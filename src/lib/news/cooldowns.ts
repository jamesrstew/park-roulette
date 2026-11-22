import { createHash } from "node:crypto";
import {
  type Catalog,
  type Venue,
  type WeatherLabel,
  WEEKDAYS,
} from "./catalog";
import { type Hazard, NEEDS_INDOOR, ROAD_HAZARDS } from "./tiers";
import type { Issue } from "./issue";
import { addDays, daysBetween } from "./time";

/**
 * No repeats. History is the issues we actually sent (never a file the
 * writer edits), and every cooldown is counted in weeks between issue
 * dates: used on Dec 3 with a 4-week cooldown means free again Dec 31.
 */

export const COOLDOWN_WEEKS = {
  wheel: 10,
  featured: 6,
  /**
   * The Indoor pick: 8 weeks, relaxing to 6, then 4, only when nothing else
   * fits (weather-season spec, section 3). Counted only on issues where
   * the pick ran.
   */
  venue: [8, 6, 4],
  tip: 12,
  /** Dress for it / Good to know lines. */
  dress: 12,
  challenge: 12,
  series: 4,
  /** Library story times are an occasional pick (Family Loop covers them). */
  storyTime: 8,
} as const;

export type SentIssue = { issueDate: string; body: Issue };
export type CooldownKind =
  "wheel" | "featured" | "venue" | "tip" | "challenge" | "series" | "dress";

/** The ids one sent issue used, by kind. */
export function usedIn(body: Issue): Record<CooldownKind, string[]> {
  const weekendParks = (body.weekend ?? []).flatMap((w) => w.park ?? []);
  return {
    wheel: [body.wheel_pick.park],
    featured: [body.wheel_pick.park, ...weekendParks],
    venue: body.plan_b?.venue_id ? [body.plan_b.venue_id] : [],
    tip: body.plan_b?.tip_id ? [body.plan_b.tip_id] : [],
    challenge: [body.passport.challenge_id],
    series: (body.weekend ?? []).flatMap((w) => w.series_id ?? []),
    dress: body.dress?.tip_id ? [body.dress.tip_id] : [],
  };
}

/** When each id was last used (history is any order). */
export function lastUsed(
  history: readonly SentIssue[],
  kind: CooldownKind,
): Map<string, string> {
  const last = new Map<string, string>();
  for (const h of history)
    for (const id of usedIn(h.body)[kind])
      if ((last.get(id) ?? "") < h.issueDate) last.set(id, h.issueDate);
  return last;
}

/** Still cooling down on this issue date? */
export function cooling(
  last: string | undefined,
  issueDate: string,
  weeks: number,
): boolean {
  if (!last || last >= issueDate) return false;
  return daysBetween(last, issueDate) < weeks * 7;
}

/** Everything still cooling down, and when it's free again (for the plan). */
export function cooldownState(
  history: readonly SentIssue[],
  issueDate: string,
) {
  const kinds: [CooldownKind, number][] = [
    ["wheel", COOLDOWN_WEEKS.wheel],
    ["featured", COOLDOWN_WEEKS.featured],
    ["venue", COOLDOWN_WEEKS.venue[0]],
    ["tip", COOLDOWN_WEEKS.tip],
    ["challenge", COOLDOWN_WEEKS.challenge],
    ["series", COOLDOWN_WEEKS.series],
    ["dress", COOLDOWN_WEEKS.dress],
  ];
  return Object.fromEntries(
    kinds.map(([kind, weeks]) => [
      kind,
      [...lastUsed(history, kind)]
        .filter(([, last]) => cooling(last, issueDate, weeks))
        .map(([id, last]) => ({
          id,
          last_used: last,
          free_on: addDays(last, weeks * 7),
        })),
    ]),
  ) as Record<
    CooldownKind,
    { id: string; last_used: string; free_on: string }[]
  >;
}

/** The last sent issue's Indoor pick (venue and kind), if one ran. */
export function lastIndoorPick(
  history: readonly SentIssue[],
  catalog: Pick<Catalog, "venues">,
): Venue | null {
  const last = [...history]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .find((h) => h.body.plan_b?.kind === "venue");
  return (
    catalog.venues.find((v) => v.id === last?.body.plan_b?.venue_id) ?? null
  );
}

/** Did the last two sent issues both carry an Indoor pick? */
export function twoIndoorInARow(history: readonly SentIssue[]): boolean {
  const recent = [...history]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .slice(0, 2);
  return (
    recent.length === 2 && recent.every((h) => h.body.plan_b?.kind === "venue")
  );
}

const COST_ORDER = { free: 0, low: 1, paid: 2 } as const;

/**
 * Indoor pick venues for one day (spec sections 2 and 3):
 *   - verified, in season, open that weekday (open_days);
 *   - indoor (not covered) for smoke, wind, ice or extreme cold;
 *   - within 15 minutes of downtown Bend on snow or ice days, else 35;
 *   - never the last pick's venue or kind (pool, museum, climbing...);
 *   - cooldown 8 weeks, else 6, else 4; if nothing is free at 4, the
 *     oldest pick repeats rather than the section dropping;
 *   - free first, then low cost, then paid (on ice days the closest).
 */
export function indoorVenues(
  catalog: Pick<Catalog, "venues">,
  history: readonly SentIssue[],
  issueDate: string,
  forDay: string,
  hazards: readonly Hazard[],
): { weeks: number | null; repeat: boolean; eligible: Venue[] } {
  const month = Number(forDay.slice(5, 7));
  const [y, m, d] = forDay.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const indoorOnly = hazards.some((h) => NEEDS_INDOOR.includes(h));
  const roads = hazards.some((h) => ROAD_HAZARDS.includes(h));
  const ice = hazards.includes("ice");
  const lastPick = lastIndoorPick(history, catalog);
  const last = lastUsed(history, "venue");
  const fits = catalog.venues
    .filter(
      (v) =>
        v.verified &&
        v.months.includes(month) &&
        v.open_days.includes(weekday) &&
        (!indoorOnly || v.enclosure === "indoor") &&
        v.drive_minutes_from_downtown <= (roads ? 15 : 35) &&
        v.id !== lastPick?.id &&
        v.kind !== lastPick?.kind,
    )
    .sort(
      (a, b) =>
        COST_ORDER[a.cost] - COST_ORDER[b.cost] ||
        (ice
          ? a.drive_minutes_from_downtown - b.drive_minutes_from_downtown
          : 0) ||
        a.id.localeCompare(b.id),
    );
  for (const weeks of COOLDOWN_WEEKS.venue) {
    const eligible = fits.filter(
      (v) => !cooling(last.get(v.id), issueDate, weeks),
    );
    if (eligible.length) return { weeks, repeat: false, eligible };
  }
  // Nothing free at 4 weeks: the oldest pick again beats no help.
  const oldest = [...fits].sort((a, b) =>
    (last.get(a.id) ?? "").localeCompare(last.get(b.id) ?? ""),
  )[0];
  return oldest
    ? { weeks: null, repeat: true, eligible: [oldest] }
    : { weeks: null, repeat: false, eligible: [] };
}

/**
 * "Closer to home" on snow and ice days: one open catalog venue each in
 * Redmond, Sisters and La Pine (free first), so readers there don't drive
 * to Bend on the worst roads of the year.
 */
export function closerToHome(
  catalog: Pick<Catalog, "venues">,
  forDay: string,
): string[] {
  const month = Number(forDay.slice(5, 7));
  const [y, m, d] = forDay.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return ["Redmond", "Sisters", "La Pine"].flatMap((town) => {
    const v = catalog.venues
      .filter(
        (v) =>
          v.town === town &&
          v.verified &&
          v.enclosure === "indoor" &&
          v.months.includes(month) &&
          v.open_days.includes(weekday),
      )
      .sort((a, b) => COST_ORDER[a.cost] - COST_ORDER[b.cost])[0];
    return v ? [v.name] : [];
  });
}

/** Catalog items of one kind that are verified, in season and not cooling. */
export function freeItems<
  T extends { id: string; months: number[]; verified: boolean },
>(
  items: readonly T[],
  history: readonly SentIssue[],
  issueDate: string,
  kind: "tip" | "challenge" | "series" | "dress",
): T[] {
  const month = Number(issueDate.slice(5, 7));
  const last = lastUsed(history, kind);
  return items.filter(
    (i) =>
      i.verified &&
      i.months.includes(month) &&
      !cooling(last.get(i.id), issueDate, COOLDOWN_WEEKS[kind]),
  );
}

// --- The Wheel Pick ------------------------------------------------------

export type PickPark = {
  slug: string;
  name: string;
  city: string;
  status: string;
  play: string;
  approved: boolean;
  features: string[];
};

/** A number from the seed, the same every time for the same issue date. */
function seeded(seed: string, salt: string): number {
  return createHash("sha256")
    .update(`${seed}:${salt}`)
    .digest()
    .readUInt32BE(0);
}

/**
 * Code spins the wheel. Eligible: open, approved parks with play, not a
 * Wheel Pick in 10 weeks, not featured in 6, not on the no-pick list (or
 * changed to closed since the last issue). The weather narrows it when it
 * can (shade or a splash pad when hot, cleared paths when snowy). Then a
 * seeded spin picks a town, weighted toward bigger towns but not
 * swamped by them (square root of park count), then a park in it.
 */
export function wheelPick(
  parks: readonly PickPark[],
  history: readonly SentIssue[],
  issueDate: string,
  labels: readonly WeatherLabel[],
  hints: Catalog["parks"],
  exclude: ReadonlySet<string> = new Set(),
): { park: PickPark; reasons: string[]; eligible: number } | null {
  const month = Number(issueDate.slice(5, 7));
  const wheelLast = lastUsed(history, "wheel");
  const featuredLast = lastUsed(history, "featured");
  const noPick = new Set(
    hints.filter((h) => h.no_pick || h.closed).map((h) => h.slug),
  );
  const snowOk = new Set(hints.filter((h) => h.snow_ok).map((h) => h.slug));
  const eligible = parks
    .filter(
      (p) =>
        p.status === "active" &&
        p.approved &&
        (p.play === "playground" || p.play === "nature") &&
        !noPick.has(p.slug) &&
        !exclude.has(p.slug) &&
        !cooling(wheelLast.get(p.slug), issueDate, COOLDOWN_WEEKS.wheel) &&
        !cooling(featuredLast.get(p.slug), issueDate, COOLDOWN_WEEKS.featured),
    )
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (!eligible.length) return null;

  const reasons: string[] = [];
  let pool = eligible;
  const narrow = (why: string, test: (p: PickPark) => boolean) => {
    const fit = pool.filter(test);
    if (fit.length) {
      pool = fit;
      reasons.push(why);
    }
  };
  if (labels.includes("hot"))
    narrow("hot week: shade or water", (p) =>
      p.features.some(
        (f) =>
          f === "shade" ||
          f === "water_view" ||
          (f === "splash_pad" && month >= 6 && month <= 9),
      ),
    );
  if (labels.includes("snow"))
    narrow("snowy week: paths that get cleared", (p) => snowOk.has(p.slug));
  if (labels.includes("wind"))
    narrow("windy week: trees for a windbreak", (p) =>
      p.features.includes("shade"),
    );

  const towns = new Map<string, PickPark[]>();
  for (const p of pool) towns.set(p.city, [...(towns.get(p.city) ?? []), p]);
  const names = [...towns.keys()].sort();
  const weights = names.map((t) => Math.sqrt(towns.get(t)!.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let spin = (seeded(issueDate, "town") / 2 ** 32) * total;
  let town = names[names.length - 1];
  for (let i = 0; i < names.length; i++) {
    spin -= weights[i];
    if (spin < 0) {
      town = names[i];
      break;
    }
  }
  const inTown = towns.get(town)!;
  const park = inTown[seeded(issueDate, "park") % inTown.length];
  return { park, reasons, eligible: eligible.length };
}
