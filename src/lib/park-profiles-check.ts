import "server-only";
import { alertLater } from "@/lib/alerts";
import { fetchPage } from "@/lib/news/fetcher";
import { normalizeText, type Fetcher } from "@/lib/news/validate";
import { allEvidence, type ParkProfile, PROFILES } from "./park-profiles";

/**
 * The monthly re-check of signature-trait evidence (data/park-profiles.json).
 * Every evidence page is fetched once a month: the pages are spread over
 * days 1 to 28 of the month, a few a day, so the nightly events-check cron
 * that runs it never runs long. A page that loads without its quote is a
 * trait to fix by hand (James gets an email); timeouts, bot walls and 5xx
 * say nothing and are only logged.
 */

export const SPREAD_DAYS = 28;

/** Evidence pages (distinct URLs), sorted, with the quotes each must print. */
export function evidencePages(
  profiles: ReadonlyMap<string, ParkProfile> = PROFILES,
): { url: string; items: { slug: string; trait: string; quote: string }[] }[] {
  const by = new Map<
    string,
    { slug: string; trait: string; quote: string }[]
  >();
  for (const e of allEvidence(profiles)) {
    const list = by.get(e.url) ?? [];
    list.push({ slug: e.slug, trait: e.trait, quote: e.quote });
    by.set(e.url, list);
  }
  return [...by]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([url, items]) => ({ url, items }));
}

/** The pages due on a day of the month (1 to 31; 29 to 31 check nothing). */
export function pagesForDay<T>(pages: readonly T[], dayOfMonth: number): T[] {
  if (dayOfMonth < 1 || dayOfMonth > SPREAD_DAYS) return [];
  return pages.filter((_, i) => i % SPREAD_DAYS === dayOfMonth - 1);
}

export type ProfileCheck = {
  checked: number;
  /** Loaded fine, but the quote isn't there any more. */
  missing: { slug: string; trait: string; url: string }[];
  /** Couldn't tell (timeout, bot wall, 5xx). */
  unknown: string[];
};

export async function recheckProfiles(
  dayOfMonth: number,
  {
    fetcher = fetchPage,
    profiles = PROFILES,
  }: { fetcher?: Fetcher; profiles?: ReadonlyMap<string, ParkProfile> } = {},
): Promise<ProfileCheck> {
  const due = pagesForDay(evidencePages(profiles), dayOfMonth);
  const out: ProfileCheck = { checked: 0, missing: [], unknown: [] };
  for (const page of due) {
    out.checked++;
    let host = "";
    try {
      host = new URL(page.url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const got = await fetcher(page.url, [host]).catch(() => null);
    if (!got || got.blocked || got.unreachable || got.status >= 500) {
      out.unknown.push(page.url);
      continue;
    }
    // A 404 or 410 is as good as a missing quote: the page is gone.
    const text = got.status === 200 ? got.text : "";
    for (const it of page.items)
      if (!text.includes(normalizeText(it.quote)))
        out.missing.push({ slug: it.slug, trait: it.trait, url: page.url });
  }
  if (out.missing.length)
    alertLater({
      key: `park-profiles:${dayOfMonth}`,
      subject: "Park signature traits need a look",
      text: [
        "These signature traits' evidence pages no longer print their quotes. Fix or drop them in data/park-profiles.json (posts lead with them):",
        ...out.missing.map((m) => `- ${m.slug}: ${m.trait} (${m.url})`),
      ].join("\n"),
      everyMinutes: 23 * 60,
    });
  return out;
}
