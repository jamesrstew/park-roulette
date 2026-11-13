import "server-only";
import { parkShownSql } from "./data";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crews, explorers, media, parks, reviews, visits } from "@/db/schema";
import { normalizePlay } from "./features";

export type PassportPark = {
  id: number;
  slug: string;
  name: string;
  city: string;
  features: string[];
  /** playground | nature | none */
  play: string;
  status: string;
};

export type PassportData = Awaited<ReturnType<typeof getPassportData>>;

/**
 * Everything the passport needs for one crew, in parallel. Parks include every
 * status (crossed-off parks count as "done") and every play type (the
 * playground quest skips play "none"; the every-park count doesn't).
 */
export async function getPassportData(crewId: number) {
  const [crewRows, members, allParks, crewVisits, crewReviews, photos] =
    await Promise.all([
      db
        .select({ name: crews.name, color: crews.color })
        .from(crews)
        .where(eq(crews.id, crewId)),
      db
        .select({
          id: explorers.id,
          name: explorers.name,
          color: explorers.color,
          avatar: explorers.avatar,
        })
        .from(explorers)
        .where(eq(explorers.crewId, crewId))
        .orderBy(asc(explorers.createdAt), asc(explorers.id)),
      db
        .select({
          id: parks.id,
          slug: parks.slug,
          name: parks.name,
          city: parks.city,
          features: parks.features,
          play: parks.play,
          status: parks.status,
        })
        .from(parks)
        .where(parkShownSql(crewId))
        .orderBy(asc(parks.city), asc(parks.name)),
      db
        .select({
          id: visits.id,
          parkId: visits.parkId,
          visitedOn: sql<string>`${visits.visitedOn}::text`,
        })
        .from(visits)
        .where(eq(visits.crewId, crewId))
        .orderBy(desc(visits.visitedOn), desc(visits.id)),
      db
        .select({
          parkId: reviews.parkId,
          explorerId: reviews.explorerId,
          tenths: reviews.ratingTenths,
          tags: reviews.tags,
        })
        .from(reviews)
        .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
        .where(eq(explorers.crewId, crewId)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(media)
        .innerJoin(reviews, eq(reviews.id, media.reviewId))
        .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
        .where(eq(explorers.crewId, crewId)),
    ]);

  return {
    crew: crewRows[0] ?? { name: "Our family", color: "red" },
    members,
    parks: allParks.map(normalizePlay) as PassportPark[],
    visits: crewVisits,
    reviews: crewReviews,
    photoCount: photos[0]?.n ?? 0,
  };
}
