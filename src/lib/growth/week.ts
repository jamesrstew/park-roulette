import { addDays, pacific, pacificInstant } from "@/lib/news/time";

/**
 * The growth digest's calendar. A week runs Monday 00:00 to the next
 * Monday 00:00, Pacific, and is named by its Monday ("2026-11-23"). The
 * digest goes out on the Monday after, covering the week that just ended.
 * Pure (no server imports), so tests can pin any moment.
 */

export type Week = {
  /** The Monday, Pacific ("2026-11-23"). */
  start: string;
  /** The Sunday it ends on (for words: "Nov 23 to 29"). */
  end: string;
  /** Monday 00:00 Pacific, as an instant (PST or PDT, whichever applies). */
  from: Date;
  /** The next Monday 00:00 Pacific: the window is [from, to). */
  to: Date;
};

export function weekOf(monday: string): Week {
  return {
    start: monday,
    end: addDays(monday, 6),
    from: pacificInstant(monday, 0, 0),
    to: pacificInstant(addDays(monday, 7), 0, 0),
  };
}

/** The Monday of the Pacific week `now` is in. */
export function mondayOn(now: Date): string {
  const p = pacific(now);
  return addDays(p.date, -((p.weekday + 6) % 7));
}

/** The last full week before `now` (what Monday's digest covers). */
export function lastFullWeek(now: Date): Week {
  return weekOf(addDays(mondayOn(now), -7));
}

/** The `n` weeks before this one, oldest first. */
export function weeksBefore(week: Week, n: number): Week[] {
  return Array.from({ length: n }, (_, i) =>
    weekOf(addDays(week.start, -7 * (n - i))),
  );
}

export const isMonday = (date: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  addDays(date, 0) === date &&
  new Date(`${date}T12:00:00Z`).getUTCDay() === 1;

/**
 * The send gate. Vercel runs the cron at :12 and :42 from 14:00 to 16:59
 * UTC on Mondays (vercel.json), which is 7:12 to 9:42 in summer (PDT) and
 * 6:12 to 8:42 in winter (PST). The digest may go from 7:12 to 9:00
 * Pacific: the first run in that window sends it, and later runs only
 * retry one that failed (the send is idempotent per week).
 */
export const SEND_FROM_MIN = 7 * 60 + 12;
export const SEND_UNTIL_MIN = 9 * 60;

export function sendGate(now: Date): { open: boolean; why: string } {
  const p = pacific(now);
  if (p.weekday !== 1) return { open: false, why: "not Monday in Pacific" };
  if (p.minutes < SEND_FROM_MIN)
    return { open: false, why: "before 7:12 Pacific" };
  if (p.minutes >= SEND_UNTIL_MIN)
    return { open: false, why: "after 9:00 Pacific" };
  return { open: true, why: "Monday 7:12 to 9:00 Pacific" };
}

/** "Nov 23 to 29" or "Nov 30 to Dec 6". */
export function weekLabel(w: Week): string {
  const md = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    });
  const [a, b] = [md(w.start), md(w.end)];
  const sameMonth = a.split(" ")[0] === b.split(" ")[0];
  return `${a} to ${sameMonth ? b.split(" ")[1] : b}`;
}
