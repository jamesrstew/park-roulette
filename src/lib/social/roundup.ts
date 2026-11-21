import {
  clock,
  costChip,
  type EventDate,
  type EventRow,
  monthDay,
  pacificAt,
  statusOn,
  upcomingDates,
} from "@/lib/events/model";
import { ALL_AGES } from "@/lib/events/ages";
import { listed } from "@/lib/events/state";
import { addDays, weekdayOf } from "@/lib/news/time";
import type { WeekEvent } from "./compose";
import { DATED_LEAD_HOURS, EVENTS_MAX, EVENTS_MIN } from "./model";
import { eventTextProblem } from "./validate";

/** ageTags' open top ("6 and up" reads as [6, 99]). */
const OPEN_TOP = 99;

/**
 * Tuesday's "Family events this week": which kids' events go in, made by
 * code from kid_events alone (no model words). Pure.
 *
 * The window runs from the post plus 12 hours (the dated-lead rule) to the
 * end of the following Monday. An event counts only when it's on the
 * listing (confirmed, a kids' event, inside the 60-day horizon), its date
 * is scheduled, and it prints a start time and ages. Its price chip shows
 * only when the page prints a cost (costChip); with none, no price at all,
 * never "free" or "check the page". One slide per
 * event (its first date in the window). At least 4, or the week is
 * skipped; at most 8, spread across towns and days. Ordered by date.
 */

const DAYS3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "1 to 3 pm", "10 am to noon", "Starts 6 pm" (one am/pm when both share it). */
export function timeLine(d: Pick<EventDate, "start" | "end">): string {
  const a = clock(d.start!);
  if (!d.end) return `Starts ${a}`;
  const b = clock(d.end);
  const m = /^(.+) (am|pm)$/.exec(a);
  return m && b.endsWith(` ${m[2]}`) ? `${m[1]} to ${b}` : `${a} to ${b}`;
}

/** The oldest youngest-age a roundup event may print (a family event, not a teen one). */
export const ROUNDUP_MAX_YOUNGEST = 10;

/**
 * The ages chip: exactly the printed range code read, never a wider one
 * ("Ages 3 to 8", "Ages 10 to 18", "Ages 6 and up", "All ages"). Null
 * when there's no range to print (then the event isn't in the roundup).
 */
export function ageChips(
  tags: readonly string[],
  range: readonly [number, number] | null = null,
): string[] | null {
  if (tags.includes(ALL_AGES)) return [ALL_AGES];
  if (!range) return null;
  const [lo, hi] = range;
  if (hi >= OPEN_TOP) return [`Ages ${lo} and up`];
  return [lo === hi ? `Age ${lo}` : `Ages ${lo} to ${hi}`];
}

/** Printed ages a family roundup takes: kids, youngest 10 or under, not teen-only. */
export function roundupAges(
  ages:
    | { tags: readonly string[]; kids: boolean; range: [number, number] | null }
    | null
    | undefined,
): { chips: string[] } | { why: string } {
  if (!ages || !ages.tags.length) return { why: "no printed ages" };
  if (ages.kids === false) return { why: "not a kids' event" };
  if (ages.range && ages.range[0] > ROUNDUP_MAX_YOUNGEST)
    return {
      why: `youngest age ${ages.range[0]} (a family roundup needs ${ROUNDUP_MAX_YOUNGEST} or under)`,
    };
  const chips = ageChips(ages.tags, ages.range);
  return chips ? { chips } : { why: "no printed age range" };
}

/** The window: from the slot plus 12 hours to the end of the 7th day (Monday). */
export function roundupWindow(slotDay: string, publishAt: Date) {
  const lastDay = addDays(slotDay, 6);
  return {
    from: new Date(publishAt.getTime() + DATED_LEAD_HOURS * 3_600_000),
    to: pacificAt(addDays(lastDay, 1), "00:00"),
    firstDay: slotDay,
    lastDay,
    /** "Tue, Nov 24 to Mon, Nov 30" (the headline slide's kicker). */
    label: `${DAYS3[weekdayOf(slotDay)]}, ${monthDay(slotDay)} to ${DAYS3[weekdayOf(lastDay)]}, ${monthDay(lastDay)}`,
    /** "Nov 24 to 30" or "Nov 30 to Dec 6" (the caption). */
    caption:
      slotDay.slice(5, 7) === lastDay.slice(5, 7)
        ? `${monthDay(slotDay)} to ${Number(lastDay.slice(8))}`
        : `${monthDay(slotDay)} to ${monthDay(lastDay)}`,
  };
}

export type RoundupPick = {
  events: WeekEvent[];
  /** Why each left-out event was left out (for the log and tests). */
  left: string[];
};

/**
 * The events for the roundup, or the reason there's no roundup this week.
 * `screen` checks an event's title, venue and host names (default: the
 * text rules, and no bars, breweries or wineries); null is fine.
 */
export function pickWeekEvents(
  rows: Iterable<EventRow>,
  window: ReturnType<typeof roundupWindow>,
  now: Date,
  screen: (e: EventRow["data"]) => string | null = (e) =>
    eventTextProblem(e, Number(window.firstDay.slice(5, 7))),
): RoundupPick & { skip: string | null } {
  const left: string[] = [];
  const candidates: (WeekEvent & { at: number })[] = [];
  for (const e of rows) {
    if (!listed(e, now)) continue;
    const ages = roundupAges(e.data.ages);
    if ("why" in ages) {
      left.push(`${e.slug}: ${ages.why}`);
      continue;
    }
    // Printed cost or none: never a guess.
    const cost = costChip(e.data);
    const bad = screen(e.data);
    if (bad) {
      left.push(`${e.slug}: ${bad}`);
      continue;
    }
    const inWindow = upcomingDates(e.data, now).filter((d) => {
      if (!d.start) return false;
      if (statusOn(e.data, d.day, e.status) !== "scheduled") return false;
      const t = pacificAt(d.day, d.start);
      return t >= window.from && t < window.to;
    });
    if (!inWindow.length) continue;
    const first = inWindow[0];
    const more = [
      ...new Set(
        inWindow
          .slice(1)
          .map((d) => d.day)
          .filter((day) => day !== first.day),
      ),
    ];
    candidates.push({
      slug: e.slug,
      day: first.day,
      start: first.start!,
      at: pacificAt(first.day, first.start!).getTime(),
      title: e.data.title.trim(),
      weekday: DAYS3[weekdayOf(first.day)],
      date: monthDay(first.day),
      time: timeLine(first),
      venue: e.data.venue.name,
      town: e.data.venue.town,
      ages: ages.chips,
      cost,
      host:
        e.data.organizer &&
        e.data.organizer.name.trim().toLowerCase() !==
          e.data.venue.name.trim().toLowerCase()
          ? e.data.organizer.name.trim()
          : null,
      also: more.length
        ? `Also ${more.map((d) => DAYS3[weekdayOf(d)]).join(", ")}`
        : null,
    });
  }
  candidates.sort((a, b) => a.at - b.at || a.slug.localeCompare(b.slug));
  if (candidates.length < EVENTS_MIN)
    return {
      events: [],
      left,
      skip: `Only ${candidates.length} kids' events with printed ages and times this week (${EVENTS_MIN} needed).`,
    };
  // Greedy spread: the next pick is the event whose town and day are least
  // used so far; the earlier start breaks ties. Bend (where most readers
  // live) counts half, so it keeps about half the slides when it has the
  // events, and the other towns still each get in.
  const chosen: typeof candidates = [];
  const pool = [...candidates];
  const towns = new Map<string, number>();
  const days = new Map<string, number>();
  while (chosen.length < EVENTS_MAX && pool.length) {
    let best = 0;
    let bestScore = Infinity;
    pool.forEach((c, i) => {
      const t = towns.get(c.town) ?? 0;
      const score = (c.town === "Bend" ? t / 2 : t) + (days.get(c.day) ?? 0);
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    const [c] = pool.splice(best, 1);
    chosen.push(c);
    towns.set(c.town, (towns.get(c.town) ?? 0) + 1);
    days.set(c.day, (days.get(c.day) ?? 0) + 1);
  }
  for (const c of pool) left.push(`${c.slug}: over ${EVENTS_MAX} (spread)`);
  chosen.sort((a, b) => a.at - b.at || a.slug.localeCompare(b.slug));
  return {
    events: chosen.map((c) => {
      const e: WeekEvent & { at?: number } = { ...c };
      delete e.at;
      return e;
    }),
    left,
    skip: null,
  };
}
