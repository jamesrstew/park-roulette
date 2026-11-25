import { directionsUrl } from "@/lib/geo";
import { addDays } from "@/lib/news/time";
import { ageChip } from "@/lib/scoop";
import {
  dateEnds,
  type EventDate,
  type EventRow,
  isFree,
  listingEnds,
  occurrenceId,
  pacificAt,
  pacificToday,
  shortDate,
  statusOn,
  upcomingDates,
  whenLine,
} from "./model";
import { type SaveRef, saveKey } from "./prefs";
import { type SpecialGroup, specialGroupOf, venueLine } from "./programs";

/**
 * The shortlist's facts for each saved ref, fresh from the stored events
 * (never the phone's snapshot): what's on, and what changed. Pure.
 *
 *  ok            on as saved
 *  canceled      that date is canceled (per date, else the page's status)
 *  postponed     postponed, no new date yet
 *  moved         that date is gone from the page (rescheduled or trimmed)
 *  unconfirmed   the official page stopped printing it
 *  no_next       a saved regular with no date announced yet
 *  gone          the page came off our list entirely
 */
export type ShortState =
  | "ok"
  | "canceled"
  | "postponed"
  | "moved"
  | "unconfirmed"
  | "no_next"
  | "gone";

export type ShortFact = {
  key: string;
  slug: string;
  occ: string;
  state: ShortState;
  /** A regular saved as a program (occ ""): its next date, always. */
  regular: boolean;
  title: string;
  /** "Downtown Library, Bend". */
  where: string;
  /** The date shown: the saved one, or a regular's next. */
  date: EventDate | null;
  /** The saved date has ended. */
  past: boolean;
  /** Moved by a reschedule: the new first date. */
  newDay: string | null;
  /** A dated save of a series that passed: its next date, to save again. */
  next: { occ: string; date: EventDate } | null;
  free: boolean;
  ages: string | null;
  point: { lat: number; lng: number } | null;
  venue: string;
  /** Who says so: the organizer, else the venue ("Canceled, per …"). */
  by: string;
  /** Display, worked out here so the browser needs no event code. */
  show: ShortShow;
};

export type ShortShow = {
  /** Where it goes on the shortlist. */
  group: SpecialGroup | "regular" | "past";
  /** Sorts within a group: "2026-11-25|10:30". */
  sort: string;
  /** "Tue, Nov 25 · 10:30 am to 11:30 am". */
  when: string;
  /** The date block: "Nov", "25". */
  mon: string;
  dom: string;
  /** Something a family planning around it needs to know. */
  changed: boolean;
  /** "Sat, Dec 6" for a reschedule's new date. */
  newDay: string | null;
  /** A passed series date's next one: "Tue, Dec 2 · 10:30 am". */
  again: string | null;
  ics: string | null;
  directions: string | null;
};

/** "10:30 am" never splits across lines ("10:30 / am"). */
export const keepTimes = (s: string) =>
  s.replace(/ (am|pm)\b/g, "\u00a0$1").replace(/ to /g, "\u00a0to ");

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

function showOf(f: Omit<ShortFact, "show">, today: string): ShortShow {
  const d = f.date;
  const day = d?.day ?? "";
  const live = !f.past && (f.state === "ok" || f.state === "unconfirmed");
  return {
    group: f.past
      ? "past"
      : f.regular
        ? "regular"
        : specialGroupOf(day < today ? today : day, today),
    sort: `${day || "9999"}|${d?.start ?? ""}`,
    when: d ? keepTimes(whenLine(d as EventDate)) : "",
    mon: day ? MONTHS[Number(day.slice(5, 7)) - 1] : "",
    dom: day ? String(Number(day.slice(8, 10))) : "",
    changed: !f.past && f.state !== "ok" && f.state !== "no_next",
    newDay: f.newDay ? shortDate(f.newDay) : null,
    again: f.next ? keepTimes(whenLine(f.next.date)) : null,
    ics:
      d && live
        ? `/events/${f.slug}/calendar.ics?d=${day}${d.start ? `&t=${d.start}` : ""}`
        : null,
    directions:
      f.point && !f.past && f.state !== "gone"
        ? directionsUrl({ ...f.point, name: f.venue })
        : null,
  };
}

/** The day and start an occurrence id names ("2026-12-06-1400"). */
export function occParts(occ: string): { day: string; start?: string } {
  const day = occ.slice(0, 10);
  const t = occ.slice(11);
  return t.length === 4
    ? { day, start: `${t.slice(0, 2)}:${t.slice(2)}` }
    : { day };
}

export function shortlistFacts(
  rows: readonly EventRow[],
  refs: readonly SaveRef[],
  now: Date,
): ShortFact[] {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const today = pacificToday(now);
  return refs.map((ref) => {
    const f = factOf(ref);
    return { ...f, show: showOf(f, today) };
  });

  function factOf(ref: SaveRef): Omit<ShortFact, "show"> {
    const key = saveKey(ref.slug, ref.occ);
    const row = bySlug.get(ref.slug);
    const regular = ref.occ === "";
    const base = {
      key,
      slug: ref.slug,
      occ: ref.occ,
      regular,
      newDay: null,
      next: null,
      free: false,
      ages: null,
      point: null,
    };
    if (!row) {
      const p = occParts(ref.occ);
      return {
        ...base,
        state: "gone",
        title: "",
        where: "",
        date: regular ? null : p,
        past: regular ? false : pacificAt(addDays(p.day, 1)) <= now,
        venue: "",
        by: "",
      };
    }
    const e = row.data;
    const common = {
      ...base,
      title: e.title,
      where: venueLine(row),
      free: isFree(e),
      ages: ageChip(e.ages?.tags),
      point: e.point,
      venue: e.venue.name,
      by: e.organizer?.name ?? e.venue.name,
    };
    const upcoming = upcomingDates(e, now);
    if (regular) {
      // A regular's date leaves 2 hours after it starts (as on /events).
      const next = upcoming.find((d) => listingEnds(d) > now) ?? null;
      if (!next)
        return { ...common, state: "no_next", date: null, past: false };
      return {
        ...common,
        state: stateOf(row, next.day),
        date: next,
        past: false,
      };
    }
    const date = e.dates.find((d) => occurrenceId(d) === ref.occ) ?? null;
    if (!date) {
      const p = occParts(ref.occ);
      const moved =
        e.status?.kind === "rescheduled" && e.status.previous_day === p.day;
      const past = pacificAt(addDays(p.day, 1)) <= now;
      return {
        ...common,
        state: "moved",
        date: p,
        past,
        newDay: moved ? (upcoming[0]?.day ?? null) : null,
      };
    }
    const past = dateEnds(date) <= now;
    const again =
      past && row.kind === "series" && upcoming[0]
        ? { occ: occurrenceId(upcoming[0]), date: upcoming[0] }
        : null;
    return {
      ...common,
      state: past ? "ok" : stateOf(row, date.day),
      date,
      past,
      next: again,
    };
  }
}

function stateOf(row: EventRow, day: string): ShortState {
  const s = statusOn(row.data, day, row.status);
  if (s === "canceled") return "canceled";
  if (s === "postponed") return "postponed";
  if (row.confirm === "unconfirmed") return "unconfirmed";
  return "ok";
}

/** Dated saves this long past drop off the shortlist (and the database). */
export const PAST_DAYS = 30;

/** The oldest day a dated save may have and still show (Pacific). */
export function pastCutoff(now: Date): string {
  return addDays(pacificToday(now), -PAST_DAYS);
}
