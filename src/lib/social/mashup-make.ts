import { composeMashup, mashupRows } from "./compose";
import { dedupeTags, parkTag, REGISTRY, type Tag, tagFor } from "./handles";
import {
  type Anchor,
  chooseMix,
  copyFacts,
  cycleFor,
  type Hours,
  type MashupHistory,
  type MashupTheme,
  mashupCopy,
  type Mix,
  openDaytime,
  pairPlaces,
  type Pairing,
  PAIRS_MIN,
  pickPairs,
  type Place,
  themeOrder,
  type Weather,
  weekendOf,
} from "./mashup";
import type { PostSpec } from "./model";
import { PlacesError } from "./places";
import { weekdayOf } from "@/lib/news/time";
import { mashupProblems, pairProblems, type RecentPost } from "./validate";

/**
 * Making one park pairings carousel: try the themes in rotation order,
 * fetch each theme's places (Places, at draft time), pair each with the
 * kids' anchors near it (parks; indoor places and this weekend's events
 * when the mix calls for them), take the best fresh pairs of the theme's
 * cycle, write the copy and compose the post, then check it. The first
 * theme with enough pairs that passes wins. Shared by the Wednesday cron
 * (store.ts) and the sample script; the network comes in as `places` and
 * `indoorHours`.
 */

export type MashupMade =
  | {
      ok: true;
      theme: MashupTheme;
      mix: Mix;
      spec: PostSpec;
      pairs: Pairing[];
      /** Every theme tried, with why it didn't make it. */
      tried: { theme: MashupTheme; why: string }[];
      /** Places left out of the chosen theme, with why (for the report). */
      out: { name: string; why: string }[];
    }
  | {
      ok: false;
      tried: { theme: MashupTheme; why: string }[];
      /**
       * Places refused for good today (the day's quota or our cap, a bad
       * key, the run's time): skip the week, never try again this run.
       */
      fatal?: string;
    };

/** One make stops trying themes after this long (the cron allows 300 s). */
export const MAKE_BUDGET_MS = 120_000;
/** Indoor places whose hours one make reads, at most (each is a request). */
export const HOURS_MAX = 4;

export async function makeMashup(o: {
  month: number;
  slotDate: string;
  /** Every anchor: parks, indoor places and this weekend's events. */
  parks: readonly Anchor[];
  history: readonly MashupHistory[];
  recent: readonly RecentPost[];
  dms: boolean;
  places: (theme: MashupTheme) => Promise<Place[]>;
  /** An indoor place's opening hours by its place id (null: unknown). */
  indoorHours?: (placeId: string) => Promise<Hours | null>;
  weather?: Weather;
  /** Only this theme (the sample script); default: the rotation. */
  only?: MashupTheme;
  /** Stop starting themes after this instant (ms); default: 120 s from now. */
  deadline?: number;
}): Promise<MashupMade> {
  const deadline = o.deadline ?? Date.now() + MAKE_BUDGET_MS;
  const weather = o.weather ?? { bad: false };
  // Each theme's search results, and each indoor place's hours, once per make.
  const cache = new Map<MashupTheme, Place[]>();
  const placesFor = async (theme: MashupTheme) => {
    if (!cache.has(theme)) cache.set(theme, await o.places(theme));
    return cache.get(theme)!;
  };
  const open = new Map<string, boolean>();
  let asked = 0;
  const tried: { theme: MashupTheme; why: string }[] = [];
  if (o.parks.length === 0)
    return { ok: false, tried: [{ theme: "coffee", why: "no anchors" }] };
  const themes = o.only ? [o.only] : themeOrder(o.history, o.month);
  const [, sat, sun] = weekendOf(o.slotDate);
  try {
    for (const theme of themes) {
      if (Date.now() > deadline) {
        tried.push({ theme, why: "out of time for this run" });
        break;
      }
      const found = pairPlaces(await placesFor(theme), o.parks, theme, o.month);
      // A pair whose own words break a rule drops alone, not the theme.
      let clean = found.pairs.filter((p) => {
        const bad = pairProblems(p, o.month);
        if (bad.length)
          found.out.push({ name: p.place.placeId, why: bad.join(" ") });
        return !bad.length;
      });
      const parksOnly = clean.filter((p) => p.park.kind === "park");
      const parksCycle = cycleFor(o.history, theme, parksOnly, weather);
      // Indoor places and events only when the mix may use them (a thin
      // week or bad weather). Indoor places: only the likeliest few, as
      // each one's hours cost a request (HOURS_MAX for the whole make,
      // read together); one not open 2 hours straight Saturday or Sunday
      // daytime drops out, and so does one whose hours didn't load.
      if (
        weather.bad ||
        pickPairs([parksOnly], parksCycle.used).length < PAIRS_MIN
      ) {
        const want = [
          ...new Set(
            [...clean]
              .filter((p) => p.park.kind === "indoor" && p.park.placeId)
              .sort((a, b) => b.score - a.score)
              .map((p) => p.park.placeId!),
          ),
        ].filter((id) => !open.has(id));
        const ask = want.slice(0, Math.max(0, HOURS_MAX - asked));
        asked += ask.length;
        const got = await Promise.all(
          ask.map((id) =>
            o.indoorHours ? o.indoorHours(id) : Promise.resolve(null),
          ),
        );
        ask.forEach((id, i) =>
          open.set(
            id,
            openDaytime(got[i], weekdayOf(sat)) ||
              openDaytime(got[i], weekdayOf(sun)),
          ),
        );
        clean = clean.filter(
          (p) =>
            p.park.kind !== "indoor" ||
            (!!p.park.placeId && open.get(p.park.placeId) === true),
        );
      } else clean = parksOnly;
      // The cycle over what can really run (after the hours check).
      const { cycle, used } = cycleFor(o.history, theme, clean, weather);
      const { mix, pairs } = chooseMix(clean, used, weather);
      if (pairs.length < PAIRS_MIN) {
        tried.push({
          theme,
          why: `only ${pairs.length} pairs (${clean.length} before the rotation)`,
        });
        continue;
      }
      // Variants rotate with the theme's own count, so a theme's next
      // carousel opens differently.
      const variant = o.history.filter((h) => h.theme === theme).length;
      const facts = copyFacts(theme, pairs, weather, mix);
      const copy = mashupCopy(theme, facts, o.month, variant);
      const tags = mashupTags(pairs);
      const sites = new Map(
        pairs.flatMap((p) =>
          p.place.domain && REGISTRY.entries[p.place.domain]
            ? [[p.place.placeId, `https://${p.place.domain}/`] as const]
            : [],
        ),
      );
      const rows = mashupRows(pairs, sites);
      const compose = (t: readonly Tag[]) =>
        composeMashup(theme, rows, copy, {
          month: o.month,
          cycle,
          dms: o.dms,
          tags: t,
          variant,
          weather: facts.weather,
          shops: facts.shops,
          slotDate: o.slotDate,
        });
      let spec = compose(tags);
      let problems = mashupProblems(spec, pairs, o);
      // A tag that breaks a rule is dropped, never the post.
      if (problems.length && tags.length) {
        spec = compose([]);
        problems = mashupProblems(spec, pairs, o);
      }
      if (problems.length) {
        tried.push({ theme, why: problems.join(" ") });
        continue;
      }
      return { ok: true, theme, mix, spec, pairs, tried, out: found.out };
    }
  } catch (e) {
    if (e instanceof PlacesError && e.fatal)
      return { ok: false, tried, fatal: e.message };
    throw e;
  }
  return { ok: false, tried };
}

/**
 * The pairs' verified accounts: each place's own, then each anchor's (a
 * park's operator, an indoor place's own site, an event's host).
 */
export function mashupTags(pairs: readonly Pairing[]): Tag[] {
  return dedupeTags([
    ...pairs.map((p) => tagFor(p.place.domain, "place")),
    ...pairs.map((p) =>
      p.park.kind === "park"
        ? parkTag(p.park.slug)
        : p.park.kind === "indoor"
          ? tagFor(p.park.site, "place")
          : tagFor(p.park.event?.host, "host"),
    ),
  ]);
}
