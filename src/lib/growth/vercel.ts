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
 * "Visitors" is Vercel's count: a browser is one visitor per day (its hash
 * rotates daily), so over a week a family that came on 3 days counts 3.
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

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** Everything the digest reads from Vercel for [from, to). */
export async function readTraffic(
  c: VercelConfig,
  from: Date,
  to: Date,
): Promise<Traffic> {
  // A dimension keeps the exact hours; a time-only query snaps to UTC days.
  const range = {
    since: from.toISOString(),
    until: new Date(to.getTime() - 1000).toISOString(),
  };
  const [refs, paths, events, asks, arrived, daily] = await Promise.all([
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
  const referrers = refs.map((r) => ({
    host: String(r.referrerHostname ?? ""),
    visitors: num(r.visitors),
    pageviews: num(r.pageviews),
  }));
  const byData = (rows: Row[], key: string) =>
    Object.fromEntries(
      rows
        .map((r) => [String(r[key] ?? r.eventData ?? ""), num(r.count)])
        .filter(([k]) => k !== ""),
    ) as Record<string, number>;
  return {
    visitors: referrers.reduce((n, r) => n + r.visitors, 0),
    pageviews: referrers.reduce((n, r) => n + r.pageviews, 0),
    referrers,
    paths: paths.map((r) => ({
      path: String(r.requestPath ?? ""),
      visitors: num(r.visitors),
      pageviews: num(r.pageviews),
    })),
    events: Object.fromEntries(
      events.map((r) => [
        String(r.eventName ?? ""),
        { count: num(r.count), visitors: num(r.visitors) },
      ]),
    ),
    askShownBy: byData(asks, "eventData/channel"),
    arrivedBy: byData(arrived, "eventData/from"),
    daily: daily.map((r) => ({
      day: String(r.timestamp ?? "").slice(0, 10),
      visitors: num(r.visitors),
      pageviews: num(r.pageviews),
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
    .filter((r) => r.host)
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
    .filter((p) => !p.path.startsWith("/admin"))
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
