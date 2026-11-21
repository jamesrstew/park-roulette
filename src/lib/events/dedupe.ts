import { CATALOG, onList } from "@/lib/news/catalog";
import { type EventDate, occurrenceId, venueKey } from "./model";
import { titleWords, type EventVerdict } from "./validate";

/**
 * De-duplication across pages (pure; the route feeds it the stored rows).
 * The series key decides which page a hand-in joins. On top of that:
 * - the same venue, day and start time already on another page is the
 *   same event under another title: refused, naming the page;
 * - the same official URL on another page is a warning (a calendar page
 *   can list several programs); when both have per-date pages, those
 *   decide, not a shared calendar link (samePage);
 * - within 0.5 miles and 30 minutes of a stored event, with 60% of the
 *   title's words in common: a near-duplicate warning.
 */

export type KnownEvent = {
  slug: string;
  key: string;
  title: string;
  url: string;
  venue: { name: string; town: string };
  point: { lat: number; lng: number } | null;
  dates: EventDate[];
  /** Every page a date is checked on (the per-date targets). */
  targetUrls: string[];
  /** Set for an event earlier in the same hand-in (not stored yet). */
  index?: number;
  /** Stored under series:<id> alone: its dates may be other venues'. */
  legacy?: boolean;
};

/** Near-duplicate thresholds. */
export const NEAR = { miles: 0.5, minutes: 30, titleOverlap: 0.6 } as const;

/** Great-circle miles between two points. */
export function miles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/** Same venue, day and start is one event from this title overlap. */
export const SAME_TITLE_JACCARD = 0.5;

/** Shared title words over all title words (Jaccard). */
export function titleJaccard(a: string, b: string): number {
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size && !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}

/** Share of the shorter title's words found in the other. */
export function titleOverlap(a: string, b: string): number {
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

const minutes = (t?: string) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Close in time: the same day, starts within 30 minutes (or neither timed). */
function closeInTime(a: EventDate[], b: EventDate[]): string | null {
  for (const x of a)
    for (const y of b) {
      if (x.day !== y.day) continue;
      const mx = minutes(x.start);
      const my = minutes(y.start);
      if (mx == null && my == null) return x.day;
      if (mx != null && my != null && Math.abs(mx - my) <= NEAR.minutes)
        return x.day;
    }
  return null;
}

const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");

/**
 * Do two events share an official page? When both have per-date pages
 * (targets), those decide: the library links every program to one
 * calendar page (deschuteslibrary.org/calendar/) but checks each date on
 * its own occurrence page (dpl.libnet.info/event/{id}), so two programs
 * at one branch and time are two pages, not one (lessons 33 and 47).
 * Otherwise the link counts too. A newsletter issue is never one event's
 * page (it lists dozens), so listing evidence pages don't count.
 */
export function samePage(
  a: Pick<KnownEvent, "url" | "targetUrls">,
  b: Pick<KnownEvent, "url" | "targetUrls">,
  listingDomains: readonly string[] = CATALOG.listing_domains,
): boolean {
  const own = (k: typeof a) =>
    k.targetUrls.filter((u) => !onList(u, listingDomains));
  const both = own(a).length > 0 && own(b).length > 0;
  const pages = (k: typeof a) => (both ? own(k) : [k.url, ...own(k)]).map(norm);
  const mine = new Set(pages(a));
  return pages(b).some((u) => mine.has(u));
}

/** A verdict as a known event (for checks within one hand-in). */
function asKnown(v: EventVerdict): KnownEvent | null {
  if (!v.ok || !v.event || !v.key || !v.slug) return null;
  return {
    slug: v.slug,
    key: v.key,
    title: v.event.title,
    url: v.event.url,
    venue: v.event.venue,
    point: v.event.point,
    dates: v.event.dates,
    targetUrls: Object.values(v.event.targets ?? {}).map((t) => t.url),
    index: v.index,
  };
}

/**
 * Check a validated hand-in against the stored events (and against
 * itself): refusals go into problems (the event is cut), the rest into
 * warnings. Mutates and returns the verdicts.
 */
export function dedupe(
  verdicts: EventVerdict[],
  stored: readonly KnownEvent[],
): EventVerdict[] {
  const seen: KnownEvent[] = [...stored];
  for (const v of verdicts) {
    const me = asKnown(v);
    if (!me) continue;
    const others = seen.filter((k) => k.key !== me.key);
    const venue = venueKey(me.venue);
    const sharesUrl = (k: KnownEvent) => samePage(me, k);
    // Same venue, day and start on another page.
    const clashes = others.filter(
      (k) =>
        venueKey(k.venue) === venue &&
        me.dates.some(
          (d) =>
            !!d.start &&
            k.dates.some((x) => x.day === d.day && x.start === d.start),
        ),
    );
    // The same event only when the titles overlap (Jaccard 0.5 or more)
    // or it's the same official page; two programs in two rooms at 10:30
    // are two events. A legacy row (series:<id> alone) may hold other
    // venues' dates, so it never blocks.
    const same = clashes.find(
      (k) =>
        !k.legacy &&
        (titleJaccard(me.title, k.title) >= SAME_TITLE_JACCARD || sharesUrl(k)),
    );
    for (const k of clashes)
      if (k !== same)
        v.warnings.push(
          `${k.index == null ? k.slug : `#${k.index} in this hand-in`} is at the same venue, day and start. Make sure it's a different program.`,
        );
    if (same) {
      const d = me.dates.find((d) =>
        same.dates.some((x) => x.day === d.day && x.start === d.start),
      )!;
      v.ok = false;
      v.problems.push(
        same.index == null
          ? `Already on /events as ${same.slug} (same venue, day and start: ${occurrenceId(d)}). Hand it in with that page's title, or leave it out.`
          : `Same venue, day and start as #${same.index} in this hand-in (${occurrenceId(d)}). Send it once.`,
      );
      v.event = undefined;
      v.key = undefined;
      v.slug = undefined;
      continue;
    }
    const byUrl = others.find(sharesUrl);
    const name = (k: KnownEvent) =>
      k.index == null ? k.slug : `#${k.index} in this hand-in`;
    if (byUrl)
      v.warnings.push(
        `Its official page is also the page of ${name(byUrl)}. Make sure it's a different program.`,
      );
    const near = others.find((k) => {
      if (byUrl && k.key === byUrl.key) return false;
      const close =
        me.point && k.point
          ? miles(me.point, k.point) <= NEAR.miles
          : venueKey(k.venue) === venue;
      return (
        close &&
        !!closeInTime(me.dates, k.dates) &&
        titleOverlap(me.title, k.title) >= NEAR.titleOverlap
      );
    });
    if (near)
      v.warnings.push(
        `Looks like ${name(near)} (within ${NEAR.miles} miles and ${NEAR.minutes} minutes, a similar title). If it's the same event, hand it in with that page's title and venue.`,
      );
    seen.push(me);
  }
  // A date handed in as its own object follows its series' fate.
  for (const v of verdicts)
    if (v.merged != null && !verdicts[v.merged]?.ok && v.ok) {
      v.ok = false;
      v.problems.push(`Part of #${v.merged}, which was cut.`);
    }
  return verdicts;
}

// --- Admin repairs stick ---------------------------------------------------------

/** Days a removed page can't be made again. */
export const REMOVED_BLOCK_DAYS = 60;

export type EditBlocks = {
  /** Occurrence ids admins trimmed or split off, by the key they left. */
  trimmed: ReadonlyMap<string, ReadonlySet<string>>;
  /** Pages removed in the last 60 days. */
  removed: readonly { slug: string; key: string | null; at: string }[];
};

/**
 * Apply admin repairs to a hand-in: dates an admin took off a page are
 * left out of it (a warning), a hand-in with nothing else is cut, and a
 * page removed in the last 60 days (same key or slug) is cut. Mutates and
 * returns the verdicts; running it twice changes nothing more.
 */
export function screenEdits(
  verdicts: EventVerdict[],
  blocks: EditBlocks,
): EventVerdict[] {
  for (const v of verdicts) {
    if (!v.ok || !v.event || !v.key) continue;
    const gone = blocks.removed.find(
      (r) =>
        r.key === v.key ||
        r.slug === v.slug ||
        (v.slug &&
          r.slug.startsWith(`${v.slug}-`) &&
          /-[0-9a-f]{6}$/.test(r.slug)),
    );
    if (gone) {
      v.ok = false;
      v.problems.push(
        `An admin removed ${gone.slug} on ${gone.at}. Leave it out.`,
      );
      v.event = undefined;
      v.key = undefined;
      continue;
    }
    const cut = blocks.trimmed.get(v.key);
    if (!cut?.size) continue;
    const keep = v.event.dates.filter((d) => !cut.has(occurrenceId(d)));
    const dropped = v.event.dates.length - keep.length;
    if (!dropped) continue;
    if (!keep.length) {
      v.ok = false;
      v.problems.push(
        "An admin took these dates off this page. Leave them out.",
      );
      v.event = undefined;
      v.key = undefined;
      continue;
    }
    const days = new Set(keep.map((d) => d.day));
    const only = <T>(m?: Record<string, T>) =>
      m
        ? Object.fromEntries(Object.entries(m).filter(([k]) => days.has(k)))
        : m;
    v.event = {
      ...v.event,
      dates: keep,
      targets: only(v.event.targets),
      statusByDay: only(v.event.statusByDay),
    };
    v.warnings.push(
      `Left out ${dropped} ${dropped === 1 ? "date" : "dates"} an admin took off this page.`,
    );
  }
  return verdicts;
}
