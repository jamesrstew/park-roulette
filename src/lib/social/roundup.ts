import {
  clock,
  costChip,
  type EventDate,
  type EventRow,
  monthDay,
  pacificAt,
  shortDate,
  statusOn,
  upcomingDates,
  whenLine,
} from "@/lib/events/model";
import { ALL_AGES } from "@/lib/events/ages";
import { checkShort, FIRST_PERSON, MONEY } from "@/lib/events/short";
import { DESC_MAX, firstSentence, LOGISTICS } from "@/lib/events/short-what";
import { listed } from "@/lib/events/state";
import { addDays, weekdayOf } from "@/lib/news/time";
import {
  composeEventsWeek,
  placeLine,
  slideTitle,
  type WeekEvent,
} from "./compose";
import {
  CAPTION_MAX,
  DATED_LEAD_HOURS,
  EVENTS_MAX,
  EVENTS_MIN,
  type PostSpec,
} from "./model";
import { eventFit } from "@/components/social/fit";
import { eventTextProblem, textProblems } from "./validate";

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

/**
 * Every showing's start, one am/pm for a run that shares it: "1:30 and 6
 * pm", "noon and 3:30 pm", "11 am and 1:30 pm", "10, 11:30 am and 1 pm".
 */
export function showTimes(starts: readonly string[]): string {
  const t = [...new Set(starts)].sort().map((s) => {
    const c = clock(s);
    const m = /^(.+) (am|pm)$/.exec(c);
    return m ? { n: m[1], ap: m[2] } : { n: c, ap: "" };
  });
  const words = t.map((x, i) =>
    x.ap && t[i + 1]?.ap !== x.ap ? `${x.n} ${x.ap}` : x.n,
  );
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
    : (words[0] ?? "");
}

/**
 * An event's day chip on the Unpack carousel (lesson 50): "Sat, Nov 21 ·
 * 10 am to 2 pm", "Sat, Nov 21 · 1:30 pm" (a start alone, no "Start
 * time"), and every showing that day: "Sat, Nov 28 · 1:30 and 6 pm".
 */
export function eventDayChip(dates: readonly EventDate[], day: string): string {
  const own = dates.filter((d) => d.day === day);
  const first = own[0];
  if (!first) return "";
  if (first.end_day && first.end_day !== first.day) return whenLine(first);
  const head = shortDate(day);
  const shows = own.filter((d) => d.start && !d.end_day);
  if (shows.length > 1)
    return `${head} · ${showTimes(shows.map((d) => d.start!))}`;
  if (first.start && !first.end) return `${head} · ${clock(first.start)}`;
  return whenLine(first);
}

/**
 * The venue chip: "Central Library, Bend", or "Redmond Library" alone
 * when the name says the town; a long name drops the town so the chip
 * stays on one line (40 characters fill the slide at 48 px).
 */
export function venueChip(venue: string, town: string): string {
  const chip = placeLine(venue, town).replace(/^At /, "");
  return chip.length > 40 ? venue : chip;
}

// The descriptor trimmer is shared with The Scoop's event cards.
export { DESC_MAX, firstSentence } from "@/lib/events/short-what";

/**
 * The descriptor under an event's title, in order: its checked `short`
 * (written by the harvest, one complete phrase); else the whole first
 * sentence of `what` when it's 70 characters or fewer and isn't
 * logistics; else none. Never a clause cut.
 */
export function eventDescriptor(e: {
  short?: string;
  what: string;
  title: string;
}): { text: string; from: "short" | "sentence" } | null {
  if (e.short) {
    const sc = checkShort(e.short, { what: e.what, title: e.title });
    if (sc.short) return { text: sc.short, from: "short" };
  }
  // The fallback is the summary's own sentence, held to the short's word
  // rules too: no logistics, no price or "free", no first person.
  const s = firstSentence(e.what, DESC_MAX);
  return s &&
    s.length >= 12 &&
    !LOGISTICS.test(s) &&
    !MONEY.test(s) &&
    !FIRST_PERSON.test(s)
    ? { text: s, from: "sentence" }
    : null;
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
/** Our summary's words still pass the text rules as a descriptor (else none). */
/**
 * Our summary's words, held to the text rules for the post's own month.
 * A line that breaks one (first person, a competitor) is dropped, and
 * why goes in the roundup's log rather than vanishing.
 */
function descOk(
  d: string | null,
  month: number,
): { desc: string | null; why: string | null } {
  if (!d) return { desc: null, why: null };
  // The host's words, not ours: no "we" either ("We'll paint ornaments").
  const bad = textProblems(d, { month, label: "descriptor", plural: false });
  return bad.length
    ? { desc: null, why: bad.join(" ") }
    : { desc: d, why: null };
}

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
    // Printed cost or none: never a guess. A printed cost the chip can't
    // show (no amount read) would print as no price: leave it out.
    const cost = costChip(e.data);
    if (e.data.cost && !cost) {
      left.push(`${e.slug}: printed cost we can't show`);
      continue;
    }
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
    const descResult = descOk(
      eventDescriptor(e.data)?.text ?? null,
      Number(window.firstDay.slice(5, 7)),
    );
    if (descResult.why)
      left.push(`${e.slug}: descriptor dropped (${descResult.why})`);
    const c = {
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
      desc: descResult.desc,
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
    };
    // Nothing overflows the card: drop the descriptor if that's what it
    // takes, and leave out an event whose words still don't fit.
    const copy = (desc: string | null) => ({
      ...c,
      // Measured as the slide prints it ("B.U.R.S.T. - X" → "B.U.R.S.T. X").
      title: slideTitle(c.title),
      desc,
      place: placeLine(c.venue, c.town),
      chips: [...c.ages, ...(c.cost ? [c.cost] : [])],
    });
    if (!eventFit(copy(c.desc)).fits) c.desc = null;
    if (!eventFit(copy(null)).fits) {
      left.push(`${e.slug}: too many words for one slide`);
      continue;
    }
    candidates.push(c);
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
  // The same program at another branch ("Family Story Time" in four
  // towns) reads as one slide repeated: each repeat costs two.
  const titles = new Map<string, number>();
  const titleKey = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  while (chosen.length < EVENTS_MAX && pool.length) {
    let best = 0;
    let bestScore = Infinity;
    pool.forEach((c, i) => {
      const t = towns.get(c.town) ?? 0;
      const score =
        (c.town === "Bend" ? t / 2 : t) +
        (days.get(c.day) ?? 0) +
        2 * (titles.get(titleKey(c.title)) ?? 0);
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    const [c] = pool.splice(best, 1);
    chosen.push(c);
    towns.set(c.town, (towns.get(c.town) ?? 0) + 1);
    days.set(c.day, (days.get(c.day) ?? 0) + 1);
    titles.set(titleKey(c.title), (titles.get(titleKey(c.title)) ?? 0) + 1);
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

/**
 * The roundup, cut to Instagram's 2,200-character caption: descriptors
 * go first (the latest event's first), then the "Also ..." lines, then
 * the latest events, down to 4. Still too long: no roundup (the caller
 * skips the slot and tells James). The slides lose the same words, so
 * the caption and the slides always agree.
 */
export function fitRoundup(
  events: WeekEvent[],
  window: { label: string; caption: string },
  dms: boolean,
  max = CAPTION_MAX,
): { spec: PostSpec; events: WeekEvent[]; cut: string[] } | { skip: string } {
  let es = events.map((e) => ({ ...e }));
  const cut: string[] = [];
  const make = () => composeEventsWeek(es, window, dms);
  const fits = () => (make().caption ?? "").length <= max;
  for (const field of ["desc", "also"] as const)
    for (let i = es.length - 1; i >= 0 && !fits(); i--)
      if (es[i][field]) {
        es[i][field] = null;
        cut.push(
          `${es[i].slug}: ${field === "desc" ? "descriptor" : "also line"} cut for caption length`,
        );
      }
  while (!fits() && es.length > EVENTS_MIN) {
    const last = es[es.length - 1];
    es = es.slice(0, -1);
    cut.push(`${last.slug}: left out for caption length`);
  }
  if (!fits())
    return {
      skip: `The roundup's caption runs over ${max} characters even with ${es.length} events and no descriptors.`,
    };
  return { spec: make(), events: es, cut };
}
