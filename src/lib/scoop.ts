import {
  conditionFromNws,
  type WeatherIcon,
} from "@/components/news/WeatherCard";
import { isThisWeekendsPick } from "@/lib/asks";
import { AGE_BRACKETS, ALL_AGES, type AgeTag } from "@/lib/events/ages";
import {
  clock,
  type EventDate,
  type EventRow,
  costChip,
  isFree,
  monthDay,
  statusOn,
} from "@/lib/events/model";
import {
  bigness,
  buildPrograms,
  placesLabel,
  venueLine,
  type Program,
} from "@/lib/events/programs";
import { shortWhat } from "@/lib/events/short-what";
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
 * or after today. From 6 pm Pacific today is over, so tomorrow leads (NWS
 * drops the period then too, but a cached forecast may still hold it).
 * Tiers come from tiers.ts (text forecast only; no alerts here). Null when
 * there's no forecast, so the block hides.
 */
export function scoopWeather(
  periods: readonly TextPeriod[] | null | undefined,
  now: Date,
): ScoopDay[] | null {
  if (!periods?.length) return null;
  const p0 = pacific(now);
  const today = p0.date;
  const first = p0.minutes >= 18 * 60 ? addDays(today, 1) : today;
  const dates = [
    ...new Set(
      periods
        .filter((p) => p.isDaytime && p.startTime.slice(0, 10) >= first)
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
    const night = nightOf(periods, date);
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

/**
 * That date's night period: the one starting at noon or later ("Tonight",
 * from 6 pm), else the last night period dated that day. Never an early
 * "Overnight" period (midnight to 6 am), which is the night before's.
 */
export function nightOf(
  periods: readonly TextPeriod[],
  date: string,
): TextPeriod | undefined {
  const nights = periods.filter(
    (p) => !p.isDaytime && p.startTime.slice(0, 10) === date,
  );
  return (
    nights.find((p) => Number(p.startTime.slice(11, 13)) >= 12) ??
    nights[nights.length - 1]
  );
}

/** The day the rough-day row is about: the first disruptive one, if any. */
export function roughDay(days: readonly ScoopDay[]): ScoopDay | null {
  return days.find((d) => d.tier === "disruptive") ?? null;
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
  /** The event page, or /events#regulars for a many-branch regular. */
  href: string;
  /** A regular (story time, club), not a special event. */
  regular: boolean;
  /** An annual event (the "Once a year" tape, as on /events). */
  annual: boolean;
  /** The one-liner under the title: what kids do, or where it is. */
  line: ScoopLine;
  /** "Tower Theatre, Bend", "5 libraries". */
  place: string;
  /** The printed price chip: "Free", "$5 kids", "$10 to $15"; or null. */
  price: string | null;
  setting: "indoor" | "outdoor" | null;
};

/** The longest place a card prints whole (one line, no ellipsis). */
const PLACE_MAX = 28;

/** "Tower Theatre, Bend"; too long: "Crook County Library"; else the town. */
export function cardPlace(r: EventRow): string {
  const line = venueLine(r);
  if (line.length <= PLACE_MAX) return line;
  return r.data.venue.name.length <= PLACE_MAX
    ? r.data.venue.name
    : r.data.venue.town;
}

/** A card's one-liner: three short lines at most. */
export const SCOOP_LINE_MAX = 84;
/** Four lines, under a title that fits on one line. */
export const SCOOP_LINE_LONG = 112;
/** About as many title characters as fit on one card line. */
export const SCOOP_TITLE_LINE = 22;

/** The one-liner's budget: longer under a short title, so cards fill alike. */
export const lineBudget = (title: string) =>
  title.length <= SCOOP_TITLE_LINE ? SCOOP_LINE_LONG : SCOOP_LINE_MAX;

/** What kids do (the trimmed `what`), else the venue ("At Tower Theatre"). */
export type ScoopLine = { text: string; kind: "what" | "where" };

/**
 * The card's one-liner, never empty: the shared descriptor trimmer's line
 * from the stored `what`; when it gives none (too long to cut cleanly, a
 * rule, or nothing printed), where it is instead.
 */
export function scoopLine(
  what: string | undefined,
  venue: string,
  /** A one-line title leaves room for a fourth line. */
  max = SCOOP_LINE_MAX,
): ScoopLine {
  const text = shortWhat(what, max);
  return text ? { text, kind: "what" } : { text: venue, kind: "where" };
}

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

/** Regular programs (story times, clubs) that may fill a thin carousel. */
const SCOOP_REGULARS = 2;

/**
 * The carousel's events, by program (one card for five branches' story
 * time): specials first, listed (confirmed, kids', within 60 days) whose
 * first scheduled date (never a canceled or postponed one) is in the next
 * week (two when the week is thin), soonest first by day then start time;
 * on the same day, single-day events before ones already running. A thin
 * row is topped up with up to two regulars this week, marked as such.
 */
export function scoopEvents(
  rows: readonly EventRow[],
  now: Date,
): ScoopEvent[] {
  const today = pacific(now).date;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const key = (d: EventDate) => {
    const running = d.day < today;
    return [
      running ? today : d.day,
      running ? "1" : "0",
      d.start ?? "99:99",
    ].join("|");
  };
  const live = buildPrograms(rows, now)
    .map((p) => {
      // The soonest scheduled date across the program's event pages (each
      // date's status is sticky); the card's title, link and time all
      // come from that one page.
      const firsts = p.branches
        .flatMap((b) => b.parts)
        .map((x) => {
          const r = byId.get(x.row.id) ?? x.row;
          return {
            r,
            next: x.upcoming.find(
              (d) => statusOn(r.data, d.day, r.status) === "scheduled",
            ),
          };
        })
        .filter((x): x is { r: EventRow; next: EventDate } => !!x.next)
        .sort((a, b) => key(a.next).localeCompare(key(b.next)));
      return firsts.length ? { p, ...firsts[0] } : null;
    })
    .filter((x) => x !== null);
  // Soonest day first; on one day, big specials (annual, not a library
  // program) lead, then by start time.
  const dayOf = (d: EventDate) => (d.day < today ? today : d.day);
  const order = (a: (typeof live)[number], b: (typeof live)[number]) =>
    dayOf(a.next).localeCompare(dayOf(b.next)) ||
    bigness(a.p) - bigness(b.p) ||
    key(a.next).localeCompare(key(b.next)) ||
    a.p.title.localeCompare(b.p.title);
  const within = (n: number, kind: "special" | "regular") =>
    live.filter(
      (x) => x.p.kind === kind && x.next.day <= addDays(today, n - 1),
    );
  const specials = (
    within(WEEK, "special").length >= ENOUGH
      ? within(WEEK, "special")
      : within(WIDE, "special")
  )
    .sort(order)
    .slice(0, SCOOP_EVENTS);
  const room = Math.min(SCOOP_REGULARS, SCOOP_EVENTS - specials.length);
  const regulars = within(WEEK, "regular").sort(order).slice(0, room);
  const ages = (p: Program) => [
    ...new Set(
      p.branches.flatMap((b) => b.rows.flatMap((r) => r.data.ages?.tags ?? [])),
    ),
  ];
  const free = (p: Program) =>
    p.branches.every((b) => b.rows.every((r) => isFree(r.data)));
  return [
    ...specials.map(({ r, next, p }) => ({
      slug: r.slug,
      href: `/events/${r.slug}`,
      title: r.data.title,
      when: scoopWhen(next, today),
      town: p.branches.length > 1 ? placesLabel(p.branches) : r.data.venue.town,
      age: ageChip(ages(p)),
      free: free(p),
      regular: false,
      annual: p.annual,
      line: scoopLine(r.data.what, r.data.venue.name, lineBudget(r.data.title)),
      place: p.branches.length > 1 ? placesLabel(p.branches) : cardPlace(r),
      price: costChip(r.data),
      setting: r.data.setting ?? null,
    })),
    ...regulars.map(({ r, next, p }) => ({
      slug: r.slug,
      href: p.branches.length > 1 ? "/events#regulars" : `/events/${r.slug}`,
      title: p.title,
      when: `Next: ${scoopWhen(next, today)}`,
      town: p.branches.length > 1 ? placesLabel(p.branches) : r.data.venue.town,
      age: ageChip(ages(p)),
      free: free(p),
      regular: true,
      annual: false,
      line: scoopLine(r.data.what, r.data.venue.name, lineBudget(p.title)),
      place: p.branches.length > 1 ? placesLabel(p.branches) : cardPlace(r),
      price: free(p) ? "Free" : costChip(r.data),
      setting: r.data.setting ?? null,
    })),
  ];
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

// --- The issue row -----------------------------------------------------------

/**
 * The row under the weather: Thursday to Sunday of a sent issue's week,
 * its wheel pick ("This weekend's pick"); otherwise the latest issue.
 */
export function issueRow(
  issue: {
    issueDate: string;
    subject: string;
    pick: { slug: string; name: string } | null;
  },
  now: Date,
):
  | { kind: "pick"; pick: { slug: string; name: string }; issueDate: string }
  | { kind: "issue"; subject: string; issueDate: string } {
  return issue.pick && isThisWeekendsPick(issue.issueDate, now)
    ? { kind: "pick", pick: issue.pick, issueDate: issue.issueDate }
    : { kind: "issue", subject: issue.subject, issueDate: issue.issueDate };
}
