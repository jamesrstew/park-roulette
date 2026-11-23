import "server-only";
import { allEvents } from "./events/store";
import type { StoredEvent } from "./events/model";
import {
  buildGuide,
  GUIDES,
  type GuideInput,
  guidePath,
  guidesForEvents,
  type GuideView,
} from "./guides";
import { CATALOG } from "./news/catalog";
import { currentProfiles } from "./park-profiles-check";
import { publicParks, townPageHref, townsOf } from "./seo-data";
import { SITE_URL } from "./site";
import { townSlug } from "./towns";

/**
 * What the seasonal guides are built from, loaded once per request: the
 * public parks, live signature traits, kids' events and the indoor venue
 * catalog. Callers have awaited connection() (live data, never a
 * build-time snapshot).
 */
export async function guideInput(now: Date): Promise<GuideInput> {
  const [parks, events, profiles] = await Promise.all([
    publicParks(),
    allEvents(),
    currentProfiles(now),
  ]);
  const towns = new Map(townsOf(parks).map((t) => [t.slug, t]));
  return {
    parks,
    events,
    profiles,
    venues: CATALOG.venues,
    now,
    townHref: (city) => {
      const t = towns.get(townSlug(city));
      return t ? townPageHref(t) : "/towns";
    },
  };
}

export async function loadGuide(
  slug: string,
  now: Date,
): Promise<GuideView | null> {
  if (!GUIDES.some((g) => g.slug === slug)) return null;
  return buildGuide(slug, await guideInput(now));
}

export async function allGuides(now: Date): Promise<GuideView[]> {
  const input = await guideInput(now);
  return GUIDES.map((g) => buildGuide(g.slug, input)!);
}

/**
 * Guide pages a set of changed events touches, for IndexNow (the holiday
 * guide for holiday events, the indoor guide for indoor ones, and the
 * guides index). `known` is event data the caller already has; the rest
 * is looked up by slug. Never throws: a failed lookup sends nothing extra.
 */
export async function guideUrlsForEvents(
  slugs: readonly string[],
  known: readonly StoredEvent[] = [],
): Promise<string[]> {
  if (!slugs.length && !known.length) return [];
  try {
    const want = new Set(slugs);
    const rows = slugs.length
      ? (await allEvents()).filter((r) => want.has(r.slug)).map((r) => r.data)
      : [];
    const hit = guidesForEvents([...known, ...rows]);
    return hit.length
      ? [`${SITE_URL}/guides`, ...hit.map((g) => `${SITE_URL}${guidePath(g)}`)]
      : [];
  } catch (e) {
    console.warn("[guides] event lookup failed", (e as Error)?.message);
    return [];
  }
}
