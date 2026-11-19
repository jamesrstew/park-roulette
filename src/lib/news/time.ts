/**
 * Pacific time and the calendar for Bend Playground Passport. Pure (no
 * server imports), so tests can pin any moment.
 *
 * Dates are ISO strings ("2026-12-03") for a day in Pacific time. The
 * issue date is always the Thursday the issue goes out.
 */

export const TZ = "America/Los_Angeles";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The Pacific date, weekday (0 = Sunday) and minutes after midnight. */
export function pacific(now: Date): {
  date: string;
  weekday: number;
  minutes: number;
} {
  const p = Object.fromEntries(
    fmt.formatToParts(now).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** The moment a Pacific wall-clock time happens (handles PST and PDT). */
export function pacificInstant(date: string, hh: number, mm = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  for (const offset of [7, 8]) {
    const t = new Date(Date.UTC(y, m - 1, d, hh + offset, mm));
    const p = pacific(t);
    if (p.date === date && p.minutes === hh * 60 + mm) return t;
  }
  // The skipped hour on the spring-forward night: an hour later is close.
  return new Date(Date.UTC(y, m - 1, d, hh + 7, mm));
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;

/** "Fri, Dec 4" */
export function shortDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "December 3, 2026" */
export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** This week's Thursday (or the next one, from Friday on). */
export function issueDateFor(now: Date): string {
  const p = pacific(now);
  return addDays(p.date, (4 - p.weekday + 7) % 7);
}

/** Friday to Sunday after the issue's Thursday: when "This weekend" happens. */
export function weekendOf(issueDate: string): { from: string; to: string } {
  return { from: addDays(issueDate, 1), to: addDays(issueDate, 3) };
}

/**
 * The sender's clock. Vercel runs it every 15 minutes, 14:00 to 19:45 UTC
 * on Thursdays, which is 6:00 to 11:45 in winter and 7:00 to 12:45 in
 * summer. A send may only START from 7:00 to 9:00 Pacific; a send that
 * started keeps going on every later run. The 8:45 run is the last
 * chance: if nothing valid is ready by then, the week is skipped.
 */
export function sendGate(now: Date) {
  const p = pacific(now);
  const thursday = p.weekday === 4;
  const START = 7 * 60;
  const CUTOFF = 9 * 60;
  const LAST = 8 * 60 + 45;
  return {
    date: p.date,
    thursday,
    tooEarly: thursday && p.minutes < START,
    canStart: thursday && p.minutes >= START && p.minutes < CUTOFF,
    lastChance: thursday && p.minutes >= LAST,
  };
}

// --- Calendar flags -------------------------------------------------------

function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastWeekday(year: number, month: number, weekday: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  const day = lastDay - ((last - weekday + 7) % 7);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days families plan around (federal holidays plus a few big ones). */
export function holidays(year: number): Record<string, string> {
  const d = (m: number, day: number) =>
    `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    [d(1, 1)]: "New Year's Day",
    [nthWeekday(year, 1, 1, 3)]: "Martin Luther King Jr. Day",
    [nthWeekday(year, 2, 1, 3)]: "Presidents' Day",
    [lastWeekday(year, 5, 1)]: "Memorial Day",
    [d(6, 19)]: "Juneteenth",
    [d(7, 4)]: "Independence Day",
    [nthWeekday(year, 9, 1, 1)]: "Labor Day",
    [d(10, 31)]: "Halloween",
    [d(11, 11)]: "Veterans Day",
    [nthWeekday(year, 11, 4, 4)]: "Thanksgiving",
    [d(12, 24)]: "Christmas Eve",
    [d(12, 25)]: "Christmas Day",
    [d(12, 31)]: "New Year's Eve",
  };
}

/** US daylight saving time: starts the 2nd Sunday in March, ends the 1st Sunday in November. */
export function dstChanges(year: number): { starts: string; ends: string } {
  return {
    starts: nthWeekday(year, 3, 0, 2),
    ends: nthWeekday(year, 11, 0, 1),
  };
}

/**
 * Solstices and equinoxes, as Pacific dates (from the U.S. Naval
 * Observatory's tables). Add years as they come.
 */
export const SEASON_MARKERS: Record<string, string> = {
  "2026-12-21": "Winter solstice (shortest day)",
  "2027-03-20": "Spring equinox",
  "2027-06-21": "Summer solstice (longest day)",
  "2027-09-22": "Fall equinox",
  "2027-12-21": "Winter solstice (shortest day)",
  "2028-03-19": "Spring equinox",
  "2028-06-20": "Summer solstice (longest day)",
  "2028-09-21": "Fall equinox",
  "2028-12-21": "Winter solstice (shortest day)",
};

export type CalendarFlags = {
  /** No issue this week, and why. */
  skip: string | null;
  /** Thursday to the next Wednesday: holidays, DST and season markers. */
  holidays: { date: string; name: string }[];
  breaks: { id: string; label: string; from: string; to: string }[];
  dst: { date: string; change: "starts" | "ends" } | null;
  season: { date: string; name: string } | null;
};

export function calendarFlags(
  issueDate: string,
  catalog: {
    skip_dates: { date: string; reason: string }[];
    breaks: {
      id: string;
      label: string;
      from: string;
      to: string;
      verified: boolean;
    }[];
  },
): CalendarFlags {
  const week = Array.from({ length: 7 }, (_, i) => addDays(issueDate, i));
  const years = [...new Set(week.map((d) => Number(d.slice(0, 4))))];
  const hol = Object.assign({}, ...years.map(holidays)) as Record<
    string,
    string
  >;
  const dst = years.flatMap((y) => {
    const c = dstChanges(y);
    return [
      { date: c.starts, change: "starts" as const },
      { date: c.ends, change: "ends" as const },
    ];
  });
  const skip = catalog.skip_dates.find((s) => s.date === issueDate);
  return {
    skip: skip ? skip.reason : null,
    holidays: week
      .filter((d) => hol[d])
      .map((d) => ({ date: d, name: hol[d] })),
    breaks: catalog.breaks
      .filter((b) => b.verified && b.from <= week[6] && b.to >= week[0])
      .map(({ id, label, from, to }) => ({ id, label, from, to })),
    dst: dst.find((c) => week.includes(c.date)) ?? null,
    season:
      week
        .filter((d) => SEASON_MARKERS[d])
        .map((d) => ({ date: d, name: SEASON_MARKERS[d] }))[0] ?? null,
  };
}
