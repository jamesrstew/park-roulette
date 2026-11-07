import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { parks } from "@/db/schema";

/** Just enough of a park for the page title. */
export async function getParkMeta(slug: string) {
  const row = (
    await db
      .select({ name: parks.name, city: parks.city, status: parks.status })
      .from(parks)
      .where(eq(parks.slug, slug))
  )[0];
  return row ?? null;
}
