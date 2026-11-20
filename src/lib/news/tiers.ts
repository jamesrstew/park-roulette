/**
 * Weather and season v1 (spec: /tmp/pr-news/weather-season/spec.md, the
 * "(critic)" versions): each counted day gets a tier from the NWS text
 * forecast (shortForecast, detailedForecast, high, chance of rain or snow),
 * NWS alerts (each checked against 9 am to 5 pm that day) and the AirNow
 * air quality forecast, with observed AQI as the smoke fallback. Pure, so
 * tests can pin any forecast.
 *
 *   fine         nothing to say (a dry 40°F winter day needs no comment)
 *   plan_around  one "Dress for it" or "Good to know" line
 *   disruptive   opens the gate: the issue gets an Indoor pick
 *
 * v1 reads the text forecast, which gives one daytime period (6 am to
 * 6 pm): durations ("gusts of 40 mph for 3 hours", "6 of 8 hours at 70%")
 * come with v2's hourly gridpoint data. Until then the text forecast's own
 * wording stands in, as noted at each rule. Missing data never makes a day
 * disruptive; a fallback source is not missing data.
 */

export type Tier = "fine" | "plan_around" | "disruptive";

export type Hazard =
  "snow" | "ice" | "rain" | "wind" | "smoke" | "heat" | "cold" | "thunder";

/** Which source decided a finding (logged with every issue). */
export type Source = "text" | "alert" | "airnow" | "airnow_observed";

export type Finding = { hazard: Hazard; why: string; source: Source };

/** One NWS text-forecast period (api.weather.gov /forecast). */
export type TextPeriod = {
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  windSpeed?: string;
  windGust?: string | null;
  shortForecast: string;
  detailedForecast?: string;
  probabilityOfPrecipitation?: { value: number | null } | null;
};

/** One NWS alert (api.weather.gov /alerts/active?point=). */
export type Alert = {
  event: string;
  onset: string | null;
  ends: string | null;
  expires: string | null;
};

export type DayTier = {
  date: string;
  /** "Saturday" */
  day: string;
  tier: Tier;
  /** What made it disruptive (empty unless it is). */
  disruptive: Finding[];
  /** What makes it plan-around (empty for fine days). */
  plan_around: Finding[];
  high: number | null;
  pop: number | null;
  short: string | null;
  /** The upper end of the forecast snow amount, inches (0 when none said). */
  snow_in: number;
  /** The forecast snow amount as printed ("4 to 6 inches"), if any. */
  snow_text: string | null;
  /** The highest gust the forecast names, mph. */
  gust_mph: number | null;
  /** The sustained wind's upper end, mph ("20 to 30 mph" -> 30). */
  wind_mph: number | null;
  /** The AirNow forecast AQI for the day (null when there is none). */
  aqi: number | null;
  /** The AQI observed now (the smoke fallback), or null. */
  aqi_observed: number | null;
};

/** Thresholds (the critic's). */
export const T = {
  snowIn: 4,
  icePop: 40,
  rainPop: 70,
  gustDisruptive: 40,
  gustPlanAround: 25,
  aqiDisruptive: 101,
  aqiPlanAround: 51,
  heat: 95,
  warm: 88,
  extremeCold: 19,
  cold: 35,
  windChillDisruptive: 0,
  windChillPlanAround: 15,
  snowPopPlanAround: 30,
  thunderPop: 30,
} as const;

const DISRUPTIVE_ALERTS: [RegExp, Hazard][] = [
  [/^(winter storm (watch|warning)|blizzard warning)$/i, "snow"],
  [/^ice storm warning$/i, "ice"],
  [/^(high wind (watch|warning)|wind advisory)$/i, "wind"],
  [/^(air quality alert|dense smoke advisory)$/i, "smoke"],
  [
    /^(heat advisory|extreme heat (watch|warning)|excessive heat (watch|warning))$/i,
    "heat",
  ],
  [
    /^(cold weather advisory|extreme cold (watch|warning)|wind chill (advisory|warning|watch))$/i,
    "cold",
  ],
];
/** Alerts that only make a day plan-around. */
const PLAN_AROUND_ALERTS: [RegExp, Hazard][] = [
  [/^winter weather advisory$/i, "snow"],
  [/^freeze (watch|warning)$/i, "cold"],
];

/**
 * The moment a Pacific wall-clock time happens on a date (handles PST and
 * PDT): 9 am and 5 pm bound the day we judge.
 */
export function pacificAt(date: string, hour: number): number {
  const [y, m, d] = date.split("-").map(Number);
  for (const offset of [7, 8]) {
    const t = Date.UTC(y, m - 1, d, hour + offset);
    const h = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date(t)),
    );
    if (h === hour) return t;
  }
  return Date.UTC(y, m - 1, d, hour + 8);
}

/** Does the alert cover any of 9 am to 5 pm Pacific that day? */
export function alertCovers(a: Alert, date: string): boolean {
  const from = pacificAt(date, 9);
  const to = pacificAt(date, 17);
  const start = a.onset ? Date.parse(a.onset) : -Infinity;
  // With no end time, a watch, warning or air quality alert runs 48
  // hours from its onset (its `expires` is when the message is replaced,
  // not when the hazard ends).
  const long = /\b(watch|warning)\b|^air quality alert$/i.test(a.event.trim());
  const end = a.ends
    ? Date.parse(a.ends)
    : long && a.onset
      ? Date.parse(a.onset) + 48 * 3_600_000
      : a.expires
        ? Date.parse(a.expires)
        : Infinity;
  return start < to && end > from;
}

/** "10 to 20 mph" or "20 mph" -> 20 (the upper end). */
export function mphMax(s: string | null | undefined): number | null {
  const n = (s?.match(/\d+/g) ?? []).map(Number);
  return n.length ? Math.max(...n) : null;
}

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|zero|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;

/** "around an inch", "0.5 to 1 inch", "less than half an inch" -> inches. */
export function amountIn(phrase: string): number | null {
  const p = phrase.toLowerCase();
  if (/less than (a half|half)/.test(p)) return 0.5;
  const nums = [...p.matchAll(new RegExp(`\\b${NUMBER}\\b`, "g"))]
    .map((m) => m[0])
    .filter((w) => !(w === "a" && /\ba half\b/.test(p)))
    .map((w) => (w in WORD_NUMBERS ? WORD_NUMBERS[w] : Number(w)))
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return Math.max(...nums);
}

/**
 * The snow amount the text forecast states, upper end ("New snow
 * accumulation of 3 to 5 inches possible" counts as 5; "snow and sleet
 * accumulation of 2 to 4 inches" as 4; "around an inch" as 1; "less than
 * half an inch" as 0.5). Null when it states none ("Little or no snow
 * accumulation expected").
 */
export function snowAmount(
  detailed: string,
): { inches: number; text: string } | null {
  const d = detailed.replace(/\s+/g, " ");
  let best: { inches: number; text: string } | null = null;
  for (const m of d.matchAll(
    /\b(?:snow(?: and sleet)?|sleet) accumulation of ((?:[^.]|\.(?=\d))*?inch(?:es)?)/gi,
  )) {
    const inches = amountIn(m[1]);
    if (inches != null && (!best || inches > best.inches))
      best = { inches, text: m[1] };
  }
  return best;
}

/**
 * Ice only when the forecast states an amount ("New ice accumulation of
 * around 0.1 of an inch possible"). "Little or no ice accumulation
 * expected" is not ice.
 */
export function iceAmountStated(detailed: string): boolean {
  return /\bice accumulation of\b/i.test(detailed);
}

/** "gusts as high as 40 mph" -> 40 (the text forecast's peak gust). */
export function gustFromText(detailed: string): number | null {
  const all = [
    ...detailed.matchAll(/gusts? (?:as high as|up to|to) (\d+) mph/gi),
  ];
  return all.length ? Math.max(...all.map((m) => Number(m[1]))) : null;
}

/** "Wind chill values as low as -5" -> -5; "as low as zero" -> 0. */
export function windChillFromText(detailed: string): number | null {
  const all = [
    ...detailed.matchAll(
      /wind chill values? (?:as low as|between) (-?\d+|zero)/gi,
    ),
  ];
  return all.length
    ? Math.min(
        ...all.map((m) => (m[1].toLowerCase() === "zero" ? 0 : Number(m[1]))),
      )
    : null;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function dayName(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * One day's tier. `aqi.forecast` is AirNow's forecast for the day;
 * `aqi.observed` the daily AQI observed Wednesday or Thursday morning (the
 * smoke fallback when there's no forecast for the day).
 */
export function dayTier(input: {
  date: string;
  periods: readonly TextPeriod[];
  alerts: readonly Alert[];
  aqi?: { forecast: number | null; observed: number | null };
}): DayTier {
  const { date } = input;
  const day = input.periods.find(
    (p) => p.isDaytime && p.startTime.slice(0, 10) === date,
  );
  const dis: Finding[] = [];
  const around: Finding[] = [];
  const add = (list: Finding[], hazard: Hazard, why: string, source: Source) =>
    list.push({ hazard, why, source });

  // Alerts, each checked against 9 am to 5 pm that day.
  for (const a of input.alerts) {
    if (!alertCovers(a, date)) continue;
    const d = DISRUPTIVE_ALERTS.find(([re]) => re.test(a.event.trim()));
    if (d) add(dis, d[1], a.event, "alert");
    const p = PLAN_AROUND_ALERTS.find(([re]) => re.test(a.event.trim()));
    if (p) add(around, p[1], a.event, "alert");
  }

  const short = day?.shortForecast ?? null;
  const detailed = day?.detailedForecast ?? "";
  const words = `${short ?? ""} ${detailed}`.toLowerCase();
  const pop = day?.probabilityOfPrecipitation?.value ?? null;
  const high = day ? Math.round(day.temperature) : null;
  const snow = day ? snowAmount(detailed) : null;
  const gust = day
    ? Math.max(
        gustFromText(detailed) ?? 0,
        mphMax(day.windGust ?? null) ?? 0,
      ) || null
    : null;
  const sustained = day ? mphMax(day.windSpeed) : null;
  const chill = day ? windChillFromText(detailed) : null;

  if (day) {
    // Snow: 4 inches or more (the upper end of the range) is disruptive;
    // less, with a 30% chance or more, is plan-around ("Chance Light Snow"
    // at 20% is Fine).
    const snowWords = /snow|flurr|sleet|wintry|blizzard/.test(words);
    if (snow && snow.inches >= T.snowIn)
      add(dis, "snow", `${snow.text} of snow`, "text");
    else if (snowWords && (pop ?? 0) >= T.snowPopPlanAround)
      add(around, "snow", `${short} (${pop}%)`, "text");

    // Ice: any ice accumulation, or freezing rain or drizzle at 40% or more.
    // Freezing fog never counts.
    const freezingRain = /freezing (rain|drizzle)/.test(words);
    const iceAccum = iceAmountStated(detailed);
    if (iceAccum || (freezingRain && (pop ?? 0) >= T.icePop))
      add(
        dis,
        "ice",
        iceAccum ? "ice accumulation" : `${short} (${pop}%)`,
        "text",
      );

    // Rain: v1 proxy for "70% or more for 6 of 8 hours, no 3-hour window
    // under 40%": steady rain (not showers or a chance) at 70% or more,
    // with no "before", "after" or "then" break in the day's words.
    const rainWords = /\brain\b|showers|drizzle/.test(words) && !freezingRain;
    const steady =
      /\brain\b/.test(short?.toLowerCase() ?? "") &&
      !/showers|chance|slight|before|after|then|mainly|isolated|scattered/.test(
        (short ?? "").toLowerCase(),
      ) &&
      // The detailed words can show a break the short ones don't ("Rain
      // likely, mainly after 11am").
      !/\b(before|after|then|mainly)\b/i.test(detailed);
    if (rainWords && steady && (pop ?? 0) >= T.rainPop)
      add(dis, "rain", `${short} (${pop}%)`, "text");
    else if (rainWords && (pop ?? 0) >= 30)
      add(around, "rain", `${short} (${pop}%)`, "text");

    // Wind: gusts of 40 mph or more. The text forecast names a gust only
    // when it is the day's story; v2 checks the 3-hour duration hourly.
    if (gust != null && gust >= T.gustDisruptive)
      add(dis, "wind", `gusts to ${gust} mph`, "text");
    else if (
      (gust != null && gust >= T.gustPlanAround) ||
      (sustained != null && sustained >= T.gustPlanAround)
    )
      add(
        around,
        "wind",
        `wind to ${Math.max(gust ?? 0, sustained ?? 0)} mph`,
        "text",
      );

    // Heat and cold, from the day's high and the wind chill it names.
    if (high != null && high >= T.heat)
      add(dis, "heat", `a high of ${high}`, "text");
    else if (high != null && high >= T.warm)
      add(around, "heat", `a high of ${high}`, "text");
    if (high != null && high <= T.extremeCold)
      add(dis, "cold", `a high of ${high}`, "text");
    else if (chill != null && chill <= T.windChillDisruptive)
      add(dis, "cold", `wind chill to ${chill}`, "text");
    else if (high != null && high <= T.cold)
      add(around, "cold", `a high of ${high}`, "text");
    else if (chill != null && chill <= T.windChillPlanAround)
      add(around, "cold", `wind chill to ${chill}`, "text");

    // Afternoon thunder at 30% or more.
    if (/thunder|t-storm/.test(words) && (pop ?? 0) >= T.thunderPop)
      add(around, "thunder", `${short} (${pop}%)`, "text");
  }

  // Smoke: the AirNow forecast, else the observed fallback (101 or more
  // observed Wednesday or Thursday, and the NWS still names smoke or haze).
  const aqiF = input.aqi?.forecast ?? null;
  const aqiO = input.aqi?.observed ?? null;
  if (aqiF != null) {
    if (aqiF >= T.aqiDisruptive)
      add(dis, "smoke", `AQI forecast ${aqiF}`, "airnow");
    else if (aqiF >= T.aqiPlanAround)
      add(around, "smoke", `AQI forecast ${aqiF}`, "airnow");
  } else if (
    aqiO != null &&
    aqiO >= T.aqiDisruptive &&
    /smoke|haze/.test(words)
  )
    add(
      dis,
      "smoke",
      `AQI observed ${aqiO}, and the forecast names smoke`,
      "airnow_observed",
    );

  const tier: Tier = dis.length
    ? "disruptive"
    : around.length
      ? "plan_around"
      : "fine";
  return {
    date,
    day: dayName(date),
    tier,
    disruptive: dis,
    // A plan-around trigger the disruption already covers isn't news.
    plan_around: dis.length ? [] : around,
    high,
    pop,
    short,
    snow_in: snow?.inches ?? 0,
    snow_text: snow?.text ?? null,
    gust_mph: gust,
    wind_mph: sustained,
    aqi: aqiF,
    aqi_observed: aqiO,
  };
}

/** The gate: any disruptive counted day (Bend) adds an Indoor pick. */
export function gateOpen(days: readonly DayTier[]): boolean {
  return days.some((d) => d.tier === "disruptive");
}

/**
 * The best time to go on a disruptive weekend: the first counted day that
 * isn't disruptive, with a window for the season ("Sunday, 10 am to 1
 * pm"), or "the first clear morning" when every day is out.
 */
export function bestSlot(days: readonly DayTier[], month: number): string {
  const ok = days.find((d) => d.tier !== "disruptive");
  if (!ok) return "the first clear morning";
  const hot = ok.high != null && ok.high >= T.warm;
  const winter = month >= 11 || month <= 3;
  const window = hot
    ? "8 to 11 am"
    : winter
      ? "11 am to 2 pm"
      : "10 am to 1 pm";
  return `${ok.day}, ${window}`;
}

/** Hazards that rule out a covered (open-sided) venue. */
export const NEEDS_INDOOR: readonly Hazard[] = [
  "smoke",
  "wind",
  "ice",
  "cold",
  "heat",
];
/** Hazards that keep the pick within 15 minutes of downtown Bend. */
export const ROAD_HAZARDS: readonly Hazard[] = ["snow", "ice"];

/** Subject words Dec to Feb can't use unless a day is disruptive. */
export const WINTER_SUBJECT_WORDS = /\b(cold|chilly|freezing|bundle)\b/i;
