import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { newsSettings, socialPosts } from "@/db/schema";
import type { GraphOpts } from "./graph";

/**
 * Instagram's switches and environment, and the /admin read. No rendering
 * here (sharp and next/og stay out of every page that imports this).
 */

export type SocialSettings = {
  enabled: boolean;
  dryRun: boolean;
};

export async function getSocialSettings(): Promise<SocialSettings> {
  await db.insert(newsSettings).values({ id: 1 }).onConflictDoNothing();
  const [s] = await db
    .select({
      enabled: newsSettings.socialEnabled,
      dryRun: newsSettings.socialDryRun,
    })
    .from(newsSettings)
    .where(eq(newsSettings.id, 1));
  return s;
}

export async function setSocialSettings(
  patch: Partial<SocialSettings>,
): Promise<void> {
  await getSocialSettings();
  await db
    .update(newsSettings)
    .set({
      ...(patch.enabled !== undefined ? { socialEnabled: patch.enabled } : {}),
      ...(patch.dryRun !== undefined ? { socialDryRun: patch.dryRun } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(newsSettings.id, 1));
}

/** SOCIAL_PUBLISH=off in the environment stops everything, whatever /admin says. */
export function envKilled(): boolean {
  return (process.env.SOCIAL_PUBLISH ?? "").toLowerCase() === "off";
}

/**
 * Keyword DMs (and the "Comment PARK" call to action) ship OFF (decision
 * 13): every CTA reads "Link in bio" until SOCIAL_KEYWORD_DMS=on, which
 * waits for a non-role test account to receive a private reply.
 */
export function dmsOn(): boolean {
  return (process.env.SOCIAL_KEYWORD_DMS ?? "").toLowerCase() === "on";
}

/** Facebook cross-posts: off until James adds pages_manage_posts. */
export function facebookOn(): boolean {
  return (process.env.SOCIAL_FACEBOOK ?? "").toLowerCase() === "on";
}

/** The Facebook Page id, required for DMs and Facebook (never guessed). */
export function pageIdEnv(): string | null {
  const id = process.env.FB_PAGE_ID;
  return id && /^\d{5,25}$/.test(id) ? id : null;
}

export function graphOpts(fetchImpl?: typeof fetch): GraphOpts | null {
  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  if (!token || !igUserId || !/^\d{5,25}$/.test(igUserId)) return null;
  return { token, igUserId, appSecret: process.env.IG_APP_SECRET, fetchImpl };
}

/**
 * The Sunday routine's own bearer, SOCIAL_TOKEN (decision 13), for
 * /api/social/* only. NEWS_INGEST_TOKEN is refused there.
 */
export { socialOk } from "@/lib/news/http";

/** /admin: the switches, recent posts and the week's signups from Instagram. */
export async function socialAdmin() {
  const [settings, posts, signups] = await Promise.all([
    getSocialSettings(),
    db
      .select({
        id: socialPosts.id,
        kind: socialPosts.kind,
        slotDate: socialPosts.slotDate,
        status: socialPosts.status,
        reason: socialPosts.reason,
      })
      .from(socialPosts)
      .where(sql`${socialPosts.status} <> 'replaced'`)
      .orderBy(desc(socialPosts.publishAt))
      .limit(10),
    db.execute<{ source: string; n: number }>(sql`
      select source, count(*)::int as n from (
        select source from email_subscribers
          where source in ('ig_bio', 'ig_dm', 'fb') and status = 'confirmed'
            and created_at > now() - interval '7 days'
        union all
        select source from contact_consents
          where channel = 'sms' and action = 'opt_in'
            and source in ('ig_bio', 'ig_dm', 'fb')
            and created_at > now() - interval '7 days'
      ) s group by source`),
  ]);
  return {
    ...settings,
    envOff: envKilled(),
    canPreflight: !!graphOpts(),
    posts,
    signups: Object.fromEntries(
      [...signups].map((r) => [r.source, Number(r.n)]),
    ) as Record<string, number>,
  };
}
