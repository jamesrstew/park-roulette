import { addDays, weekdayOf } from "@/lib/news/time";
import {
  clock,
  domainOf,
  type EventDate,
  type EventRow,
  groupBounds,
  keyStem,
  upcomingDates,
  venueKey,
} from "./model";
import { listed, nextStatus } from "./state";

/**
 * Programs: the listing's unit. Rows of one program (same name stem, same
 * organizer site) merge across branches, so five library branches' story
 * times are one program. A program is a "special" (one-offs, annual
 * events, short runs like a Nutcracker weekend) or a "regular" (repeats on
 * a schedule: story times, clubs, weekly classes). The kind is decided on
 * the whole program before any filter, so a filter never moves a program
 * between sections. Pure: no database. Spec:
 * /tmp/pr-news/batch7/events-page-spec.md.
 */

export type Branch = {
  row: EventRow;
  /** Its first date not over yet. */
  next: EventDate;
  /** Every date not over yet, soonest first. */
  upcoming: EventDate[];
};

export type ProgramKind = "special" | "regular";

export type Program = {
  key: string;
  kind: ProgramKind;
  /** The soonest branch's title. */
  title: string;
  /** Soonest first. */
  branches: Branch[];
  /** The soonest branch (its row and next date). */
  lead: Branch;
  /** The lead's next day, or today when it's already running. */
  day: string;
  annual: boolean;
};

/** Which rows are one program: the organizer's site plus the name stem. */
export function programKey(r: EventRow): string {
  return `${domainOf(r.data.url)}|${keyStem(r.data.title)}`;
}

const isLibrary = (r: EventRow) => /\blibrary\b/i.test(r.data.venue.name);

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
 * 3. At a library with more than one date: regular.
 * 4. Dates in 3 or more different weeks: regular.
 * 5. Otherwise: special.
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
  if (rows.some(isLibrary)) return "regular";
  if (new Set(days.map(mondayOf)).size >= 3) return "regular";
  return "special";
}

/**
 * The listing's programs: listed rows (with the next date's status),
 * merged and classified, then filtered by row (a town filter keeps only
 * that town's branches). Soonest first.
 */
export function buildPrograms(
  rows: readonly EventRow[],
  now: Date,
  keep: (r: EventRow) => boolean = () => true,
): Program[] {
  const today = now
    .toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" })
    .slice(0, 10);
  const byKey = new Map<string, EventRow[]>();
  for (const r of rows) {
    if (!listed(r, now)) continue;
    const row = { ...r, status: nextStatus(r, now) };
    const k = programKey(row);
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
  }
  const out: Program[] = [];
  for (const [key, members] of byKey) {
    const kind = programKind(members);
    const branches = members
      .filter(keep)
      .map((row) => {
        const upcoming = upcomingDates(row.data, now);
        return { row, upcoming, next: upcoming[0] };
      })
      .sort((a, b) => sortKey(a.next).localeCompare(sortKey(b.next)));
    if (!branches.length) continue;
    const lead = branches[0];
    out.push({
      key,
      kind,
      title: lead.row.data.title,
      branches,
      lead,
      day: lead.next.day < today ? today : lead.next.day,
      annual: members.some((r) => r.kind === "annual"),
    });
  }
  return out.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      sortKey(a.lead.next).localeCompare(sortKey(b.lead.next)) ||
      a.title.localeCompare(b.title),
  );
}

const sortKey = (d: EventDate) => `${d.day}|${d.start ?? "99:99"}`;

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

/** A library program (every branch at a library). */
export function atLibraries(p: Program): boolean {
  return p.branches.every((x) => isLibrary(x.row));
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
  if (!all.length) return "";
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
    const time =
      starts.length === 1 && starts[0] ? `, ${clock(starts[0])}` : "";
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

function mostCommon(xs: (string | null)[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) if (x) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** "Today", "Tomorrow", "Tue, Nov 24" (day names and dates, not clocks). */
export function dayWord(day: string, today: string): string {
  if (day <= today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  const [, m, d] = day.split("-").map(Number);
  const MON = [
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
  return `${DAY3[weekdayOf(day)]}, ${MON[m - 1]} ${d}`;
}

/** "Today · 10:30 am", "Tue, Nov 24 · 4 pm". */
export function nextLine(d: EventDate, today: string): string {
  const w = dayWord(d.day, today);
  return d.start ? `${w} · ${clock(d.start)}` : w;
}

/** Every date a special program has left, across branches (for "+2 more dates"). */
export function moreDates(p: Program): number {
  return p.branches.reduce((n, b) => n + b.upcoming.length, 0) - 1;
}
