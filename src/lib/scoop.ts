import {
  conditionFromNws,
  type WeatherIcon,
} from "@/components/news/WeatherCard";
import { AGE_BRACKETS, ALL_AGES, type AgeTag } from "@/lib/events/ages";
import {
  clock,
  type EventDate,
  type EventRow,
  isFree,
  monthDay,
  statusOn,
  upcomingDates,
} from "@/lib/events/model";
import { listed } from "@/lib/events/state";
import { dayName, dayTier, type TextPeriod, type Tier } from "@/lib/news/tiers";
import { addDays, pacific, shortDay } from "@/lib/news/time";

/**
 * The scoop (/news), the pure parts: Bend's next three days, the events
 * the carousel shows, and the labels on its cards. No database or fetch
 * here, so tests can pin any moment. Spec: /tmp/pr-news/batch7/scoop-spec.md.
 */

// --- Weather -----------------------------------------------------------------

export type ScoopDay = {
  date: string;
  /** "Today", "Sun" */
  label: string;
  /** "Sunday", for the sentence screen readers hear. */
  long: string;
  condition: string;
  icon: WeatherIcon;
  high: number;
  low: number | null;
  /** Daytime chance of rain or snow, shown at 20% or more. */
  pop: number | null;
  tier: Tier;
};

/**
 * The next three forecast days in Bend: from the first daytime period on
 * or after today (after 6 pm NWS leads with tonight, so tomorrow leads).
 * Tiers come from tiers.ts (text forecast only; no alerts here). Null when
 * there's no forecast, so the block hides.
 */
export function scoopWeather(
  periods: readonly TextPeriod[] | null | undefined,
  now: Date,
): ScoopDay[] | null {
  if (!periods?.length) return null;
  const today = pacific(now).date;
  const dates = [
    ...new Set(
      periods
        .filter((p) => p.isDaytime && p.startTime.slice(0, 10) >= today)
        .map((p) => p.startTime.slice(0, 10)),
    ),
  ]
    .sort()
    .slice(0, 3);
  if (dates.length < 3) return null;
  return dates.map((date) => {
    const day = periods.find(
      (p) => p.isDaytime && p.startTime.slice(0, 10) === date,
    )!;
    const night = periods.find(
      (p) => !p.isDaytime && p.startTime.slice(0, 10) === date,
    );
    const pop = day.probabilityOfPrecipitation?.value ?? null;
    const long = dayName(date);
    return {
      date,
      label: date === today ? "Today" : long.slice(0, 3),
      long: date === today ? "Today" : long,
      ...conditionFromNws(day.shortForecast, pop),
      high: Math.round(day.temperature),
      low: night ? Math.round(night.temperature) : null,
      pop,
      tier: dayTier({ date, periods, alerts: [] }).tier,
    };
  });
}

/** The column's word, short enough for a third of a phone ("Snow showers" -> "Snow"). */
export function shortCondition(condition: string): string {
  const short: Record<string, string> = {
    "Snow showers": "Snow",
    "Rain and snow": "Rain, snow",
    "Mostly cloudy": "Cloudy",
  };
  return short[condition] ?? condition;
}

/** "Sunday looks snowy." for a disruptive day, by its icon. */
export function roughLine(d: ScoopDay): string {
  const word: Partial<Record<WeatherIcon, string>> = {
    snow: "snowy",
    rain: "rainy",
    mixed: "icy",
    storm: "stormy",
    wind: "windy",
    smoke: "smoky",
  };
  return `${d.long} looks ${word[d.icon] ?? "rough"}.`;
}

/** "Sunday: snow showers, high 34°, low 20°, 60% chance of snow." */
export function daySentence(d: ScoopDay): string {
  let s = `${d.long}: ${d.condition.toLowerCase()}, high ${d.high}°`;
  if (d.low != null) s += `, low ${d.low}°`;
  if (d.pop != null && d.pop >= 20)
    s += `, ${d.pop}% chance of ${d.icon === "snow" ? "snow" : d.icon === "mixed" ? "rain or snow" : "rain"}`;
  return `${s}.`;
}

// --- Events ------------------------------------------------------------------

export type ScoopEvent = {
  slug: string;
  title: string;
  /** "Today · 10 am", "Wed, Nov 25 · 1 pm", "Through Jan 3" */
  when: string;
  town: string;
  /** One age chip: "Ages 4-12", "All ages", or null (none, or 0 to 12). */
  age: string | null;
  free: boolean;
};

/** At most this many cards, then the See all card. */
export const SCOOP_EVENTS = 8;
/** The window: a week, widened to two when it holds fewer than 4. */
const WEEK = 7;
const WIDE = 14;
const ENOUGH = 4;

/**
 * Several age tags as one chip: "Ages 0-3" + "Ages 4-7" -> "Ages 0-7".
 * No chip when the tags cover every bracket (0 to 12 tells a parent
 * nothing) or when none is printed.
 */
export function ageChip(tags: readonly AgeTag[] | undefined): string | null {
  if (!tags?.length) return null;
  if (tags.includes(ALL_AGES)) return ALL_AGES;
  const b = AGE_BRACKETS.filter((x) => tags.includes(x.tag));
  if (!b.length || b.length === AGE_BRACKETS.length) return null;
  return `Ages ${b[0].lo}-${b[b.length - 1].hi}`;
}

/** The card's when: the next date, by day name close in, with its start. */
export function scoopWhen(d: EventDate, today: string): string {
  const last = d.end_day ?? d.day;
  if (d.day < today) return `Through ${monthDay(last)}`;
  const day =
    d.day === today
      ? "Today"
      : d.day === addDays(today, 1)
        ? "Tomorrow"
        : shortDay(d.day);
  if (d.end_day && d.end_day !== d.day)
    return `${day} to ${monthDay(d.end_day)}`;
  return d.start ? `${day} · ${clock(d.start)}` : day;
}

/**
 * The carousel's events: listed (confirmed, kids', within 60 days) whose
 * next date is scheduled (never canceled or postponed), in the next week
 * (two when the week is thin). Soonest first, by day then start time; on
 * the same day, single-day events before ones already running.
 */
export function scoopEvents(
  rows: readonly EventRow[],
  now: Date,
): ScoopEvent[] {
  const today = pacific(now).date;
  const live = rows
    .filter((r) => listed(r, now))
    .map((r) => ({ r, next: upcomingDates(r.data, now)[0] }))
    .filter(
      (x) =>
        x.next &&
        x.r.status !== "canceled" &&
        statusOn(x.r.data, x.next.day, x.r.status) === "scheduled",
    );
  const within = (n: number) =>
    live.filter((x) => x.next.day <= addDays(today, n - 1));
  const pool = within(WEEK).length >= ENOUGH ? within(WEEK) : within(WIDE);
  const key = (x: (typeof live)[number]) => {
    const running = x.next.day < today;
    return [
      running ? today : x.next.day,
      running ? "1" : "0",
      x.next.start ?? "99:99",
      x.r.data.title,
    ].join("|");
  };
  return pool
    .sort((a, b) => key(a).localeCompare(key(b)))
    .slice(0, SCOOP_EVENTS)
    .map(({ r, next }) => ({
      slug: r.slug,
      title: r.data.title,
      when: scoopWhen(next, today),
      town: r.data.venue.town,
      age: ageChip(r.data.ages?.tags),
      free: isFree(r.data),
    }));
}

// --- Reviews -----------------------------------------------------------------

/** "Today", "Yesterday", "Thursday" (this week), "Nov 3". */
export function dayLabel(iso: string, now: number): string {
  const tz = { timeZone: "America/Los_Angeles" } as const;
  const day = (t: number) => new Date(t).toLocaleDateString("en-CA", tz);
  const t = new Date(iso).getTime();
  if (day(t) === day(now)) return "Today";
  if (day(t) === day(now - 86400000)) return "Yesterday";
  if (now - t < 6 * 86400000)
    return new Date(t).toLocaleDateString("en-US", { ...tz, weekday: "long" });
  return new Date(t).toLocaleDateString("en-US", {
    ...tz,
    month: "short",
    day: "numeric",
  });
}

/** A review's words cut to about two lines, at a word break. */
export function excerpt(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,.;:!?-]+$/, "")}…`;
}
