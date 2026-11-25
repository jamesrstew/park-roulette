import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pairingGuides, placesUsage } from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import { pingIndexNow } from "@/lib/indexnow";
import { CATALOG } from "@/lib/news/catalog";
import { pacific } from "@/lib/news/time";
import { currentProfiles } from "@/lib/park-profiles-check";
import { SITE_URL } from "@/lib/site";
import { REGISTRY } from "@/lib/social/handles";
import {
  indoorAnchors,
  type MashupTheme,
  type Place,
  postableParks,
} from "@/lib/social/mashup";
import { PlacesError, placesKey, themePlaces } from "@/lib/social/places";
import { parkPoints, PLACES_PER_DAY, placesBudget } from "@/lib/social/store";
import {
  FRESH_DAYS,
  type GuidePair,
  GUIDE_MIN,
  guidePairs,
  guidesForPark,
  guideTextProblems,
  PAIRING_GUIDES,
  type PairingGuideDef,
  pairingGuideDef,
  pairingGuidePath,
  pairingGuideView,
  type PairingGuideView,
} from "./pairing-guides";

/**
 * The park pairings guides' data (lib/pairing-guides.ts): read the last
 * good pairs from pairing_guides, and refresh them in rotation within the
 * Places budget (a daily cron, /api/cron/pairing-guides). A refresh that
 * fails keeps the last good pairs, shown for 30 days at most; after that
 * only the place ids stay (purge), and the page is gone until a refresh
 * works again.
 */

type Row = typeof pairingGuides.$inferSelect;

async function rows(): Promise<Row[]> {
  return db.select().from(pairingGuides);
}

export async function loadPairingGuide(
  slug: string,
  now: Date,
): Promise<PairingGuideView | null> {
  const g = pairingGuideDef(slug);
  if (!g) return null;
  const [r] = await db
    .select()
    .from(pairingGuides)
    .where(eq(pairingGuides.slug, slug));
  return pairingGuideView(g, r ?? null, now);
}

/** Every page that exists now (3+ fresh pairs), in PAIRING_GUIDES order. */
export async function allPairingGuides(now: Date): Promise<PairingGuideView[]> {
  const all = new Map((await rows()).map((r) => [r.slug, r]));
  return PAIRING_GUIDES.flatMap(
    (g) => pairingGuideView(g, all.get(g.slug) ?? null, now) ?? [],
  );
}

/** A park's "Nearby" links: the guides it anchors. */
export async function parkGuideLinks(slug: string, now: Date) {
  return guidesForPark(slug, await rows(), now);
}

/** A theme's page in a town, when it exists (the social post page links it). */
export async function themeGuide(
  theme: MashupTheme,
  town: string,
  now: Date,
): Promise<PairingGuideView | null> {
  const g = PAIRING_GUIDES.find(
    (x) => x.theme === theme && x.town === town && !x.rainy,
  );
  return g ? loadPairingGuide(g.slug, now) : null;
}

/** Pages refreshed per run, at most, and how old a page is before it's due. */
export const GUIDES_PER_RUN = 4;
export const DUE_DAYS = 6;
/** Places requests one run may spend (of the day's shared 60). */
export const GUIDE_REQUESTS = 12;

/** A page's pairs as a stable key (jsonb reorders object keys). */
export function pairsKey(pairs: unknown): string {
  return ((Array.isArray(pairs) ? pairs : []) as GuidePair[])
    .map((p) =>
      [
        p.placeId,
        p.place,
        p.anchorSlug,
        p.apart,
        p.anchorLine,
        (p.anchorHas ?? []).join(","),
        p.site ?? "",
      ].join("|"),
    )
    .join("\n");
}

/** Of the day's 60 Places requests, the guides leave this many for the make. */
export const MAKE_RESERVE = 15;

/**
 * One cron run: purge pairs older than 30 days (ids only stay), then
 * refresh the stalest due pages, at most 4 and 12 Places requests, and
 * never into the 15 the Wednesday make needs. One search per theme and
 * town serves its pages (the rainy page reuses the coffee search). Every
 * page tried is stamped, so one bad page never stalls the rotation; only
 * the budget or the run's time leaves the rest due. A refresh that fails
 * keeps the last good pairs (shown up to 30 days). Pages that appear,
 * change or go are pinged to IndexNow.
 */
export async function refreshPairingGuides(
  now: Date,
  {
    placesFetch,
    backoffMs,
    max = GUIDES_PER_RUN,
  }: { placesFetch?: typeof fetch; backoffMs?: number; max?: number } = {},
): Promise<{ refreshed: string[]; skipped: string[]; purged: number }> {
  const cutoff = new Date(now.getTime() - FRESH_DAYS * 86_400_000);
  const purged = await db
    .update(pairingGuides)
    .set({ pairs: [] })
    .where(
      sql`${pairingGuides.refreshedAt} < ${cutoff.toISOString()}::timestamptz and jsonb_array_length(${pairingGuides.pairs}) > 0`,
    )
    .returning({ slug: pairingGuides.slug });
  const changed = purged.map((p) => p.slug);
  const have = new Map((await rows()).map((r) => [r.slug, r]));
  const due = PAIRING_GUIDES.filter((g) => {
    const at = have.get(g.slug)?.triedAt?.getTime() ?? 0;
    return now.getTime() - at > DUE_DAYS * 86_400_000;
  })
    .sort(
      (a, b) =>
        (have.get(a.slug)?.triedAt?.getTime() ?? 0) -
        (have.get(b.slug)?.triedAt?.getTime() ?? 0),
    )
    .slice(0, max);
  const done = async (refreshed: string[], skipped: string[]) => {
    if (changed.length)
      await pingIndexNow([
        `${SITE_URL}/guides`,
        ...changed.map((s) => `${SITE_URL}${pairingGuidePath(s)}`),
      ]);
    return { refreshed, skipped, purged: purged.length };
  };
  if (!due.length) return done([], []);
  // Today's spend so far: the guides stop where the make's 15 begin.
  const [used] = await db
    .select({ n: placesUsage.requests })
    .from(placesUsage)
    .where(eq(placesUsage.day, pacific(now).date));
  const room = Math.min(
    GUIDE_REQUESTS,
    PLACES_PER_DAY - MAKE_RESERVE - (used?.n ?? 0),
  );
  let key: string;
  try {
    key = placesKey();
  } catch {
    return done(
      [],
      due.map((g) => g.slug),
    );
  }
  if (room <= 0)
    return done(
      [],
      due.map((g) => g.slug),
    );
  const month = Number(pacific(now).date.slice(5, 7));
  const [points, profiles] = await Promise.all([
    parkPoints(),
    currentProfiles(now),
  ]);
  const features = new Map(points.map((p) => [p.slug, p.features]));
  const parks = postableParks(
    points.map((p) => ({ ...p, approved: p.approvedAt != null })),
    profiles,
    CATALOG,
    month,
  );
  const anchors = [...parks, ...indoorAnchors()];
  const spend = placesBudget(now, room);
  const deadline = Date.now() + 150_000;
  const searches = new Map<string, Place[]>();
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const stamp = (slug: string) =>
    db
      .insert(pairingGuides)
      .values({ slug, triedAt: now })
      .onConflictDoUpdate({
        target: pairingGuides.slug,
        set: { triedAt: now },
      });
  for (const g of due) {
    let places: Place[];
    const k = `${g.theme}|${g.town}`;
    try {
      if (!searches.has(k))
        searches.set(
          k,
          await themePlaces(
            g.theme,
            anchors.filter((a) => a.city === g.town),
            month,
            { key, fetchImpl: placesFetch, backoffMs, spend, deadline },
          ),
        );
      places = searches.get(k)!;
    } catch (e) {
      const spent =
        e instanceof PlacesError &&
        /requests are used|out of time|daily quota/.test(e.message);
      if (spent) {
        // The budget, the day's quota or the time: the rest stay due.
        skipped.push(...due.slice(due.indexOf(g)).map((x) => x.slug));
        break;
      }
      // Places trouble for this page: stamped (its turn comes round
      // again), the last good pairs stay, and the next page goes on.
      skipped.push(g.slug);
      await stamp(g.slug);
      alertLater({
        key: `pairing-guides:refresh:${pacific(now).date}`,
        subject: "Pairing guides: a refresh failed",
        text: `Refreshing ${g.slug} failed (${(e as Error).message}). The last good pairs stay up to 30 days.`,
        everyMinutes: 24 * 60,
      });
      continue;
    }
    const sites = new Map(
      places.flatMap((p) =>
        p.domain && REGISTRY.entries[p.domain]
          ? [[p.placeId, `https://${p.domain}/`] as const]
          : [],
      ),
    );
    // The rainy page puts the town's coffee page's cafes last (as stored
    // now: this run may just have refreshed it).
    const coffee = g.rainy
      ? have.get(
          `coffee-shops-near-playgrounds-${g.town.toLowerCase().replace(/\s+/g, "-")}`,
        )
      : null;
    const pairs = guidePairs(
      g,
      places,
      anchors,
      month,
      sites,
      features,
      new Set(coffee?.placeIds ?? []),
    );
    const view = pairingGuideView(g, { pairs, refreshedAt: now }, now);
    if (view && guideTextProblems(view).length) {
      skipped.push(g.slug);
      await stamp(g.slug);
      continue;
    }
    const old = have.get(g.slug);
    const ids = pairs.map((p) => p.placeId);
    // The page's own lastmod moves only when what it shows changed.
    const same = pairsKey(old?.pairs) === pairsKey(pairs);
    const changedAt = same && old?.changedAt ? old.changedAt : now;
    const [row] = await db
      .insert(pairingGuides)
      .values({
        slug: g.slug,
        refreshedAt: now,
        triedAt: now,
        changedAt,
        pairs,
        placeIds: ids,
      })
      .onConflictDoUpdate({
        target: pairingGuides.slug,
        set: {
          refreshedAt: now,
          triedAt: now,
          changedAt,
          pairs,
          placeIds: ids,
        },
      })
      .returning();
    have.set(g.slug, row);
    refreshed.push(g.slug);
    const shownBefore = !!old && pairingGuideView(g, old, now) !== null;
    const shownNow = view !== null;
    if (shownBefore !== shownNow || (shownNow && !same)) changed.push(g.slug);
  }
  // A page whose pairs haven't refreshed in 20 days is 10 from vanishing.
  const stale = [...have.values()].filter(
    (r) =>
      r.refreshedAt &&
      Array.isArray(r.pairs) &&
      (r.pairs as unknown[]).length >= GUIDE_MIN &&
      now.getTime() - r.refreshedAt.getTime() > 20 * 86_400_000,
  );
  if (stale.length)
    alertLater({
      key: "pairing-guides:stale",
      subject: "Pairing guides: pages going stale",
      text: `${stale.map((r) => r.slug).join(", ")} haven't refreshed in 20 days; at 30 they stop showing. Check the cron and the Places key.`,
      everyMinutes: 24 * 60,
    });
  return done(refreshed, skipped);
}

export type { PairingGuideDef };
