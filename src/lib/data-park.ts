import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { parks, reviews } from "@/db/schema";

/**
 * What a park's link preview shows: name, town, stars. Never photos (they
 * only show to signed-in families). Public information only (previews are fetched by messaging apps, signed out).
 */
export async function getParkShare(slug: string) {
  const [park] = await db
    .select({
      id: parks.id,
      name: parks.name,
      city: parks.city,
      play: parks.play,
      status: parks.status,
      approved: sql<boolean>`${parks.approvedAt} is not null`,
    })
    .from(parks)
    .where(eq(parks.slug, slug));
  if (!park) return null;
  const [stars] = await db
    .select({
      avg: sql<number | null>`avg(${reviews.ratingTenths})::float`,
      n: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(and(eq(reviews.parkId, park.id), isNull(reviews.hiddenAt)));
  return {
    ...park,
    avgTenths: stars?.avg == null ? null : Math.round(stars.avg),
    reviewCount: stars?.n ?? 0,
  };
}
