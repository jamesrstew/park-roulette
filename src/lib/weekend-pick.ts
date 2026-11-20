import { isGsm7, septets, toGsmAscii } from "./texts";

/**
 * Weekend Pick, the Friday text: the generator and the send-window rules,
 * pure (code only, no model, no new facts). The text is the decision
 * itself: the week's featured park from the SENT issue, its town, a few
 * kid-fit words from its own database record, and a weather word only
 * when the issue's forecast and Friday's fresh forecast agree.
 *
 *   Park Roulette: Weekend Pick: {hook} {Park}, {Town}. {fit}.
 *   https://parkroulette.quest/w/{code} Reply STOP to opt out
 *
 * The link is our own short link (/w/{code}, the park's id in base 36):
 * it redirects to the park page and counts taps per issue.
 */

export const SITE = "https://parkroulette.quest";
export const MAX_CHARS = 160;
export const PREFIX = "Park Roulette: Weekend Pick:";
export const SUFFIX = "Reply STOP to opt out";
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
/** Confirmations: any day, 8 am to 5 pm Pacific, and 8 am to 8 pm local. */
export const CONFIRM_WINDOW = { from: 8, to: 17 };
/** The recipient's local window: 8 am to 8 pm. */
export const LOCAL_WINDOW = { from: 8, to: 20 };
/** Two sends in a row with STOP above this rate pause the texts. */
export const STOP_RATE_LIMIT = 0.01;

/** A park's short-link code: its id in base 36 ("3f"). */
export function parkCode(id: number): string {
  return id.toString(36);
}

/** The park id a short-link code names, or null for anything else. */
export function parkIdFromCode(code: string): number | null {
  if (!/^[0-9a-z]{1,4}$/.test(code)) return null;
  const id = parseInt(code, 36);
  return Number.isSafeInteger(id) && id > 0 && parkCode(id) === code
    ? id
    : null;
}

/** news_clicks' key for Weekend Pick taps (per issue, next to /n/ links). */
export const WEEKEND_PICK_CLICK = "weekend-pick-text";

/** The text's link: /w/{code}. */
export function shortLink(id: number): string {
  return `${SITE}/w/${parkCode(id)}`;
}

export type ParkFacts = {
  id: number;
  name: string;
  city: string;
  slug: string;
  features: readonly string[];
  status: string;
};

export type Hook = "Sunny weekend?" | "Snowy weekend?" | null;

/**
 * The text: with the weather word if it fits, else without it (a weather
 * word never costs the week its text). Null when neither fits.
 */
export function weekendText(
  park: ParkFacts,
  hook: Hook,
  month: number,
): string | null {
  return (
    (hook ? composeText(park, hook, month) : null) ??
    composeText(park, null, month)
  );
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

/**
 * The text, or null when nothing fits (no fit word fits in 160
 * characters, the park is closed, or a check fails): then skip and alert.
 * Fit words go in, in order, while the whole still fits.
 */
export function composeText(
  park: ParkFacts,
  hook: Hook,
  month: number,
): string | null {
  if (park.status !== "active") return null;
  if (!/^[a-z0-9-]+$/.test(park.slug)) return null;
  const url = shortLink(park.id);
  // Curly quotes and dashes in a name would make the text Unicode (70 a
  // segment): plain ASCII instead.
  const name = toGsmAscii(park.name);
  const city = toGsmAscii(park.city);
  const head = `${PREFIX} ${hook ? `${hook} ` : ""}${name}, ${city}.`;
  const build = (fit: string[]) =>
    `${head} ${fit.map((w, i) => (i ? w.toLowerCase() : w)).join(", ")}. ${url} ${SUFFIX}`;
  const fit: string[] = [];
  for (const w of fitWords(park.features, month)) {
    if (septets(build([...fit, w])) <= MAX_CHARS) fit.push(w);
  }
  if (!fit.length) return null;
  const text = build(fit);
  return textProblems(text) ? null : text;
}

/**
 * The dry run's text: "[Dry run] " in front only when the whole still fits
 * in one segment, so "Reply STOP to opt out" is never cut off.
 */
export function dryRunText(text: string): string {
  const marked = `[Dry run] ${text}`;
  return septets(marked) <= MAX_CHARS ? marked : text;
}

/**
 * Why a text can't go, or null: GSM-7, length in septets (one segment),
 * prefix, suffix, one link.
 */
export function textProblems(text: string): string | null {
  if (!isGsm7(text)) return "not GSM-7";
  if (septets(text) > MAX_CHARS) return "over 160 characters";
  if (!text.startsWith("Park Roulette:")) return "doesn't start with the brand";
  if (!text.endsWith(SUFFIX)) return "doesn't end with the STOP line";
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  if (
    urls.length !== 1 ||
    !/^https:\/\/parkroulette\.quest\/w\/[0-9a-z]{1,4}$/.test(urls[0])
  )
    return "needs exactly one link, our short link to a park";
  return null;
}

/**
 * The weather word: only when the issue's Saturday and Friday's fresh
 * Saturday forecast both say it. A fresh forecast can remove a weather
 * word, never add one. "Sunny" means a sunny or clear sky ("Partly Sunny"
 * isn't), and never with rain, snow, cold (35 or under) or smoke.
 */
export function hookFor(
  issueSaturday: { icon: string } | null,
  freshSaturday: { short: string; labels: readonly string[] } | null,
): Hook {
  if (!issueSaturday || !freshSaturday) return null;
  const fresh = freshSaturday.short.trim().toLowerCase();
  const has = (l: string) => freshSaturday.labels.includes(l);
  if (issueSaturday.icon === "snow" && has("snow") && !has("smoke"))
    return "Snowy weekend?";
  if (
    issueSaturday.icon === "sun" &&
    /^(mostly )?(sunny|clear)$/.test(fresh) &&
    !["rain", "storm", "snow", "cold", "smoke"].some(has)
  )
    return "Sunny weekend?";
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

/** Pause when the last two completed sends both ran above 1% STOP. */
export function guardrailTrips(rates: readonly number[]): boolean {
  return (
    rates.length >= 2 && rates.slice(0, 2).every((r) => r > STOP_RATE_LIMIT)
  );
}
