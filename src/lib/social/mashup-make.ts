import { composeMashup } from "./compose";
import { dedupeTags, parkTag, REGISTRY, type Tag, tagFor } from "./handles";
import {
  cycleFor,
  type MashupHistory,
  type MashupPark,
  type MashupTheme,
  mashupCopy,
  pairPlaces,
  type Pairing,
  PAIRS_MIN,
  pickPairs,
  type Place,
  themeOrder,
} from "./mashup";
import type { PostSpec } from "./model";
import { PlacesError } from "./places";
import { mashupProblems, pairProblems, type RecentPost } from "./validate";

/**
 * Making one park pairings carousel: try the themes in rotation order,
 * fetch each theme's places near our parks (Places, at draft time), pair
 * and score them, take the best fresh pairs of the theme's cycle, write
 * the copy and compose the post, then check it. The first theme with
 * enough pairs that passes wins. Shared by the Wednesday cron (store.ts)
 * and the sample script; the network comes in as `places`.
 */

export type MashupMade =
  | {
      ok: true;
      theme: MashupTheme;
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

export async function makeMashup(o: {
  month: number;
  slotDate: string;
  parks: readonly MashupPark[];
  history: readonly MashupHistory[];
  recent: readonly RecentPost[];
  dms: boolean;
  places: (theme: MashupTheme) => Promise<Place[]>;
  /** Only this theme (the sample script); default: the rotation. */
  only?: MashupTheme;
  /** Stop starting themes after this instant (ms); default: 120 s from now. */
  deadline?: number;
}): Promise<MashupMade> {
  const deadline = o.deadline ?? Date.now() + MAKE_BUDGET_MS;
  // Each theme's search results, once per make.
  const cache = new Map<MashupTheme, Place[]>();
  const placesFor = async (theme: MashupTheme) => {
    if (!cache.has(theme)) cache.set(theme, await o.places(theme));
    return cache.get(theme)!;
  };
  const tried: { theme: MashupTheme; why: string }[] = [];
  if (o.parks.length === 0)
    return { ok: false, tried: [{ theme: "coffee", why: "no vetted parks" }] };
  const themes = o.only ? [o.only] : themeOrder(o.history, o.month);
  for (const theme of themes) {
    if (Date.now() > deadline) {
      tried.push({ theme, why: "out of time for this run" });
      break;
    }
    let got: Place[];
    try {
      got = await placesFor(theme);
    } catch (e) {
      if (e instanceof PlacesError && e.fatal)
        return { ok: false, tried, fatal: e.message };
      throw e;
    }
    const found = pairPlaces(got, o.parks, theme, o.month);
    // A pair whose own words break a rule drops alone, not the theme.
    const clean = found.pairs.filter((p) => {
      const bad = pairProblems(p, o.month);
      if (bad.length)
        found.out.push({ name: p.place.placeId, why: bad.join(" ") });
      return !bad.length;
    });
    const { cycle, used } = cycleFor(o.history, theme, clean);
    const pairs = pickPairs(clean, used);
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
    const copy = mashupCopy(theme, pairs, o.month, variant);
    const tags = mashupTags(pairs);
    const sites = new Map(
      pairs.flatMap((p) =>
        p.place.domain && REGISTRY.entries[p.place.domain]
          ? [[p.place.placeId, `https://${p.place.domain}/`] as const]
          : [],
      ),
    );
    const compose = (t: readonly Tag[]) =>
      composeMashup(theme, pairs, copy, {
        month: o.month,
        cycle,
        dms: o.dms,
        tags: t,
        sites,
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
    return { ok: true, theme, spec, pairs, tried, out: found.out };
  }
  return { ok: false, tried };
}

/** The pairs' verified accounts: each place's own, then each park's operator. */
export function mashupTags(pairs: readonly Pairing[]): Tag[] {
  return dedupeTags([
    ...pairs.map((p) => tagFor(p.place.domain, "place")),
    ...pairs.map((p) => parkTag(p.park.slug)),
  ]);
}
