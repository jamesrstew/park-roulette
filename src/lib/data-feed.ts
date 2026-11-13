import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  crews,
  explorers,
  media,
  parkChanges,
  parks,
  reviews,
} from "@/db/schema";
import { parkShownSql, type Me } from "./data";
import { mediaSrc, viewerOf, visibleSql } from "./visibility";

export type FeedReview = {
  type: "review";
  id: number;
  at: string;
  ratingTenths: number;
  body: string;
  tags: string[];
  park: { slug: string; name: string; city: string };
  explorer: { name: string; color: string; avatar: string; crewName: string };
  ours: boolean;
  photos: string[];
};

export type FeedPark = {
  type: "park";
  id: number;
  at: string;
  topic: string;
  value: string;
  families: number;
  park: { slug: string; name: string; city: string };
};

export type FeedItem = FeedReview | FeedPark;

/**
 * What's new around town: reviews this person may see (another family's
 * show an hour after they're written, so the feed never says where anyone
 * is right now) and park news (fixes the town agreed on, new parks).
 */
export async function getFeed(me: Me | null, limit = 30): Promise<FeedItem[]> {
  const viewer = viewerOf(me);
  const reviewRows = await db
    .select({
      id: reviews.id,
      createdAt: reviews.createdAt,
      ratingTenths: reviews.ratingTenths,
      body: reviews.body,
      tags: reviews.tags,
      crewId: explorers.crewId,
      park: { slug: parks.slug, name: parks.name, city: parks.city },
      explorer: {
        name: explorers.name,
        color: explorers.color,
        avatar: explorers.avatar,
        crewName: crews.name,
      },
    })
    .from(reviews)
    .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
    .innerJoin(crews, eq(crews.id, explorers.crewId))
    .innerJoin(parks, eq(parks.id, reviews.parkId))
    .where(
      and(
        visibleSql(viewer, {
          visibility: reviews.visibility,
          hiddenAt: reviews.hiddenAt,
          createdAt: reviews.createdAt,
          updatedAt: reviews.updatedAt,
          crewId: explorers.crewId,
        }),
        parkShownSql(me?.crew.id ?? null),
      ),
    )
    .orderBy(desc(reviews.createdAt))
    .limit(limit);

  // Photos only for people signed in (never videos: those stay in families).
  const ids = reviewRows.map((r) => r.id);
  const photoRows =
    viewer && ids.length
      ? await db
          .select({ id: media.id, reviewId: media.reviewId })
          .from(media)
          .where(and(inArray(media.reviewId, ids), eq(media.kind, "image")))
          .orderBy(media.createdAt)
      : [];

  const changeRows = await db
    .select({
      id: parkChanges.id,
      createdAt: parkChanges.createdAt,
      topic: parkChanges.topic,
      value: parkChanges.value,
      families: parkChanges.families,
      park: { slug: parks.slug, name: parks.name, city: parks.city },
    })
    .from(parkChanges)
    .innerJoin(parks, eq(parks.id, parkChanges.parkId))
    .where(sql`${parks.approvedAt} is not null`)
    .orderBy(desc(parkChanges.createdAt))
    .limit(limit);

  const items: FeedItem[] = [
    ...reviewRows.map((r): FeedReview => ({
      type: "review",
      id: r.id,
      at: r.createdAt.toISOString(),
      ratingTenths: r.ratingTenths,
      body: r.body,
      tags: r.tags,
      park: r.park,
      explorer: r.explorer,
      ours: !!viewer && viewer.crewId === r.crewId,
      photos: photoRows
        .filter((p) => p.reviewId === r.id)
        .slice(0, 3)
        .map((p) => mediaSrc(p.id)),
    })),
    ...changeRows.map((c): FeedPark => ({
      type: "park",
      id: c.id,
      at: c.createdAt.toISOString(),
      topic: c.topic,
      value: c.value,
      families: c.families,
      park: c.park,
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
