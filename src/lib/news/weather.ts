import type { WeatherLabel } from "./catalog";
import { conditionFromNws } from "@/components/news/WeatherCard";
import type { ForecastDay } from "./issue";
import type { DayWeather } from "./plan-types";
import { addDays, shortDay } from "./time";
import type { Alert } from "./tiers";

/**
 * The forecast for Bend, Redmond, Sisters and La Pine from the National
 * Weather Service (api.weather.gov, free, no key, but a User-Agent with a
 * contact is required), plus each town's active alerts. Turned into plain
 * labels and tiers (tiers.ts) the plan and validator share. Bend gates the
 * Indoor pick; the other towns are computed and shown, never gated on
 * (Sisters and La Pine sit in the East Slopes zone, which snows more).
 */

export const TOWNS: Record<string, [number, number]> = {
  Bend: [44.0582, -121.3153],
  Redmond: [44.2726, -121.1739],
  Sisters: [44.291, -121.5492],
  "La Pine": [43.6704, -121.5036],
};

export const NWS_USER_AGENT =
  "ParkRoulette/1.0 (parkroulette.quest, hello@parkroulette.quest)";

type Period = {
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  windSpeed?: string;
  windGust?: string | null;
  shortForecast: string;
  detailedForecast?: string;
  probabilityOfPrecipitation?: { value: number | null } | null;
};

/** "10 to 20 mph" -> 20 */
function maxWind(s: string | undefined): number {
  return Math.max(0, ...(s?.match(/\d+/g) ?? []).map(Number));
}

/** Labels for one daytime forecast period. Clear and mild gets none. */
export function labelPeriod(p: Period): WeatherLabel[] {
  const f = p.shortForecast.toLowerCase();
  const pop = p.probabilityOfPrecipitation?.value ?? 0;
  const out = new Set<WeatherLabel>();
  // "Slight chance" (under 30%) isn't a plan changer; freezing fog isn't snow.
  const unlikely = /slight chance/.test(f) && pop < 30;
  const snow = !unlikely && /snow|flurr|sleet|wintry|blizzard/.test(f);
  if (snow) out.add("snow");
  if (!snow && !unlikely && (/rain|shower|drizzle/.test(f) || pop >= 60))
    out.add("rain");
  if (/thunder|t-storm/.test(f)) out.add("storm");
  if (maxWind(p.windSpeed) >= 20 || /wind|breezy|gust/.test(f)) out.add("wind");
  if (p.isDaytime && p.temperature <= 35) out.add("cold");
  if (p.isDaytime && p.temperature >= 88) out.add("hot");
  if (/smoke|haze/.test(f)) out.add("smoke");
  return [...out];
}

const LONG_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * The weekend ahead for the email: Friday, Saturday and Sunday in Bend
 * (the daytime period's sky, high and chance of rain or snow, and that
 * night's low), in the weather card's words and icons. A day NWS hasn't
 * forecast yet is marked missing; null when none of the three is there.
 */
export function weekendForecast(
  issueDate: string,
  periods: Period[] | undefined,
): ForecastDay[] | null {
  if (!periods) return null;
  const days = [1, 2, 3].map((i) => {
    const date = addDays(issueDate, i);
    const day = periods.find(
      (p) => p.isDaytime && p.startTime.slice(0, 10) === date,
    );
    const night = periods.find(
      (p) => !p.isDaytime && p.startTime.slice(0, 10) === date,
    );
    const [y, m, d] = date.split("-").map(Number);
    const label = LONG_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    if (!day)
      return {
        date,
        label,
        condition: "",
        icon: "cloudy" as const,
        high: null,
        low: null,
        precip: null,
        missing: true,
      };
    const precip = day.probabilityOfPrecipitation?.value ?? null;
    return {
      date,
      label,
      ...conditionFromNws(day.shortForecast, precip),
      high: Math.round(day.temperature),
      low: night ? Math.round(night.temperature) : null,
      precip,
    };
  });
  return days.some((d) => !d.missing) ? days : null;
}

/** Thursday to Sunday of the issue's week, from each town's periods. */
export function daysFrom(
  issueDate: string,
  byTown: Record<string, Period[]>,
): DayWeather[] {
  return [0, 1, 2, 3].map((i) => {
    const date = addDays(issueDate, i);
    const towns: DayWeather["towns"] = {};
    for (const [town, periods] of Object.entries(byTown)) {
      const day = periods.find(
        (p) => p.isDaytime && p.startTime.slice(0, 10) === date,
      );
      const night = periods.find(
        (p) => !p.isDaytime && p.startTime.slice(0, 10) === date,
      );
      if (!day && !night) continue;
      towns[town] = {
        high: day?.temperature ?? null,
        low: night?.temperature ?? null,
        short: (day ?? night)!.shortForecast,
        labels: day ? labelPeriod(day) : [],
      };
    }
    const labels = [
      ...new Set(Object.values(towns).flatMap((t) => t.labels)),
    ] as WeatherLabel[];
    return { date, day: shortDay(date).slice(0, 3), towns, labels };
  });
}

async function getJson(url: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": NWS_USER_AGENT, accept: "application/geo+json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  return res.json();
}

/** Every town's forecast periods. A town that fails is left out. */
export async function fetchForecast(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, Period[]>> {
  const out: Record<string, Period[]> = {};
  await Promise.all(
    Object.entries(TOWNS).map(async ([town, [lat, lng]]) => {
      try {
        const point = await getJson(
          `https://api.weather.gov/points/${lat},${lng}`,
          fetchImpl,
        );
        const forecast = await getJson(
          point.properties.forecast as string,
          fetchImpl,
        );
        out[town] = forecast.properties.periods as Period[];
      } catch (e) {
        console.warn(
          `[news] forecast for ${town} failed`,
          (e as Error).message,
        );
      }
    }),
  );
  return out;
}

/**
 * Every town's active NWS alerts (event, onset, ends, expires). A town
 * that fails is left out; tiers.ts checks each alert against 9 am to 5 pm
 * of the day it judges.
 */
export async function fetchAlerts(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, Alert[]>> {
  const out: Record<string, Alert[]> = {};
  await Promise.all(
    Object.entries(TOWNS).map(async ([town, [lat, lng]]) => {
      try {
        const json = await getJson(
          `https://api.weather.gov/alerts/active?point=${lat},${lng}`,
          fetchImpl,
        );
        out[town] = (
          (json.features ?? []) as { properties: Record<string, unknown> }[]
        ).map(({ properties: p }) => ({
          event: String(p.event ?? ""),
          onset:
            (p.onset as string | null) ??
            (p.effective as string | null) ??
            null,
          ends: (p.ends as string | null) ?? null,
          expires: (p.expires as string | null) ?? null,
        }));
      } catch (e) {
        console.warn(`[news] alerts for ${town} failed`, (e as Error).message);
      }
    }),
  );
  return out;
}
