import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { crews, explorers, media, parks, reviews, visits } from "@/db/schema";
import { currentExplorerId } from "./session";

export type Me = {
  id: number;
  name: string;
  color: string;
  avatar: string;
  crew: {
    id: number;
    name: string;
    color: string;
    joinCode: string;
    friendCode: string;
  };
};

export async function getMe(): Promise<Me | null> {
  const id = await currentExplorerId();
  if (!id) return null;
  const rows = await db
    .select({ explorer: explorers, crew: crews })
    .from(explorers)
    .innerJoin(crews, eq(crews.id, explorers.crewId))
    .where(eq(explorers.id, id));
  const row = rows[0];
  if (!row) return null;
  const { explorer, crew } = row;
  return {
    id: explorer.id,
    name: explorer.name,
    color: explorer.color,
    avatar: explorer.avatar,
    crew: {
      id: crew.id,
      name: crew.name,
      color: crew.color,
      joinCode: crew.joinCode,
      friendCode: crew.friendCode,
    },
  };
}

export type ParkSummary = {
  id: number;
  slug: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  kind: string;
  features: string[];
  confidence: string;
  avgTenths: number | null;
  reviewCount: number;
  /** ISO date of my crew's most recent visit, or null if we haven't been. */
  lastVisit: string | null;
  visitCount: number;
  cover: string | null;
  /** How many explorer reviews reported each attribute key. */
  reports: Record<string, number>;
  /** "active", or why it was crossed off the bucket list. */
  status: string;
  statusNote: string | null;
};

/** Every active (still-to-play) park plus ratings and my crew's visit status. */
export async function getParkSummaries(
  crewId: number | null,
): Promise<ParkSummary[]> {
  return summaries(crewId, false);
}

/** The whole bucket list: active parks and crossed-off ones. */
export async function getBucketList(
  crewId: number | null,
): Promise<ParkSummary[]> {
  return summaries(crewId, true);
}

async function reportCounts(): Promise<Map<number, Record<string, number>>> {
  const rows = await db.execute<{ park_id: number; tag: string; n: number }>(
    sql`select park_id, tag, count(*)::int as n from ${reviews}, unnest(${reviews.tags}) as tag group by park_id, tag`,
  );
  const out = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const rec = out.get(r.park_id) ?? {};
    rec[r.tag] = r.n;
    out.set(r.park_id, rec);
  }
  return out;
}

async function summaries(
  crewId: number | null,
  includeCrossedOff: boolean,
): Promise<ParkSummary[]> {
  const ratingAgg = db
    .select({
      parkId: reviews.parkId,
      avg: sql<number>`round(avg(${reviews.ratingTenths}))::int`.as("avg"),
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(reviews)
    .groupBy(reviews.parkId)
    .as("r");

  const visitAgg = db
    .select({
      parkId: visits.parkId,
      last: sql<string>`max(${visits.visitedOn})::text`.as("last"),
      n: sql<number>`count(*)::int`.as("vn"),
    })
    .from(visits)
    .where(eq(visits.crewId, crewId ?? -1))
    .groupBy(visits.parkId)
    .as("v");

  const coverAgg = db
    .select({
      parkId: reviews.parkId,
      url: sql<string>`(array_agg(${media.url} order by ${media.createdAt} desc))[1]`.as(
        "cover",
      ),
    })
    .from(media)
    .innerJoin(reviews, eq(reviews.id, media.reviewId))
    .where(eq(media.kind, "image"))
    .groupBy(reviews.parkId)
    .as("c");

  const reportsP = reportCounts();
  const rows = await db
    .select({
      park: parks,
      avg: ratingAgg.avg,
      n: ratingAgg.n,
      last: visitAgg.last,
      vn: visitAgg.n,
      cover: coverAgg.url,
    })
    .from(parks)
    .leftJoin(ratingAgg, eq(ratingAgg.parkId, parks.id))
    .leftJoin(visitAgg, eq(visitAgg.parkId, parks.id))
    .leftJoin(coverAgg, eq(coverAgg.parkId, parks.id))
    .where(includeCrossedOff ? undefined : eq(parks.status, "active"))
    .orderBy(asc(parks.city), asc(parks.name));
  const reports = await reportsP;

  return rows.map(({ park, avg, n, last, vn, cover }) => ({
    id: park.id,
    slug: park.slug,
    name: park.name,
    city: park.city,
    lat: park.lat,
    lng: park.lng,
    kind: park.kind,
    features: park.features,
    confidence: park.confidence,
    avgTenths: avg ?? null,
    reviewCount: n ?? 0,
    lastVisit: last ?? null,
    visitCount: vn ?? 0,
    cover: cover ?? null,
    reports: reports.get(park.id) ?? {},
    status: park.status,
    statusNote: park.statusNote,
  }));
}

export type ReviewView = {
  id: number;
  ratingTenths: number;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  explorer: {
    id: number;
    name: string;
    color: string;
    avatar: string;
    crewName: string;
  };
  media: { id: number; url: string; kind: string }[];
};

export async function getParkDetail(slug: string, crewId: number | null) {
  const park = (await db.select().from(parks).where(eq(parks.slug, slug)))[0];
  if (!park) return null;

  const reviewRows = await db
    .select({ review: reviews, explorer: explorers, crewName: crews.name })
    .from(reviews)
    .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
    .innerJoin(crews, eq(crews.id, explorers.crewId))
    .where(eq(reviews.parkId, park.id))
    .orderBy(desc(reviews.updatedAt));

  const ids = reviewRows.map((r) => r.review.id);
  const mediaRows = ids.length
    ? await db
        .select()
        .from(media)
        .where(inArray(media.reviewId, ids))
        .orderBy(asc(media.createdAt))
    : [];

  const reviewViews: ReviewView[] = reviewRows.map(
    ({ review, explorer, crewName }) => ({
      id: review.id,
      ratingTenths: review.ratingTenths,
      body: review.body,
      tags: review.tags,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      explorer: {
        id: explorer.id,
        name: explorer.name,
        color: explorer.color,
        avatar: explorer.avatar,
        crewName,
      },
      media: mediaRows
        .filter((m) => m.reviewId === review.id)
        .map((m) => ({ id: m.id, url: m.url, kind: m.kind })),
    }),
  );

  const myVisits = crewId
    ? await db
        .select({
          id: visits.id,
          visitedOn: visits.visitedOn,
          by: explorers.name,
        })
        .from(visits)
        .innerJoin(explorers, eq(explorers.id, visits.loggedBy))
        .where(and(eq(visits.parkId, park.id), eq(visits.crewId, crewId)))
        .orderBy(desc(visits.visitedOn))
    : [];

  return { park, reviews: reviewViews, myVisits };
}

export async function getPassport(crewId: number) {
  const members = await db
    .select()
    .from(explorers)
    .where(eq(explorers.crewId, crewId))
    .orderBy(asc(explorers.createdAt));
  const stamps = await db
    .select({
      id: visits.id,
      visitedOn: visits.visitedOn,
      park: { slug: parks.slug, name: parks.name, city: parks.city },
    })
    .from(visits)
    .innerJoin(parks, eq(parks.id, visits.parkId))
    .where(eq(visits.crewId, crewId))
    .orderBy(desc(visits.visitedOn), desc(visits.id));
  const myReviews = await db
    .select({ tenths: reviews.ratingTenths, explorerId: reviews.explorerId })
    .from(reviews)
    .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
    .where(eq(explorers.crewId, crewId));
  return { members, stamps, myReviews };
}

export async function findCrewByCode(code: string) {
  const byJoin = (
    await db.select().from(crews).where(eq(crews.joinCode, code))
  )[0];
  if (byJoin) {
    const members = await db
      .select()
      .from(explorers)
      .where(eq(explorers.crewId, byJoin.id));
    return { kind: "join" as const, crew: byJoin, members };
  }
  const byFriend = (
    await db.select().from(crews).where(eq(crews.friendCode, code))
  )[0];
  if (byFriend) return { kind: "friend" as const, crew: byFriend, members: [] };
  return null;
}

/** Recent reviews across everyone, for the "fresh scribbles" feed. */
export async function getRecentReviews(limit = 8) {
  return db
    .select({
      id: reviews.id,
      ratingTenths: reviews.ratingTenths,
      body: reviews.body,
      updatedAt: reviews.updatedAt,
      park: { slug: parks.slug, name: parks.name, city: parks.city },
      explorer: {
        name: explorers.name,
        color: explorers.color,
        avatar: explorers.avatar,
      },
    })
    .from(reviews)
    .innerJoin(parks, eq(parks.id, reviews.parkId))
    .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
    .orderBy(desc(reviews.updatedAt))
    .limit(limit);
}
