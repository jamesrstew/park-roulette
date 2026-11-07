import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { media, parks, reviews } from "@/db/schema";

/**
 * What a park's link preview shows: name, town, stars, a photo. Public
 * information only (previews are fetched by messaging apps, signed out).
 */
export async function getParkShare(slug: string) {
  const [park] = await db
    .select({
      id: parks.id,
      name: parks.name,
      city: parks.city,
      play: parks.play,
      status: parks.status,
    })
    .from(parks)
    .where(eq(parks.slug, slug));
  if (!park) return null;
  const [[stars], photos] = await Promise.all([
    db
      .select({
        avg: sql<number | null>`avg(${reviews.ratingTenths})::float`,
        n: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(eq(reviews.parkId, park.id)),
    db
      .select({ url: media.url })
      .from(media)
      .innerJoin(reviews, eq(reviews.id, media.reviewId))
      .where(and(eq(reviews.parkId, park.id), eq(media.kind, "image")))
      .orderBy(desc(media.createdAt))
      .limit(4),
  ]);
  return {
    ...park,
    avgTenths: stars?.avg == null ? null : Math.round(stars.avg),
    reviewCount: stars?.n ?? 0,
    /** Newest first; the card uses the first one it can draw. */
    photos: photos.map((p) => p.url),
  };
}
