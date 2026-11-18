import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  crews,
  explorers,
  media,
  parks,
  parkVotes,
  reviewReports,
  reviews,
} from "@/db/schema";
import type { Me } from "./data";
import { REPORT_LABELS, type ReportReason } from "./reports";
import { mediaSrc } from "./visibility";

/** A photo (never a video) on a review with an open report: admins may look. */
export async function photoUnderReview(mediaId: number): Promise<boolean> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewReports)
    .innerJoin(media, eq(media.reviewId, reviewReports.reviewId))
    .where(
      and(
        eq(media.id, mediaId),
        eq(media.kind, "image"),
        isNull(reviewReports.resolvedAt),
      ),
    );
  return (r?.n ?? 0) > 0;
}

/** How many things wait for an admin (for the dot on the Passport chip and the Admin card). */
export async function adminQueueSize(): Promise<number> {
  const [r] = await db.execute<{ n: number }>(sql`
    select
      (select count(distinct review_id) from ${reviewReports} where resolved_at is null)
      + (select count(*) from ${parks} where approved_at is null)
      + (select count(distinct (park_id, topic)) from ${parkVotes} where topic <> 'exists')
      as n`);
  return Number(r?.n ?? 0);
}

/** Everything an admin decides: reported reviews, suggested fixes, new parks. */
export async function getAdminQueue(me: Me) {
  if (!me.isAdmin || !me.trusted) return null;
  const reported = await db
    .select({
      reviewId: reviewReports.reviewId,
      reason: reviewReports.reason,
      note: reviewReports.note,
      at: reviewReports.createdAt,
    })
    .from(reviewReports)
    .where(isNull(reviewReports.resolvedAt))
    .orderBy(desc(reviewReports.createdAt));
  const ids = [...new Set(reported.map((r) => r.reviewId))];
  const reviewRows = ids.length
    ? await db
        .select({
          id: reviews.id,
          body: reviews.body,
          ratingTenths: reviews.ratingTenths,
          visibility: reviews.visibility,
          hiddenAt: reviews.hiddenAt,
          author: explorers.name,
          family: crews.name,
          park: parks.name,
          slug: parks.slug,
        })
        .from(reviews)
        .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
        .innerJoin(crews, eq(crews.id, explorers.crewId))
        .innerJoin(parks, eq(parks.id, reviews.parkId))
        .where(inArray(reviews.id, ids))
    : [];
  const photos = ids.length
    ? await db
        .select({ id: media.id, reviewId: media.reviewId, kind: media.kind })
        .from(media)
        .where(inArray(media.reviewId, ids))
    : [];

  const fixes = await db
    .select({
      parkId: parkVotes.parkId,
      topic: parkVotes.topic,
      value: parkVotes.value,
      note: parkVotes.note,
      park: parks.name,
      slug: parks.slug,
    })
    .from(parkVotes)
    .innerJoin(parks, eq(parks.id, parkVotes.parkId))
    .where(sql`${parkVotes.topic} <> 'exists'`)
    .orderBy(desc(parkVotes.createdAt));

  const newParks = await db
    .select({
      id: parks.id,
      name: parks.name,
      city: parks.city,
      slug: parks.slug,
      notes: parks.notes,
      createdAt: parks.createdAt,
    })
    .from(parks)
    .where(isNull(parks.approvedAt))
    .orderBy(desc(parks.createdAt));

  return {
    reports: reviewRows.map((r) => ({
      ...r,
      hidden: r.hiddenAt != null,
      reasons: reported
        .filter((x) => x.reviewId === r.id)
        .map((x) => ({
          label: REPORT_LABELS[x.reason as ReportReason] ?? x.reason,
          note: x.note,
        })),
      media: photos
        .filter((p) => p.reviewId === r.id)
        .map((p) => ({ id: p.id, url: mediaSrc(p.id), kind: p.kind })),
    })),
    fixes,
    newParks,
  };
}

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>;

/**
 * How Park Roulette is doing, from our own database (no tracking needed):
 * the family funnel, the last two weeks, and today's texting budget.
 */
export async function getAdminStats() {
  const [funnel] = await db.execute<{
    families: number;
    families7: number;
    families1: number;
    stamped: number;
    stamped3: number;
    reviewed: number;
    grew: number;
    grownups: number;
    withNumber: number;
    kids: number;
    reviews: number;
    photos: number;
    stamps: number;
  }>(sql`
    with fam as (
      select c.id, c.created_at,
        (select count(*) from visits v where v.crew_id = c.id) as stamps,
        (select count(*) from reviews r join explorers e on e.id = r.explorer_id where e.crew_id = c.id) as reviews,
        (select count(*) from explorers e where e.crew_id = c.id) as members
      from crews c
    )
    select
      (select count(*) from fam)::int as families,
      (select count(*) from fam where created_at > now() - interval '7 days')::int as families7,
      (select count(*) from fam where (created_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date)::int as families1,
      (select count(*) from fam where stamps > 0)::int as stamped,
      (select count(*) from fam where stamps >= 3)::int as stamped3,
      (select count(*) from fam where reviews > 0)::int as reviewed,
      (select count(*) from fam where members > 1)::int as grew,
      (select count(*) from explorers where not is_kid)::int as grownups,
      (select count(*) from explorers where phone is not null)::int as "withNumber",
      (select count(*) from explorers where is_kid)::int as kids,
      (select count(*) from reviews)::int as reviews,
      (select count(*) from media)::int as photos,
      (select count(*) from visits)::int as stamps`);
  const days = await db.execute<{
    day: string;
    families: number;
    stamps: number;
    reviews: number;
  }>(sql`
    with today as (select (now() at time zone 'America/Los_Angeles')::date as t)
    select to_char(d, 'Mon DD') as day,
      (select count(*) from crews where (created_at at time zone 'America/Los_Angeles')::date = d::date)::int as families,
      (select count(*) from visits where (created_at at time zone 'America/Los_Angeles')::date = d::date)::int as stamps,
      (select count(*) from reviews where (created_at at time zone 'America/Los_Angeles')::date = d::date)::int as reviews
    from today, generate_series(today.t - 13, today.t, interval '1 day') as d
    order by d desc`);
  const [texts] = await db.execute<{ known: number; unknown: number }>(sql`
    select
      count(*) filter (where kind = 'send' and known)::int as known,
      count(*) filter (where kind = 'send' and not known)::int as unknown
    from sms_events where created_at > now() - interval '1 day'`);
  return { funnel, days: [...days], texts };
}
