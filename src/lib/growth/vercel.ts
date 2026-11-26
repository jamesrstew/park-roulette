import type { Details, Metrics } from "./model";
/**
 * Vercel Web Analytics, read through its query API
 * (api.vercel.com/v1/query/web-analytics). The site already counts page
 * views and our custom events there with no cookies (components/
 * SiteAnalytics.tsx); this reads the totals back for the growth digest, so
 * nothing new is collected about anyone.
 *
 * Needs VERCEL_ANALYTICS_TOKEN (a Vercel access token) and
 * VERCEL_ANALYTICS_TEAM_ID; the project defaults to "park-roulette".
 * Unset: traffic shows as "not connected" in the digest's gaps.
 *
 * "Visitors" is Vercel's own unique count over the week. Its visitor code
 * resets daily, so someone who comes on several days can count more than
 * once; sources are counted the same way, per referrer.
 * Query strings never reach Vercel (lib/analytics-url.ts), so ?from= is
 * read from the "Arrived" event instead. Pure: config and fetch come in.
 */

export type VercelConfig = {
  token: string;
  teamId: string;
  projectId: string;
  fetchImpl?: typeof fetch;
};

export function vercelConfig(fetchImpl?: typeof fetch): VercelConfig | null {
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  const teamId = process.env.VERCEL_ANALYTICS_TEAM_ID;
  if (!token || !teamId) return null;
  return {
    token,
    teamId,
    projectId: process.env.VERCEL_ANALYTICS_PROJECT || "park-roulette",
    fetchImpl,
  };
}

const API = "https://api.vercel.com/v1/query/web-analytics";

export class VercelAnalyticsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Row = Record<string, string | number>;

async function query(
  c: VercelConfig,
  path: "visits/aggregate" | "events/aggregate",
  params: Record<string, string>,
): Promise<Row[]> {
  const q = new URLSearchParams({
    teamId: c.teamId,
    projectId: c.projectId,
    ...params,
  });
  let res: Response;
  try {
    res = await (c.fetchImpl ?? fetch)(`${API}/${path}?${q}`, {
      headers: { authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new VercelAnalyticsError(
      `Vercel didn't answer (${(e as Error)?.name ?? "error"})`,
      0,
    );
  }
  const json = (await res.json().catch(() => null)) as {
    data?: Row[];
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok || !json || !Array.isArray(json.data))
    throw new VercelAnalyticsError(
      `Vercel said ${res.status}: ${(json?.error?.code ?? "error").slice(0, 80)}`,
      res.status,
    );
  return json.data;
}

export type Traffic = {
  visitors: number;
  pageviews: number;
  /** Visitors by referring site ("" is direct or unknown). */
  referrers: { host: string; visitors: number; pageviews: number }[];
  /** Page views by path (query strings never reach Vercel). */
  paths: { path: string; visitors: number; pageviews: number }[];
  /** Custom events: name to {count, visitors}. */
  events: Record<string, { count: number; visitors: number }>;
  /** "Ask shown" by channel (email, text, both). */
  askShownBy: Record<string, number>;
  /** "Arrived" by from (ig, ig_dm, fb, email, text). */
  arrivedBy: Record<string, number>;
  /** Visitors per UTC day (for the web view's chart). */
  daily: { day: string; visitors: number; pageviews: number }[];
};

/** A count Vercel must have sent: a missing or odd one fails the source. */
function count(r: Row, key: string): number {
  const v = r[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
    throw new VercelAnalyticsError(`Vercel's answer has no ${key}`, 200);
  return v;
}

/** A dimension Vercel must have sent ("" is a real value: no referrer). */
function label(r: Row, key: string): string {
  const v = r[key];
  if (typeof v !== "string")
    throw new VercelAnalyticsError(`Vercel's answer has no ${key}`, 200);
  return v;
}

/** Vercel folds rows past `limit` into one "Others" row. */
export const OTHERS = "Others";

/**
 * Everything the digest reads from Vercel for [from, to). Any malformed
 * answer throws, so the digest shows the source as missing, never zeros.
 */
export async function readTraffic(
  c: VercelConfig,
  from: Date,
  to: Date,
): Promise<Traffic> {
  // A dimension keeps the exact hours (a time-only query snaps to UTC
  // days). The total comes from the one-value environment dimension, not
  // a sum over referrers (a visitor with two referrers would count twice).
  const range = {
    since: from.toISOString(),
    until: new Date(to.getTime() - 1000).toISOString(),
  };
  const [total, refs, paths, events, asks, arrived, daily] = await Promise.all([
    query(c, "visits/aggregate", { ...range, by: "environment" }),
    query(c, "visits/aggregate", {
      ...range,
      by: "referrerHostname",
      limit: "100",
    }),
    query(c, "visits/aggregate", { ...range, by: "requestPath", limit: "100" }),
    query(c, "events/aggregate", { ...range, by: "eventName", limit: "100" }),
    query(c, "events/aggregate", {
      ...range,
      by: "eventData/channel",
      filter: "eventName eq 'Ask shown'",
      limit: "10",
    }),
    query(c, "events/aggregate", {
      ...range,
      by: "eventData/from",
      filter: "eventName eq 'Arrived'",
      limit: "10",
    }),
    query(c, "visits/aggregate", { ...range, by: "day" }),
  ]);
  const prod = total.filter((r) => r.environment === "production");
  const byData = (rows: Row[], key: string) => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      // Vercel names the column "eventData/<key>" (or plain "eventData").
      const k =
        typeof r[key] === "string" ? String(r[key]) : label(r, "eventData");
      if (k && k !== OTHERS) out[k] = count(r, "count");
    }
    return out;
  };
  return {
    visitors: prod.reduce((n, r) => n + count(r, "visitors"), 0),
    pageviews: prod.reduce((n, r) => n + count(r, "pageviews"), 0),
    referrers: refs.map((r) => ({
      host: label(r, "referrerHostname"),
      visitors: count(r, "visitors"),
      pageviews: count(r, "pageviews"),
    })),
    paths: paths.map((r) => ({
      path: label(r, "requestPath"),
      visitors: count(r, "visitors"),
      pageviews: count(r, "pageviews"),
    })),
    events: Object.fromEntries(
      events
        .filter((r) => label(r, "eventName") !== OTHERS)
        .map((r) => [
          label(r, "eventName"),
          { count: count(r, "count"), visitors: count(r, "visitors") },
        ]),
    ),
    askShownBy: byData(asks, "eventData/channel"),
    arrivedBy: byData(arrived, "eventData/from"),
    daily: daily.map((r) => ({
      day: label(r, "timestamp").slice(0, 10),
      visitors: count(r, "visitors"),
      pageviews: count(r, "pageviews"),
    })),
  };
}

/** Where a referring host belongs. Pure. */
export type SourceKey =
  | "bulletin"
  | "instagram"
  | "facebook"
  | "google"
  | "other_search"
  | "other_site"
  | "direct";

export function sourceOf(host: string): SourceKey {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (!h) return "direct";
  // Vercel folds the long tail into one "Others" row.
  if (h === "others") return "other_site";
  if (h === "parkroulette.quest" || h.endsWith(".parkroulette.quest"))
    return "direct";
  if (h === "bendbulletin.com" || h.endsWith(".bendbulletin.com"))
    return "bulletin";
  if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
  if (/(^|\.)facebook\.com$/.test(h) || h === "fb.com" || h === "fb.me")
    return "facebook";
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return "google";
  if (
    /(^|\.)(bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|startpage\.com)$/.test(
      h,
    )
  )
    return "other_search";
  return "other_site";
}

/** Path groups for the "where they went" table. Pure. */
export function pathGroup(path: string): string {
  const p = path.split("?")[0].toLowerCase();
  if (p === "/" || p === "") return "Home and wheel";
  if (p.startsWith("/events")) return "Events";
  if (p.startsWith("/guides") || p.startsWith("/playgrounds")) return "Guides";
  if (p.startsWith("/parks") || p.startsWith("/map") || p.startsWith("/list"))
    return "Parks and map";
  if (p.startsWith("/towns")) return "Towns";
  if (p.startsWith("/news") || p.startsWith("/newsletter"))
    return "News and newsletter";
  if (p.startsWith("/texts")) return "Texts page";
  if (p.startsWith("/social") || p.startsWith("/ig")) return "Social link page";
  if (
    p.startsWith("/passport") ||
    p.startsWith("/me") ||
    p.startsWith("/start") ||
    p.startsWith("/join")
  )
    return "Passport and sign-in";
  if (p.startsWith("/admin")) return "Admin";
  return "Other";
}

/** Vercel's numbers into the snapshot. Pure (exported for tests). */
export function applyTraffic(t: Traffic, metrics: Metrics, details: Details) {
  metrics.visitors = t.visitors;
  metrics.pageviews = t.pageviews;
  const sources: Record<string, number> = {
    bulletin: 0,
    instagram: 0,
    facebook: 0,
    google: 0,
    other_search: 0,
    other_site: 0,
    direct: 0,
  };
  for (const r of t.referrers) sources[sourceOf(r.host)] += r.visitors;
  for (const [k, v] of Object.entries(sources)) metrics[`src_${k}`] = v;
  details.sources = sources;
  details.referrers = t.referrers
    .filter((r) => r.host && r.host !== OTHERS)
    .slice(0, 12)
    .map((r) => ({ host: r.host, visitors: r.visitors }));
  const groups = new Map<string, { visitors: number; pageviews: number }>();
  for (const p of t.paths) {
    const g = groups.get(pathGroup(p.path)) ?? { visitors: 0, pageviews: 0 };
    g.visitors += p.visitors;
    g.pageviews += p.pageviews;
    groups.set(pathGroup(p.path), g);
  }
  details.pathGroups = [...groups]
    .map(([group, v]) => ({ group, ...v }))
    .sort((a, b) => b.pageviews - a.pageviews);
  // Family invite codes never reach Vercel (lib/analytics-url.ts); admin
  // pages stay out of the list anyway.
  details.topPaths = t.paths
    .filter((p) => !p.path.startsWith("/admin") && p.path !== OTHERS)
    .slice(0, 15);
  details.daily = t.daily;
  details.events = Object.fromEntries(
    Object.entries(t.events).map(([k, v]) => [k, v.count]),
  );
  details.askShownBy = t.askShownBy;
  details.arrivedBy = t.arrivedBy;
  metrics.spins = t.events.Spin?.count ?? 0;
  metrics.code_requested = t.events["Code requested"]?.count ?? 0;
  metrics.arrived_social =
    (t.arrivedBy.ig ?? 0) + (t.arrivedBy.ig_dm ?? 0) + (t.arrivedBy.fb ?? 0);
}
