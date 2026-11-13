import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { crews, explorers, media, parks, reviews, visits } from "@/db/schema";
import { isCrossedOff, normalizePlay } from "./features";
import { readSession, trusted } from "./session";
import {
  canSee,
  canSeeMedia,
  mediaSrc,
  SHOW_AFTER_MS,
  viewerOf,
} from "./visibility";

export type Me = {
  id: number;
  name: string;
  color: string;
  avatar: string;
  /** My verified number (E.164), or null. Only ever shown to me. */
  phone: string | null;
  /**
   * Did this phone sign in a trusted way (joined here, a texted code, or from
   * before phone sign-in)? Only then may it add or change a number.
   */
  trusted: boolean;
  /** A kid's explorer: stars and tags only, no words or photos. */
  isKid: boolean;
  /** Can moderate (hide reviews, settle park fixes). */
  isAdmin: boolean;
  /** Has agreed to the Terms and Privacy Policy. */
  termsAccepted: boolean;
  crew: {
    id: number;
    name: string;
    color: string;
    joinCode: string;
    friendCode: string;
  };
};

/**
 * Who's signed in on this phone, or null. A cookie only counts if its epoch
 * still matches the explorer's (bumped when their phone number changes).
 */
export async function getMe(): Promise<Me | null> {
  const session = await readSession();
  if (!session) return null;
  const rows = await db
    .select({
      id: explorers.id,
      name: explorers.name,
      color: explorers.color,
      avatar: explorers.avatar,
      phone: explorers.phone,
      sessionEpoch: explorers.sessionEpoch,
      isKid: explorers.isKid,
      isAdmin: explorers.isAdmin,
      termsAcceptedAt: explorers.termsAcceptedAt,
      crew: {
        id: crews.id,
        name: crews.name,
        color: crews.color,
        joinCode: crews.joinCode,
        friendCode: crews.friendCode,
      },
    })
    .from(explorers)
    .innerJoin(crews, eq(crews.id, explorers.crewId))
    .where(eq(explorers.id, session.id));
  const row = rows[0];
  if (!row || row.sessionEpoch !== session.epoch) return null;
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    avatar: row.avatar,
    phone: row.phone,
    trusted: trusted(session.by),
    isKid: row.isKid,
    isAdmin: row.isAdmin,
    termsAccepted: row.termsAcceptedAt != null,
    crew: row.crew,
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
  /** How many explorer reviews reported each attribute key. */
  reports: Record<string, number>;
  /** playground | nature | none */
  play: string;
  /** A line about the park ("Bend's only free splash pad"), or null. */
  notes: string | null;
  /** "active", or why it was crossed off the bucket list. */
  status: string;
  statusNote: string | null;
  /** False for a family-added park nobody else has confirmed yet. */
  approved: boolean;
};

/** Every park still on the list (not closed/private), with ratings and my crew's visits. */
export async function getParkSummaries(me: Me | null): Promise<ParkSummary[]> {
  return summaries(me, false);
}

/** The whole bucket list: parks still on it and crossed-off ones. */
export async function getBucketList(me: Me | null): Promise<ParkSummary[]> {
  return summaries(me, true);
}

async function reportCounts(): Promise<Map<number, Record<string, number>>> {
  const rows = await db.execute<{ park_id: number; tag: string; n: number }>(
    sql`select park_id, tag, count(*)::int as n from ${reviews}, unnest(${reviews.tags}) as tag where ${reviews.hiddenAt} is null group by park_id, tag`,
  );
  const out = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const rec = out.get(r.park_id) ?? {};
    rec[r.tag] = r.n;
    out.set(r.park_id, rec);
  }
  return out;
}

/**
 * A family-added park counts for everyone once a second family (or an
 * admin) confirms it. Until then only the family that added it sees it on
 * their wheel, map and list.
 */
export function parkShownSql(crewId: number | null) {
  return sql`(${parks.approvedAt} is not null or ${parks.addedBy} in (select ${explorers.id} from ${explorers} where ${explorers.crewId} = ${crewId ?? -1}))`;
}

async function summaries(
  me: Me | null,
  includeCrossedOff: boolean,
): Promise<ParkSummary[]> {
  const crewId = me?.crew.id ?? null;
  const ratingAgg = db
    .select({
      parkId: reviews.parkId,
      avg: sql<number>`round(avg(${reviews.ratingTenths}))::int`.as("avg"),
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(reviews)
    .where(sql`${reviews.hiddenAt} is null`)
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

  const reportsP = reportCounts();
  const rows = await db
    .select({
      park: parks,
      avg: ratingAgg.avg,
      n: ratingAgg.n,
      last: visitAgg.last,
      vn: visitAgg.n,
    })
    .from(parks)
    .leftJoin(ratingAgg, eq(ratingAgg.parkId, parks.id))
    .leftJoin(visitAgg, eq(visitAgg.parkId, parks.id))
    .where(parkShownSql(crewId))
    .orderBy(asc(parks.city), asc(parks.name));
  const reports = await reportsP;

  const all = rows.map(({ park, avg, n, last, vn }) =>
    normalizePlay({
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
      reports: reports.get(park.id) ?? {},
      play: park.play,
      notes: park.notes?.trim() || null,
      status: park.status,
      statusNote: park.statusNote,
      approved: park.approvedAt != null,
    }),
  );
  return includeCrossedOff ? all : all.filter((p) => !isCrossedOff(p));
}

export type ReviewView = {
  id: number;
  ratingTenths: number;
  body: string;
  tags: string[];
  visibility: string;
  /** Hidden by reports or an admin (only the author's family sees it then). */
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  explorer: {
    id: number;
    name: string;
    color: string;
    avatar: string;
    crewName: string;
    crewId: number;
  };
  /** `url` is our own /photos/<id> door, never the storage address. */
  media: { id: number; url: string; kind: string }[];
};

export async function getParkDetail(slug: string, me: Me | null) {
  const row = (await db.select().from(parks).where(eq(parks.slug, slug)))[0];
  if (!row) return null;
  const park = normalizePlay(row);
  const crewId = me?.crew.id ?? null;
  const viewer = viewerOf(me);

  const reviewRows = await db
    .select({
      review: reviews,
      explorer: {
        id: explorers.id,
        name: explorers.name,
        color: explorers.color,
        avatar: explorers.avatar,
        crewId: explorers.crewId,
      },
      crewName: crews.name,
    })
    .from(reviews)
    .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
    .innerJoin(crews, eq(crews.id, explorers.crewId))
    .where(eq(reviews.parkId, park.id))
    .orderBy(desc(reviews.updatedAt));

  // Stars and tags from every review that isn't hidden count for the park;
  // the reviews themselves only show to people allowed to see them.
  const counted = reviewRows.filter((r) => r.review.hiddenAt == null);
  const stats = {
    ratings: counted.map((r) => r.review.ratingTenths),
    tags: counted.map((r) => r.review.tags),
  };
  const accessOf = (r: (typeof reviewRows)[number]) => ({
    visibility: r.review.visibility,
    hidden: r.review.hiddenAt != null,
    crewId: r.explorer.crewId,
    createdAt: r.review.createdAt,
    updatedAt: r.review.updatedAt,
  });
  const shown = reviewRows.filter((r) => canSee(viewer, accessOf(r)));
  // Signed out: reviews that signing in would show ("hop in to read them").
  const unseen = viewer
    ? 0
    : reviewRows.filter((r) => canSee({ crewId: -1 }, accessOf(r))).length -
      shown.length;

  const ids = shown.map((r) => r.review.id);
  const mediaRows = ids.length
    ? await db
        .select({
          id: media.id,
          reviewId: media.reviewId,
          kind: media.kind,
        })
        .from(media)
        .where(inArray(media.reviewId, ids))
        .orderBy(asc(media.createdAt))
    : [];

  const reviewViews: ReviewView[] = shown.map((r) => {
    const { review, explorer, crewName } = r;
    const access = accessOf(r);
    return {
      id: review.id,
      ratingTenths: review.ratingTenths,
      body: review.body,
      tags: review.tags,
      visibility: review.visibility,
      hidden: review.hiddenAt != null,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      explorer: { ...explorer, crewName },
      media: mediaRows
        .filter(
          (m) =>
            m.reviewId === review.id && canSeeMedia(viewer, access, m.kind),
        )
        .map((m) => ({ id: m.id, url: mediaSrc(m.id), kind: m.kind })),
    };
  });

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

  let addedByUs = false;
  if (row.addedBy && crewId) {
    const [a] = await db
      .select({ crewId: explorers.crewId })
      .from(explorers)
      .where(eq(explorers.id, row.addedBy));
    addedByUs = a?.crewId === crewId;
  }

  return {
    park: { ...park, approved: row.approvedAt != null, addedByUs },
    reviews: reviewViews,
    stats,
    /** Signed out: reviews signing in would show (their stars already count). */
    unseen,
    /**
     * Stars from reviews this viewer can't read, with no names: everyone
     * sees every rating (the park's score is the point of the app).
     */
    otherRatings: counted
      .filter((r) => !shown.includes(r))
      // Settled ones only (an hour after the last change), so a named card
      // and an anonymous star can't be matched up by timing.
      .filter(
        (r) =>
          Date.now() -
            Math.max(
              r.review.createdAt.getTime(),
              r.review.updatedAt.getTime(),
            ) >=
          SHOW_AFTER_MS,
      )
      .map((r) => r.review.ratingTenths)
      .sort((a, b) => b - a),
    myVisits,
  };
}

export async function findCrewByCode(code: string) {
  const byJoin = (
    await db.select().from(crews).where(eq(crews.joinCode, code))
  )[0];
  if (byJoin) {
    // Never phone numbers: this goes to anyone holding the link.
    const members = await db
      .select({
        id: explorers.id,
        name: explorers.name,
        color: explorers.color,
        avatar: explorers.avatar,
        hasPhone: sql<boolean>`${explorers.phone} is not null`,
      })
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
