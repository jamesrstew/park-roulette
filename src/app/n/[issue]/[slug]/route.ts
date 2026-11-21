import { sql } from "drizzle-orm";
import { db } from "@/db";
import { newsClicks } from "@/db/schema";
import { CATALOG } from "@/lib/news/catalog";
import { startedIssue } from "@/lib/news/data";
import { issueLinks } from "@/lib/news/issue";
import { isIsoDate } from "@/lib/news/time";
import { formatOn, ON_COOKIE, ON_COOKIE_DAYS, parseOn } from "@/lib/on-cookie";
import { SITE_URL } from "@/lib/site";

/**
 * /n/<issue>/<slug>: a link in an issue, the same for every reader.
 * We add one to that link's total and send them on. No person and no IP:
 * just "the Featured park link in the Dec 3 issue got 41 taps". The only
 * cookie is pr_on's "e" (lib/on-cookie.ts): this browser gets the email,
 * so the site stops offering it.
 */
export async function GET(
  req: Request,
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
  const res = away(viaEmail(link.url));
  res.headers.append("set-cookie", onCookie(req));
  return res;
}

/**
 * Our own pages get ?via=email, so the app knows this browser already gets
 * the email and never asks for it (lib/asks.ts). Other sites' links go
 * as they are.
 */
function viaEmail(to: string): string {
  try {
    const u = new URL(to);
    if (u.origin !== new URL(SITE_URL).origin) return to;
    u.searchParams.set("via", "email");
    return u.toString();
  } catch {
    return to;
  }
}

/** pr_on with "e" added to whatever this browser had. */
function onCookie(req: Request): string {
  const had = /(?:^|;\s*)pr_on=([^;]*)/.exec(req.headers.get("cookie") ?? "");
  const v = formatOn({ ...parseOn(had?.[1]), email: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ON_COOKIE}=${v}; Path=/; Max-Age=${ON_COOKIE_DAYS * 86_400}; HttpOnly; SameSite=Lax${secure}`;
}
