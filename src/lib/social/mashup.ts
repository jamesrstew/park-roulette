import type { Catalog } from "@/lib/news/catalog";
import { addDays, daysBetween, weekdayOf } from "@/lib/news/time";
import {
  CONTEXT_KINDS,
  MIN_POST_TRAITS,
  type ParkProfile,
  postKinds,
  postTraits,
} from "@/lib/park-profiles";

/**
 * Park pairings ("mashups"): every other Wednesday, in place of the Unpack
 * carousel, a code-made carousel that pairs a well-loved, family-friendly
 * local spot (a cafe, a food truck lot, a brewery, a bakery or ice cream
 * shop) with a vetted park nearby. Pure: Google Places comes in through
 * lib/social/places.ts, the database through store.ts.
 *
 * Every claim is mechanical, from checked data, and printed in our words:
 *
 *   - the distance, from the two points: "a 6-minute walk" only when the
 *     straight line is 0.3 mi or less (never over 10 minutes), else "a
 *     short drive" (3 mi at most);
 *   - "Kids' menu" only from Google's menuForChildren, "Patio" only from
 *     outdoorSeating, "Good for kids" only from goodForChildren;
 *   - the park's line only from its own in-season trait (park-profiles).
 *
 * Google's rating and review count choose places (4.5 and up, 100 reviews
 * and up) and are never printed or stored. No hours, ever.
 */

// --- Themes ------------------------------------------------------------------

export {
  MASHUP_THEMES,
  type MashupTheme,
  THEME_ICON,
  THEME_LABEL,
} from "./model";
import { MASHUP_THEMES, type MashupTheme } from "./model";

/** The first four mashups go in this order (James, Nov 25, 2026). */
export const THEME_ORDER: readonly MashupTheme[] = MASHUP_THEMES;

/** Months that count as warm (ice cream, patios) and as winter (short outings). */
export const WARM_MONTHS = new Set([5, 6, 7, 8, 9]);
export const WINTER_MONTHS = new Set([11, 12, 1, 2, 3]);

/** How well a theme suits a month (0 to 1). */
export function seasonFit(theme: MashupTheme, month: number): number {
  const winter = WINTER_MONTHS.has(month);
  switch (theme) {
    case "coffee":
      return 1;
    case "treats":
      return 1;
    case "food_trucks":
      return winter ? 0.5 : 1;
    case "breweries":
      return winter ? 0.6 : 1;
  }
}

/** A theme counts as in season at this fit or above. */
export const IN_SEASON = 0.8;

/**
 * What a theme searches Places for, in each town (Text Search). Ice cream
 * only in warm months; bakeries all year.
 */
export function themeQueries(theme: MashupTheme, month: number): string[] {
  switch (theme) {
    case "coffee":
      return ["coffee shop"];
    case "food_trucks":
      return ["food truck lot", "food cart pod"];
    case "breweries":
      return ["brewery"];
    case "treats":
      return ["bakery", ...(WARM_MONTHS.has(month) ? ["ice cream"] : [])];
  }
}

/**
 * The Places (New) primary types a theme's places may have. Ice cream
 * shops only in warm months.
 */
export function themeTypes(theme: MashupTheme, month: number): string[] {
  switch (theme) {
    case "coffee":
      return ["coffee_shop", "cafe", "tea_house"];
    case "food_trucks":
      return ["food_court"];
    case "breweries":
      return ["brewery", "brewpub", "pub"];
    case "treats":
      return [
        "bakery",
        "donut_shop",
        "dessert_shop",
        ...(WARM_MONTHS.has(month) ? ["ice_cream_shop"] : []),
      ];
  }
}

/** A food truck lot by its name (Google types some as plain restaurants). */
const FOOD_LOT =
  /\b(food (park|carts|trucks)|(cart|truck) (lot|pod|park)s?)\b/i;

// --- The alternation ---------------------------------------------------------

/**
 * Week 0 of the alternation: the Monday of the first mashup week. Weeks
 * are counted from here, so the year's end (a 53-week ISO year) never
 * puts two mashups in a row: even weeks are mashups, odd weeks Unpack.
 */
export const MASHUP_EPOCH = "2026-11-30";

/** Is this week (its Monday) a mashup week by the alternation alone? */
export function mashupParity(weekOf: string): boolean {
  if (weekdayOf(weekOf) !== 1) return false;
  const weeks = daysBetween(MASHUP_EPOCH, weekOf) / 7;
  return weeks >= 0 && weeks % 2 === 0;
}

/** A break long enough to be a school-break week (not a single day off, not summer). */
export const HOLIDAY_BREAK = { minWeekdays: 3, maxDays: 21 } as const;

/**
 * A verified school break that makes this a holiday week: it covers 3 or
 * more of the week's weekdays and is not the summer vacation. In a
 * mashup week, such a break lets the routine write the holiday Unpack
 * (Sunday 7:45 pm) instead, and the holiday Unpack wins.
 */
export function holidayBreak(catalog: Pick<Catalog, "breaks">, weekOf: string) {
  const days = [0, 1, 2, 3, 4].map((i) => addDays(weekOf, i));
  return (
    catalog.breaks.find(
      (b) =>
        b.verified &&
        daysBetween(b.from, b.to) + 1 <= HOLIDAY_BREAK.maxDays &&
        days.filter((d) => d >= b.from && d <= b.to).length >=
          HOLIDAY_BREAK.minWeekdays,
    ) ?? null
  );
}

// --- Places --------------------------------------------------------------------

/** Our towns: a place or a park must be in one. */
export const MASHUP_TOWNS = [
  "Bend",
  "Redmond",
  "Sisters",
  "Sunriver",
  "La Pine",
  "Madras",
  "Prineville",
  "Terrebonne",
] as const;

/**
 * One place as Places (New) describes it, fetched at draft time. Only the
 * place id is ever kept for good; the rest lives in memory while a post is
 * made (and the words we print from it are our own).
 */
export type Place = {
  placeId: string;
  /** displayName, as Google has it. */
  name: string;
  /** The locality from addressComponents. */
  town: string | null;
  lat: number;
  lng: number;
  businessStatus: string | null;
  primaryType: string | null;
  goodForChildren: boolean | null;
  menuForChildren: boolean | null;
  outdoorSeating: boolean | null;
  dineIn: boolean | null;
  /** For choosing only; never printed or stored. */
  rating: number | null;
  userRatingCount: number | null;
  /** websiteUri's registrable domain (for a verified tag), or null. */
  domain: string | null;
};

/** The selection bar: Google's rating and review count (never printed). */
export const RATING_MIN = 4.5;
export const REVIEWS_MIN = 100;

/**
 * Chains with far more than 10 locations (and their usual spellings):
 * we feature local independents. Matched on the start of the cleaned name.
 */
export const CHAINS = [
  "starbucks",
  "coffee bean & tea leaf",
  "cinnabon",
  "auntie anne's",
  "bruegger's",
  "wendy's",
  "pretzelmaker",
  "panda express",
  "chick-fil-a",
  "taco bell",
  "little caesars",
  "domino's",
  "pizza hut",
  "dutch bros",
  "black rock coffee",
  "human bean",
  "dunkin",
  "peet's",
  "caribou coffee",
  "tim hortons",
  "coffee bean",
  "scooter's coffee",
  "biggby",
  "ziggi's",
  "krispy kreme",
  "panera",
  "einstein",
  "great harvest",
  "crumbl",
  "nothing bundt",
  "insomnia cookies",
  "cold stone",
  "baskin",
  "dairy queen",
  "menchie's",
  "yogurtland",
  "sweet frog",
  "ben & jerry's",
  "häagen",
  "haagen",
  "bahama buck's",
  "kona ice",
  "dippin' dots",
  "marble slab",
  "mcmenamins",
  "rogue ales",
  "old chicago",
  "jamba",
  "smoothie king",
  "tropical smoothie",
  "safeway",
  "fred meyer",
  "albertsons",
  "costco",
  "walmart",
  "target",
  "mcdonald's",
  "sonic",
] as const;

/**
 * Words that never appear in a mashup's words, names included: no drinks
 * talk, ever (breweries are framed around the family visit), and no bar.
 * "Brewery", "brewing" and "brewpub" stay allowed as the place type.
 */
export const NO_DRINKS =
  /\b(beers?|pints?|drinks?|drinking|brews|brewski|ales?|ipas?|lagers?|stouts?|porters?|cocktails?|wines?|booze|boozy|alcohol\w*|liquor|spirits|cider|happy hour|cheers|hops|on tap|taps?|tap ?rooms?|tap ?house|tasting room|pubs?|bars?|saloons?|taverns?|lounges?|distiller(y|ies)|winer(y|ies)|beer ?gardens?)\b/i;

/** Primary types that are never a family stop, whatever the theme. */
const ADULT_TYPES = new Set([
  "bar",
  "pub",
  "sports_bar",
  "wine_bar",
  "cocktail_bar",
  "night_club",
  "beer_garden",
  "liquor_store",
  "lounge_bar",
  "hookah_bar",
  "irish_pub",
  "bar_and_grill",
]);

/** A brewery theme's place names itself as one. */
const BREWERY_NAME = /\b(brew(ing|ery|eries|pub)|fermentation)\b/i;

/**
 * The name we print: Google's display name without a parenthetical
 * ("(formerly ...)") or a branch after a dash ("Thump Coffee - Downtown"),
 * in title case when it's all capitals.
 */
export function cleanName(name: string): string {
  let n = name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    // "Dry Canyon Club + EV Charging Station": the amenity isn't the name.
    .replace(/\s+\+\s+(ev|charging|gas|fuel|parking|atm)\b.*$/i, "")
    .replace(/\s+[-–—|]\s+.*$/, "")
    .replace(/[-–—]\s+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // A brewery's pub, taproom or tasting room is where it is, not who it
  // is: "Deschutes Brewery Bend Public House" prints "Deschutes Brewery".
  n = n
    .replace(
      /(\s+(&|and|\+))?\s+(public house|pub|tap ?house|tap ?room|tasting room|ale ?house|bar)\b.*$/i,
      "",
    )
    .replace(
      /\s+(bend|redmond|sisters|sunriver|la pine|madras|prineville|terrebonne|eastside|westside|downtown)$/i,
      "",
    );
  if (n.length > 3 && n === n.toUpperCase() && /[A-Z]/.test(n))
    n = n
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase())
      .replace(/'S\b/g, "'s");
  return n.replace(/\s*@\s*/g, " at ").trim();
}

/** The chain key a name starts with, or null (a local independent). */
export function chainOf(name: string): string | null {
  const n = cleanName(name)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // "The Coffee Bean & Tea Leaf" is "coffee bean & tea leaf".
    .replace(/^the /, "");
  return CHAINS.find((c) => n === c || n.startsWith(`${c} `)) ?? null;
}

/**
 * Why a place is out of a theme's carousel, or null. Open, in our towns,
 * well loved, local, a real sit-down stop (not a drive-through kiosk), the
 * theme's own kind of place, and never a bar. A food truck lot and a
 * brewery must be marked good for children; any place marked not good
 * for children is out.
 */
export function placeProblem(
  p: Place,
  theme: MashupTheme,
  month: number,
): string | null {
  if (p.businessStatus !== "OPERATIONAL") return "not operational";
  if (!p.town || !(MASHUP_TOWNS as readonly string[]).includes(p.town))
    return "not in our towns";
  if ((p.rating ?? 0) < RATING_MIN || (p.userRatingCount ?? 0) < REVIEWS_MIN)
    return "below the rating bar";
  if (chainOf(p.name)) return "a chain";
  // A brewpub Google types as a pub is a brewery here (its name says so,
  // below); every other bar type is out of every theme.
  const pubBrewery = theme === "breweries" && p.primaryType === "pub";
  if (p.primaryType && ADULT_TYPES.has(p.primaryType) && !pubBrewery)
    return "a bar";
  // Google types many brewpubs and food truck lots as plain restaurants:
  // then the name has to say so.
  const restaurant = !!p.primaryType && /restaurant$/.test(p.primaryType);
  const kind =
    (!!p.primaryType && themeTypes(theme, month).includes(p.primaryType)) ||
    (theme === "food_trucks" && FOOD_LOT.test(p.name)) ||
    (theme === "breweries" && restaurant && BREWERY_NAME.test(p.name));
  if (!kind) return "not this theme's kind of place";
  const name = cleanName(p.name);
  if (!name || name.length > 40) return "no printable name";
  // The name as printed never has one. Outside the breweries theme Google's
  // own name mustn't either ("Cafe and Taproom" is a bar that serves coffee);
  // a brewery's "Public House" or "Taproom" is only where it is.
  if (NO_DRINKS.test(name) || (theme !== "breweries" && NO_DRINKS.test(p.name)))
    return "a drinks word in its name";
  if (theme === "breweries" && !BREWERY_NAME.test(name))
    return "not named as a brewery";
  if (p.goodForChildren === false) return "not good for children";
  if (
    (theme === "breweries" || theme === "food_trucks") &&
    p.goodForChildren !== true
  )
    return "not marked good for children";
  // A drive-through kiosk isn't an outing: somewhere to sit, inside or out.
  if (p.dineIn === false && p.outdoorSeating !== true) return "takeout only";
  return null;
}

// --- Parks ---------------------------------------------------------------------

/** A park a mashup may pair with: one of our postable parks. */
export type MashupPark = {
  slug: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  /** Distinct in-season trait kinds (park-profiles postKinds). */
  kinds: number;
  /** The park's line: its lead in-season trait, in our words. */
  trait: string;
  /** The trait's kind (for the season preference). */
  traitKind: string;
  /** Featured on Instagram in the last 8 weeks. */
  cooling: boolean;
};

/** Trait kinds that are about play, best first (park-profiles TRAIT_KINDS). */
const PLAY_KINDS = [
  "signature_structure",
  "nature_play",
  "all_abilities",
  "toddler",
  "splash_pad",
  "sledding",
  "fenced",
  "other",
];

/** The longest trait a slide prints. */
export const TRAIT_MAX = 72;

/**
 * The park's line for a month: its first in-season trait that isn't
 * context (nearby, history) and fits a slide, or null.
 */
export function parkLine(
  profile: ParkProfile | null | undefined,
  month: number,
): { text: string; kind: string } | null {
  // Play first: a pairing sells the playground, not the river gate.
  const rank = (k: string) => {
    const i = PLAY_KINDS.indexOf(k);
    return i < 0 ? PLAY_KINDS.length : i;
  };
  const t = postTraits(profile, month)
    .map((x, i) => ({ x, i }))
    .filter(
      ({ x }) =>
        !CONTEXT_KINDS.has(x.kind) &&
        x.text.length <= TRAIT_MAX &&
        // Shade is no draw in the cold months.
        !(WINTER_MONTHS.has(month) && x.kind === "shade"),
    )
    .sort((a, b) => rank(a.x.kind) - rank(b.x.kind) || a.i - b.i)[0]?.x;
  return t ? { text: t.text.replace(/[.\s]+$/, ""), kind: t.kind } : null;
}

/** A postable park for a month: approved, open, with play, 2+ trait kinds and a line. */
export function mashupPark(
  p: {
    slug: string;
    name: string;
    city: string;
    lat: number;
    lng: number;
    approved: boolean;
    status: string;
    play: string;
  },
  profile: ParkProfile | null | undefined,
  month: number,
  o: { closed: boolean; noPick: boolean; cooling: boolean },
): MashupPark | null {
  if (!p.approved || p.status !== "active" || o.closed || o.noPick) return null;
  // Every pairing's copy says "playground": a park without one never pairs.
  if (p.play !== "playground") return null;
  if (!(MASHUP_TOWNS as readonly string[]).includes(p.city)) return null;
  const kinds = postKinds(profile, month);
  if (kinds < MIN_POST_TRAITS) return null;
  const line = parkLine(profile, month);
  if (!line) return null;
  return {
    slug: p.slug,
    name: p.name,
    city: p.city,
    lat: p.lat,
    lng: p.lng,
    kinds,
    trait: line.text,
    traitKind: line.kind,
    cooling: o.cooling,
  };
}

/**
 * Every park a mashup may pair with this month: the postable parks (2+
 * in-season trait kinds, with a line), open and pickable in the catalog.
 */
export function postableParks(
  parks: Iterable<Parameters<typeof mashupPark>[0]>,
  profiles: ReadonlyMap<string, ParkProfile>,
  catalog: Pick<Catalog, "parks">,
  month: number,
  cooling: ReadonlySet<string> = new Set(),
): MashupPark[] {
  const entry = (slug: string) => catalog.parks.find((c) => c.slug === slug);
  return [...parks].flatMap(
    (p) =>
      mashupPark(p, profiles.get(p.slug), month, {
        closed: !!entry(p.slug)?.closed,
        noPick: !!entry(p.slug)?.no_pick,
        cooling: cooling.has(p.slug),
      }) ?? [],
  );
}

// --- Distance ----------------------------------------------------------------

/** Straight-line miles between two points. */
export function miles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/** A walk only up to this straight line; a drive up to the next. */
export const WALK_MAX_MI = 0.3;
export const DRIVE_MAX_MI = 3;
/** Streets aren't straight: walking minutes at 3 mph over 1.3 times the line. */
const DETOUR = 1.3;
const MIN_PER_MI = 20;

/**
 * How the two are apart, or null when they're too far: "a 6-minute walk"
 * (0.3 mi or less, never over 10 minutes) or "a short drive" (3 mi or less).
 */
export function apart(
  mi: number,
): { walk: true; minutes: number } | { walk: false } | null {
  if (!Number.isFinite(mi) || mi < 0) return null;
  if (mi <= WALK_MAX_MI) {
    const minutes = Math.max(2, Math.ceil(mi * DETOUR * MIN_PER_MI));
    return minutes <= 10 ? { walk: true, minutes } : { walk: false };
  }
  return mi <= DRIVE_MAX_MI ? { walk: false } : null;
}

/** "6-minute walk" or "Short drive", as the slide's chip. */
export function apartChip(a: NonNullable<ReturnType<typeof apart>>): string {
  return a.walk ? `${a.minutes}-minute walk` : "Short drive";
}

// --- Pairing and scoring ---------------------------------------------------------

/** One place with its best park. */
export type Pairing = {
  place: Place;
  park: MashupPark;
  mi: number;
  apart: NonNullable<ReturnType<typeof apart>>;
  score: number;
};

/** A pair's score: closer, better parks and more family facts first. */
export function pairScore(
  place: Place,
  park: MashupPark,
  mi: number,
  month: number,
): number {
  const a = apart(mi);
  if (!a) return -Infinity;
  const winter = WINTER_MONTHS.has(month);
  const warm = WARM_MONTHS.has(month);
  let s = a.walk ? 2.5 - a.minutes / 10 : 1.2 - mi / 5;
  // Winter: short outings first (a walk, not a drive).
  if (winter && a.walk) s += 0.5;
  s += park.kinds * 0.25;
  // A park on Instagram lately (a park post, or a recent pairing) gives way.
  if (park.cooling) s -= 0.9;
  // Winter: shade and splash are no draw; a trait that works in the cold is.
  if (winter && park.traitKind === "shade") s -= 0.3;
  if (place.goodForChildren) s += 0.5;
  if (place.menuForChildren) s += 0.4;
  if (place.outdoorSeating) s += warm ? 0.3 : 0;
  // The rating only ranks among places that already passed the bar.
  s += Math.min(0.5, ((place.rating ?? RATING_MIN) - RATING_MIN) * 1.5);
  s += Math.min(0.3, Math.log10(Math.max(1, place.userRatingCount ?? 1)) / 10);
  return s;
}

/** Each place that passes, with its best park (null when none is close). */
export function pairPlaces(
  places: readonly Place[],
  parks: readonly MashupPark[],
  theme: MashupTheme,
  month: number,
): { pairs: Pairing[]; out: { name: string; why: string }[] } {
  const pairs: Pairing[] = [];
  const out: { name: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const place of places) {
    if (seen.has(place.placeId)) continue;
    seen.add(place.placeId);
    const why = placeProblem(place, theme, month);
    if (why) {
      // Two branches can share a name: the place id tells them apart.
      out.push({ name: `${place.name} (${place.placeId})`, why });
      continue;
    }
    let best: Pairing | null = null;
    for (const park of parks) {
      const mi = miles(place, park);
      const a = apart(mi);
      if (!a) continue;
      const score = pairScore(place, park, mi, month);
      if (!best || score > best.score)
        best = { place, park, mi, apart: a, score };
    }
    if (best) pairs.push(best);
    else
      out.push({
        name: `${place.name} (${place.placeId})`,
        why: "no vetted park within 3 miles",
      });
  }
  return { pairs: pairs.sort((a, b) => b.score - a.score), out };
}

export const PAIRS_MAX = 5;
export const PAIRS_MIN = 3;
/** At most this many pairs from one town, when other towns have some. */
const PER_TOWN = 3;

/**
 * The carousel's pairs: the best by score, one per place, park and brand,
 * none already used in this theme's cycle, at most 3 per town while other
 * towns have pairs. Bend first, then the other towns (as the Unpack).
 */
export function pickPairs(
  pairs: readonly Pairing[],
  used: ReadonlySet<string>,
  max = PAIRS_MAX,
): Pairing[] {
  const fresh = pairs.filter((p) => !used.has(p.place.placeId));
  const towns = new Set(fresh.map((p) => p.place.town));
  const out: Pairing[] = [];
  const parks = new Set<string>();
  const brands = new Set<string>();
  const perTown = new Map<string, number>();
  for (const pass of [true, false])
    for (const p of fresh) {
      if (out.length >= max) break;
      if (out.includes(p)) continue;
      const brand = cleanName(p.place.name).toLowerCase();
      if (parks.has(p.park.slug) || brands.has(brand)) continue;
      const town = p.place.town ?? "";
      if (pass && towns.size > 1 && (perTown.get(town) ?? 0) >= PER_TOWN)
        continue;
      out.push(p);
      parks.add(p.park.slug);
      brands.add(brand);
      perTown.set(town, (perTown.get(town) ?? 0) + 1);
    }
  const order = (t: string | null) => (t === "Bend" ? 0 : 1);
  return out.sort(
    (a, b) =>
      order(a.place.town) - order(b.place.town) ||
      (a.place.town ?? "").localeCompare(b.place.town ?? "") ||
      b.score - a.score,
  );
}

// --- Which theme -------------------------------------------------------------

/** One mashup already out (or queued), for the rotation. */
export type MashupHistory = {
  slotDate: string;
  theme: MashupTheme;
  cycle: number;
  placeIds: string[];
};

/**
 * The themes to try, best first: the first four in James's order, then
 * the least recently used theme that suits the month (fit 0.8 or more),
 * then the rest by how long ago they ran. The caller takes the first one
 * that yields enough pairs.
 */
export function themeOrder(
  history: readonly MashupHistory[],
  month: number,
): MashupTheme[] {
  const sorted = [...history].sort((a, b) =>
    a.slotDate.localeCompare(b.slotDate),
  );
  const last = new Map<MashupTheme, string>();
  for (const h of sorted) last.set(h.theme, h.slotDate);
  const lru = [...MASHUP_THEMES].sort(
    (a, b) =>
      (last.get(a) ?? "").localeCompare(last.get(b) ?? "") ||
      MASHUP_THEMES.indexOf(a) - MASHUP_THEMES.indexOf(b),
  );
  // The first theme in James's order that hasn't run yet (a fallback week
  // that ran another theme doesn't skip one).
  const first =
    THEME_ORDER.find((t) => !sorted.some((h) => h.theme === t)) ?? null;
  const inSeason = lru.filter((t) => seasonFit(t, month) >= IN_SEASON);
  const rest = lru.filter((t) => seasonFit(t, month) < IN_SEASON);
  const order = [...(first ? [first] : []), ...inSeason, ...rest];
  return [...new Set(order)];
}

/**
 * The places already used in a theme's current cycle. A pairing never
 * repeats until the theme's set is used up: when fewer than PAIRS_MIN
 * fresh pairs are left, a new cycle starts (every place eligible again,
 * except the theme's last carousel).
 */
export function cycleFor(
  history: readonly MashupHistory[],
  theme: MashupTheme,
  pairs: readonly Pairing[],
): { cycle: number; used: Set<string> } {
  const mine = history
    .filter((h) => h.theme === theme)
    .sort((a, b) => a.slotDate.localeCompare(b.slotDate));
  const cycle = mine.length ? Math.max(...mine.map((h) => h.cycle)) : 1;
  const used = new Set(
    mine.filter((h) => h.cycle === cycle).flatMap((h) => h.placeIds),
  );
  const fresh = pickPairs(pairs, used);
  if (fresh.length >= PAIRS_MIN || !mine.length) return { cycle, used };
  return { cycle: cycle + 1, used: new Set(mine.at(-1)?.placeIds ?? []) };
}

// --- Copy ----------------------------------------------------------------------

/** Each pair's distance phrase, for the intro: all walks, all drives, or both. */
function apartWords(pairs: readonly Pairing[]): string {
  const walks = pairs.filter((p) => p.apart.walk).length;
  if (walks === pairs.length) return "a short walk";
  if (walks === 0) return "a short drive";
  return "a short walk or drive";
}

/** "5" as the headline prints it. */
const n = (k: number) => String(k);

export type MashupCopy = {
  headline: string;
  highlight: string;
  intro: string;
};

/**
 * The cover and intro for a theme, in our voice: a few variants each,
 * picked by how many carousels of the theme came before, so they don't
 * read the same twice in a row. Every variant only says what the pairs
 * hold (the count, walk or drive, kids' menus only when every place has
 * one), and never drinks words.
 */
export function mashupCopy(
  theme: MashupTheme,
  pairs: readonly Pairing[],
  month: number,
  variant: number,
): MashupCopy {
  const k = pairs.length;
  const near = apartWords(pairs);
  const allWalk = pairs.every((p) => p.apart.walk);
  const winter = WINTER_MONTHS.has(month);
  const pick = <T>(xs: readonly T[]) => xs[Math.abs(variant) % xs.length];
  // One headline shape for the series ("5 cafes near a playground"), the
  // walk said only when every pair is a walk; the variants change the
  // intro's opening, so a theme's next carousel reads fresh.
  const where = allWalk
    ? "a short walk from a playground"
    : "near a playground";
  const cover = (places: string) => {
    const walk = `${n(k)} ${places} ${where}`;
    // 8 words at most: a long name for the places says "near" instead.
    return {
      headline:
        walk.split(/\s+/).length <= 8
          ? walk
          : `${n(k)} ${places} near a playground`,
      highlight: "playground",
    };
  };
  // No food or mealtime words ("lunch"): that reads as an hours claim. No
  // Google attribute either ("good for kids"): those only choose places.
  switch (theme) {
    case "coffee":
      return {
        ...cover("cafes"),
        intro: pick([
          winter
            ? "A warm cup for you, a playground for them."
            : "Coffee for the grown-ups, a playground for the kids.",
          `Start with a cup, end at the playground. Each pair is ${near} apart.`,
          `Pick a cafe, then let the kids loose. Every playground here is ${near} away.`,
        ]),
      };
    case "food_trucks":
      return {
        ...cover("food truck lots"),
        intro: pick([
          `Pick a truck, then let the kids run. Each lot is ${near} from a playground.`,
          `A food truck stop, then the playground. Each pair is ${near} apart.`,
        ]),
      };
    case "breweries":
      return {
        ...cover("breweries"),
        intro: pick([
          `A brewery stop, then the playground. Each pair is ${near} apart.`,
          `Each brewery here is ${near} from a playground the kids can run around.`,
        ]),
      };
    case "treats": {
      const iceCream = pairs.filter(
        (p) => p.place.primaryType === "ice_cream_shop",
      ).length;
      const shops =
        iceCream === k
          ? "ice cream shops"
          : iceCream === 0
            ? "bakeries"
            : "treat shops";
      return {
        ...cover(shops),
        intro: pick([
          `A treat first, then the playground. Each of these ${shops} is ${near} from a park.`,
          `Something sweet, then somewhere to climb. Each pair is ${near} apart.`,
        ]),
      };
    }
  }
}

/**
 * The park's trait as a clause after a colon: its first word lowercased
 * only when it's a plain word ("A juniper log forest", not "Bend's first").
 */
export function traitClause(trait: string): string {
  const PLAIN =
    /^(A|An|The|One|Two|Three|Four|Five|On|In|Along|By|Next|Right|With|Big|Giant|Towering|Sound|Musical|Panoramic|Shaded|Shady|Nature|Natural|Mountain|Views|Inclusive|Exploratory|Round|Railroad|Tree-house)\b/;
  return PLAIN.test(trait) ? trait[0].toLowerCase() + trait.slice(1) : trait;
}
