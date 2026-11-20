import { ATTRIBUTES } from "@/lib/features";
import { type LatLng, milesBetween } from "@/lib/geo";
import { playOf } from "@/lib/features";
import type { StoredEvent } from "./model";

/**
 * Playgrounds near an event: one function for the listing card's
 * "Closest playground" line and the event page's three rows, so the
 * numbers always match. Straight-line miles (fine at this scale).
 */

export type NearPark = {
  slug: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  play?: string | null;
  status: string;
  features: string[];
  avgTenths: number | null;
  reviewCount: number;
};

export type Near = {
  slug: string;
  name: string;
  miles: number;
  /** Stars only with 3 or more ratings (never a shaky number). */
  stars: number | null;
  /** Two feature labels. */
  features: string[];
};

/** The venue is itself a park with play: "Playground on site". */
export function playgroundOnSite(
  e: StoredEvent,
  parks: readonly NearPark[],
): NearPark | null {
  if (!e.venue.park) return null;
  const p = parks.find((x) => x.slug === e.venue.park);
  return p && playOf(p) !== "none" ? p : null;
}

/** The closest parks with play within `maxMiles`, nearest first. */
export function nearbyPlaygrounds(
  point: LatLng | null,
  parks: readonly NearPark[],
  opts: { n?: number; maxMiles?: number; skip?: string } = {},
): Near[] {
  if (!point) return [];
  return parks
    .filter((p) => p.slug !== opts.skip && playOf(p) !== "none")
    .map((p) => ({ p, miles: milesBetween(point, p) }))
    .filter((x) => x.miles <= (opts.maxMiles ?? 10))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, opts.n ?? 3)
    .map(({ p, miles }) => ({
      slug: p.slug,
      name: p.name,
      miles: Math.round(miles * 10) / 10,
      stars:
        p.reviewCount >= 3 && p.avgTenths != null ? p.avgTenths / 10 : null,
      features: p.features
        .filter((f) => ATTRIBUTES[f]?.kind === "good")
        .slice(0, 2)
        .map((f) => ATTRIBUTES[f].label),
    }));
}

/** "3.3 mi" (the accessible name says "3.3 miles away"). */
export function miles(m: number): string {
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} mi`;
}

/** The listing's one line: "Playground on site" or "Closest playground: X, 3.3 mi". */
export function closestLine(
  e: StoredEvent,
  parks: readonly NearPark[],
): { text: string; label: string } | null {
  if (playgroundOnSite(e, parks))
    return { text: "Playground on site", label: "Playground on site" };
  const [c] = nearbyPlaygrounds(e.point, parks, { n: 1 });
  if (!c) return null;
  return {
    text: `Closest playground: ${c.name}, ${miles(c.miles)}`,
    label: `Closest playground: ${c.name}, ${c.miles.toFixed(1)} miles away`,
  };
}
