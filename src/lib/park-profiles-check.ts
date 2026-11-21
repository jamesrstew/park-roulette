import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { parkEvidenceChecks } from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import { fetchPage } from "@/lib/news/fetcher";
import {
  normalizeText,
  type Fetcher,
  type FetchResult,
} from "@/lib/news/validate";
import {
  allEvidence,
  liveProfiles,
  type ParkProfile,
  PROFILES,
  PROFILES_ERROR,
} from "./park-profiles";

/**
 * The monthly re-check of signature-trait evidence (data/park-profiles.json),
 * and the profiles as they stand after it.
 *
 * Every evidence page is fetched once a month: pages are spread over days
 * 1 to 28, a few a night, from the nightly events-check cron, in parallel
 * and inside the time it's given. Only a 200 without the quote, or a 404
 * or 410, is "missing": that trait drops out of posts, plans and park
 * pages until the data is fixed, and James hears about it (one email, at
 * most weekly, listing everything missing). Anything else (403, 429, a
 * timeout, a bot wall, 5xx, an empty or oversized page) is "unknown"; a
 * page unknown 2 monthly checks in a row is mentioned once.
 */

export const SPREAD_DAYS = 28;
/** Parallel fetches (mostly different hosts; each host sees 1 or 2). */
const PARALLEL = 4;
const ALERT_KEY = "park-profiles";
const WEEK_MIN = 7 * 24 * 60;

type Item = { slug: string; trait: string; quote: string };
export type EvidencePage = { url: string; items: Item[] };

/** Evidence pages (distinct URLs), sorted, with the quotes each must print. */
export function evidencePages(
  profiles: ReadonlyMap<string, ParkProfile> = PROFILES,
): EvidencePage[] {
  const by = new Map<string, Item[]>();
  for (const e of allEvidence(profiles)) {
    const list = by.get(e.url) ?? [];
    list.push({ slug: e.slug, trait: e.trait, quote: e.quote });
    by.set(e.url, list);
  }
  return [...by]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([url, items]) => ({ url, items }));
}

/** The pages due on a day of the month (29 to 31 check nothing). */
export function pagesForDay<T>(pages: readonly T[], dayOfMonth: number): T[] {
  if (dayOfMonth < 1 || dayOfMonth > SPREAD_DAYS) return [];
  return pages.filter((_, i) => i % SPREAD_DAYS === dayOfMonth - 1);
}

export type PageResult = {
  url: string;
  status: "ok" | "missing" | "unknown";
  /** Quotes the page no longer prints (status missing only). */
  missingQuotes: string[];
};

/** What one fetch says about a page's quotes. */
export function judge(page: EvidencePage, got: FetchResult | null): PageResult {
  const quotes = page.items.map((i) => i.quote);
  if (got && (got.status === 404 || got.status === 410))
    return { url: page.url, status: "missing", missingQuotes: quotes };
  // An empty 200 is a page we couldn't read (over 2 MB, or not HTML).
  if (!got || got.status !== 200 || got.blocked || got.unreachable || !got.text)
    return { url: page.url, status: "unknown", missingQuotes: [] };
  const gone = quotes.filter((q) => !got.text.includes(normalizeText(q)));
  return gone.length
    ? { url: page.url, status: "missing", missingQuotes: gone }
    : { url: page.url, status: "ok", missingQuotes: [] };
}

/** Fetch pages a few at a time; whatever isn't back by the deadline is unknown. */
export async function checkPages(
  pages: readonly EvidencePage[],
  fetcher: Fetcher,
  deadline: number,
): Promise<PageResult[]> {
  const out: PageResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pages.length) {
      const page = pages[next++];
      const left = deadline - Date.now();
      let got: FetchResult | null = null;
      let host = "";
      try {
        host = new URL(page.url).hostname.replace(/^www\./, "");
      } catch {
        // A bad URL can't be judged.
      }
      if (left > 0 && host) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        got = await Promise.race([
          fetcher(page.url, [host]).catch(() => null),
          new Promise<null>((r) => {
            timer = setTimeout(() => r(null), left);
          }),
        ]);
        clearTimeout(timer);
      }
      out.push(judge(page, got));
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return out;
}

export type CheckRow = {
  url: string;
  status: PageResult["status"];
  missingQuotes: string[];
  unknownStreak: number;
};

/** Where results live: Postgres, or a Map in tests. */
export type CheckStore = {
  load(urls: string[]): Promise<CheckRow[]>;
  save(rows: CheckRow[]): Promise<void>;
  all(): Promise<CheckRow[]>;
};

const asRow = (r: typeof parkEvidenceChecks.$inferSelect): CheckRow => ({
  url: r.url,
  status: r.status as CheckRow["status"],
  missingQuotes: r.missingQuotes,
  unknownStreak: r.unknownStreak,
});

export const dbStore: CheckStore = {
  async load(urls) {
    if (!urls.length) return [];
    const rows = await db
      .select()
      .from(parkEvidenceChecks)
      .where(inArray(parkEvidenceChecks.url, urls));
    return rows.map(asRow);
  },
  async save(rows) {
    for (const r of rows)
      await db
        .insert(parkEvidenceChecks)
        .values({ ...r, checkedAt: new Date() })
        .onConflictDoUpdate({
          target: parkEvidenceChecks.url,
          set: {
            status: r.status,
            missingQuotes: r.missingQuotes,
            unknownStreak: r.unknownStreak,
            checkedAt: new Date(),
          },
        });
  },
  async all() {
    return (await db.select().from(parkEvidenceChecks)).map(asRow);
  },
};

export type ProfileCheck = {
  checked: number;
  missing: { slug: string; trait: string; url: string }[];
  unknown: string[];
  /** Pages that just reached 2 unknown monthly checks in a row. */
  stuck: string[];
};

export async function recheckProfiles(
  dayOfMonth: number,
  {
    fetcher = fetchPage,
    profiles = PROFILES,
    store = dbStore,
    deadline = Date.now() + 60_000,
  }: {
    fetcher?: Fetcher;
    profiles?: ReadonlyMap<string, ParkProfile>;
    store?: CheckStore;
    deadline?: number;
  } = {},
): Promise<ProfileCheck> {
  const pages = evidencePages(profiles);
  const due = pagesForDay(pages, dayOfMonth);
  const results = await checkPages(due, fetcher, deadline);
  const before = new Map(
    (await store.load(due.map((p) => p.url))).map((r) => [r.url, r]),
  );
  const rows: CheckRow[] = results.map((r) => ({
    ...r,
    unknownStreak:
      r.status === "unknown" ? (before.get(r.url)?.unknownStreak ?? 0) + 1 : 0,
  }));
  await store.save(rows);

  const itemsOf = new Map(pages.map((p) => [p.url, p.items]));
  const out: ProfileCheck = {
    checked: due.length,
    missing: results.flatMap((r) =>
      (itemsOf.get(r.url) ?? [])
        .filter((i) => r.missingQuotes.includes(i.quote))
        .map((i) => ({ slug: i.slug, trait: i.trait, url: r.url })),
    ),
    unknown: results.filter((r) => r.status === "unknown").map((r) => r.url),
    stuck: rows.filter((r) => r.unknownStreak === 2).map((r) => r.url),
  };

  if (out.missing.length || out.stuck.length) {
    // One rolling email: everything missing now, not only tonight's.
    const missingNow = (await store.all()).filter(
      (r) => r.status === "missing",
    );
    const lines = missingNow.flatMap((r) =>
      (itemsOf.get(r.url) ?? [])
        .filter((i) => r.missingQuotes.includes(i.quote))
        .map((i) => `- ${i.slug}: ${i.trait} (${r.url})`),
    );
    alertLater({
      key: ALERT_KEY,
      subject: "Park signature traits need a look",
      text: [
        ...(lines.length
          ? [
              "These traits' evidence pages no longer print their quotes, so the traits are out of posts and plans until data/park-profiles.json is fixed:",
              ...lines,
            ]
          : []),
        ...(out.stuck.length
          ? [
              "These evidence pages couldn't be read 2 monthly checks in a row (bot wall, timeout or error). Their traits still count:",
              ...out.stuck.map((u) => `- ${u}`),
            ]
          : []),
      ].join("\n"),
      everyMinutes: WEEK_MIN,
    });
  }
  return out;
}

/** Evidence last seen missing, as `${url}\n${quote}` keys. */
export async function missingEvidence(
  store: CheckStore = dbStore,
): Promise<Set<string>> {
  const rows = await store.all();
  return new Set(
    rows
      .filter((r) => r.status === "missing")
      .flatMap((r) => r.missingQuotes.map((q) => `${r.url}\n${q}`)),
  );
}

/**
 * The profiles as they stand now: missing evidence and stale Google
 * traits dropped. A bundled file that didn't parse means none, and an
 * alert (CI's strict parse test is the gate; this never crashes a page).
 */
export async function currentProfiles(
  now: Date,
  store: CheckStore = dbStore,
): Promise<Map<string, ParkProfile>> {
  if (PROFILES_ERROR)
    alertLater({
      key: "park-profiles:parse",
      subject: "data/park-profiles.json didn't parse",
      text: `Park posts are off until it's fixed: ${PROFILES_ERROR}`,
      everyMinutes: 23 * 60,
    });
  const missing = await missingEvidence(store).catch((e) => {
    console.error("[profiles] couldn't read checks", (e as Error)?.message);
    return new Set<string>();
  });
  return liveProfiles(PROFILES, { missing, now });
}
