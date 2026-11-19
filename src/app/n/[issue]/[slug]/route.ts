import { sql } from "drizzle-orm";
import { db } from "@/db";
import { newsClicks } from "@/db/schema";
import { CATALOG } from "@/lib/news/catalog";
import { startedIssue } from "@/lib/news/data";
import { issueLinks } from "@/lib/news/issue";
import { isIsoDate } from "@/lib/news/time";
import { SITE_URL } from "@/lib/site";

/**
 * /n/<issue>/<slug>: a link in an issue, the same for every reader.
 * We add one to that link's total and send them on. No cookie, no person,
 * no IP: just "the Featured park link in the Dec 3 issue got 41 taps".
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ issue: string; slug: string }> },
) {
  const { issue, slug } = await params;
  const away = (to: string) =>
    new Response(null, {
      status: 302,
      headers: { location: to, "cache-control": "no-store" },
    });
  if (!isIsoDate(issue) || !/^[a-z0-9-]{1,40}$/.test(slug))
    return away(SITE_URL);
  // Any issue whose send has started: links work from the first email on.
  const sent = await startedIssue(issue);
  if (!sent) return away(SITE_URL);
  const link = issueLinks(sent, CATALOG, SITE_URL).find((l) => l.slug === slug);
  if (!link) return away(`${SITE_URL}/newsletter/${issue}`);
  await db
    .insert(newsClicks)
    .values({ issueDate: issue, slug, clicks: 1 })
    .onConflictDoUpdate({
      target: [newsClicks.issueDate, newsClicks.slug],
      set: { clicks: sql`${newsClicks.clicks} + 1` },
    })
    .catch((e) => console.error("[news] click count failed", e?.name));
  return away(link.url);
}
