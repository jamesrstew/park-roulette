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

/** How many things wait for an admin (for the badge on Me). */
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
