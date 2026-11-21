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
import { ALL_AGES, AGE_BRACKETS } from "@/lib/events/ages";
import { listed } from "@/lib/events/state";
import { addDays, weekdayOf } from "@/lib/news/time";
import type { WeekEvent } from "./compose";
import { DATED_LEAD_HOURS, EVENTS_MAX, EVENTS_MIN } from "./model";

/**
 * Tuesday's "Family events this week": which kids' events go in, made by
 * code from kid_events alone (no model words). Pure.
 *
 * The window runs from the post plus 12 hours (the dated-lead rule) to the
 * end of the following Monday. An event counts only when it's on the
 * listing (confirmed, a kids' event, inside the 60-day horizon), its date
 * is scheduled, and it prints a start time, ages and a cost. One slide per
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

/**
 * The ages chip: the printed range when code read one ("Ages 3 to 8",
 * "Ages 6 and up"), so a chip is never wider than the page says; else the
 * tags, touching brackets merged ("Ages 0-3", "Ages 4-7" → "Ages 0 to 7").
 * "All ages" stays as it is.
 */
export function ageChips(
  tags: readonly string[],
  range: readonly [number, number] | null = null,
): string[] {
  if (tags.includes(ALL_AGES)) return [ALL_AGES];
  if (range) {
    const [lo, hi] = range;
    if (hi > 12) return [`Ages ${lo} and up`];
    return [lo === hi ? `Age ${lo}` : `Ages ${lo} to ${hi}`];
  }
  const spans: [number, number][] = [];
  for (const b of AGE_BRACKETS)
    if (tags.includes(b.tag)) {
      const last = spans[spans.length - 1];
      if (last && last[1] + 1 === b.lo) last[1] = b.hi;
      else spans.push([b.lo, b.hi]);
    }
  return spans.map(([lo, hi]) => `Ages ${lo} to ${hi}`);
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
 * `titleOk` runs the text rules on a title (null: fine).
 */
export function pickWeekEvents(
  rows: Iterable<EventRow>,
  window: ReturnType<typeof roundupWindow>,
  now: Date,
  titleOk: (title: string) => string | null = () => null,
): RoundupPick & { skip: string | null } {
  const left: string[] = [];
  const candidates: (WeekEvent & { at: number })[] = [];
  for (const e of rows) {
    if (!listed(e, now)) continue;
    const ages = e.data.ages;
    if (!ages || ages.kids === false || !ages.tags.length) {
      left.push(`${e.slug}: no printed ages`);
      continue;
    }
    const cost = costChip(e.data);
    if (!cost) {
      left.push(`${e.slug}: no printed cost`);
      continue;
    }
    const bad = titleOk(e.data.title);
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
      ages: ageChips(ages.tags, ages.range),
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
      skip: `Only ${candidates.length} kids' events with printed ages, times and cost this week (${EVENTS_MIN} needed).`,
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
