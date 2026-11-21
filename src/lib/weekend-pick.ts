import type { ForecastDay } from "./news/issue";
import type { Tier } from "./news/tiers";
import { isGsm7, septets, toGsmAscii } from "./texts";

/**
 * Weekend Pick, the Friday text: the generator and the send-window rules,
 * pure (code only, no model, no new facts). The text gives the weekend in
 * words and links to this week's issue page, whose link preview carries
 * the picture (spec: /tmp/pr-news/batch6/texts-spec.md):
 *
 *   Park Roulette: {weather}. {plan}. {fit}. Reply STOP to opt out.
 *   https://parkroulette.quest/w/{code}
 *
 * {weather} comes from the issue's frozen forecast (the weather card's
 * own data). When Friday's fresh forecast flips a Saturday or Sunday into
 * or out of the disruptive tier, the text starts "Update:" and uses the
 * fresh forecast. {plan} is "Go Saturday: {Park}, {Town}" for the better
 * day, or "Indoor pick: {Venue}, {Town}" when both days are disruptive.
 * The link goes last: iMessage builds a rich preview only for a link at
 * the start or end, and carriers need the STOP wording, not its position.
 *
 * {code} is the issue date as YYMMDD in base 36 (always 4 characters);
 * /w/ sends it to /newsletter/{date}. Park codes from older texts are 1
 * to 3 characters and still work.
 */

export const SITE = "https://parkroulette.quest";
export const MAX_CHARS = 160;
export const BRAND = "Park Roulette:";
export const STOP_LINE = "Reply STOP to opt out.";
/**
 * At most this many Weekend Picks a number gets in a calendar month: the
 * "up to 5 a month" we promise. With one pick a Friday it can't bind
 * today (no month has six Fridays); it's here so a second kind of
 * program text would be counted against the promise too.
 */
export const MONTHLY_CAP = 5;
/**
 * Program sends: Friday, 3:30 pm to 5 pm Pacific (after pickup, when
 * families plan). 5 pm Pacific is 8 pm Eastern, so the window sits
 * inside 8 am to 8 pm local everywhere in the US, Hawaii included, with
 * no area-code guessing. Anything unsent by 5 pm is skipped for the week.
 */
export const START = { hour: 15, minute: 30 };
export const END = { hour: 17, minute: 0 };
/**
 * The backlog of held confirmations (yeses collected while confirmations
 * were off): any day, 8 am to 5 pm Pacific, and 8 am to 8 pm local. A
 * confirmation answering a fresh yes goes at once, at any hour.
 */
export const CONFIRM_WINDOW = { from: 8, to: 17 };
/** The recipient's local window: 8 am to 8 pm. */
export const LOCAL_WINDOW = { from: 8, to: 20 };
/** A send counts toward the guardrail above this STOP rate... */
export const STOP_RATE_LIMIT = 0.01;
/** ...with at least this many STOPs of its own. */
export const STOP_MIN = 3;

// --- Short links -------------------------------------------------------------

/** A park's short-link code, from older texts: its id in base 36 ("3f"). */
export function parkCode(id: number): string {
  return id.toString(36);
}

/**
 * The park id an old text's code names (1 to 3 characters), or null.
 * Four characters is always an issue date (dateFromCode).
 */
export function parkIdFromCode(code: string): number | null {
  if (!/^[0-9a-z]{1,3}$/.test(code)) return null;
  const id = parseInt(code, 36);
  return Number.isSafeInteger(id) && id > 0 && parkCode(id) === code
    ? id
    : null;
}

/** An issue date's code: YYMMDD in base 36 (2026-12-10 is "5lju"). */
export function dateCode(issueDate: string): string {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(issueDate))
    throw new Error(`Not an issue date: ${issueDate}`);
  const [y, m, d] = issueDate.split("-");
  const code = Number(`${y.slice(2)}${m}${d}`).toString(36);
  if (code.length !== 4)
    throw new Error(`No 4-character code for ${issueDate}`);
  return code;
}

/** The issue date a 4-character code names, or null. */
export function dateFromCode(code: string): string | null {
  if (!/^[0-9a-z]{4}$/.test(code)) return null;
  const n = parseInt(code, 36);
  if (n < 100_000 || n > 991_231) return null;
  const s = String(n);
  const date = `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  const t = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== date)
    return null;
  return dateCode(date) === code ? date : null;
}

/** news_clicks' key for taps on old park links (/w/{park code}). */
export const WEEKEND_PICK_CLICK = "weekend-pick-text";
/** news_clicks' key for the issue page's beacon from a text (?src=text). */
export const WEEKEND_PICK_TAP = "weekend-pick-tap";

/** The text's link: /w/{date code}. */
export function issueLink(issueDate: string): string {
  return `${SITE}/w/${dateCode(issueDate)}`;
}

// --- The words ---------------------------------------------------------------

export type ParkFacts = {
  id: number;
  name: string;
  city: string;
  slug: string;
  features: readonly string[];
  status: string;
};

/** One weekend day as the text says it: "Snow", 29. */
export type TextDay = { date: string; word: string; high: number };

/**
 * The text's weather word for a card condition: the card's own word,
 * shortened where a text reads better ("Mostly sunny" is "Sunny").
 */
export function weatherWord(condition: string): string {
  const c = condition.trim().toLowerCase();
  const map: Record<string, string> = {
    "mostly sunny": "Sunny",
    sunny: "Sunny",
    "partly sunny": "Partly sunny",
    "mostly cloudy": "Cloudy",
    cloudy: "Cloudy",
    "snow showers": "Snow",
    blizzard: "Snow",
    foggy: "Fog",
  };
  return map[c] ?? (c ? c[0].toUpperCase() + c.slice(1) : "");
}

/** Saturday and Sunday of the issue's card, skipping a missing day. */
export function textDays(
  days: readonly ForecastDay[] | undefined,
  issueDate: string,
): TextDay[] {
  const weekend = [addDays(issueDate, 2), addDays(issueDate, 3)];
  return weekend.flatMap((date) => {
    const d = days?.find((x) => x.date === date);
    if (!d || d.missing || d.high == null) return [];
    const word = weatherWord(d.condition);
    return word ? [{ date, word, high: d.high }] : [];
  });
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

function addDays(date: string, n: number): string {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * "Sunny Sat and Sun, 47 and 49" or "Snow Sat, 29. Sunny Sun, 36"; short:
 * "Sat rain and snow 33, Sun partly sunny 41". Null with no days.
 */
export function weatherWords(
  days: readonly TextDay[],
  short = false,
): string | null {
  const [a, b] = days;
  if (!a) return null;
  const dayA = DAY_SHORT[weekday(a.date)];
  if (!b)
    return short
      ? `${dayA} ${a.word.toLowerCase()} ${a.high}`
      : `${a.word} ${dayA}, ${a.high}`;
  const dayB = DAY_SHORT[weekday(b.date)];
  if (a.word === b.word)
    return `${a.word} ${dayA} and ${dayB}, ${a.high} and ${b.high}`;
  return short
    ? `${dayA} ${a.word.toLowerCase()} ${a.high}, ${dayB} ${b.word.toLowerCase()} ${b.high}`
    : `${a.word} ${dayA}, ${a.high}. ${b.word} ${dayB}, ${b.high}`;
}

/**
 * Kid-fit words, in order. "Fenced toddler area" needs both; a splash pad
 * only counts May to September.
 */
export function fitWords(features: readonly string[], month: number): string[] {
  const f = new Set(features);
  const out: string[] = [];
  if (f.has("toddler_area") && f.has("fenced")) out.push("Fenced toddler area");
  else if (f.has("toddler_area")) out.push("Toddler area");
  const rest: [string, string][] = [
    ["baby_swings", "Baby swings"],
    ["swings", "Swings"],
    ["slides", "Slides"],
    ["spinny", "Spinny things"],
    ["climbing", "Big kid climbing"],
    ["accessible", "Accessible play"],
    ["splash_pad", "Splash pad"],
    ["restrooms", "Restrooms"],
    ["trail", "Walking trail"],
  ];
  for (const [key, words] of rest) {
    if (!f.has(key)) continue;
    if (key === "splash_pad" && (month < 5 || month > 9)) continue;
    out.push(words);
  }
  return out;
}

// --- The plan ----------------------------------------------------------------

export type TextPlan =
  | {
      kind: "park";
      /** The date of the day to go (Saturday or Sunday). */
      date: string;
      name: string;
      city: string;
      fit: readonly string[];
    }
  | { kind: "indoor"; name: string; city: string };

const RANK: Record<Tier, number> = { fine: 0, plan_around: 1, disruptive: 2 };

/**
 * A day's tier when the issue's plan has none stored (issues from before
 * the tiers): rain, snow or storms at 40% or more and smoke count as
 * disruptive for picking the day only. Never opens the Indoor pick.
 */
export function roughTier(d: ForecastDay | undefined): Tier {
  if (!d || d.missing) return "fine";
  if (d.icon === "smoke") return "disruptive";
  if (["rain", "snow", "mixed", "storm"].includes(d.icon))
    return (d.precip ?? 0) >= 40 ? "disruptive" : "plan_around";
  if (["cloudy", "fog", "wind"].includes(d.icon)) return "plan_around";
  return "fine";
}

/** The day to go: the better tier, Saturday on a tie. */
export function betterDay(
  saturday: string,
  tiers: Partial<Record<string, Tier>>,
): string {
  const sunday = addDays(saturday, 1);
  const r = (d: string) => RANK[tiers[d] ?? "fine"];
  return r(sunday) < r(saturday) ? sunday : saturday;
}

/**
 * Did Friday's forecast flip a weekend day into or out of disruptive?
 * Only days both forecasts cover count (missing data never decides).
 */
export function tierFlipped(
  issue: Partial<Record<string, Tier>> | null,
  fresh: Partial<Record<string, Tier>> | null,
  dates: readonly string[],
): boolean {
  if (!issue || !fresh) return false;
  return dates.some((d) => {
    const a = issue[d];
    const b = fresh[d];
    return !!a && !!b && (a === "disruptive") !== (b === "disruptive");
  });
}

// --- The text ----------------------------------------------------------------

export type WeekInput = {
  /** The issue's Thursday. */
  issueDate: string;
  /** The issue's frozen forecast (weekend_ahead.days). */
  days: readonly ForecastDay[] | undefined;
  /** Bend's tiers by date from the issue's plan, or null (older issues). */
  tiers: Partial<Record<string, Tier>> | null;
  /** The featured park (approved), or null. */
  park: ParkFacts | null;
  /** The issue's Indoor pick venue, if it ran one. */
  indoor: { name: string; city: string } | null;
  /** Friday's fresh forecast for Bend, when it could be fetched. */
  fresh?: {
    days: readonly TextDay[];
    tiers: Partial<Record<string, Tier>>;
  } | null;
};

export type WeekText = {
  text: string;
  /** "Snow Sat, 29. Sunny Sun, 36" when Friday's forecast changed the plan. */
  update: string | null;
  /** The plan the text names (the page follows it on an Update week). */
  plan: { kind: "park"; date: string } | { kind: "indoor" };
};

/** A name for a text: ASCII, no parenthetical ("Gym (Bend)" is "Gym"). */
export function textName(name: string): string {
  return toGsmAscii(name)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The week's text, or null when nothing fits (then skip and alert James;
 * the full-catalog test keeps that from happening with real names).
 */
export function weekendText(input: WeekInput): WeekText | null {
  const saturday = addDays(input.issueDate, 2);
  const weekend = [saturday, addDays(saturday, 1)];
  const update = tierFlipped(input.tiers, input.fresh?.tiers ?? null, weekend);
  const frozen = textDays(input.days, input.issueDate);
  // Friday's forecast wins where it has a day; the issue's fills the gaps.
  const days = update
    ? weekend.flatMap((d) => {
        const x =
          input.fresh?.days.find((f) => f.date === d) ??
          frozen.find((f) => f.date === d);
        return x ? [x] : [];
      })
    : frozen;
  const rough = Object.fromEntries(
    weekend.map((d) => [d, roughTier(input.days?.find((x) => x.date === d))]),
  );
  const tiers: Partial<Record<string, Tier>> = update
    ? { ...input.tiers, ...input.fresh!.tiers }
    : (input.tiers ?? rough);
  // The Indoor pick needs real tiers: both days disruptive.
  const indoorWeek =
    !!input.indoor &&
    (update || !!input.tiers) &&
    weekend.every((d) => tiers[d] === "disruptive");
  const link = issueLink(input.issueDate);
  const done = (text: string | null, plan: TextPlan): WeekText | null =>
    text
      ? {
          text,
          update: update ? (weatherWords(days) ?? "") : null,
          plan:
            plan.kind === "park"
              ? { kind: "park", date: plan.date }
              : { kind: "indoor" },
        }
      : null;
  if (indoorWeek && input.indoor) {
    const plan: TextPlan = {
      kind: "indoor",
      name: textName(input.indoor.name),
      city: textName(input.indoor.city),
    };
    const text = composeText({ update, days, plan, link });
    // An Indoor pick that can't fit falls back to the park.
    if (text) return done(text, plan);
  }
  if (
    !input.park ||
    input.park.status !== "active" ||
    !/^[a-z0-9-]+$/.test(input.park.slug)
  )
    return null;
  const date = betterDay(saturday, tiers);
  const plan: TextPlan = {
    kind: "park",
    date,
    name: textName(input.park.name),
    city: textName(input.park.city),
    fit: fitWords(input.park.features, Number(date.slice(5, 7))),
  };
  return done(composeText({ update, days, plan, link }), plan);
}

/**
 * The shortening steps, in order: drop fit words (they go in only while
 * the whole fits), then the short weather, then "Go Sat:", then drop the
 * town, then the other day's weather, then all the weather. Null when
 * even that is too long.
 */
const STEPS = [
  { short: false, abbrev: false, town: true, weather: "both" },
  { short: true, abbrev: false, town: true, weather: "both" },
  { short: true, abbrev: true, town: true, weather: "both" },
  { short: true, abbrev: true, town: false, weather: "both" },
  { short: true, abbrev: true, town: false, weather: "plan_day" },
  { short: true, abbrev: true, town: false, weather: "none" },
] as const;

export function composeText(x: {
  update: boolean;
  days: readonly TextDay[];
  plan: TextPlan;
  link: string;
}): string | null {
  const { plan } = x;
  // The day the plan is for keeps its weather longest (Saturday indoors).
  const planDay = plan.kind === "park" ? plan.date : (x.days[0]?.date ?? "");
  for (const step of STEPS) {
    const shown =
      step.weather === "both"
        ? x.days
        : step.weather === "plan_day"
          ? x.days.filter((d) => d.date === planDay)
          : [];
    const weather = weatherWords(shown, step.short);
    const head = `${BRAND} ${x.update ? "Update: " : ""}${weather ? `${weather}. ` : ""}`;
    const where = step.town ? `${plan.name}, ${plan.city}` : plan.name;
    const what =
      plan.kind === "indoor"
        ? `Indoor pick: ${where}`
        : `Go ${(step.abbrev ? DAY_SHORT : DAY_LONG)[weekday(plan.date)]}: ${where}`;
    const build = (fit: readonly string[]) =>
      `${head}${what}.${fit.length ? ` ${fit.map((w, i) => (i ? w.toLowerCase() : w)).join(", ")}.` : ""} ${STOP_LINE} ${x.link}`;
    const fit: string[] = [];
    if (plan.kind === "park")
      for (const w of plan.fit)
        if (septets(build([...fit, w])) <= MAX_CHARS) fit.push(w);
    const text = build(fit);
    if (!textProblems(text)) return text;
  }
  return null;
}

/**
 * The dry run's text: "[Dry run] " in front only when the whole still fits
 * in one segment, so the STOP line and the link are never cut off.
 */
export function dryRunText(text: string): string {
  const marked = `[Dry run] ${text}`;
  return septets(marked) <= MAX_CHARS ? marked : text;
}

/**
 * Why a text can't go, or null: GSM-7, length in septets (one segment),
 * the brand first, the STOP line, and exactly one link, our short link to
 * an issue, at the very end.
 */
export function textProblems(text: string): string | null {
  if (!isGsm7(text)) return "not GSM-7";
  if (septets(text) > MAX_CHARS) return "over 160 characters";
  if (!text.startsWith(BRAND)) return "doesn't start with the brand";
  if (!text.includes(STOP_LINE)) return "doesn't carry the STOP line";
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  if (
    urls.length !== 1 ||
    !/^https:\/\/parkroulette\.quest\/w\/[0-9a-z]{4}$/.test(urls[0])
  )
    return "needs exactly one link, our short link to the issue";
  if (!text.endsWith(` ${urls[0]}`)) return "the link must come last";
  if (text.indexOf(STOP_LINE) > text.indexOf(urls[0]))
    return "the STOP line must come before the link";
  return null;
}

// --- When a number may get its text ----------------------------------------

/**
 * Oregon, Washington, California and Nevada area codes. A few edges are on
 * Mountain time (Malheur County in 541/458, West Wendover in 775): an hour
 * later, still inside 8 am to 8 pm for 8 am to 5 pm Pacific.
 */
const PACIFIC_AREA_CODES = new Set([
  "503",
  "541",
  "458",
  "971",
  "206",
  "253",
  "360",
  "425",
  "509",
  "564",
  "209",
  "213",
  "279",
  "310",
  "323",
  "341",
  "350",
  "369",
  "408",
  "415",
  "424",
  "442",
  "510",
  "530",
  "559",
  "562",
  "619",
  "626",
  "628",
  "650",
  "657",
  "661",
  "669",
  "707",
  "714",
  "747",
  "760",
  "805",
  "818",
  "820",
  "831",
  "837",
  "840",
  "858",
  "909",
  "916",
  "925",
  "949",
  "951",
  "702",
  "725",
  "775",
]);

/** Every US time zone: a number we can't place must be inside all of them. */
export const US_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

/**
 * The zones a number may be in, for confirmations: Pacific for an Oregon,
 * Washington, California or Nevada area code; otherwise every US zone (so
 * the window holds wherever it is).
 */
export function zonesFor(phone: string): string[] {
  const area = phone.replace(/^\+1/, "").slice(0, 3);
  return PACIFIC_AREA_CODES.has(area) ? ["America/Los_Angeles"] : US_ZONES;
}

function local(now: Date, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday as string,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Is it Friday, 3:30 pm to 5 pm Pacific (the program window)? */
export function windowOpen(now: Date): boolean {
  const pt = local(now, "America/Los_Angeles");
  return (
    pt.weekday === "Fri" &&
    pt.minutes >= START.hour * 60 + START.minute &&
    pt.minutes < END.hour * 60 + END.minute
  );
}

/** Past 5 pm Pacific Friday (or the weekend): the week's window is gone. */
export function windowMissed(now: Date): boolean {
  const pt = local(now, "America/Los_Angeles");
  return (
    (pt.weekday === "Fri" && pt.minutes >= END.hour * 60 + END.minute) ||
    pt.weekday === "Sat" ||
    pt.weekday === "Sun"
  );
}

/** Too early on Friday for the program window: nothing to do yet. */
export function beforeWindow(now: Date): boolean {
  const pt = local(now, "America/Los_Angeles");
  return pt.weekday === "Fri" && pt.minutes < START.hour * 60 + START.minute;
}

/**
 * May this number get its confirmation now? Any day, 8 am to 5 pm
 * Pacific, and 8 am to 8 pm in every zone the number may be in (a Hawaii
 * or East Coast number waits for its own morning).
 */
export function confirmWindowOpen(phone: string, now: Date): boolean {
  const pt = local(now, "America/Los_Angeles");
  if (pt.minutes < CONFIRM_WINDOW.from * 60) return false;
  if (pt.minutes >= CONFIRM_WINDOW.to * 60) return false;
  return zonesFor(phone).every((z) => {
    const l = local(now, z);
    return (
      l.minutes >= LOCAL_WINDOW.from * 60 && l.minutes < LOCAL_WINDOW.to * 60
    );
  });
}

/** A send's STOP rate: stops after it over the numbers it reached. */
export function stopRate(sent: number, stops: number): number {
  return sent ? stops / sent : 0;
}

/** One completed send: the numbers it reached and the STOPs after it. */
export type SendStops = { sent: number; stops: number };

/**
 * Pause after two sends in a row where each, on its own, had at least 3
 * STOPs AND more than 1%: on a small list one or two STOPs are already
 * over 1%, and that alone shouldn't stop the program.
 */
export function guardrailTrips(sends: readonly SendStops[]): boolean {
  const last = sends.slice(0, 2);
  return (
    last.length === 2 &&
    last.every(
      (s) => s.stops >= STOP_MIN && stopRate(s.sent, s.stops) > STOP_RATE_LIMIT,
    )
  );
}
