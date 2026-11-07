import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { parks } from "@/db/schema";

export type ParkPin = {
  id: number;
  slug: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
};

/** Every park as a bare pin (for the add-a-park map and duplicate check). */
export async function getParkPins(): Promise<ParkPin[]> {
  return db
    .select({
      id: parks.id,
      slug: parks.slug,
      name: parks.name,
      city: parks.city,
      lat: parks.lat,
      lng: parks.lng,
    })
    .from(parks)
    .orderBy(asc(parks.city), asc(parks.name));
}

/** Towns, busiest first, so the common picks sit at the front. */
export function townsOf(pins: ParkPin[]): string[] {
  const counts = new Map<string, number>();
  for (const p of pins) counts.set(p.city, (counts.get(p.city) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}
