import { connection } from "next/server";
import { sentIssues } from "@/lib/news/data";
import { NEWS_NAME } from "@/lib/news/template";
import { PARK_NEWS } from "@/lib/park-news";
import { SITE_URL } from "@/lib/site";

const x = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** RSS for Bend Playground Passport: every issue that went out. */
export async function GET() {
  await connection();
  const issues = await sentIssues(50);
  const items = issues
    .map(
      (i) => `<item>
<title>${x(i.subject)}</title>
<link>${SITE_URL}/newsletter/${i.issueDate}</link>
<guid isPermaLink="true">${SITE_URL}/newsletter/${i.issueDate}</guid>
<pubDate>${i.sentAt.toUTCString()}</pubDate>
<description>${x(i.preview)}</description>
</item>`,
    )
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${x(NEWS_NAME)}</title>
<link>${SITE_URL}/newsletter</link>
<atom:link href="${SITE_URL}/newsletter/rss.xml" rel="self" type="application/rss+xml"/>
<description>${x(`${PARK_NEWS.tagline} ${PARK_NEWS.cadence}`)}</description>
<language>en-us</language>
${items}
</channel>
</rss>`;
  return new Response(body, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
