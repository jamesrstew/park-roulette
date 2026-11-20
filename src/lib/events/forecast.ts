import "server-only";
import { cacheLife } from "next/cache";
import { milesBetween } from "@/lib/geo";
import { NWS_USER_AGENT } from "@/lib/news/weather";

/**
 * Weather for event pages: the National Weather Service forecast for the
 * town nearest the venue (Bend, Redmond, Sisters, La Pine, Madras,
 * Prineville, Sunriver), daily and hourly, cached for an hour. Within 7
 * days only. Evening events use the hourly forecast at the start time,
 * since a daily high is wrong for a tree lighting.
 */
export const FORECAST_TOWNS: Record<string, [number, number]> = {
  Bend: [44.0582, -121.3153],
  Redmond: [44.2726, -121.1739],
  Sisters: [44.291, -121.5492],
  "La Pine": [43.6704, -121.5036],
  Madras: [44.6335, -121.1295],
  Prineville: [44.2999, -120.8345],
  Sunriver: [43.884, -121.4386],
};

export type Period = {
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  shortForecast: string;
  probabilityOfPrecipitation?: { value: number | null } | null;
};

export function nearestTown(
  point: { lat: number; lng: number } | null,
  fallback: string,
): string {
  if (!point) return FORECAST_TOWNS[fallback] ? fallback : "Bend";
  let best = "Bend";
  let d = Infinity;
  for (const [t, [lat, lng]] of Object.entries(FORECAST_TOWNS)) {
    const m = milesBetween(point, { lat, lng });
    if (m < d) {
      d = m;
      best = t;
    }
  }
  return best;
}

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: { "user-agent": NWS_USER_AGENT, accept: "application/geo+json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  return res.json();
}

/** A town's daily and hourly periods, or null when NWS doesn't answer. */
export async function townForecast(
  town: string,
): Promise<{ daily: Period[]; hourly: Period[] } | null> {
  "use cache";
  cacheLife("hours");
  const at = FORECAST_TOWNS[town];
  if (!at) return null;
  try {
    const point = await getJson(
      `https://api.weather.gov/points/${at[0]},${at[1]}`,
    );
    const [daily, hourly] = await Promise.all([
      getJson(point.properties.forecast as string),
      getJson(point.properties.forecastHourly as string),
    ]);
    return {
      daily: daily.properties.periods as Period[],
      hourly: hourly.properties.periods as Period[],
    };
  } catch (e) {
    console.warn(`[events] forecast for ${town} failed`, (e as Error).message);
    return null;
  }
}

/** "snow likely", lowercased NWS words. */
const words = (p: Period) => p.shortForecast.toLowerCase();

/**
 * The weather line for one date: "Saturday in Bend: high 34°, snow
 * likely" by day, or "4:30 pm in Sisters: 30°, clear" for an evening
 * start (5 pm or later). Null past the forecast.
 */
export function weatherFor(
  f: { daily: Period[]; hourly: Period[] } | null,
  town: string,
  day: string,
  start: string | undefined,
  dayName: string,
  clockText: string | null,
): { line: string; cold: boolean; wet: boolean } | null {
  if (!f) return null;
  if (start && start >= "17:00") {
    const hh = start.slice(0, 2);
    const h = f.hourly.find((p) => p.startTime.slice(0, 13) === `${day}T${hh}`);
    if (h)
      return {
        line: `${clockText} in ${town}: ${Math.round(h.temperature)}°, ${words(h)}`,
        cold: h.temperature <= 35,
        wet: /rain|snow|shower|sleet/.test(words(h)),
      };
  }
  const d = f.daily.find(
    (p) => p.isDaytime && p.startTime.slice(0, 10) === day,
  );
  if (!d) return null;
  return {
    line: `${dayName} in ${town}: high ${Math.round(d.temperature)}°, ${words(d)}`,
    cold: d.temperature <= 35,
    wet: /rain|snow|shower|sleet/.test(words(d)),
  };
}
