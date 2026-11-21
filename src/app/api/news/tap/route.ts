import { sql } from "drizzle-orm";
import { db } from "@/db";
import { newsClicks } from "@/db/schema";
import { sentIssue } from "@/lib/news/data";
import { isIsoDate } from "@/lib/news/time";
import { memoryCap } from "@/lib/memory-cap";
import { SITE_URL } from "@/lib/site";
import { WEEKEND_PICK_TAP } from "@/lib/weekend-pick";

/**
 * POST /api/news/tap: the issue page's beacon when it was opened from a
 * Weekend Pick text (?src=text). It counts a tap per issue in
 * news_clicks under its own slug (weekend-pick-tap), like the email's /n/
 * links: no cookie, no person, no IP stored. A beacon, not the /w
 * redirect, because link scanners and preview fetchers follow redirects
 * but don't run scripts. Our own pages only (Origin), and at most 20 an
 * hour from one address (held in memory, as a hash, per server instance).
 */

const overCap = memoryCap(20, 3_600_000);

export async function POST(req: Request) {
  const done = () => new Response(null, { status: 204 });
  if (req.headers.get("origin") !== new URL(SITE_URL).origin) return done();
  const ip =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  if (overCap(ip)) return done();
  const body = (await req.text().catch(() => "")).slice(0, 200);
  let date: unknown = null;
  try {
    date = (JSON.parse(body) as { date?: unknown }).date;
  } catch {
    /* not JSON */
  }
  if (!isIsoDate(date) || !(await sentIssue(date).catch(() => null)))
    return done();
  await db
    .insert(newsClicks)
    .values({ issueDate: date, slug: WEEKEND_PICK_TAP, clicks: 1 })
    .onConflictDoUpdate({
      target: [newsClicks.issueDate, newsClicks.slug],
      set: { clicks: sql`${newsClicks.clicks} + 1` },
    })
    .catch((e) => console.error("[texts] tap count failed", e?.name));
  return done();
}
