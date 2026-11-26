import type { Catalog } from "@/lib/news/catalog";
import { addDays, daysBetween, weekdayOf } from "@/lib/news/time";
import { clock } from "@/lib/events/model";
import { INDOOR, INDOOR_LABEL, type IndoorType } from "./indoor";
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
 * local spot for the grown-ups (a cafe, a food truck lot, a brewery, a
 * bakery or ice cream shop) with an anchor for the kids nearby: a vetted
 * park, an indoor place from our registry (lib/social/indoor.ts), or a
 * kids' event this weekend from our events listing. Pure: Google Places comes in through
 * lib/social/places.ts, the database through store.ts.
 *
 * Every claim is mechanical, from checked data, and printed in our words:
 *
 *   - the distance, from the two points: "a 6-minute walk" only when the
 *     straight line is 0.3 mi or less (never over 10 minutes), else "a
 *     short drive" (3 mi at most);
 *   - Google's attributes (good for children, kids' menu, patio, hours)
 *     only choose places, and are never printed or kept;
 *   - the anchor's line only from our own data: a park's in-season trait,
 *     an indoor place's grounded line, an event's day, time and short.
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
  /** regularOpeningHours, for choosing only (never printed or kept). */
  hours?: Hours | null;
};

/** Google's regularOpeningHours periods (day 0 is Sunday), in memory only. */
export type Hours = {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}[];

/** Is it open at this weekday (0 Sunday) and minute of the day? */
export function openAt(
  hours: Hours | null | undefined,
  day: number,
  min: number,
) {
  if (!hours?.length) return false;
  return hours.some((p) => {
    // Open around the clock: one period with no close.
    if (!p.close) return true;
    const from = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let to = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (to <= from) to += 7 * 1440;
    const t = day * 1440 + min;
    return (t >= from && t < to) || (t + 7 * 1440 >= from && t + 7 * 1440 < to);
  });
}

/** Open some time between 10 am and 4 pm on this weekday. */
export function openDaytime(hours: Hours | null | undefined, day: number) {
  // Two hours straight, somewhere between 10 am and 4 pm.
  for (let m = 10 * 60; m + 120 <= 16 * 60; m += 30) {
    let all = true;
    for (let t = m; t < m + 120; t += 30)
      if (!openAt(hours, day, t)) all = false;
    if (all) return true;
  }
  return false;
}

/** "HH:MM" as minutes of the day. */
export const minutesOf = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
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
  // A play cafe is the kids' anchor, never the grown-ups' cafe.
  if (
    theme === "coffee" &&
    (/\bplay\b/i.test(p.name) ||
      INDOOR.some((x) => x.place_id === p.placeId || x.site === p.domain))
  )
    return "a play cafe";
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

export type AnchorKind = "park" | "indoor" | "event";

/**
 * The kids' half of a pair (named for its first kind, a park): a vetted
 * park, an indoor place from our registry, or a kids' event this weekend.
 * Everything here is our own data.
 */
export type MashupPark = {
  kind: AnchorKind;
  /** Unique per anchor: a park's slug, an indoor place's, "event@day". */
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
  /** The slide's label: "At the park", "At the library", "This weekend". */
  label: string;
  /** Indoors (an indoor place, an indoor event): good in bad weather. */
  sheltered: boolean;
  /** Our page for it, or the place's own site (an indoor place). */
  href: string;
  /** The slide's icon for it. */
  icon: string;
  /** An indoor place: Google's id (for its hours) and its own site. */
  placeId?: string | null;
  site?: string | null;
  indoorType?: IndoorType;
  /** An event: which date, when, a weekly regular or not, its host's site. */
  event?: {
    slug: string;
    day: string;
    start: string;
    regular: boolean;
    host: string | null;
    venue?: string | null;
  };
};
export type Anchor = MashupPark;

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
    kind: "park",
    slug: p.slug,
    name: p.name,
    city: p.city,
    lat: p.lat,
    lng: p.lng,
    kinds,
    trait: line.text,
    traitKind: line.kind,
    cooling: o.cooling,
    label: "At the park",
    sheltered: false,
    href: `/parks/${p.slug}`,
    icon: "playground",
  };
}

const INDOOR_ICON: Record<IndoorType, string> = {
  library: "book",
  play_gym: "climbing",
  museum: "star",
  pool: "swim_ring",
};

/** The indoor registry as anchors (their hours are checked when picked). */
export function indoorAnchors(
  cooling: ReadonlySet<string> = new Set(),
): Anchor[] {
  return INDOOR.filter((x) =>
    (MASHUP_TOWNS as readonly string[]).includes(x.town),
  ).map((x) => ({
    kind: "indoor",
    slug: x.slug,
    name: x.name,
    city: x.town,
    lat: x.lat,
    lng: x.lng,
    kinds: x.type === "library" ? 2 : 3,
    trait: x.line,
    traitKind: x.type,
    cooling: cooling.has(x.slug),
    label: INDOOR_LABEL[x.type],
    sheltered: true,
    href: x.url,
    icon: INDOOR_ICON[x.type],
    placeId: x.place_id,
    site: x.site,
    indoorType: x.type,
  }));
}

/** One kids' event date, from our listing (store.ts checks it's live). */
export type EventAnchorInput = {
  slug: string;
  title: string;
  day: string;
  start: string;
  town: string;
  lat: number;
  lng: number;
  /** A weekly regular (a series), not a one-off special. */
  regular: boolean;
  /** Indoors, as the listing records it. */
  indoor: boolean;
  /** Its checked short line ("Kids sculpt air-dry clay"), or null. */
  short: string | null;
  /** Where it is, as the listing names the venue. */
  venue?: string | null;
  /** The host's registrable domain (for a verified tag), or null. */
  host: string | null;
};

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** The weekend after a Wednesday post: Friday, Saturday and Sunday. */
export function weekendOf(wed: string): string[] {
  return [2, 3, 4].map((i) => addDays(wed, i));
}

/** An event anchor starts in the day: 8 am to before 5 pm (no evening shows). */
export const EVENT_HOURS = { from: "08:00", before: "17:00" } as const;

/**
 * Kids' events this weekend as anchors: Friday to Sunday after the post,
 * starting in the day (8 am to before 5 pm), with a point and a line that
 * says what it is (its checked short, or its own first sentence), in our
 * towns. The line is the day, time and venue, then that.
 */
export function eventAnchors(
  inputs: readonly EventAnchorInput[],
  wed: string,
): Anchor[] {
  const days = new Set(weekendOf(wed));
  return inputs
    .filter(
      (e) =>
        days.has(e.day) &&
        /^\d{2}:\d{2}$/.test(e.start) &&
        e.start >= EVENT_HOURS.from &&
        e.start < EVENT_HOURS.before &&
        !!e.short &&
        (MASHUP_TOWNS as readonly string[]).includes(e.town),
    )
    .map((e) => ({
      kind: "event",
      slug: `${e.slug}@${e.day}`,
      name: e.title,
      city: e.town,
      lat: e.lat,
      lng: e.lng,
      // One-off specials first; a weekly regular is fine, once.
      kinds: e.regular ? 2 : 4,
      trait: `${WEEKDAY[weekdayOf(e.day)]} at ${clock(e.start)}${
        e.venue && e.venue !== e.title ? `, at ${e.venue}` : ""
      }.${e.short ? ` ${e.short.replace(/[.\s]+$/, "")}.` : ""}`,
      traitKind: "event",
      cooling: false,
      label: "This weekend",
      sheltered: e.indoor,
      href: `/events/${e.slug}`,
      icon: "calendar",
      event: {
        slug: e.slug,
        day: e.day,
        start: e.start,
        regular: e.regular,
        host: e.host,
        venue: e.venue ?? null,
      },
    }));
}

/** The same business, or the same building (0.02 mi): never one pair. */
export const SAME_SPOT_MI = 0.02;
export function sameSpot(place: Place, anchor: Anchor): boolean {
  return (
    (!!anchor.placeId && anchor.placeId === place.placeId) ||
    (!!anchor.site && !!place.domain && anchor.site === place.domain) ||
    miles(place, anchor) <= SAME_SPOT_MI
  );
}

/**
 * May this place pair with this anchor at all? Not the same spot; and a
 * cafe or a treats shop must be open when an event starts (its hours,
 * read at draft time, choose only).
 */
export function pairAllowed(
  place: Place,
  anchor: Anchor,
  theme: MashupTheme,
): boolean {
  if (sameSpot(place, anchor)) return false;
  if (anchor.event && (theme === "coffee" || theme === "treats"))
    return openAt(
      place.hours,
      weekdayOf(anchor.event.day),
      minutesOf(anchor.event.start),
    );
  return true;
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

/**
 * Every pair a place may make: each anchor within 3 miles that it may pair
 * with (not the same spot; open for an event), best first. A place with
 * none, or that fails the rules, is said why.
 */
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
    let any = false;
    for (const park of parks) {
      const mi = miles(place, park);
      const a = apart(mi);
      if (!a || !pairAllowed(place, park, theme)) continue;
      any = true;
      pairs.push({
        place,
        park,
        mi,
        apart: a,
        score: pairScore(place, park, mi, month),
      });
    }
    if (!any)
      out.push({
        name: `${place.name} (${place.placeId})`,
        why: "no anchor within 3 miles it may pair with",
      });
  }
  return { pairs: pairs.sort((a, b) => b.score - a.score), out };
}

export const PAIRS_MAX = 5;
export const PAIRS_MIN = 3;
/** At most this many pairs from one town, when other towns have some. */
const PER_TOWN = 3;
/** At most 2 library branches, and 1 weekly regular event, per carousel. */
export const MAX_LIBRARIES = 2;
export const MAX_REGULAR_EVENTS = 1;

/**
 * The carousel's pairs, group by group (the first group leads): the best
 * by score, one per place, anchor and brand, no two anchors in one spot,
 * none already used in this theme's cycle, at most 3 per town while other
 * towns have pairs, 2 libraries and 1 weekly regular event. Within a
 * group, Bend first, then the other towns (as the Unpack).
 */
export function pickPairs(
  pairs: readonly Pairing[] | readonly (readonly Pairing[])[],
  used: ReadonlySet<string>,
  max = PAIRS_MAX,
): Pairing[] {
  const groups = (
    Array.isArray(pairs[0]) ? pairs : [pairs]
  ) as readonly (readonly Pairing[])[];
  const all = groups.flat().filter((p) => !used.has(p.place.placeId));
  const towns = new Set(all.map((p) => p.place.town));
  const out: Pairing[] = [];
  const brands = new Set<string>();
  const perTown = new Map<string, number>();
  const fits = (p: Pairing, pass: boolean) => {
    if (out.includes(p)) return false;
    if (out.some((o) => o.place.placeId === p.place.placeId)) return false;
    const brand = cleanName(p.place.name).toLowerCase();
    if (brands.has(brand)) return false;
    if (
      out.some(
        (o) =>
          o.park.slug === p.park.slug ||
          (o.park.event &&
            p.park.event &&
            o.park.event.slug === p.park.event.slug) ||
          miles(o.park, p.park) <= SAME_SPOT_MI,
      )
    )
      return false;
    if (
      p.park.indoorType === "library" &&
      out.filter((o) => o.park.indoorType === "library").length >= MAX_LIBRARIES
    )
      return false;
    if (
      p.park.event?.regular &&
      out.filter((o) => o.park.event?.regular).length >= MAX_REGULAR_EVENTS
    )
      return false;
    const town = p.place.town ?? "";
    if (pass && towns.size > 1 && (perTown.get(town) ?? 0) >= PER_TOWN)
      return false;
    return true;
  };
  const picked: Pairing[][] = [];
  for (const g of groups) {
    const fresh = [...g]
      .filter((p) => !used.has(p.place.placeId))
      .sort((a, b) => b.score - a.score);
    const mine: Pairing[] = [];
    for (const pass of [true, false])
      for (const p of fresh) {
        if (out.length >= max) break;
        if (!fits(p, pass)) continue;
        out.push(p);
        mine.push(p);
        brands.add(cleanName(p.place.name).toLowerCase());
        const town = p.place.town ?? "";
        perTown.set(town, (perTown.get(town) ?? 0) + 1);
      }
    picked.push(mine);
  }
  const order = (t: string | null) => (t === "Bend" ? 0 : 1);
  return picked.flatMap((mine) =>
    mine.sort(
      (a, b) =>
        order(a.place.town) - order(b.place.town) ||
        (a.place.town ?? "").localeCompare(b.place.town ?? "") ||
        b.score - a.score,
    ),
  );
}

// --- The mix --------------------------------------------------------------------

/** This weekend's weather, as the mix reads it. */
export type Weather =
  { bad: false } | { bad: true; kind: "wet" | "snow" | "cold" };

/**
 * A bad weekend: on Saturday or Sunday, a 50% chance of rain or snow or
 * more, or a high of 35°F or less (the daytime periods of the forecast).
 */
export function weekendWeather(
  days: readonly {
    date: string;
    high: number | null;
    precip: number | null;
    /** The forecast's own icon ("snow", "rain", "mixed"), when it has one. */
    icon?: string;
  }[],
  wed: string,
): Weather {
  const [, sat, sun] = weekendOf(wed);
  let wet = false;
  let snow = false;
  let cold = false;
  for (const d of days)
    if (d.date === sat || d.date === sun) {
      if ((d.precip ?? 0) >= 50) {
        wet = true;
        // Snow is said only when the forecast says snow.
        if (d.icon === "snow") snow = true;
      }
      if (d.high != null && d.high <= 35) cold = true;
    }
  if (wet) return { bad: true, kind: snow ? "snow" : "wet" };
  return cold ? { bad: true, kind: "cold" } : { bad: false };
}

export type Mix = "parks" | "thin" | "weather";

/**
 * Which anchors a carousel uses. Good weather and 3 or more park pairs:
 * parks only, as always. Fewer park pairs: the parks, then indoor places
 * and events fill it (so a thin theme still runs). A bad weekend: indoor
 * places and indoor events lead, then the parks fill.
 */
export function chooseMix(
  pairs: readonly Pairing[],
  used: ReadonlySet<string>,
  weather: Weather,
): { mix: Mix; pairs: Pairing[] } {
  const parks = pairs.filter((p) => p.park.kind === "park");
  const others = pairs.filter((p) => p.park.kind !== "park");
  if (weather.bad) {
    const sheltered = others.filter((p) => p.park.sheltered);
    const rest = others.filter((p) => !p.park.sheltered);
    return { mix: "weather", pairs: pickPairs([sheltered, parks, rest], used) };
  }
  const only = pickPairs([parks], used);
  if (only.length >= PAIRS_MIN) return { mix: "parks", pairs: only };
  return { mix: "thin", pairs: pickPairs([parks, others], used) };
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
  weather: Weather = { bad: false },
): { cycle: number; used: Set<string> } {
  const mine = history
    .filter((h) => h.theme === theme)
    .sort((a, b) => a.slotDate.localeCompare(b.slotDate));
  const cycle = mine.length ? Math.max(...mine.map((h) => h.cycle)) : 1;
  const used = new Set(
    mine.filter((h) => h.cycle === cycle).flatMap((h) => h.placeIds),
  );
  const fresh = chooseMix(pairs, used, weather).pairs;
  if (fresh.length >= PAIRS_MIN || !mine.length) return { cycle, used };
  return { cycle: cycle + 1, used: new Set(mine.at(-1)?.placeIds ?? []) };
}

// --- Copy ----------------------------------------------------------------------

/** What the cover and intro may say, from the pairs (or the stored slides). */
export type CopyFacts = {
  count: number;
  /** How many pairs are a walk. */
  walks: number;
  allParks: boolean;
  allSheltered: boolean;
  /** Any anchor is an event (a show, a market): not "somewhere to play". */
  anyEvent: boolean;
  /** The weekend's bad weather, when it shaped the mix. */
  weather: "wet" | "snow" | "cold" | null;
  /** Treats: "bakeries", "ice cream shops" or "treat shops". */
  shops: string | null;
};

export function copyFacts(
  theme: MashupTheme,
  pairs: readonly Pairing[],
  weather: Weather,
  mix: Mix,
): CopyFacts {
  const k = pairs.length;
  const iceCream = pairs.filter(
    (p) => p.place.primaryType === "ice_cream_shop",
  ).length;
  return {
    count: k,
    walks: pairs.filter((p) => p.apart.walk).length,
    allParks: pairs.every((p) => p.park.kind === "park"),
    allSheltered: pairs.every((p) => p.park.sheltered),
    anyEvent: pairs.some((p) => p.park.kind === "event"),
    // The weather frames the set only when indoor anchors lead and are at
    // least half of it; otherwise it reads as a plain set.
    weather:
      mix === "weather" &&
      weather.bad &&
      !!pairs[0]?.park.sheltered &&
      pairs.filter((p) => p.park.sheltered).length * 2 >= k
        ? weather.kind
        : null,
    shops:
      theme !== "treats"
        ? null
        : iceCream === k
          ? "ice cream shops"
          : iceCream === 0
            ? "bakeries"
            : "treat shops",
  };
}

/** Each pair's distance phrase, for the intro: all walks, all drives, or both. */
function apartWords(f: CopyFacts): string {
  if (f.walks === f.count) return "a short walk";
  if (f.walks === 0) return "a short drive";
  return "a short walk or drive";
}

/** "5" as the headline prints it. */
const n = (k: number) => String(k);

export type MashupCopy = {
  headline: string;
  highlight: string;
  intro: string;
};

const wordsIn = (s: string) => s.split(/\s+/).length;

/**
 * The cover and intro for a theme, in our voice: a few variants each,
 * picked by how many carousels of the theme came before, so they don't
 * read the same twice in a row. Every variant only says what the pairs
 * hold: "a playground" only when every anchor is a park, "indoor play"
 * only when every one is indoors, a walk only when every pair is one, the
 * weather only when it shaped the mix. Never drinks, food or mealtime
 * words, and nothing of Google's.
 */
export function mashupCopy(
  theme: MashupTheme,
  f: CopyFacts,
  month: number,
  variant: number,
): MashupCopy {
  const k = f.count;
  const near = apartWords(f);
  const allWalk = f.walks === k;
  const winter = WINTER_MONTHS.has(month);
  const pick = <T>(xs: readonly T[]) => xs[Math.abs(variant) % xs.length];
  // What the kids get, as the anchors allow.
  // An event isn't "somewhere to play": then "something for the kids".
  const spot = f.allParks
    ? "a playground"
    : f.anyEvent
      ? "something for the kids"
      : f.allSheltered
        ? "somewhere indoors to play"
        : "somewhere to play";
  const theSpot = f.allParks
    ? "the playground"
    : f.anyEvent
      ? "something for the kids"
      : "somewhere to play";
  const places =
    theme === "coffee"
      ? "cafes"
      : theme === "food_trucks"
        ? "food truck lots"
        : theme === "breweries"
          ? "breweries"
          : (f.shops ?? "bakeries");
  // One headline shape for the series, 8 words at most.
  const tail = f.allParks
    ? allWalk
      ? "a short walk from a playground"
      : "near a playground"
    : f.anyEvent
      ? "+ something for the kids"
      : f.allSheltered
        ? "near indoor play"
        : "near somewhere to play";
  // Long place names ("food truck lots") take the shorter tail: 8 words.
  const fallback = f.allParks
    ? "near a playground"
    : f.anyEvent
      ? "+ something for kids"
      : "near somewhere to play";
  const headline =
    wordsIn(`${n(k)} ${places} ${tail}`) <= 8
      ? `${n(k)} ${places} ${tail}`
      : `${n(k)} ${places} ${fallback}`;
  // The weather goes in the cover's kicker ("Rainy-day pairings"), not the title.
  const highlight = f.allParks
    ? "playground"
    : f.anyEvent
      ? "kids"
      : headline.includes("indoor")
        ? "indoor"
        : "play";
  // In bad weather the intro opens on it, plainly.
  // Said as the set is: all indoors, or the indoor picks first and the
  // parks (labeled "If it clears up") after.
  const why =
    f.weather === "wet"
      ? "Rain is in the forecast"
      : f.weather === "snow"
        ? "Snow is in the forecast"
        : f.weather === "cold"
          ? "A cold weekend ahead"
          : null;
  const lead = !why
    ? ""
    : f.allSheltered
      ? `${why}, so these are all indoors. `
      : `${why}, so the indoor picks come first, then parks for if it clears up. `;
  const intro = (xs: string[]) => `${lead}${pick(xs)}`;
  switch (theme) {
    case "coffee":
      return {
        headline,
        highlight,
        intro: intro([
          // "for them" / "for the kids" already said by an event's phrase.
          winter
            ? f.anyEvent
              ? "A warm cup for you, and something for the kids."
              : `A warm cup for you, ${spot} for them.`
            : f.anyEvent
              ? "Coffee for the grown-ups, and something for the kids."
              : `Coffee for the grown-ups, ${spot} for the kids.`,
          `Start with a cup, then ${theSpot}. Each pair is ${near} apart.`,
          `Pick a cafe, then let the kids loose. Each pair is ${near} apart.`,
        ]),
      };
    case "food_trucks":
      return {
        headline,
        highlight,
        intro: intro([
          `Pick a truck, then let the kids run. Each lot is ${near} from ${spot}.`,
          `A food truck stop, then ${theSpot}. Each pair is ${near} apart.`,
        ]),
      };
    case "breweries":
      return {
        headline,
        highlight,
        intro: intro([
          `A brewery stop, then ${theSpot}. Each pair is ${near} apart.`,
          `Each brewery here is ${near} from ${spot}.`,
        ]),
      };
    case "treats":
      return {
        headline,
        highlight,
        intro: intro([
          `A treat first, then ${theSpot}. Each of these ${places} is ${near} from ${spot}.`,
          `Something sweet, then ${theSpot}. Each pair is ${near} apart.`,
        ]),
      };
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
