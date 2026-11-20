/**
 * Air quality for the weekend's tiers (lib/news/tiers.ts), from AirNow
 * (airnowapi.org, a free key in AIRNOW_API_KEY, sent as a query
 * parameter). Without the key, or when AirNow doesn't answer, this returns
 * nothing and the tiers fall back to NWS Air Quality Alerts and Dense
 * Smoke Advisories (fetched with the other alerts).
 *
 * AirNow retired /aq/forecast/latLong/ and the /aq/observation/latLong/
 * services on September 30, 2026 (its June 2026 API update). We use the
 * replacements, which take latitude and longitude but no date or distance
 * and answer in camelCase:
 *   /aq/forecast/current/             dateValid, parameterName, aqi
 *   /aq/observation/current/ziplatlong/  dateObserved, nowcastAQI
 * Older field names (DateForecast, AQI) are read too. Neither has been
 * called with a real key from here yet: check the first plan's log.
 *
 *   forecast  the highest AQI forecast for each date (PM2.5 or ozone);
 *             AirNow doesn't forecast every area every day, so Saturday
 *             and Sunday are often missing on a Thursday.
 *   observed  the highest AQI observed now (Thursday morning): the smoke
 *             fallback when a day has no forecast (smoke spells last days
 *             to weeks). Wednesday's daily value needs the historical
 *             service, whose parameters aren't public yet (v2).
 */

export const AIRNOW = "https://www.airnowapi.org";
const BEND = { lat: 44.0582, lng: -121.3153 };

type ForecastRow = {
  dateValid?: string;
  DateForecast?: string;
  parameterName?: string;
  aqi?: number;
  AQI?: number;
};
type ObservationRow = {
  dateObserved?: string;
  nowcastAQI?: number;
  aqi?: number;
  AQI?: number;
};

export type AirQuality = {
  /** YYYY-MM-DD -> the highest AQI forecast that day. */
  forecast: Record<string, number>;
  /** The highest AQI observed Wednesday or Thursday so far, or null. */
  observed: number | null;
  source: "airnow" | "none";
};

const NONE: AirQuality = { forecast: {}, observed: null, source: "none" };

async function get<T>(
  path: string,
  params: Record<string, string>,
  key: string,
  fetchImpl: typeof fetch,
): Promise<T[]> {
  const url = new URL(path, AIRNOW);
  for (const [k, v] of Object.entries({
    format: "application/json",
    latitude: String(BEND.lat),
    longitude: String(BEND.lng),
    ...params,
    API_KEY: key,
  }))
    url.searchParams.set(k, v);
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`AirNow ${res.status}`);
  const json = (await res.json()) as unknown;
  return Array.isArray(json) ? (json as T[]) : [];
}

/** "2026-12-03 " or "2026-12-03" -> "2026-12-03". */
const day = (s: string) => s.trim().slice(0, 10);

/** Highest AQI per date; AirNow's -1 means "no number". */
export function forecastByDay(
  rows: readonly ForecastRow[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const aqi = r.aqi ?? r.AQI;
    const date = r.dateValid ?? r.DateForecast;
    if (typeof aqi !== "number" || aqi < 0 || !date) continue;
    const d = day(date);
    out[d] = Math.max(out[d] ?? 0, aqi);
  }
  return out;
}

export function maxObserved(rows: readonly ObservationRow[]): number | null {
  const n = rows
    .map((r) => r.nowcastAQI ?? r.aqi ?? r.AQI)
    .filter((a): a is number => typeof a === "number" && a >= 0);
  return n.length ? Math.max(...n) : null;
}

/**
 * The air quality the plan needs on `issueDate` (a Thursday): the
 * forecast from today on, and what is observed now. Never throws.
 */
export async function airQuality(
  issueDate: string,
  opts: { key?: string; fetchImpl?: typeof fetch } = {},
): Promise<AirQuality> {
  const key = opts.key ?? process.env.AIRNOW_API_KEY;
  if (!key) return NONE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const [forecast, now] = await Promise.all([
    get<ForecastRow>("/aq/forecast/current/", {}, key, fetchImpl)
      .then(forecastByDay)
      .catch((e) => {
        console.warn("[news] AirNow forecast failed", (e as Error).message);
        return null;
      }),
    get<ObservationRow>(
      "/aq/observation/current/ziplatlong/",
      {},
      key,
      fetchImpl,
    )
      .then(maxObserved)
      .catch(() => null),
  ]);
  // No rows at all (AirNow answered, but with nothing) is no data too.
  if (!Object.keys(forecast ?? {}).length && now == null) return NONE;
  // Only today's and later forecasts count.
  const ahead = Object.fromEntries(
    Object.entries(forecast ?? {}).filter(([d]) => d >= issueDate),
  );
  return { forecast: ahead, observed: now, source: "airnow" };
}
