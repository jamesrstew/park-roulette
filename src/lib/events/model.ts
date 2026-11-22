import { z } from "zod";
import { type Ages, ageTags } from "./ages";
import { CATALOG } from "@/lib/news/catalog";
import { addDays, weekdayOf } from "@/lib/news/time";

/**
 * Kids' events: what the writer hands in (EventInput), what we keep
 * (StoredEvent), and the pure rules every page shares (dates, groups,
 * slugs, the series key, costs, titles, JSON-LD, .ics). No server imports.
 */

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");
const Https = z.url({ protocol: /^https$/, error: "Use an https link" });
const Text = (max: number, min = 1) => z.string().trim().min(min).max(max);

/**
 * A quote is 12 characters or more, or as short as 8 when it prints a
 * date and a time ("Dec 6 · 10:30am"), or a price or "free" with a date
 * or time ("Free · Dec 6", "$5 · 10 am").
 */
/**
 * A family newsletter's issue in our own inbox (lib/inbox), cited as
 * evidence for a listing event: "issue:<id>". Never public: the checker
 * reads the stored issue, and no page ever links or shows it.
 */
export const ISSUE_REF = /^issue:([1-9]\d{0,9})$/;
const IssueRef = z.string().regex(ISSUE_REF, "Use issue:<id>");

/** The stored issue's id when a link is an issue reference, else null. */
export function issueId(u: string): number | null {
  const m = ISSUE_REF.exec(u);
  return m ? Number(m[1]) : null;
}

export const EventEvidence = z.strictObject({
  /** The page, or a stored newsletter issue ("issue:<id>", listing events). */
  url: z.union([Https, IssueRef]),
  quote: Text(400, 8),
});

export const EventInput = z.strictObject({
  title: Text(80),
  /**
   * A catalog event series: links the page to it. It never merges
   * different venues or programs (the key adds the venue and title stem).
   */
  series_id: z.string().max(80).optional(),
  /** Happens every year (a yearless page that rolls to the next edition). */
  annual: z.boolean().optional(),
  /**
   * false: a genuine one-off (keyed by its date, the page gets the year).
   * Otherwise hand-ins at the same venue with the same title stem share
   * one page, whatever their date count (weekly single-date hand-ins).
   */
  series: z.boolean().optional(),
  /** Each date; a multi-day event with daily hours is one date with end_day. */
  dates: z
    .array(
      z.strictObject({
        day: Day,
        start: Time.optional(),
        end: Time.optional(),
        end_day: Day.optional(),
      }),
    )
    .min(1)
    .max(30),
  venue: z.strictObject({
    name: Text(100),
    town: Text(40),
    street: Text(120).optional(),
    postal: z
      .string()
      .regex(/^97\d{3}$/)
      .optional(),
    /** The venue (or the trailhead's lot): Central Oregon only. */
    lat: z.number().min(43).max(45.2).optional(),
    lng: z.number().min(-122.5).max(-120).optional(),
    /** A park on our map, when the event is at one (its pin is used). */
    park: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
  }),
  setting: z.enum(["indoor", "outdoor"]).optional(),
  cost: z
    .strictObject({
      /** Every price the page prints, in its words ("$13 kids, $20 grown-ups, under 3 free"). */
      text: Text(160),
      prices: z
        .array(
          z.strictObject({
            label: Text(40),
            amount: z.number().min(0).max(500),
          }),
        )
        .max(6)
        .default([]),
      /** Free for everyone (printed "free"). */
      free: z.boolean().default(false),
    })
    .optional(),
  /** The age words exactly as printed ("Ages 5 and under"). Omit if none. */
  ages_text: Text(80).optional(),
  signup: z
    .strictObject({
      kind: z.enum(["none", "required", "sellout"]),
      /** "Grown-ups stay with kids under 8", when printed. */
      note: Text(120).optional(),
    })
    .optional(),
  parking: Text(120).optional(),
  /** Our own one or two sentences, from the primary page only. */
  what: Text(240, 20),
  /**
   * What kids do there, as one complete phrase of 70 characters or fewer,
   * in the summary's own words ("Kids sculpt air-dry clay into a little
   * creature"). Checked by lib/events/short.ts; a failing one is dropped
   * with a warning, never the event: anything here parses (a null, a number,
   * 500 characters), and lib/events/validate.ts keeps only a short that
   * passes. The Tuesday roundup prints it under the title.
   */
  short: z.unknown().optional(),
  /** The official page (organizer, venue, city, parks, library, USFS). */
  url: Https,
  organizer: z.strictObject({ name: Text(80), url: Https }).optional(),
  /**
   * 1 to 8 quotes; a series may carry up to 30 (one per occurrence page,
   * or one organizer JSON or .ics record per date).
   */
  evidence: z.array(EventEvidence).min(1).max(30),
  /**
   * Where the writer found it (a roundup, or a stored newsletter issue as
   * "issue:<id>"): never shown or linked.
   */
  discovery_url: z.union([Https, IssueRef]).optional(),
  /**
   * "listing": the organizer's site keeps our checker out (a bot wall, a
   * reset, a timeout), so the event stands on a local newsletter's own
   * listing of it (its evidence: the newsletter's page, or its issue in
   * our inbox as "issue:<id>"), with the organizer's link as `url`.
   * Never shown; the newsletter is never named or linked.
   */
  verified_via: z.enum(["listing"]).optional(),
  status: z
    .strictObject({
      kind: z.enum(["canceled", "postponed", "rescheduled"]),
      /** "Canceled", "postponed": quoted from the same page. */
      quote: Text(300, 6),
      /** Rescheduled: the old first date. */
      previous_day: Day.optional(),
    })
    .optional(),
});
export type EventInput = z.infer<typeof EventInput>;

export type EventDate = EventInput["dates"][number];

/** What a page shows: the input, plus what code worked out. */
export type StoredEvent = Omit<EventInput, "discovery_url" | "short"> & {
  /** The checked short line (lib/events/short.ts), when it passed. */
  short?: string;
  ages: Ages | null;
  /** The venue's point (from its park on our map, or the writer's pin). */
  point: { lat: number; lng: number } | null;
  /** The quote the nightly check looks for (the one with the date). */
  checkQuote: string;
  /** Per date: the page and quote that print it (the nightly check's target). */
  targets?: Record<string, { url: string; quote: string }>;
  /**
   * Per date, sticky: canceled, postponed or rescheduled stays until an
   * explicit status hand-in changes it.
   */
  statusByDay?: Record<string, EventStatus>;
};

export type EventStatus =
  "scheduled" | "canceled" | "postponed" | "rescheduled";

/** A stored row, as pages use it. */
export type EventRow = {
  id: number;
  slug: string;
  kind: "one_off" | "series" | "annual";
  data: StoredEvent;
  status: EventStatus;
  confirm: "ok" | "unconfirmed";
  lastSeenAt: Date | null;
  factsChangedAt: Date;
  stateChangedAt: Date | null;
};

// --- Time ------------------------------------------------------------------

/** Today's date in Pacific time (never UTC: evenings would be tomorrow). */
export function pacificToday(now: Date): string {
  return now
    .toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" })
    .slice(0, 10);
}

/** A date's status: sticky per date, else the event's own. */
export function statusOn(
  e: StoredEvent,
  day: string,
  fallback: EventStatus = "scheduled",
): EventStatus {
  return e.statusByDay?.[day] ?? fallback;
}

const TZ = "America/Los_Angeles";

/** One formatter for every Pacific wall-time read (building one is slow). */
const WALL = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Pacific wall time to an instant (DST-safe). */
export function pacificAt(day: string, time = "00:00"): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  for (const off of [7, 8]) {
    const t = new Date(guess + off * 3_600_000);
    if (WALL.format(t) === `${day} ${time}`) return t;
  }
  return new Date(guess + 8 * 3_600_000);
}

/** "-08:00" or "-07:00" on that day. */
export function pacificOffset(day: string, time = "12:00"): string {
  const t = pacificAt(day, time);
  const local = Date.parse(
    `${t.toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T")}Z`,
  );
  const h = Math.round((t.getTime() - local) / 3_600_000);
  return `-0${h}:00`;
}

/** One occurrence's id: its day, plus its start when there are showtimes ("2026-12-06-1400"). */
export function occurrenceId(d: { day: string; start?: string }): string {
  return d.start ? `${d.day}-${d.start.replace(":", "")}` : d.day;
}

/** When a date is over: its end time, or the end of its (last) day. */
export function dateEnds(d: EventDate): Date {
  const lastDay = d.end_day ?? d.day;
  if (d.end) return pacificAt(lastDay, d.end);
  return pacificAt(addDays(lastDay, 1), "00:00");
}

/** Soonest first: by day, then start time (untimed first). */
const byWhen = (a: EventDate, b: EventDate) =>
  a.day.localeCompare(b.day) || (a.start ?? "").localeCompare(b.start ?? "");

/** Dates not over yet, soonest first. */
export function upcomingDates(e: StoredEvent, now: Date): EventDate[] {
  return [...e.dates].filter((d) => dateEnds(d) > now).sort(byWhen);
}

/** Hours a date with a start but no printed end stays on the listing. */
export const UNTIMED_END_HOURS = 2;

/**
 * When a regular's date leaves the listing: like dateEnds, except a
 * one-day date with a start and no end is over 2 hours after it starts (a
 * 10 am story time isn't offered at 4 pm).
 */
export function listingEnds(d: EventDate): Date {
  if (d.start && !d.end && (!d.end_day || d.end_day === d.day))
    return new Date(
      pacificAt(d.day, d.start).getTime() + UNTIMED_END_HOURS * 3_600_000,
    );
  return dateEnds(d);
}

/** The latest moment any date ends (for "passed" and the sitemap). */
export function lastEnd(e: StoredEvent): Date {
  return new Date(Math.max(...e.dates.map((d) => dateEnds(d).getTime())));
}

/** "10 am", "4:30 pm", "noon". */
export function clock(t: string): string {
  const [h, m] = t.split(":").map(Number);
  if (h === 12 && m === 0) return "noon";
  const hh = h % 12 || 12;
  return `${hh}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

const DAYS3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS3 = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const LONG_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const LONG_MONTHS = [
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

/** "Sat, Nov 21" */
export function shortDate(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${DAYS3[weekdayOf(day)]}, ${MONTHS3[m - 1]} ${d}`;
}
/** "Nov 21" */
export function monthDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${MONTHS3[m - 1]} ${d}`;
}
/** "Saturday, November 21, 2026" */
export function longDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${LONG_DAYS[weekdayOf(day)]}, ${LONG_MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Sat, Nov 21 · 10 am to 2 pm", "Dec 1 to 6", "Start time 8:30 am". */
export function whenLine(d: EventDate): string {
  if (d.end_day && d.end_day !== d.day) {
    const span = `${monthDay(d.day)} to ${monthDay(d.end_day)}`;
    return d.start && d.end
      ? `${span} · ${clock(d.start)} to ${clock(d.end)} daily`
      : span;
  }
  const head = shortDate(d.day);
  if (d.start && d.end) return `${head} · ${clock(d.start)} to ${clock(d.end)}`;
  if (d.start) return `${head} · Start time ${clock(d.start)}`;
  return head;
}

/** "Saturdays, 10:30 am" when every upcoming date shares a weekday and time. */
export function weeklyPattern(dates: EventDate[]): string | null {
  if (dates.length < 3) return null;
  const wd = new Set(dates.map((d) => weekdayOf(d.day)));
  const times = new Set(dates.map((d) => d.start ?? ""));
  if (wd.size !== 1 || times.size !== 1) return null;
  const day = `${LONG_DAYS[[...wd][0]]}s`;
  const t = [...times][0];
  return t ? `${day}, ${clock(t)}` : day;
}

// --- Groups on /events -------------------------------------------------------

export type GroupKey = "week" | "weekend" | "next" | "later";

/** Monday-based week math, in Pacific dates. */
function fridayOf(today: string): string {
  const wd = weekdayOf(today); // 0 Sun .. 6 Sat
  if (wd === 0) return addDays(today, -2);
  if (wd === 6) return addDays(today, -1);
  return addDays(today, 5 - wd);
}

/**
 * This week (the days left before Friday, dropped from Friday on), This
 * weekend (Friday to Sunday, like the newsletter), Next week, Later (up to
 * 60 days out).
 */
export function groupBounds(today: string) {
  const fri = fridayOf(today);
  const sun = addDays(fri, 2);
  return {
    week: { from: today, to: addDays(fri, -1) },
    weekend: { from: today > fri ? today : fri, to: sun },
    next: { from: addDays(sun, 1), to: addDays(sun, 7) },
    later: { from: addDays(sun, 8), to: addDays(today, 60) },
  } satisfies Record<GroupKey, { from: string; to: string }>;
}

/** The group an event's first upcoming date falls in, or null past 60 days. */
export function groupOf(day: string, today: string): GroupKey | null {
  const b = groupBounds(today);
  const effective = day < today ? today : day; // a multi-day event already on
  for (const k of ["week", "weekend", "next", "later"] as const)
    if (effective >= b[k].from && effective <= b[k].to) return k;
  return null;
}

export const GROUP_NAMES: Record<GroupKey, string> = {
  week: "This week",
  weekend: "This weekend",
  next: "Next week",
  later: "Later",
};

// --- Slugs and series --------------------------------------------------------

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/, "");
}

/** "Story Time: Dinosaurs" -> "story time" (the part before a colon or dash). */
export function titleStem(title: string): string {
  return slugify(title.split(/[:(|]| - | – /)[0]);
}

/** The venue's name and town as a slug ("downtown-bend-library-bend"). */
export function venueSlug(v: { name: string; town: string }): string {
  return slugify(`${v.name} ${v.town}`);
}

/** A venue name's words, order-free ("Bend Downtown Library" = "Downtown Bend Library"). */
function nameWords(name: string): string {
  return [
    ...new Set(
      slugify(name.replace(/\([^)]*\)/g, " "))
        .split("-")
        .filter((w) => w && w !== "the"),
    ),
  ]
    .sort()
    .join("-");
}

type VenueIndex = Map<string, string>;
let venueIndex: VenueIndex | null = null;

/** Catalog venues and their aliases, by town + order-free name. */
function venues(): VenueIndex {
  if (venueIndex) return venueIndex;
  const m: VenueIndex = new Map();
  for (const v of CATALOG.venues)
    m.set(`${slugify(v.town)}|${nameWords(v.name)}`, v.id);
  for (const a of CATALOG.venue_aliases)
    for (const n of a.names) m.set(`${slugify(a.town)}|${nameWords(n)}`, a.id);
  return (venueIndex = m);
}

/**
 * The venue's identity in keys: its catalog venue id (or alias), else its
 * order-free name and town. "Downtown Bend Library" and "Bend Downtown
 * Library" are one venue; so are "The Pavilion" and "The Pavilion - Bend
 * Park and Recreation District".
 */
export function venueKey(v: { name: string; town: string }): string {
  const town = slugify(v.town);
  return (
    venues().get(`${town}|${nameWords(v.name)}`) ??
    `${nameWords(v.name)}@${town}`
  );
}

/** Audience qualifiers that make a different program ("Baby Storytime"). */
const QUALIFIERS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/\b(babies|baby|infants?|lap ?sit)\b/, () => "baby"],
  [/\btoddlers?\b/, () => "toddler"],
  [/\b(preschool(ers?)?|pre-?k)\b/, () => "preschool"],
  [/\btweens?\b/, () => "tween"],
  [/\bteens?\b/, () => "teen"],
  [/\b(spanish|espanol|español)\b/, () => "spanish"],
  [/\bbilingual\b/, () => "bilingual"],
  [/\bsensory\b/, () => "sensory"],
  [/\bschool[- ]age\b/, () => "school-age"],
  [
    /\bages?\s*(\d{1,2})\s*(?:-|to|–|through)\s*(\d{1,2})\b/,
    (m) => `ages-${m[1]}-${m[2]}`,
  ],
  [/\bages?\s*(\d{1,2})\s*(?:\+|and up|and older)/, (m) => `ages-${m[1]}-up`],
  [
    /\bgrades?\s*(k|\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\b/,
    (m) => `grades-${m[1]}-${m[2]}`,
  ],
];

/** One word, lightly normalized ("times" -> "time", "stories" -> "story"). */
function stemWord(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    return w.slice(0, -1);
  return w;
}

/**
 * The program in keys: the title's stem (before a colon or dash), with
 * spelling normalized ("Storytime" = "Story Time") and every audience
 * qualifier from the whole title kept, in a fixed order: "Story Time:
 * Babies" and "Baby Storytime" are one program, "Toddler Story Time"
 * another.
 */
/** The audience qualifiers anywhere in a title, in a fixed order. */
export function qualifiers(title: string): string[] {
  const t = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const quals: string[] = [];
  for (const [re, f] of QUALIFIERS) {
    const m = t.match(re);
    if (m) quals.push(f(m));
  }
  return quals;
}

/**
 * The program's part of a page address: the title's stem as written,
 * plus any audience qualifier it doesn't already say ("Story Time:
 * Babies" -> "story-time-baby"; "Pop-Up Exhibits" stays as it is).
 */
export function slugStem(title: string): string {
  const base = titleStem(title);
  const have = new Set(base.split("-").map(stemWord));
  const extra = qualifiers(title).filter(
    (q) => !q.split("-").every((w) => have.has(w)),
  );
  return [base, ...extra].filter(Boolean).join("-");
}

export function keyStem(title: string): string {
  const quals = qualifiers(title);
  const words = slugify(title.split(/[:(|]| - | – /)[0])
    .replace(/\bstory-?times?\b|\bstorytimes?\b/g, "story-time")
    .split("-")
    .filter(Boolean)
    .map(stemWord);
  const qualWords = new Set(quals.flatMap((q) => q.split("-")));
  const base = words.filter(
    (w) =>
      !qualWords.has(w) &&
      !/^(babie|babies|infant|toddler|preschooler|teen|tween)$/.test(w),
  );
  return [...base, ...quals].join("-") || slugify(title);
}

/**
 * Code's series key: the venue (canonical) + the program (keyStem), so
 * weekly story times with their own URLs and themed titles share a page.
 * A catalog series_id only links the page to the catalog; it's never part
 * of the key, so the same series_id at two library branches, or on two
 * programs at one branch, makes two pages (on November 20, keying on the
 * id alone merged ten programs into one page), and a hand-in with or
 * without the id lands on the same page. A one-off is keyed by its stem
 * and first date.
 */
export function seriesKey(e: EventInput): string {
  const venue = venueKey(e.venue);
  const stem = keyStem(e.title);
  if (e.annual) return `annual:${venue}:${stem}`;
  if (e.series === false && !e.series_id)
    return `one:${venue}:${stem}:${e.dates[0].day}`;
  // Weekly hand-ins of one date each still land on one page.
  return `venue:${venue}:${stem}`;
}

/** Rows stored before the fix were keyed "series:<id>" alone. */
export const LEGACY_SERIES_KEY = /^series:[^:]+$/;

export function kindOf(e: EventInput): EventRow["kind"] {
  if (e.annual) return "annual";
  if (e.series === false) return "one_off";
  return e.series_id || e.series || e.dates.length > 1 ? "series" : "one_off";
}

/**
 * The page's address: annual events and series are yearless (an annual
 * page rolls to the next edition); a genuine one-off gets its year.
 */
export function eventSlug(e: EventInput): string {
  const base = slugify(`${slugStem(e.title) || e.title} ${e.venue.name}`);
  return kindOf(e) === "one_off"
    ? `${base}-${e.dates[0].day.slice(0, 4)}`
    : base;
}

// --- Cost, chips -------------------------------------------------------------

/** Free for everyone: printed free and no price. */
export function isFree(e: StoredEvent): boolean {
  return !!e.cost?.free && !(e.cost.prices ?? []).some((p) => p.amount > 0);
}

const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

/** Add-ons, not the price of going: fees, parking, deposits, donations, tax. */
const EXTRA =
  /\b(fees?|parking|deposits?|donations?|suggested donation|tax(es)?|service|processing|booking|surcharge|tips?|add-?ons?)\b/i;
/** A grown-up's price, even when a child comes along ("adult with child"). */
const ADULTISH =
  /\b(adults?|grown-?ups?|parents?|caregivers?|chaperones?|seniors?|members? 18)\b/i;
const KIDISH =
  /\b(kids?|child(ren)?|youth|students?|toddlers?|bab(y|ies)|ages? \d|under \d)\b/i;
const FAMILY = /\b(famil(y|ies)|households?)\b/i;
const FROM = /\b(from|starting|starts at|as low as|and up)\b/i;
/** The page says kids are free though it lists only a grown-up's price. */
const KIDS_FREE_TEXT =
  /\b(kids?|children|youth)( \w+){0,2} (are |get in |go )?free\b|\bfree for (kids|children)\b/i;

/**
 * The short chip, never understating what a family pays: "Free", "$13
 * kids", "Kids free", "$5 to $20" (the printed range), "From $5" (a lone
 * starting price), "$10 family", "$10 adults" (when that's all that's
 * printed). Kids' prices come from every price whose label is a kid's and
 * not a grown-up's; fees, parking, deposits, donations and tax are left
 * out. Null: no price the chip can show.
 */
export function costChip(e: StoredEvent): string | null {
  if (!e.cost) return null;
  if (isFree(e)) return "Free";
  const prices = (e.cost.prices ?? []).filter((p) => !EXTRA.test(p.label));
  if (!prices.length) return null;
  const range = (set: number[]) => {
    const lo = Math.min(...set);
    const hi = Math.max(...set);
    if (lo === hi) return lo === 0 ? "Free" : dollars(lo);
    return lo === 0
      ? `Free to ${dollars(hi)}`
      : `${dollars(lo)} to ${dollars(hi)}`;
  };
  const kids = prices.filter(
    (p) => KIDISH.test(p.label) && !ADULTISH.test(p.label),
  );
  if (kids.length) {
    if (kids.every((p) => p.amount === 0)) return "Kids free";
    return `${range(kids.map((p) => p.amount))} kids`;
  }
  const paid = prices.filter((p) => p.amount > 0);
  if (!paid.length) return e.cost.free ? "Free" : null;
  const set = paid.map((p) => p.amount);
  const one = new Set(set).size === 1;
  if (paid.every((p) => ADULTISH.test(p.label)))
    return KIDS_FREE_TEXT.test(e.cost.text)
      ? "Kids free"
      : `${range(set)} adults`;
  if (paid.every((p) => FAMILY.test(p.label))) return `${range(set)} family`;
  if (one && (paid.some((p) => FROM.test(p.label)) || FROM.test(e.cost.text)))
    return `From ${dollars(set[0])}`;
  return range(set);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// --- Titles and descriptions -------------------------------------------------

/**
 * "{Title}, {Nov 21} in {Town} | Park Roulette", at most 65 characters:
 * drop the suffix first, then shorten the event name, never the date or
 * the town. A series uses its pattern ("Saturdays in Bend") or "next Nov 21".
 */
export function eventTitle(
  e: StoredEvent,
  kind: EventRow["kind"],
  next: EventDate | null,
): string {
  const pattern = next ? weeklyPattern(e.dates) : null;
  const when =
    kind !== "one_off" && pattern
      ? `${pattern.split(",")[0]} in ${e.venue.town}`
      : next
        ? `${kind === "one_off" ? "" : "next "}${monthDay(next.day)} in ${e.venue.town}`
        : `in ${e.venue.town}`;
  const full = `${e.title}, ${when} | Park Roulette`;
  if (full.length <= 65) return full;
  const bare = `${e.title}, ${when}`;
  if (bare.length <= 65) return bare;
  const room = 65 - `…, ${when}`.length;
  return `${e.title.slice(0, Math.max(8, room)).trimEnd()}…, ${when}`;
}

/** "{What kids do} {Ages}, {cost}. Playgrounds nearby: {park}." plus Free and indoor. */
export function eventDescription(e: StoredEvent, park: string | null): string {
  const bits = [e.what.trim()];
  const facts = [
    e.ages?.tags.length ? e.ages.tags.join(", ") : null,
    isFree(e) ? "Free" : costChip(e),
    e.setting === "indoor" ? "indoor" : null,
  ].filter(Boolean);
  if (facts.length) bits.push(`${facts.join(", ")}.`);
  if (park) bits.push(`Playgrounds nearby: ${park}.`);
  return bits.join(" ").slice(0, 300);
}

// --- Structured data ---------------------------------------------------------

const STATUS_LD: Record<EventStatus, string> = {
  scheduled: "https://schema.org/EventScheduled",
  canceled: "https://schema.org/EventCancelled",
  postponed: "https://schema.org/EventPostponed",
  rescheduled: "https://schema.org/EventRescheduled",
};

/** ISO with the Pacific offset, or the date alone when no time is printed. */
export function ldTime(day: string, time?: string): string {
  return time ? `${day}T${time}:00${pacificOffset(day, time)}` : day;
}

/**
 * Event JSON-LD, one per upcoming date (at most 8, 60 days). Only for an
 * upcoming, confirmed event; never on a passed or couldn't-confirm page.
 */
export function eventJsonLd(
  row: Pick<EventRow, "data" | "status" | "confirm" | "slug">,
  now: Date,
  site: string,
): object[] {
  const e = row.data;
  if (row.confirm !== "ok") return [];
  const today = pacificToday(now);
  const dates = upcomingDates(e, now)
    .filter((d) => d.day <= addDays(today, 60))
    .slice(0, 8);
  const url = `${site}/events/${row.slug}`;
  const prices = (e.cost?.prices ?? []).map((p) => ({
    "@type": "Offer",
    name: p.label,
    price: p.amount,
    priceCurrency: "USD",
    url: e.url,
  }));
  const offers = isFree(e)
    ? [{ "@type": "Offer", price: 0, priceCurrency: "USD", url: e.url }]
    : prices.length
      ? prices
      : undefined;
  const address = {
    "@type": "PostalAddress",
    ...(e.venue.street ? { streetAddress: e.venue.street } : {}),
    addressLocality: e.venue.town,
    addressRegion: "OR",
    ...(e.venue.postal ? { postalCode: e.venue.postal } : {}),
    addressCountry: "US",
  };
  const range = e.ages?.kids && e.ages.range && e.ages.tags[0] !== "All ages";
  return dates.map((d) => {
    // Date-only start and end together: never a time on one and not the other.
    const timed = !!d.start && (!d.end_day || !!d.end);
    const status = statusOn(e, d.day, row.status);
    return {
      "@context": "https://schema.org",
      "@type": "Event",
      name: e.title,
      startDate: ldTime(d.day, timed ? d.start : undefined),
      ...(d.end_day || (timed && d.end)
        ? { endDate: ldTime(d.end_day ?? d.day, timed ? d.end : undefined) }
        : {}),
      eventStatus: STATUS_LD[status],
      ...(status === "rescheduled" && e.status?.previous_day
        ? { previousStartDate: e.status.previous_day }
        : {}),
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Place",
        name: e.venue.name,
        address,
        ...(e.point
          ? {
              geo: {
                "@type": "GeoCoordinates",
                latitude: e.point.lat,
                longitude: e.point.lng,
              },
            }
          : {}),
      },
      description: e.what,
      image: ["1x1", "4x3", "16x9"].map(
        (r) => `${site}/events/${row.slug}/image/${r}`,
      ),
      "@id": `${url}#${occurrenceId(d)}`,
      ...(offers ? { offers } : {}),
      ...(e.organizer
        ? {
            organizer: {
              "@type": "Organization",
              name: e.organizer.name,
              url: e.organizer.url,
            },
          }
        : {}),
      ...(isFree(e) ? { isAccessibleForFree: true } : {}),
      ...(range
        ? {
            typicalAgeRange:
              e.ages!.range![1] >= 99
                ? `${e.ages!.range![0]}-`
                : `${e.ages!.range![0]}-${e.ages!.range![1]}`,
          }
        : {}),
      url: `${url}#${occurrenceId(d)}`,
    };
  });
}

// --- Calendar file -------------------------------------------------------------

/** Text for an .ics value: no CR or LF, and its specials escaped. */
const icsEscape = (s: string) =>
  s
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

/** Fold a content line at 75 octets (RFC 5545 3.1). */
export function icsFold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a UTF-8 character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines start with a space
  }
  return parts.join("\r\n ");
}

function icsStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * One date as an .ics file. A timed date is a timed event (an hour long
 * when no end is printed); a multi-day date or one with no time is an
 * all-day span. A canceled date says STATUS:CANCELLED.
 */
export function icsFile(
  e: StoredEvent,
  d: EventDate,
  url: string,
  now: Date,
  status: EventStatus = "scheduled",
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Park Roulette//Kids events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${url.replace(/^https?:\/\//, "")}#${occurrenceId(d)}`,
    `DTSTAMP:${icsStamp(now)}`,
  ];
  const multiDay = !!d.end_day && d.end_day !== d.day;
  if (d.start && !multiDay) {
    lines.push(`DTSTART:${icsStamp(pacificAt(d.day, d.start))}`);
    const end = d.end
      ? pacificAt(d.day, d.end)
      : new Date(pacificAt(d.day, d.start).getTime() + 3_600_000);
    lines.push(`DTEND:${icsStamp(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${d.day.replace(/-/g, "")}`);
    lines.push(
      `DTEND;VALUE=DATE:${addDays(d.end_day ?? d.day, 1).replace(/-/g, "")}`,
    );
  }
  const where = [e.venue.name, e.venue.street, e.venue.town, "OR"]
    .filter(Boolean)
    .join(", ");
  const hours =
    multiDay && d.start && d.end
      ? ` Daily ${clock(d.start)} to ${clock(d.end)}.`
      : "";
  lines.push(
    `SUMMARY:${icsEscape(e.title)}`,
    `LOCATION:${icsEscape(where)}`,
    `DESCRIPTION:${icsEscape(`${e.what}${hours} Plans change. Check the official page before you go: ${e.url}`)}`,
    `URL:${url}`,
    ...(status === "canceled" ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

/** Re-derive what code owns from the input (ages, point, check quote). */
export function storedFrom(
  input: EventInput,
  point: { lat: number; lng: number } | null,
  checkQuote: string,
): StoredEvent {
  const { discovery_url: _drop, short, ...rest } = input;
  void _drop;
  return {
    ...rest,
    // Only text gets here as a short (the validator checked it); anything
    // else is left out.
    ...(typeof short === "string" ? { short } : {}),
    ages: ageTags(input.ages_text),
    point,
    checkQuote,
  };
}
