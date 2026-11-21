import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { crews, explorers, parks, reviews } from "@/db/schema";
import { parkShownSql, type Me } from "./data";
import { authorName, viewerOf, visibleSql } from "./visibility";

export type FreshReview = {
  id: number;
  at: string;
  ratingTenths: number;
  body: string;
  tags: string[];
  park: { slug: string; name: string; city: string };
  explorer: { name: string; color: string; avatar: string; crewName: string };
  /** Written by the viewer's own family (no "from" needed). */
  ours: boolean;
};

/**
 * The scoop's fresh reviews: the newest this person may see, by the one
 * rule in visibility.ts (another family's wait an hour, hidden ones only
 * show to their own family, signed out sees public ones only). Bylines go
 * through authorName ("A kid" to other families). No photos here.
 */
export async function freshReviews(
  me: Me | null,
  limit = 3,
): Promise<FreshReview[]> {
  const viewer = viewerOf(me);
  const rows = await db
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
        isKid: explorers.isKid,
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
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    ratingTenths: r.ratingTenths,
    body: r.body,
    tags: r.tags,
    park: r.park,
    explorer: {
      name: authorName(viewer, { ...r.explorer, crewId: r.crewId }),
      color: r.explorer.color,
      avatar: r.explorer.avatar,
      crewName: r.explorer.crewName,
    },
    ours: !!viewer && viewer.crewId === r.crewId,
  }));
}
