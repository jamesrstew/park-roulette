import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { newsClicks, parks } from "@/db/schema";
import { featuredIn } from "@/lib/news/data";
import { SITE_URL } from "@/lib/site";
import { parkIdFromCode, WEEKEND_PICK_CLICK } from "@/lib/weekend-pick";

/**
 * /w/<code>: the Weekend Pick text's short link (the park's id in base
 * 36). Sends the tap to the park page, and adds one to that issue's
 * Weekend Pick total in news_clicks, like the email's /n/ links: no
 * cookie, no person, no IP. An unknown code goes home.
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
