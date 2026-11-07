import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { explorers, reviews, visits } from "@/db/schema";

export type CrewMember = {
  id: number;
  name: string;
  color: string;
  avatar: string;
  reviewCount: number;
};

/** Everyone in a crew, oldest first, with how many reviews each has written. */
export async function getCrewMembers(crewId: number): Promise<CrewMember[]> {
  const counts = db
    .select({
      explorerId: reviews.explorerId,
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(reviews)
    .groupBy(reviews.explorerId)
    .as("rc");
  const rows = await db
    .select({
      id: explorers.id,
      name: explorers.name,
      color: explorers.color,
      avatar: explorers.avatar,
      n: counts.n,
    })
    .from(explorers)
    .leftJoin(counts, eq(counts.explorerId, explorers.id))
    .where(eq(explorers.crewId, crewId))
    .orderBy(asc(explorers.createdAt), asc(explorers.id));
  return rows.map((r) => ({ ...r, reviewCount: r.n ?? 0 }));
}

/** How many different parks this crew has stamped. */
export async function getCrewStampCount(crewId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${visits.parkId})::int` })
    .from(visits)
    .where(eq(visits.crewId, crewId));
  return row?.n ?? 0;
}
