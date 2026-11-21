import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { newsClicks, parks } from "@/db/schema";
import { featuredIn, sentIssue } from "@/lib/news/data";
import { SITE_URL } from "@/lib/site";
import {
  dateFromCode,
  parkIdFromCode,
  WEEKEND_PICK_CLICK,
} from "@/lib/weekend-pick";

/**
 * /w/<code>: the Weekend Pick text's short link.
 *
 * - 4 characters: an issue date (YYMMDD in base 36). A sent issue goes to
 *   /newsletter/{date}?src=text. Taps are counted by the page's beacon,
 *   not here: link scanners and preview fetchers hit this redirect too.
 * - 1 to 3 characters: a park id, from texts sent before batch 6. Goes to
 *   the park page and adds one to that issue's total in news_clicks.
 *
 * No cookie, no person, no IP. An unknown code goes home.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const away = (to: string) =>
    new Response(null, {
      status: 302,
      headers: { location: to, "cache-control": "no-store" },
    });
  const date = dateFromCode(code);
  if (date) {
    // The page exists exactly when the issue went out (the web's rule).
    const issue = await sentIssue(date).catch(() => null);
    return away(
      issue ? `${SITE_URL}/newsletter/${date}?src=text` : `${SITE_URL}/`,
    );
  }
  const id = parkIdFromCode(code);
  if (!id) return away(`${SITE_URL}/`);
  const [park] = await db
    .select({ slug: parks.slug })
    .from(parks)
    .where(and(eq(parks.id, id), isNotNull(parks.approvedAt)));
  if (!park) return away(`${SITE_URL}/`);
  // The issue that featured this park (the text's issue): its total.
  const issue = await featuredIn(park.slug).catch(() => null);
  if (issue)
    await db
      .insert(newsClicks)
      .values({ issueDate: issue, slug: WEEKEND_PICK_CLICK, clicks: 1 })
      .onConflictDoUpdate({
        target: [newsClicks.issueDate, newsClicks.slug],
        set: { clicks: sql`${newsClicks.clicks} + 1` },
      })
      .catch((e) => console.error("[texts] tap count failed", e?.name));
  return away(`${SITE_URL}/parks/${park.slug}`);
}
