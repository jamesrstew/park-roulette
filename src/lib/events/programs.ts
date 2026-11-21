import { addDays, weekdayOf } from "@/lib/news/time";
import {
  clock,
  domainOf,
  type EventDate,
  type EventRow,
  groupBounds,
  keyStem,
  listingEnds,
  pacificToday,
  shortDate,
  slugify,
  upcomingDates,
  venueKey,
} from "./model";
import { listed, nextStatus } from "./state";

/**
 * Programs: the listing's unit. A program is a "special" (one-offs, annual
 * events, runs like a Nutcracker weekend or a month of holiday lights) or
 * a "regular" (repeats on a schedule: story times, clubs, weekly classes).
 * Regulars merge across branches (same name stem, same organizer site), so
 * five library branches' story times are one row; specials merge only
 * when the title and venue match, so "Family Movie: Elf" and "Family
 * Movie: Frozen" stay two. The kind is decided on the whole program before
 * any filter (narrowPrograms), so a filter never moves a program between
 * sections. Pure: no database. Spec: /tmp/pr-news/batch7/events-page-spec.md.
 */

/** One venue of a program: its rows there (a series and a one-off merge). */
export type Branch = {
  /** The row its link goes to (a series over a one-off, else the soonest). */
  row: EventRow;
  /** The row whose date is next (a special's link, chips and status). */
  nextRow: EventRow;
  /** Every row at this venue, soonest first. */
  rows: EventRow[];
  /** Each row with its own listing dates (for narrowing). */
  parts: Live[];
  /** Its first date still on the listing. */
  next: EventDate;
  /** Every date still on the listing, soonest first. */
  upcoming: EventDate[];
};

/** A row with the dates the listing uses (worked out once per row). */
export type Live = { row: EventRow; upcoming: EventDate[] };

export type ProgramKind = "special" | "regular";

export type Program = {
  key: string;
  kind: ProgramKind;
  /** The shared title, or the shared stem when branches' titles differ. */
  title: string;
  /** Soonest first. */
  branches: Branch[];
  /** The soonest branch. */
  lead: Branch;
  /** The lead's next day, or today when it's already running. */
  day: string;
  annual: boolean;
};

const isLibrary = (r: EventRow) => /\blibrary\b/i.test(r.data.venue.name);

/** Rows that may be one regular: the organizer's site plus the name stem. */
function stemKey(r: EventRow): string {
  return `${domainOf(r.data.url)}|${keyStem(r.data.title)}`;
}

/**
 * A special's own key: the site and the full title, so "Family Movie:
 * Elf" and "Frozen" stay two. One program at several library branches is
 * one card ("3 libraries"); anywhere else the venue joins the key, so two
 * theaters' Nutcrackers stay apart.
 */
function specialKey(r: EventRow): string {
  const base = `${domainOf(r.data.url)}|${slugify(r.data.title)}`;
  return isLibrary(r) ? base : `${base}|${venueKey(r.data.venue)}`;
}

/** Words that make a run a season's special, not a class. */
export const SEASONAL =
  /\b(holiday|christmas|xmas|santa|lights?|light show|winter ?fest(ival)?|halloween|trick[- ]or[- ]treat|thanksgiving|hanukkah|chanukah|kwanzaa|new year'?s?|nutcracker|train man|polar express|easter|egg hunt|pumpkin|harvest fest(ival)?|solstice|tree lighting|carols?|reindeer|gingerbread)\b/i;

/** Monday of the day's week (weeks run Monday to Sunday). */
function mondayOf(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

function gapsOf(days: string[]): number[] {
  const g: number[] = [];
  for (let i = 1; i < days.length; i++)
    g.push(
      Math.round(
        (Date.parse(`${days[i]}T12:00:00Z`) -
          Date.parse(`${days[i - 1]}T12:00:00Z`)) /
          86_400_000,
      ),
    );
  return g;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/**
 * Special or regular, from every stored date of the program's rows (past
 * ones too, so a weekly program near the end of what we know stays put):
 * 1. Any annual row, or only one-offs: special.
 * 2. A short run (everything within 14 days, mostly back-to-back days, or
 *    one day): special.
 * 3. A seasonal run (within 45 days, and its title or description names a
 *    holiday or season: a month of holiday lights, a Polar Express train
 *    on four weekends): special.
 * 4. At a library with more than one date: regular.
 * 5. Dates in 3 or more different weeks: regular (Mon–Fri clubs, swim
 *    lessons, weekend classes, daily open swim).
 * 6. Otherwise: special.
 */
export function programKind(rows: readonly EventRow[]): ProgramKind {
  if (rows.some((r) => r.kind === "annual")) return "special";
  if (rows.every((r) => r.kind === "one_off")) return "special";
  const days = [
    ...new Set(rows.flatMap((r) => r.data.dates.map((d) => d.day))),
  ].sort();
  const span = gapsOf([days[0], days[days.length - 1]])[0] ?? 0;
  if (span <= 14 && (days.length === 1 || median(gapsOf(days)) <= 2))
    return "special";
  const library = rows.some(isLibrary);
  if (
    !library &&
    span <= 45 &&
    rows.some((r) => SEASONAL.test(`${r.data.title} ${r.data.what}`))
  )
    return "special";
  if (library) return "regular";
  if (new Set(days.map(mondayOf)).size >= 3) return "regular";
  return "special";
}

const sortKey = (d: EventDate) => `${d.day}|${d.start ?? "99:99"}`;

/** Rows at one venue as a branch (null when none is left). */
function branchOf(lives: readonly Live[]): Branch | null {
  if (!lives.length) return null;
  const rows = [...lives].sort((a, b) =>
    sortKey(a.upcoming[0]).localeCompare(sortKey(b.upcoming[0])),
  );
  const upcoming = rows
    .flatMap((x) => x.upcoming)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const row = (rows.find((x) => x.row.kind === "series") ?? rows[0]).row;
  return {
    row,
    nextRow: rows[0].row,
    rows: rows.map((x) => x.row),
    parts: rows,
    upcoming,
    next: upcoming[0],
  };
}

/** Rows to branches, one per venue, soonest first. */
function branchesOf(lives: readonly Live[]): Branch[] {
  const byVenue = new Map<string, Live[]>();
  for (const l of lives) {
    const k = venueKey(l.row.data.venue);
    byVenue.set(k, [...(byVenue.get(k) ?? []), l]);
  }
  return [...byVenue.values()]
    .map(branchOf)
    .filter((b): b is Branch => !!b)
    .sort((a, b) => sortKey(a.next).localeCompare(sortKey(b.next)));
}

/** "Story Time" for "Story Time: Dinosaurs" + "Story Time: Bugs". */
function titleOf(rows: readonly EventRow[]): string {
  const titles = [...new Set(rows.map((r) => r.data.title))];
  if (titles.length === 1) return titles[0];
  return titles[0].split(/[:(|]| - | – /)[0].trim() || titles[0];
}

function programOf(
  key: string,
  kind: ProgramKind,
  annual: boolean,
  branches: Branch[],
  today: string,
): Program | null {
  if (!branches.length) return null;
  const lead = branches[0];
  return {
    key,
    kind,
    title: titleOf(branches.flatMap((b) => b.rows)),
    branches,
    lead,
    day: lead.next.day < today ? today : lead.next.day,
    annual,
  };
}

const byDay = (a: Program, b: Program) =>
  a.day.localeCompare(b.day) ||
  sortKey(a.lead.next).localeCompare(sortKey(b.lead.next)) ||
  a.title.localeCompare(b.title);

/**
 * The listing's programs, unfiltered: listed rows (each row's dates worked
 * out once), the next date's status, merged and classified. A regular's
 * series rows merge by stem across branches; its one-off and annual rows
 * ("Family Story Time: Pajama Party") come out as specials. A regular's
 * date with a start and no end leaves 2 hours after it starts; a special
 * stays until its printed end or the end of its day. Soonest first.
 */
export function buildPrograms(rows: readonly EventRow[], now: Date): Program[] {
  const today = pacificToday(now);
  const byStem = new Map<string, Live[]>();
  for (const r of rows) {
    // A one-day date from before today is over, whatever its clock says.
    const upcoming = upcomingDates(r.data, now).filter(
      (d) => d.day >= today || (d.end_day ?? d.day) >= today,
    );
    if (!listed(r, now, upcoming)) continue;
    const row = { ...r, status: nextStatus(r, now, upcoming) };
    const k = stemKey(row);
    byStem.set(k, [...(byStem.get(k) ?? []), { row, upcoming }]);
  }
  const out: Program[] = [];
  const specials: Live[] = [];
  for (const [key, lives] of byStem) {
    const series = lives.filter((l) => l.row.kind === "series");
    if (!series.length || programKind(series.map((l) => l.row)) !== "regular") {
      specials.push(...lives);
      continue;
    }
    specials.push(...lives.filter((l) => l.row.kind !== "series"));
    const trimmed = series
      .map((l) => {
        const upcoming = l.upcoming.filter((d) => listingEnds(d) > now);
        return {
          row: { ...l.row, status: nextStatus(l.row, now, upcoming) },
          upcoming,
        };
      })
      .filter((l) => l.upcoming.length);
    const p = programOf(key, "regular", false, branchesOf(trimmed), today);
    if (p) out.push(p);
  }
  const bySpecial = new Map<string, Live[]>();
  for (const l of specials) {
    const k = specialKey(l.row);
    bySpecial.set(k, [...(bySpecial.get(k) ?? []), l]);
  }
  for (const [k, group] of bySpecial) {
    const p = programOf(
      k,
      "special",
      group.some((l) => l.row.kind === "annual"),
      branchesOf(group),
      today,
    );
    if (p) out.push(p);
  }
  return out.sort(byDay);
}

/**
 * Programs narrowed by a row filter (a town keeps only that town's
 * branches). The kind stays as decided unfiltered.
 */
export function narrowPrograms(
  programs: readonly Program[],
  keep: (r: EventRow) => boolean,
  today: string,
): Program[] {
  return programs
    .map((p) => {
      const branches = p.branches
        .map((b) => {
          const parts = b.parts.filter((x) => keep(x.row));
          return parts.length === b.parts.length ? b : branchOf(parts);
        })
        .filter((b): b is Branch => !!b && !!b.next)
        .sort((a, b) => sortKey(a.next).localeCompare(sortKey(b.next)));
      return programOf(p.key, p.kind, p.annual, branches, today);
    })
    .filter((p): p is Program => !!p)
    .sort(byDay);
}

// --- Groups ------------------------------------------------------------------

export type SpecialGroup = "today" | "weekend" | "later";

/**
 * Today; This weekend (the rest of Friday to Sunday, after today); Coming
 * up (everything else, to 60 days out). On Sunday there's no "This
 * weekend"; on a weekday, the days before Friday lead Coming up.
 */
export function specialGroupOf(day: string, today: string): SpecialGroup {
  if (day <= today) return "today";
  const b = groupBounds(today);
  if (day >= b.weekend.from && day <= b.weekend.to) return "weekend";
  return "later";
}

export const SPECIAL_GROUP_NAMES: Record<SpecialGroup, string> = {
  today: "Today",
  weekend: "This weekend",
  later: "Coming up",
};

/** The days a group covers, or null when it has none (This weekend on Sunday). */
export function groupSpan(
  g: SpecialGroup,
  today: string,
): { from: string; to: string } | null {
  const b = groupBounds(today);
  if (g === "today") return { from: today, to: today };
  if (g === "weekend") {
    const after = addDays(today, 1);
    const from = after > b.weekend.from ? after : b.weekend.from;
    return from <= b.weekend.to ? { from, to: b.weekend.to } : null;
  }
  return { from: addDays(today, 1), to: addDays(today, 60) };
}

/**
 * Big specials first within a day group: annual events, then other
 * organizers, then library programs; then by day and start.
 */
export function bigFirst(a: Program, b: Program): number {
  return (
    bigness(a) - bigness(b) ||
    a.day.localeCompare(b.day) ||
    sortKey(a.lead.next).localeCompare(sortKey(b.lead.next))
  );
}

/** 0 annual, 1 another organizer, 2 a library program. */
export function bigness(p: Program): number {
  return p.annual ? 0 : p.branches.every((x) => isLibrary(x.row)) ? 2 : 1;
}

/** Does any branch have a date on this day (or one running through it)? */
export function onDay(p: Program, day: string): boolean {
  return p.branches.some((b) =>
    b.upcoming.some((d) => d.day <= day && (d.end_day ?? d.day) >= day),
  );
}

// --- Labels ------------------------------------------------------------------

/** "Central Library, Bend", "5 libraries", "3 places". */
export function placesLabel(branches: readonly Branch[]): string {
  const venues = new Map<string, EventRow>();
  for (const b of branches) venues.set(venueKey(b.row.data.venue), b.row);
  if (venues.size === 1) return venueLine(branches[0].row);
  const rows = [...venues.values()];
  return `${venues.size} ${rows.every(isLibrary) ? "libraries" : "places"}`;
}

/** "Central Library, Bend" (no repeated town). */
export function venueLine(r: EventRow): string {
  const v = r.data.venue;
  return v.name.includes(v.town) ? v.name : `${v.name}, ${v.town}`;
}

const DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Monday-first order. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function bucket(start: string | undefined): string | null {
  if (!start) return null;
  const h = Number(start.slice(0, 2));
  return h < 12 ? "mornings" : h < 17 ? "afternoons" : "evenings";
}

/** "Mon–Thu, Sat"; runs of 3+ days as a range. */
function dayList(wds: number[]): string {
  const idx = ORDER.map((d, i) => (wds.includes(d) ? i : -1)).filter(
    (i) => i >= 0,
  );
  const runs: number[][] = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  }
  return runs
    .flatMap((r) =>
      r.length >= 3
        ? [`${DAY3[ORDER[r[0]]]}–${DAY3[ORDER[r[r.length - 1]]]}`]
        : r.map((i) => DAY3[ORDER[i]]),
    )
    .join(", ");
}

/**
 * When a regular happens, in a parent's words: "Saturdays, 10:30 am",
 * "Tue–Thu mornings", "Every other Tuesday, 1 pm", "One Monday a month,
 * 3 pm". Read from the next four weeks of dates (all of them when that's
 * too few); the cadence from every upcoming date.
 */
export function patternLine(
  dates: readonly EventDate[],
  today: string,
  /** Per branch: a branch with few dates still adds its days. */
  branches: readonly (readonly EventDate[])[] = [],
): string {
  const all = [...dates].sort((a, b) => a.day.localeCompare(b.day));
  // One date left is a date, not a pattern.
  if (new Set(all.map((d) => d.day)).size < 2) return "";
  const soon = all.filter((d) => d.day <= addDays(today, 27));
  const look = soon.length >= 2 ? soon : all.slice(0, 8);
  // Weekdays that recur (a holiday week's odd day doesn't count).
  const count = new Map<number, number>();
  for (const d of all)
    count.set(weekdayOf(d.day), (count.get(weekdayOf(d.day)) ?? 0) + 1);
  const recurring = [
    ...new Set([
      ...[...count.keys()].filter((wd) => count.get(wd)! >= 2),
      ...branches
        .filter((b) => b.length > 0 && b.length < 4)
        .flatMap((b) => b.map((d) => weekdayOf(d.day))),
    ]),
  ];
  const wds =
    all.length >= 4 && recurring.length
      ? recurring
      : [...new Set(look.map((d) => weekdayOf(d.day)))];
  const onDays = look.filter((d) => wds.includes(weekdayOf(d.day)));
  const starts = [...new Set(onDays.map((d) => d.start ?? ""))];
  const buckets = onDays.map((d) => bucket(d.start));
  const top = mostCommon(buckets);
  const steady =
    top && buckets.filter((b) => b === top).length / buckets.length >= 0.8;
  const days = [...new Set(all.map((d) => d.day))];
  const gap = days.length >= 2 ? median(gapsOf(days)) : 7;
  if (wds.length === 1) {
    const wd = wds[0];
    // One time, or two a day ("9:30 and 10:30 am").
    const timed = starts.filter(Boolean).sort();
    const time =
      starts.length === 1 && timed.length === 1
        ? `, ${clock(timed[0])}`
        : starts.length === 2 && timed.length === 2
          ? `, ${twoTimes(timed[0], timed[1])}`
          : "";
    const tod = !time && steady ? ` ${top}` : "";
    if (gap >= 21) return `One ${DAYS[wd]} a month${time}`;
    if (gap >= 12) return `Every other ${DAYS[wd]}${time}`;
    return tod ? `${DAYS[wd]} ${tod.trim()}` : `${DAYS[wd]}s${time}`;
  }
  const list = wds.length === 7 ? "Every day" : dayList(wds);
  const tod = steady ? ` ${top}` : "";
  if (gap >= 21) return `About once a month`;
  return `${list}${tod}`;
}

/** "9:30 and 10:30 am", "10 am and 4 pm". */
function twoTimes(a: string, b: string): string {
  const [x, y] = [clock(a), clock(b)];
  const ampm = (t: string) => t.match(/ (am|pm)$/)?.[1];
  return ampm(x) && ampm(x) === ampm(y)
    ? `${x.replace(/ (am|pm)$/, "")} and ${y}`
    : `${x} and ${y}`;
}

function mostCommon(xs: (string | null)[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) if (x) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** "Today", "Tomorrow", "Tue, Nov 24" (day names and dates, not clocks). */
export function dayWord(day: string, today: string): string {
  if (day <= today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return shortDate(day);
}

/** "Today · 10:30 am", "Tue, Nov 24 · 4 pm". */
export function nextLine(d: EventDate, today: string): string {
  const w = dayWord(d.day, today);
  return d.start ? `${w} · ${clock(d.start)}` : w;
}
