import "server-only";
import { db } from "@/db";
import { parkEvidenceChecks } from "@/db/schema";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { type Alert, type AlertOutcome, sendAlert } from "@/lib/alerts";
import { fetchPage } from "@/lib/news/fetcher";
import {
  normalizeText,
  type Fetcher,
  type FetchResult,
} from "@/lib/news/validate";
import {
  allEvidence,
  expiringSoon,
  liveProfiles,
  type ParkProfile,
  PROFILES,
  PROFILES_ERROR,
} from "./park-profiles";

/**
 * The monthly re-check of signature-trait evidence (data/park-profiles.json),
 * and the profiles as they stand after it.
 *
 * Every evidence page is fetched once a month (pages spread over days 1
 * to 28, a few a night, from the nightly events-check cron, in parallel
 * and inside the time it's given), and a page with a missing quote again
 * every night until it's settled. Only a 200 without the quote, or a 404
 * or 410, is a miss; anything else (403, 429, a timeout, a bot wall,
 * 5xx, an empty or oversized page) is "unknown" and changes nothing. A
 * trait drops out of posts, plans and park pages after 2 misses in a
 * row, and comes back the first time its quote is seen again. James gets
 * one rolling email (at most weekly) listing every dropped trait and
 * every page unknown 2 checks in a row (and, on the 1st, every
 * Google-sourced trait or glance that ages out within 30 days); a notice the weekly window
 * swallowed goes out with the next allowed email.
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
  missStreak: number;
  notifiedAt: Date | null;
};

/** Where results live: Postgres, or a Map in tests. */
export type CheckStore = {
  all(): Promise<CheckRow[]>;
  save(rows: CheckRow[]): Promise<void>;
};

const asRow = (r: typeof parkEvidenceChecks.$inferSelect): CheckRow => ({
  url: r.url,
  status: r.status as CheckRow["status"],
  missingQuotes: r.missingQuotes,
  unknownStreak: r.unknownStreak,
  missStreak: r.missStreak,
  notifiedAt: r.notifiedAt,
});

export const dbStore: CheckStore = {
  async all() {
    return (await db.select().from(parkEvidenceChecks)).map(asRow);
  },
  async save(rows) {
    for (const r of rows) {
      const set = {
        status: r.status,
        missingQuotes: r.missingQuotes,
        unknownStreak: r.unknownStreak,
        missStreak: r.missStreak,
        notifiedAt: r.notifiedAt,
        checkedAt: new Date(),
      };
      await db
        .insert(parkEvidenceChecks)
        .values({ url: r.url, ...set })
        .onConflictDoUpdate({ target: parkEvidenceChecks.url, set });
    }
  },
};

/** A trait drops after this many misses in a row. */
export const MISSES_TO_DROP = 2;
/** A page unknown this many checks in a row is mentioned. */
export const UNKNOWNS_TO_NOTE = 2;

const confirmed = (r: CheckRow) =>
  r.status === "missing" && r.missStreak >= MISSES_TO_DROP;
const stuck = (r: CheckRow) => r.unknownStreak >= UNKNOWNS_TO_NOTE;

/** Fold one check into the page's row. */
export function nextRow(prev: CheckRow | undefined, r: PageResult): CheckRow {
  if (r.status === "ok")
    return { ...r, unknownStreak: 0, missStreak: 0, notifiedAt: null };
  if (r.status === "missing") {
    const again =
      prev?.status === "missing" &&
      r.missingQuotes.some((q) => prev.missingQuotes.includes(q));
    return {
      ...r,
      unknownStreak: 0,
      missStreak: again ? prev.missStreak + 1 : 1,
      notifiedAt: again ? prev.notifiedAt : null,
    };
  }
  // Unknown says nothing about the quotes: a page already missing stays so.
  if (prev?.status === "missing")
    return { ...prev, unknownStreak: prev.unknownStreak + 1 };
  return {
    ...r,
    unknownStreak: (prev?.unknownStreak ?? 0) + 1,
    missStreak: 0,
    notifiedAt: prev?.status === "unknown" ? prev.notifiedAt : null,
  };
}

export type ProfileCheck = {
  checked: number;
  /** Tonight's misses (a trait drops at its second in a row). */
  missing: { slug: string; trait: string; url: string }[];
  /** Traits out of posts now. */
  dropped: { slug: string; trait: string; url: string }[];
  unknown: string[];
  /** Pages unknown 2 checks in a row or more. */
  stuck: string[];
  /** Google-sourced traits and glances aging out within 30 days. */
  expiring: { slug: string; what: string; until: string }[];
  /** What happened to the email, when one was due. */
  notice: AlertOutcome | null;
};

/** The night the email also lists what's about to age out. */
export const EXPIRY_DAY = 1;

export const PROFILES_TAG = "park-evidence";

function expireProfiles() {
  try {
    revalidateTag(PROFILES_TAG, { expire: 0 });
  } catch {
    // Scripts and tests: there's no cache to expire.
  }
}

export async function recheckProfiles(
  dayOfMonth: number,
  {
    fetcher = fetchPage,
    profiles = PROFILES,
    store = dbStore,
    deadline = Date.now() + 60_000,
    notify = sendAlert,
    now = new Date(),
  }: {
    fetcher?: Fetcher;
    profiles?: ReadonlyMap<string, ParkProfile>;
    store?: CheckStore;
    deadline?: number;
    notify?: (a: Alert) => Promise<AlertOutcome>;
    now?: Date;
  } = {},
): Promise<ProfileCheck> {
  const pages = evidencePages(profiles);
  const before = new Map((await store.all()).map((r) => [r.url, r]));
  // This night's share, plus every page with a miss (settle it quickly).
  const today = new Set(pagesForDay(pages, dayOfMonth).map((p) => p.url));
  const due = pages.filter(
    (p) => today.has(p.url) || before.get(p.url)?.status === "missing",
  );
  const results = await checkPages(due, fetcher, deadline);
  const rows = results.map((r) => nextRow(before.get(r.url), r));
  await store.save(rows);
  expireProfiles();

  const after = new Map(before);
  for (const r of rows) after.set(r.url, r);
  const itemsOf = new Map(pages.map((p) => [p.url, p.items]));
  const traitsOn = (r: CheckRow) =>
    (itemsOf.get(r.url) ?? [])
      .filter((i) => r.missingQuotes.includes(i.quote))
      .map((i) => ({ slug: i.slug, trait: i.trait, url: r.url }));
  const live = [...after.values()].filter((r) => itemsOf.has(r.url));
  const out: ProfileCheck = {
    checked: due.length,
    missing: results
      .filter((r) => r.status === "missing")
      .flatMap((r) => traitsOn(after.get(r.url)!)),
    dropped: live.filter(confirmed).flatMap(traitsOn),
    unknown: results.filter((r) => r.status === "unknown").map((r) => r.url),
    stuck: live.filter(stuck).map((r) => r.url),
    expiring: expiringSoon(profiles, now),
    notice: null,
  };

  // Email when something is due and not yet told; list everything open.
  // On the 1st, anything Google-sourced that ages out within 30 days too.
  const told = live.filter((r) => confirmed(r) || stuck(r));
  const expiryDue = dayOfMonth === EXPIRY_DAY && out.expiring.length > 0;
  if (told.some((r) => !r.notifiedAt) || expiryDue) {
    out.notice = await notify({
      key: ALERT_KEY,
      subject: "Park signature traits need a look",
      text: [
        ...(out.dropped.length
          ? [
              "These traits' evidence pages stopped printing their quotes (2 checks in a row), so the traits are out of posts and plans until the quote is back or data/park-profiles.json is fixed:",
              ...out.dropped.map((d) => `- ${d.slug}: ${d.trait} (${d.url})`),
            ]
          : []),
        ...(out.stuck.length
          ? [
              "These evidence pages couldn't be read 2 checks in a row or more (bot wall, timeout or error). Their traits still count:",
              ...out.stuck.map((u) => `- ${u}`),
            ]
          : []),
        ...(out.expiring.length
          ? [
              "These were written from Google's summaries and stop showing on their date unless they're re-checked against a fresh fetch (scripts/park-profiles/google-places.mjs) and re-dated:",
              ...out.expiring.map((e) => `- ${e.slug}: ${e.what} (${e.until})`),
            ]
          : []),
      ].join("\n"),
      everyMinutes: WEEK_MIN,
    }).catch((): AlertOutcome => "failed");
    if (out.notice === "sent") {
      const now = new Date();
      await store.save(told.map((r) => ({ ...r, notifiedAt: now })));
    }
  }
  return out;
}

/** Evidence dropped now (2 misses in a row), as `${url}\n${quote}` keys. */
export function droppedKeys(rows: readonly CheckRow[]): string[] {
  return rows
    .filter(confirmed)
    .flatMap((r) => r.missingQuotes.map((q) => `${r.url}\n${q}`));
}

/**
 * The dropped evidence, cached for hours (the cron expires it): a park
 * page view never reads the table. A read that fails counts nothing as
 * dropped, logged once per cache fill, not per view.
 */
async function cachedDropped(): Promise<string[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(PROFILES_TAG);
  try {
    return droppedKeys(await dbStore.all());
  } catch (e) {
    console.error("[profiles] couldn't read checks", (e as Error)?.message);
    return [];
  }
}

let parseAlerted = false;

/**
 * The profiles as they stand now: dropped evidence and stale Google
 * traits out. A bundled file that didn't parse means none, and one alert
 * per server (CI's strict parse test is the gate; pages never crash).
 */
export async function currentProfiles(
  now: Date,
  store?: CheckStore,
): Promise<Map<string, ParkProfile>> {
  if (PROFILES_ERROR && !parseAlerted) {
    parseAlerted = true;
    void sendAlert({
      key: "park-profiles:parse",
      subject: "data/park-profiles.json didn't parse",
      text: `Park posts are off until it's fixed: ${PROFILES_ERROR}`,
      everyMinutes: 23 * 60,
    }).catch(() => null);
  }
  const keys = store
    ? droppedKeys(await store.all())
    : // Outside Next (scripts, tests) there's no cache: read it directly.
      await cachedDropped().catch(() =>
        dbStore.all().then(droppedKeys, () => []),
      );
  return liveProfiles(PROFILES, { missing: new Set(keys), now });
}
