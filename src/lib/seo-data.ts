import "server-only";
import { sql } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { db } from "@/db";
import { getBucketList, type ParkSummary } from "./data";
import { attributeScores, isCrossedOff, playOf } from "./features";
import { townSlug } from "./towns";

/**
 * The public, signed-out view of every park (what search engines and AI
 * assistants see): ratings, stickers and town. Cached for an hour; it's the
 * same for everyone.
 */
export type PublicPark = ParkSummary & {
  /** When this park's public facts last changed (a review, or added). */
  updated: string;
};

export async function publicParks(): Promise<PublicPark[]> {
  "use cache";
  cacheLife("hours");
  const [list, changed] = await Promise.all([
    getBucketList(null),
    db.execute<{ id: number; updated: Date | string }>(sql`
      select p.id, greatest(
        p.created_at, p.approved_at,
        max(r.updated_at) filter (
          where greatest(r.created_at, r.updated_at) < now() - interval '1 hour'
        )
      ) as updated
      from parks p left join reviews r on r.park_id = p.id and r.hidden_at is null
      group by p.id`),
  ]);
  // Day precision ("2026-11-13"): never the minute something changed.
  const when = new Map(changed.map((c) => [c.id, dayOf(new Date(c.updated))]));
  return list
    .filter((p) => !isCrossedOff(p))
    .map((p) => ({
      ...p,
      updated: when.get(p.id) ?? "2026-01-01",
    }));
}

/** A town gets its own page with this many parks; smaller ones share the hub. */
export const TOWN_PAGE_MIN = 4;

export type Town = { name: string; slug: string; parks: PublicPark[] };

export function townsOf(parks: PublicPark[]): Town[] {
  const by = new Map<string, Town>();
  for (const p of parks) {
    const slug = townSlug(p.city);
    const t = by.get(slug) ?? { name: p.city, slug, parks: [] };
    t.parks.push(p);
    by.set(slug, t);
  }
  return [...by.values()].sort(
    (a, b) => b.parks.length - a.parks.length || a.name.localeCompare(b.name),
  );
}

export const hasOwnPage = (t: Town) => t.parks.length >= TOWN_PAGE_MIN;

/** Where a town's parks are listed: its own page, or the Central Oregon hub. */
export function townPageHref(t: Town): string {
  return hasOwnPage(t) ? `/towns/${t.slug}` : `/towns#${t.slug}`;
}

export function scoresOf(p: PublicPark) {
  return attributeScores(p.features, p.reports);
}

export const hasPlay = (p: PublicPark) => playOf(p) !== "none";

/** Feature pages ("Splash pads in Central Oregon"). Published at 3+ parks. */
export type FeaturePage = {
  slug: string;
  /** "Splash pads" */
  title: string;
  /** "splash pad" (for sentences) */
  noun: string;
  plural: string;
  blurb: string;
  matches: (p: PublicPark) => boolean;
};

const s = (p: PublicPark, k: string) => (scoresOf(p)[k] ?? 0) > 0;

export const FEATURE_PAGES: FeaturePage[] = [
  {
    slug: "splash-pads",
    title: "Splash pads",
    noun: "splash pad",
    plural: "splash pads",
    blurb: "Spray grounds and splash pads for hot Central Oregon summer days.",
    matches: (p) => s(p, "splash_pad"),
  },
  {
    slug: "toddler-friendly",
    title: "Toddler-friendly playgrounds",
    noun: "toddler-friendly playground",
    plural: "toddler-friendly playgrounds",
    blurb: "Playgrounds with a toddler area, baby swings or a fence.",
    matches: (p) =>
      hasPlay(p) &&
      (s(p, "toddler_area") || s(p, "baby_swings") || s(p, "fenced")),
  },
  {
    slug: "shaded",
    title: "Shaded playgrounds",
    noun: "shaded playground",
    plural: "shaded playgrounds",
    blurb: "Playgrounds with shade, for sunny afternoons and hot slides.",
    matches: (p) => hasPlay(p) && s(p, "shade") && !s(p, "no_shade"),
  },
  {
    slug: "accessible",
    title: "Accessible playgrounds",
    noun: "accessible playground",
    plural: "accessible playgrounds",
    blurb: "Playgrounds marked wheelchair and mobility friendly.",
    matches: (p) => hasPlay(p) && s(p, "accessible"),
  },
  {
    slug: "with-restrooms",
    title: "Playgrounds with restrooms",
    noun: "playground with restrooms",
    plural: "playgrounds with restrooms",
    blurb: "Playgrounds with a restroom nearby.",
    matches: (p) => hasPlay(p) && s(p, "restrooms") && !s(p, "no_restrooms"),
  },
  {
    slug: "dog-friendly",
    title: "Dog-friendly parks",
    noun: "dog-friendly park",
    plural: "dog-friendly parks",
    blurb: "Parks where the dog can come too, including dog parks.",
    matches: (p) => s(p, "dog_friendly") || s(p, "dog_park"),
  },
];

export const FEATURE_PAGE_MIN = 3;

export function featurePage(slug: string) {
  return FEATURE_PAGES.find((f) => f.slug === slug) ?? null;
}

/** Newest change among some parks (ISO), for "Updated" lines and sitemaps. */
export function newest(parks: PublicPark[]): string {
  return parks.reduce((a, p) => (p.updated > a ? p.updated : a), "");
}

/** Ratings a park needs before we call it "top rated" or mark up its stars. */
export const MIN_RATINGS = 3;

/** Best rated first (parks with 3+ ratings), ties by more reviews. */
export function topRated(parks: PublicPark[], n = 5): PublicPark[] {
  return parks
    .filter((p) => p.avgTenths != null && p.reviewCount >= MIN_RATINGS)
    .sort(
      (a, b) =>
        b.avgTenths! - a.avgTenths! ||
        b.reviewCount - a.reviewCount ||
        a.name.localeCompare(b.name),
    )
    .slice(0, n);
}

/** "2026-11-13", the day in Central Oregon. */
export function dayOf(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** "November 13, 2026" (from "2026-11-13"); "" stays "". */
export function longDate(day: string): string {
  if (!day) return "";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
