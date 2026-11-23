import { addDays } from "@/lib/news/time";
import { milesBetween } from "./geo";
import { listWords, parkFacts } from "./park-facts";
import type { ParkProfile, Trait } from "./park-profiles";
import { inSeason } from "./park-profiles";
import {
  type EventRow,
  isFree,
  monthDay,
  pacificToday,
  shortDate,
} from "./events/model";
import {
  buildPrograms,
  narrowPrograms,
  type Program,
  venueLine,
} from "./events/programs";
import { eventLastmod } from "./events/state";
import type { Venue } from "./news/catalog";
import type { ParkSummary } from "./data";

/**
 * Seasonal guides (/guides/<slug>): evergreen pages at permanent URLs,
 * built only from data we already store (parks and their stickers,
 * signature traits with their seasons, the indoor venue catalog, kids'
 * events), so they refresh by themselves. Every line a guide prints is a
 * fact from that data: no hours, prices or safety claims we don't store.
 * Pure: no database, no clock (callers pass `now`).
 */

/** What a guide is made from (the caller loads it). */
export type GuideInput = {
  parks: readonly GuidePark[];
  /** Live signature traits (park-profiles-check currentProfiles). */
  profiles: ReadonlyMap<string, ParkProfile>;
  events: readonly EventRow[];
  venues: readonly GuideVenue[];
  now: Date;
  /** A town's page (its own, or the hub's anchor). */
  townHref: (city: string) => string;
};

export type GuidePark = Pick<
  ParkSummary,
  | "id"
  | "slug"
  | "name"
  | "city"
  | "lat"
  | "lng"
  | "play"
  | "status"
  | "features"
  | "reports"
  | "avgTenths"
  | "reviewCount"
> & { updated: string };

export type GuideVenue = Venue;

export type GuideSlug =
  | "sledding-hills-bend"
  | "holiday-events-central-oregon"
  | "indoor-play-bend"
  | "splash-pads-bend";

export type GuideDef = {
  slug: GuideSlug;
  /** Its card and link name ("Sledding hills near Bend"). */
  name: string;
  /** One line for the index, llms.txt and the share card. */
  blurb: string;
  /** Months it's most useful (1 to 12); empty: all year. */
  months: number[];
};

export const GUIDES: readonly GuideDef[] = [
  {
    slug: "sledding-hills-bend",
    name: "Sledding hills near Bend",
    blurb: "Park sledding hills for kids, from the parks' own pages.",
    months: [12, 1, 2, 3],
  },
  {
    slug: "holiday-events-central-oregon",
    name: "Holiday events for kids",
    blurb: "Christmas and holiday events for kids in Central Oregon this year.",
    months: [11, 12],
  },
  {
    slug: "indoor-play-bend",
    name: "Indoor play in Bend",
    blurb: "Indoor places and events for snowy days in Bend.",
    months: [11, 12, 1, 2, 3],
  },
  {
    slug: "splash-pads-bend",
    name: "Splash pads near Bend",
    blurb: "Splash pads in and around Bend, and when they run.",
    months: [5, 6, 7, 8, 9],
  },
];

export function guideDef(slug: string): GuideDef | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}

export const guidePath = (slug: GuideSlug) => `/guides/${slug}`;

// --- Shapes a page renders ----------------------------------------------------

export type ParkItem = {
  slug: string;
  name: string;
  city: string;
  townHref: string;
  /** The trait lines (our words), first the one the guide is about. */
  lines: string[];
  /** "December to March", when a season is on file. */
  season: string | null;
  /** Stickers families report ("restrooms", "shade"). */
  has: string[];
  /** "About 15 miles from downtown Bend" (straight line), or null in Bend. */
  away: string | null;
};

export type VenueItem = {
  id: string;
  name: string;
  town: string;
  townHref: string;
  kind: string;
  what: string;
  ages: string;
  free: boolean;
  driveMinutes: number;
  url: string;
  hoursUrl: string | null;
};

export type GuideSection =
  | { kind: "parks"; title: string; id: string; items: ParkItem[] }
  | { kind: "venues"; title: string; id: string; items: VenueItem[] }
  | {
      kind: "programs";
      title: string;
      id: string;
      style: "special" | "regular";
      programs: Program[];
      /** A link to more (the filtered listing). */
      more?: { href: string; label: string };
    };

export type Qa = { q: string; a: string };

export type GuideView = {
  def: GuideDef;
  /** The H1, in three parts (lead, the crayon word, trail). */
  h1: { lead?: string; accent: string; trail?: string };
  /** The browser and search title (no site name). */
  title: string;
  description: string;
  /** 2 or 3 sentences. */
  intro: string;
  inSeason: boolean;
  /** One honest line about the season ("Sledding season here is ..."). */
  seasonNote: string;
  /** "2026-11-21": the newest change in what the guide shows. */
  updated: string;
  sections: GuideSection[];
  faq: Qa[];
  /** Everything listed, in order, for ItemList markup (site paths or https). */
  list: { name: string; url: string }[];
  /** Parks, venues or events listed (the headline count). */
  count: number;
  /** Out of season: where to go instead (a link after the season line). */
  instead?: { href: string; label: string };
  /** When nothing is listed: the line, and where to go instead. */
  empty: { line: string; href: string; label: string } | null;
};

// --- Helpers -------------------------------------------------------------------

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "December to March" for [12, 1, 2, 3]; "May to September"; "July". */
export function monthSpan(months: readonly number[]): string {
  const set = new Set(months);
  if (!set.size) return "";
  if (set.size === 1) return MONTH_NAMES[[...set][0] - 1];
  // The first month whose month before isn't in the set starts the run.
  const first =
    [...set].find((m) => !set.has(m === 1 ? 12 : m - 1)) ?? [...set][0];
  let last = first;
  while (
    set.has(last === 12 ? 1 : last + 1) &&
    (last === 12 ? 1 : last + 1) !== first
  )
    last = last === 12 ? 1 : last + 1;
  return `${MONTH_NAMES[first - 1]} to ${MONTH_NAMES[last - 1]}`;
}

/** Month (1 to 12) of a Pacific day. */
const monthOf = (day: string) => Number(day.slice(5, 7));

/** Downtown Bend (Wall St and Oregon Ave). */
export const DOWNTOWN_BEND = { lat: 44.0582, lng: -121.3153 };

const isBend = (city: string) => city.trim().toLowerCase() === "bend";

function away(p: { lat: number; lng: number; city: string }): string | null {
  if (isBend(p.city)) return null;
  const mi = Math.round(milesBetween(DOWNTOWN_BEND, p));
  return `About ${mi} miles from downtown Bend`;
}

/** Bend first, then by distance from downtown Bend, then name. */
function nearBendFirst<
  T extends { lat: number; lng: number; city: string; name: string },
>(a: T, b: T): number {
  return (
    Number(!isBend(a.city)) - Number(!isBend(b.city)) ||
    milesBetween(DOWNTOWN_BEND, a) - milesBetween(DOWNTOWN_BEND, b) ||
    a.name.localeCompare(b.name)
  );
}

/** The stickers parents ask about, in the order they ask. */
const HAS: [string, string][] = [
  ["restrooms", "restrooms"],
  ["toddler_area", "toddler area"],
  ["shade", "shade"],
  ["fenced", "fenced"],
  ["accessible", "accessible"],
  ["parking", "easy parking"],
];

function hasList(p: GuidePark): string[] {
  const f = parkFacts(p);
  return HAS.filter(([k]) => f.has(k)).map(([, w]) => w);
}

/** The later of two days ("" is earliest). */
const later = (a: string, b: string) => (b > a ? b : a);

/** Live traits of a kind, by park slug. */
function traitsOf(
  profiles: ReadonlyMap<string, ParkProfile>,
  slug: string,
): Trait[] {
  return profiles.get(slug)?.traits ?? [];
}

function parkItem(
  p: GuidePark,
  first: Trait | null,
  input: GuideInput,
  opts: { maxLines?: number; winter?: boolean } = {},
): ParkItem {
  const traits = traitsOf(input.profiles, p.slug).filter(
    (t) => t.kind !== "nearby" && t.kind !== "history",
  );
  const lines = [
    ...(first ? [first.text] : []),
    ...traits.filter((t) => t !== first).map((t) => t.text),
  ].slice(0, opts.maxLines ?? 3);
  return {
    slug: p.slug,
    name: p.name,
    city: p.city,
    townHref: input.townHref(p.city),
    lines,
    season: first?.season ? monthSpan(first.season) : null,
    // Shade doesn't help on a snow day.
    has: hasList(p).filter((h) => !(opts.winter && h === "shade")),
    away: away(p),
  };
}

const parkList = (items: ParkItem[]) =>
  items.map((x) => ({ name: x.name, url: `/parks/${x.slug}` }));

const names = (xs: { name: string }[], max = 4) => {
  const n = xs.slice(0, max).map((x) => x.name);
  const more = xs.length - n.length;
  return more > 0 ? `${n.join(", ")} and ${more} more` : listWords(n);
};

/** "Two" for 2 (sentences start with words, not numerals), else the number. */
const WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];
export const count = (n: number) => (n < 10 ? WORDS[n] : String(n));

/** A day from a time, in Central Oregon. */
const dayOfDate = (d: Date) => pacificToday(d);

// --- 1. Sledding ---------------------------------------------------------------

export function sleddingGuide(input: GuideInput): GuideView {
  const def = guideDef("sledding-hills-bend")!;
  const today = pacificToday(input.now);
  const month = monthOf(today);
  const hills = input.parks
    .map((p) => ({
      p,
      t: traitsOf(input.profiles, p.slug).find((t) => t.kind === "sledding"),
    }))
    .filter((x): x is { p: GuidePark; t: Trait } => !!x.t)
    .sort((a, b) => nearBendFirst(a.p, b.p));
  // Other snow play on file (cross-country ski tracks), not a sledding hill.
  const snowy = input.parks
    .map((p) => ({
      p,
      t: traitsOf(input.profiles, p.slug).find(
        (t) =>
          t.kind !== "sledding" &&
          !!t.season &&
          t.season.includes(1) &&
          !t.season.includes(7),
      ),
    }))
    .filter((x): x is { p: GuidePark; t: Trait } => !!x.t)
    .filter((x) => !hills.some((h) => h.p.slug === x.p.slug))
    .sort((a, b) => nearBendFirst(a.p, b.p));
  const months = [...new Set(hills.flatMap((h) => h.t.season ?? []))];
  const span = months.length ? monthSpan(months) : monthSpan(def.months);
  const on = hills.some((h) => inSeason(h.t, month));
  const winter = { maxLines: 1, winter: true };
  const items = hills.map((h) => parkItem(h.p, h.t, input, winter));
  const more = snowy.map((s) => parkItem(s.p, s.t, input, winter));
  const little = hills.filter((h) =>
    /\b(little|small|toddlers?|young)\b/i.test(h.t.text),
  );
  const updated = [...hills, ...snowy].reduce(
    (a, x) => later(later(a, x.p.updated), x.t.verified_on),
    "",
  );

  const intro = items.length
    ? [
        `${items.length === 1 ? "One park" : `${count(items.length)} parks`} near Bend ${items.length === 1 ? "lists" : "list"} a sledding hill on ${items.length === 1 ? "its" : "their"} official park page: ${names(items)}.`,
        "Bring a sled when there's snow on the ground.",
      ].join(" ")
    : "We don't have a park sledding hill on file yet. When a park page lists one, it shows up here.";

  const faq: Qa[] = [];
  if (items.length)
    faq.push({
      q: "Where can kids go sledding in Bend?",
      a: `${names(items, 6)}. ${items.length === 1 ? "It's" : "Each is"} listed as a sledding spot on the park's own page.`,
    });
  faq.push({
    q: "When is sledding season at Bend parks?",
    a: `The parks list these as winter sledding areas. We show them ${span}, and they need snow on the ground.`,
  });
  if (little.length)
    faq.push({
      q: "Is there a sledding hill for little kids?",
      a: `${listWords(little.map((h) => h.p.name))}: ${little
        .map((h) => h.t.text.replace(/^A /, "a "))
        .join("; ")}.`,
    });

  if (more.length)
    faq.push({
      q: "Where else can kids play in the snow?",
      a: more.map((x) => `${x.name}: ${x.lines[0]}.`).join(" "),
    });

  return {
    def,
    h1: { accent: "Sledding hills", trail: " near Bend" },
    ...(on
      ? {}
      : {
          instead: {
            href: guidePath("indoor-play-bend"),
            label: "No snow yet? Indoor play in Bend",
          },
        }),
    title: "Sledding hills near Bend for kids",
    description: items.length
      ? `${names(items, 3)}: park sledding hills near Bend, Oregon, for kids, with what else each park has. Sledding season here runs ${span}.`
      : "Park sledding hills near Bend, Oregon, for kids.",
    intro,
    inSeason: on,
    seasonNote: on
      ? `It's sledding season (${span}). Hills need snow, so check the forecast.`
      : `Sledding season here runs ${span}, when there's snow.`,
    updated,
    sections: [
      { kind: "parks", title: "Sledding hills", id: "hills", items },
      ...(more.length
        ? [
            {
              kind: "parks" as const,
              title: "More snow play",
              id: "snow",
              items: more,
            },
          ]
        : []),
    ],
    faq: faq.slice(0, 5),
    list: parkList([...items, ...more]),
    count: items.length,
    empty: items.length
      ? null
      : {
          line: "No sledding hills on file yet.",
          href: "/towns/bend",
          label: "See every park in Bend",
        },
  };
}

// --- 2. Holiday events ---------------------------------------------------------

/** Words that make an event a winter-holiday one (title or description). */
export const HOLIDAY =
  /\b(christmas|xmas|holidays?|santa'?s?|nutcracker|train man|polar express|tree lighting|carol(s|ing)?|reindeer|gingerbread|ornaments?|hanukkah|chanukah|kwanzaa|new year'?s?( eve)?|winter ?fest(ival)?|solstice|light show|holiday lights|symphony of lights|elf|grinch|menorah)\b/i;

/**
 * The holiday season a day belongs to: November 1 to January 1. New
 * Year's Day still counts as the season before; from January 2 the page
 * looks ahead to this year's.
 */
export function holidaySeason(today: string): {
  year: number;
  from: string;
  to: string;
  inSeason: boolean;
} {
  const y = Number(today.slice(0, 4));
  const year = today <= `${y}-01-01` ? y - 1 : y;
  const from = `${year}-11-01`;
  const to = `${year + 1}-01-01`;
  return { year, from, to, inSeason: today >= from && today <= to };
}

const isHoliday = (r: EventRow) =>
  HOLIDAY.test(`${r.data.title} ${r.data.what}`);

/** A program's dates inside the season (any branch). */
const inWindow = (p: Program, from: string, to: string) =>
  p.branches.some((b) =>
    b.upcoming.some((d) => d.day <= to && (d.end_day ?? d.day) >= from),
  );

export function holidayGuide(input: GuideInput): GuideView {
  const def = guideDef("holiday-events-central-oregon")!;
  const today = pacificToday(input.now);
  const season = holidaySeason(today);
  const programs = narrowPrograms(
    buildPrograms(input.events, input.now),
    isHoliday,
    today,
  ).filter((p) => inWindow(p, season.from, season.to));
  // Specials first (big days out), then holiday regulars (weekly crafts).
  const specials = programs.filter((p) => p.kind === "special");
  const regulars = programs.filter((p) => p.kind === "regular");
  const rows = programs.flatMap((p) => p.branches.flatMap((b) => b.rows));
  const n = programs.length;
  const free = specials.filter((p) =>
    p.branches.every((b) => b.rows.every((r) => isFree(r.data))),
  );
  const santa = specials.filter((p) => /\bsanta\b/i.test(p.title));
  const lighting = specials.filter((p) => /\btree lighting\b/i.test(p.title));
  const towns = [...new Set(rows.map((r) => r.data.venue.town))].sort();
  const indoor = programs.filter((p) =>
    p.branches.every((b) => b.rows.every((r) => r.data.setting === "indoor")),
  );
  const when = (p: Program) =>
    `${p.title} (${monthDay(p.lead.next.day < today ? today : p.lead.next.day)}, ${venueLine(p.lead.nextRow)})`;
  const updated = rows.reduce(
    (a, r) => later(a, dayOfDate(eventLastmod(r, input.now))),
    "",
  );
  const y = season.year;

  const intro = n
    ? [
        `${count(n)} kids' holiday ${n === 1 ? "event is" : "events are"} on our calendar for ${y} so far, in ${listWords(towns)}.`,
        specials.length
          ? `${regulars.length ? "Special events come first, in date order" : "They're in date order"}, starting with ${specials[0].title} on ${shortDate(specials[0].day)}.`
          : "",
        "We add more as organizers post them.",
      ]
        .filter(Boolean)
        .join(" ")
    : season.inSeason
      ? `No kids' holiday events are on our calendar for ${y} yet. We add them as organizers post them.`
      : `The ${y} holiday season starts in November. We add kids' holiday events here as organizers post them.`;

  const faq: Qa[] = [];
  if (n)
    faq.push({
      q: `What holiday events are there for kids in Central Oregon in ${y}?`,
      a: `${n} so far, including ${(specials.length ? specials : regulars)
        .slice(0, 3)
        .map(when)
        .join("; ")}.`,
    });
  if (santa.length)
    faq.push({
      q: "Which holiday events have Santa in the title?",
      a: `${santa.map(when).join("; ")}.`,
    });
  if (lighting.length)
    faq.push({
      q: "When is the tree lighting?",
      a: `${lighting.map(when).join("; ")}.`,
    });
  if (free.length)
    faq.push({
      q: "Are there free holiday events for kids?",
      a: `Yes, the organizers list these as free: ${free
        .slice(0, 5)
        .map((p) => p.title)
        .join(", ")}.`,
    });
  if (n)
    faq.push({
      q: "Are there indoor holiday events for snowy days?",
      a: indoor.length
        ? `Yes, ${indoor.length} of ${n} are indoors, including ${indoor
            .slice(0, 3)
            .map((p) => p.title)
            .join(", ")}.`
        : "Not yet: everything on the list so far is outdoors.",
    });
  if (!n)
    faq.push({
      q: `When do holiday events for ${y} show up here?`,
      a: "As soon as organizers post them and we can check them on their own pages. The kids' events page has everything coming up in the meantime.",
    });

  return {
    def,
    h1: {
      lead: "Christmas and",
      accent: "holiday events",
      trail: ` for kids in Central Oregon, ${y}`,
    },
    title: `Christmas and holiday events for kids in Central Oregon, ${y}`,
    description: n
      ? `${n} kids' holiday events in Central Oregon for ${y}: ${specials
          .slice(0, 3)
          .map((p) => p.title)
          .join(
            ", ",
          )}${specials.length > 3 ? " and more" : ""}. Dates, places and links to each event.`
      : `Kids' Christmas and holiday events in Bend, Redmond and Central Oregon for ${y}, as organizers post them.`,
    intro,
    inSeason: season.inSeason,
    seasonNote: season.inSeason
      ? `This is the ${y} season: November 1 to New Year's Day. Plans change, so check each event's page before you go.`
      : `The ${y} holiday season runs November 1 to New Year's Day. This page fills in as events are posted.`,
    updated,
    sections: [
      ...(specials.length
        ? [
            {
              kind: "programs" as const,
              title: regulars.length
                ? "Special events"
                : "Holiday events, by date",
              id: "specials",
              style: "special" as const,
              programs: specials,
            },
          ]
        : []),
      ...(regulars.length
        ? [
            {
              kind: "programs" as const,
              title: "Holiday crafts and classes that repeat",
              id: "regulars",
              style: "regular" as const,
              programs: regulars,
            },
          ]
        : []),
    ],
    faq: faq.slice(0, 5),
    list: [...specials, ...regulars].map((p) => ({
      name: p.title,
      url: `/events/${p.lead.nextRow.slug}`,
    })),
    count: n,
    empty: n
      ? null
      : {
          line: "No holiday events on the calendar yet.",
          href: "/events",
          label: "See every kids' event",
        },
  };
}

// --- 3. Indoor play ------------------------------------------------------------

export const INDOOR_EVENT_DAYS = 7;
/** Nearby towns' venues count when they're this close (minutes' drive). */
export const INDOOR_NEARBY_MINUTES = 35;

const KIND_WORDS: Record<string, string> = {
  museum: "Museum",
  pool: "Pool",
  library: "Library",
  indoor_play: "Indoor play",
  climbing: "Climbing gym",
  skating: "Ice rink",
  trampoline: "Trampoline park",
  nature_center: "Nature center",
  other: "Fun center",
};

export function indoorGuide(input: GuideInput): GuideView {
  const def = guideDef("indoor-play-bend")!;
  const today = pacificToday(input.now);
  const month = monthOf(today);
  const snowMonth = def.months.includes(month);
  const venues = input.venues
    .filter(
      (v) =>
        v.verified &&
        v.enclosure === "indoor" &&
        v.weather.includes("snow") &&
        v.months.includes(month) &&
        (isBend(v.town) ||
          v.drive_minutes_from_downtown <= INDOOR_NEARBY_MINUTES),
    )
    .sort(
      (a, b) =>
        Number(!isBend(a.town)) - Number(!isBend(b.town)) ||
        a.drive_minutes_from_downtown - b.drive_minutes_from_downtown ||
        a.name.localeCompare(b.name),
    );
  const item = (v: GuideVenue): VenueItem => ({
    id: v.id,
    name: v.name,
    town: v.town,
    townHref: input.townHref(v.town),
    kind: KIND_WORDS[v.kind] ?? "Indoor",
    what: v.what,
    ages: v.ages_label,
    free: v.cost === "free",
    driveMinutes: v.drive_minutes_from_downtown,
    url: v.url,
    hoursUrl: v.hours_url,
  });
  const inBend = venues.filter((v) => isBend(v.town)).map(item);
  const nearby = venues.filter((v) => !isBend(v.town)).map(item);
  const all = [...inBend, ...nearby];
  const end = addDays(today, INDOOR_EVENT_DAYS - 1);
  const indoorPrograms = narrowPrograms(
    buildPrograms(input.events, input.now),
    (r) => r.data.setting === "indoor",
    today,
  );
  // Events in Bend and the towns the nearby venues are in.
  const near = new Set(venues.map((v) => v.town.toLowerCase()));
  const thisWeek = narrowPrograms(
    indoorPrograms,
    (r) => near.has(r.data.venue.town.trim().toLowerCase()),
    today,
  ).filter((p) => p.kind === "special" && p.day <= end);
  const shown = thisWeek.slice(0, 8);
  const free = venues.filter((v) => v.cost === "free");
  const littles = venues.filter((v) =>
    /\b(toddlers?|bab(y|ies)|tots?|months|preschool|6 and under)\b/i.test(
      `${v.what} ${v.ages_label}`,
    ),
  );
  const short = (xs: GuideVenue[], max = 4) =>
    names(
      xs.map((v) => ({ name: v.name.replace(/\s*\(.*\)$/, "") })),
      max,
    );
  const freeLine = !free.length
    ? ""
    : free.every((v) => v.kind === "library")
      ? `The ${free.length === 1 ? "library is" : `${count(free.length).toLowerCase()} libraries are`} free.`
      : `${short(free, 6)} ${free.length === 1 ? "is" : "are"} free.`;
  const rows = shown.flatMap((p) => p.branches.flatMap((b) => b.rows));
  const updated = [
    ...venues.map((v) => v.verified_on ?? ""),
    ...rows.map((r) => dayOfDate(eventLastmod(r, input.now))),
  ].reduce(later, "");

  const intro = all.length
    ? [
        `${count(all.length)} indoor places in and near Bend for a snowy day, closest first: ${short(venues, 3)}.`,
        thisWeek.length
          ? `There ${thisWeek.length === 1 ? "is" : "are"} also ${thisWeek.length} indoor kids' ${thisWeek.length === 1 ? "event" : "events"} in the next week.`
          : "",
        freeLine,
      ]
        .filter(Boolean)
        .join(" ")
    : "No indoor places are on file for this month yet.";

  const faq: Qa[] = [];
  if (all.length)
    faq.push({
      q: "Where can kids play indoors in Bend when it snows?",
      a: `In Bend: ${short(
        venues.filter((v) => isBend(v.town)),
        99,
      )}. ${
        nearby.length
          ? `A short drive away: ${short(
              venues.filter((v) => !isBend(v.town)),
              99,
            )}.`
          : ""
      }`.trim(),
    });
  if (free.length)
    faq.push({
      q: "Are there free indoor places for kids in Bend?",
      a: `${short(free, 8)} ${free.length === 1 ? "is" : "are"} free.`,
    });
  if (littles.length)
    faq.push({
      q: "Where can toddlers play inside?",
      a: `These list something for babies or toddlers (a play area, a little pool, set times or story times): ${short(littles, 99)}.`,
    });
  faq.push({
    q: "What indoor kids' events are on this week?",
    a: thisWeek.length
      ? `${thisWeek
          .slice(0, 4)
          .map(
            (p) =>
              `${p.title} (${shortDate(p.day)}, ${venueLine(p.lead.nextRow)})`,
          )
          .join(
            "; ",
          )}${thisWeek.length > 4 ? `, and ${thisWeek.length - 4} more` : ""}.`
      : "Nothing special indoors in the next week yet. Story times and other regulars are on the kids' events page.",
  });

  return {
    def,
    h1: { lead: "Indoor play in", accent: "Bend", trail: " when it's snowy" },
    title: `Indoor play in Bend when it's snowy: ${all.length} places for kids`,
    description: all.length
      ? `${all.length} indoor places for kids in and near Bend, Oregon, for snow days: ${names(all, 3)}. Plus indoor kids' events this week.`
      : "Indoor places and events for kids in Bend, Oregon, for snow days.",
    intro,
    inSeason: snowMonth,
    seasonNote: snowMonth
      ? "Good for snowy or very cold days. Hours and prices change, so check each place's own site before you go."
      : "This list is for snow days, but the same places work on smoky or very hot days. Check each place's own site before you go.",
    updated,
    sections: [
      ...(inBend.length
        ? [
            {
              kind: "venues" as const,
              title: "In Bend",
              id: "bend",
              items: inBend,
            },
          ]
        : []),
      ...(nearby.length
        ? [
            {
              kind: "venues" as const,
              title: "A short drive away",
              id: "nearby",
              items: nearby,
            },
          ]
        : []),
      {
        kind: "programs" as const,
        title: "Indoor events this week",
        id: "events",
        style: "special" as const,
        programs: shown,
        more: {
          href: "/events?setting=indoor",
          label:
            thisWeek.length > shown.length
              ? `See all ${thisWeek.length} indoor events this week`
              : "Every indoor kids' event",
        },
      },
    ],
    faq: faq.slice(0, 5),
    list: [
      ...all.map((v) => ({ name: v.name, url: v.url })),
      ...shown.map((p) => ({
        name: p.title,
        url: `/events/${p.lead.nextRow.slug}`,
      })),
    ],
    count: all.length,
    empty: all.length
      ? null
      : {
          line: "No indoor places on file yet.",
          href: "/events?setting=indoor",
          label: "See indoor events",
        },
  };
}

// --- 4. Splash pads ------------------------------------------------------------

/** Stickers or a signature trait say splash pad. */
function splashOf(
  p: GuidePark,
  profiles: ReadonlyMap<string, ParkProfile>,
): { trait: Trait | null } | null {
  const trait =
    traitsOf(profiles, p.slug).find((t) => t.kind === "splash_pad") ?? null;
  const sticker = parkFacts(p).has("splash_pad");
  return trait || sticker ? { trait } : null;
}

export function splashGuide(input: GuideInput): GuideView {
  const def = guideDef("splash-pads-bend")!;
  const today = pacificToday(input.now);
  const month = monthOf(today);
  const pads = input.parks
    .map((p) => ({ p, s: splashOf(p, input.profiles) }))
    .filter((x): x is { p: GuidePark; s: { trait: Trait | null } } => !!x.s)
    .sort((a, b) => nearBendFirst(a.p, b.p));
  const items = pads.map((x) => {
    const it = parkItem(x.p, x.s.trait, input);
    return x.s.trait
      ? it
      : {
          ...it,
          lines: [
            "Splash pad (reported on park maps and by families)",
            ...it.lines,
          ].slice(0, 3),
        };
  });
  const seasons = [...new Set(pads.flatMap((x) => x.s.trait?.season ?? []))];
  const span = monthSpan(seasons.length ? seasons : def.months);
  const withSeason = pads.filter((x) => x.s.trait?.season);
  const on = seasons.length
    ? seasons.includes(month)
    : def.months.includes(month);
  const inBend = items.filter((x) => isBend(x.city));
  const restrooms = items.filter((x) => x.has.includes("restrooms"));
  // "Alpenglow Park, Stryker Park and Sahalee Park run May to September."
  const bySpan = new Map<string, string[]>();
  for (const x of withSeason) {
    const k = monthSpan(x.s.trait!.season!);
    bySpan.set(k, [...(bySpan.get(k) ?? []), x.p.name]);
  }
  const seasonLine = bySpan.size
    ? [...bySpan]
        .map(
          ([k, ns]) =>
            `${listWords(ns)} ${ns.length === 1 ? "runs" : "run"} ${k}.`,
        )
        .join(" ")
    : `Most run in summer (${span}).`;
  const updated = pads.reduce(
    (a, x) => later(later(a, x.p.updated), x.s.trait?.verified_on ?? ""),
    "",
  );

  const intro = items.length
    ? [
        `${count(items.length)} parks in and around Bend have a splash pad, closest first.`,
        inBend.length
          ? `${listWords(inBend.map((x) => x.name))} ${inBend.length === 1 ? "is" : "are"} in Bend; the rest are in ${listWords([...new Set(items.filter((x) => !isBend(x.city)).map((x) => x.city))])}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "We don't have a splash pad on file near Bend yet.";

  const faq: Qa[] = [];
  if (items.length)
    faq.push({
      q: "Where are the splash pads near Bend?",
      a: `${items.map((x) => `${x.name} (${x.city})`).join(", ")}.`,
    });
  if (withSeason.length)
    faq.push({
      q: "When do splash pads open in Central Oregon?",
      a:
        withSeason.length === items.length
          ? seasonLine
          : `${seasonLine} The others don't have a season on file yet, so check their park pages.`,
    });
  faq.push({
    q: "Is there a splash pad in Bend?",
    a: inBend.length
      ? `Yes: ${listWords(inBend.map((x) => x.name))}.`
      : "Not one we have on file. The closest ones are in nearby towns.",
  });
  if (restrooms.length)
    faq.push({
      q: "Which splash pad parks have restrooms?",
      a: `Families report restrooms at ${listWords(restrooms.map((x) => x.name))}.`,
    });

  return {
    def,
    h1: { accent: "Splash pads", trail: " near Bend" },
    ...(on
      ? {}
      : {
          instead: {
            href: guidePath("indoor-play-bend"),
            label: "Water play now: the indoor pools",
          },
        }),
    title: `Splash pads near Bend: ${items.length} parks and when they run`,
    description: items.length
      ? `${items.length} splash pads in and around Bend, Oregon: ${names(items, 3)}. When they run (${span}) and what else each park has.`
      : "Splash pads in and around Bend, Oregon.",
    intro,
    inSeason: on,
    seasonNote: on
      ? `Splash season. ${seasonLine} Check the park page before you pack towels.`
      : `Splash pads are off for the winter. ${seasonLine} Check the park page before you go.`,
    updated,
    sections: [{ kind: "parks", title: "Splash pads", id: "pads", items }],
    faq: faq.slice(0, 5),
    list: parkList(items),
    count: items.length,
    empty: items.length
      ? null
      : {
          line: "No splash pads on file yet.",
          href: "/playgrounds/splash-pads",
          label: "See splash pads in Central Oregon",
        },
  };
}

// --- All of them ---------------------------------------------------------------

export const BUILDERS: Record<GuideSlug, (input: GuideInput) => GuideView> = {
  "sledding-hills-bend": sleddingGuide,
  "holiday-events-central-oregon": holidayGuide,
  "indoor-play-bend": indoorGuide,
  "splash-pads-bend": splashGuide,
};

export function buildGuide(slug: string, input: GuideInput): GuideView | null {
  const def = guideDef(slug);
  return def ? BUILDERS[def.slug](input) : null;
}

/** In-season guides first, then the rest, in GUIDES order. */
export function guidesInOrder(views: GuideView[]): GuideView[] {
  return [...views].sort((a, b) => Number(b.inSeason) - Number(a.inSeason));
}

/** Absolute URL for an ItemList entry (site paths get the site). */
export const absolute = (url: string, site: string) =>
  url.startsWith("/") ? `${site}${url}` : url;

/** The structured data for a guide: CollectionPage + ItemList, FAQPage, breadcrumbs. */
export function guideJsonLd(v: GuideView, site: string): object[] {
  const url = `${site}${guidePath(v.def.slug)}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: v.title,
      description: v.intro,
      inLanguage: "en-US",
      ...(v.updated ? { dateModified: v.updated } : {}),
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: v.list.length,
        itemListElement: v.list.map((x, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: x.name,
          url: absolute(x.url, site),
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: v.faq.map((x) => ({
        "@type": "Question",
        name: x.q,
        acceptedAnswer: { "@type": "Answer", text: x.a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Park Roulette", item: site },
        {
          "@type": "ListItem",
          position: 2,
          name: "Guides",
          item: `${site}/guides`,
        },
        { "@type": "ListItem", position: 3, name: v.def.name, item: url },
      ],
    },
  ];
}

/**
 * Guides an event change touches (for IndexNow): holiday events, and any
 * indoor one (the indoor guide lists this week's).
 */
export function guidesForEvents(
  events: readonly { title: string; what: string; setting?: string }[],
): GuideSlug[] {
  const out = new Set<GuideSlug>();
  for (const e of events) {
    if (HOLIDAY.test(`${e.title} ${e.what}`))
      out.add("holiday-events-central-oregon");
    if (e.setting === "indoor") out.add("indoor-play-bend");
  }
  return [...out];
}
