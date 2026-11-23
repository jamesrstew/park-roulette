import "server-only";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { newsSettings, socialDmReplies, socialPosts } from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import {
  GraphError,
  commentDetail,
  conversationWith,
  type IgComment,
  mediaComments,
  messageDetail,
  privateReply,
  recentMessages,
  type SentDm,
  sendMessage,
  tokenValid,
} from "./graph";
import { COPY } from "./model";
import { wantsLink, wantsPick } from "./dm-rules";
import {
  dmsOn,
  envKilled,
  getSocialSettings,
  graphOpts,
  pageIdEnv,
} from "./settings";

/**
 * "Comment PARK and we'll DM you the link" and "Reply PICK" on the Story.
 *
 * Polled, not a webhook: comment and message webhooks need the app's
 * webhook subscription set up in Meta's dashboard (and Advanced Access
 * through app review for anyone without a role on the app). Reading our
 * own posts' comments and our own inbox works with the token's
 * instagram_manage_comments and instagram_manage_messages as it is.
 *
 * One code-written DM per comment or Story reply, claimed in
 * social_dm_replies before it goes, so nobody ever gets two. We keep only
 * Meta's ids: never a username, a name or the words. A comment can get a
 * private reply within 7 days; a Story reply opens a 24-hour window.
 */

/** Claim an id; false if someone already answered it. */
async function claim(
  kind: "comment" | "story_reply",
  extId: string,
  postId: number | null,
  status: "sending" | "dry_run",
): Promise<boolean> {
  const got = await db
    .insert(socialDmReplies)
    .values({ kind, extId, postId, status })
    .onConflictDoNothing()
    .returning({ id: socialDmReplies.id });
  return got.length > 0;
}

async function settle(
  extId: string,
  status: "sent" | "failed",
  reason?: string,
  sent?: SentDm,
) {
  await db
    .update(socialDmReplies)
    .set({
      status,
      reason: reason?.slice(0, 200) ?? null,
      messageId: sent?.messageId ?? null,
      recipientId: sent?.recipientId ?? null,
    })
    .where(eq(socialDmReplies.extId, extId));
}

const COMMENT_DAYS = 7;

export type DmResult = {
  action: "paused" | "off" | "ran";
  comments: number;
  replies: number;
  notes: string[];
};

/**
 * One poll (every 15 minutes): published posts from the last 7 days,
 * their comments, and the inbox for Story replies. Dry run records what
 * it would have sent and sends nothing; off production nothing is sent.
 */
export async function runKeywordDms(
  now = new Date(),
  { fetchImpl }: { fetchImpl?: typeof fetch } = {},
): Promise<DmResult> {
  const settings = await getSocialSettings();
  const empty = { comments: 0, replies: 0, notes: [] as string[] };
  if (envKilled() || !settings.enabled) return { action: "paused", ...empty };
  const o = graphOpts(fetchImpl);
  // Off by default (decision 13), and FB_PAGE_ID is required: the DM goes
  // from the Page, and we never guess which one.
  const page = pageIdEnv();
  if (!dmsOn() || !o || !page) return { action: "off", ...empty };
  const live = !settings.dryRun && process.env.VERCEL_ENV === "production";
  const notes: string[] = [];
  let comments = 0;
  let replies = 0;

  const posts = await db
    .select({ id: socialPosts.id, mediaId: socialPosts.igMediaId })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.status, "published"),
        isNotNull(socialPosts.igMediaId),
        sql`${socialPosts.kind} <> 'story'`,
        gte(
          socialPosts.publishedAt,
          new Date(now.getTime() - COMMENT_DAYS * 86_400_000),
        ),
      ),
    )
    .orderBy(desc(socialPosts.publishedAt));
  for (const p of posts) {
    let list: IgComment[];
    try {
      list = await mediaComments(p.mediaId!, o);
    } catch (e) {
      notes.push(`comments ${p.id}: ${(e as Error).message}`);
      continue;
    }
    comments += list.length;
    for (const c of list.filter((c) => wantsLink(c, o.igUserId))) {
      if (!(await claim("comment", c.id, p.id, live ? "sending" : "dry_run")))
        continue;
      if (!live) {
        replies++;
        continue;
      }
      try {
        const sent = await privateReply(c.id, COPY.dm, o);
        // Meta said yes; a missing message_id is kept as a note to look at.
        await settle(
          c.id,
          "sent",
          sent.messageId ? undefined : "Meta gave no message_id",
          sent,
        );
        replies++;
      } catch (e) {
        // Never retried: a second try could send a second DM.
        await settle(c.id, "failed", (e as Error).message);
        notes.push(`reply ${c.id}: ${(e as Error).message}`);
      }
    }
  }

  try {
    const pid = page;
    const msgs = await recentMessages(pid, o);
    const own = new Set([o.igUserId, pid]);
    for (const m of msgs.filter((m) => wantsPick(m, own, now))) {
      if (
        !(await claim("story_reply", m.id, null, live ? "sending" : "dry_run"))
      )
        continue;
      if (!live) {
        replies++;
        continue;
      }
      try {
        const sent = await sendMessage(pid, m.from!.id!, COPY.dm, o);
        await settle(
          m.id,
          "sent",
          sent.messageId ? undefined : "Meta gave no message_id",
          sent,
        );
        replies++;
      } catch (e) {
        await settle(m.id, "failed", (e as Error).message);
        notes.push(`dm ${m.id}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    notes.push(`inbox: ${(e as Error).message}`);
  }

  if (notes.length)
    alertLater({
      key: "social:dm-errors",
      subject: "Instagram keyword DMs had trouble",
      text: `Some comments or Story replies couldn't be read or answered (each is tried once). First problem: ${notes[0]}`,
      everyMinutes: 6 * 60,
    });
  return { action: "ran", comments, replies, notes };
}

/**
 * Once a day: is the token still good (and not about to lapse), and a
 * short digest for James: how many comments and DMs came in, so he can
 * hide anything that names or shows a child. Counts only, no words.
 */
export async function dailySocialCheck(
  now = new Date(),
  { fetchImpl }: { fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const claimed = await db
    .update(newsSettings)
    .set({ socialDailyAt: now })
    .where(
      and(
        eq(newsSettings.id, 1),
        sql`(${newsSettings.socialDailyAt} is null or ${newsSettings.socialDailyAt} < ${new Date(now.getTime() - 20 * 3_600_000).toISOString()})`,
      ),
    )
    .returning({ id: newsSettings.id });
  if (!claimed.length) return "done today";
  const o = graphOpts(fetchImpl);
  if (!o) return "no token";
  try {
    const t = await tokenValid(o);
    if (!t.valid)
      alertLater({
        key: "social:token",
        subject: "The Instagram token needs a refresh",
        text: `Meta says IG_ACCESS_TOKEN is no longer valid (${t.why}). Posts and keyword DMs stop until a new long-lived Page token is set in Vercel.`,
        everyMinutes: 24 * 60,
      });
  } catch (e) {
    if (e instanceof GraphError && !e.ambiguous)
      alertLater({
        key: "social:token",
        subject: "The Instagram token check failed",
        text: `Meta refused the token check: ${e.message}`,
        everyMinutes: 24 * 60,
      });
  }
  const since = new Date(now.getTime() - 86_400_000);
  const [d] = await db.execute<{ replies: number; failed: number }>(sql`
    select count(*) filter (where status = 'sent')::int as replies,
           count(*) filter (where status = 'failed')::int as failed
    from ${socialDmReplies} where created_at > ${since.toISOString()}`);
  let comments = 0;
  const posts = await db
    .select({ mediaId: socialPosts.igMediaId })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.status, "published"),
        isNotNull(socialPosts.igMediaId),
        gte(socialPosts.publishedAt, new Date(now.getTime() - 7 * 86_400_000)),
      ),
    );
  for (const p of posts) {
    try {
      const list = await mediaComments(p.mediaId!, o);
      comments += list.filter(
        (c) => c.timestamp && Date.parse(c.timestamp) > since.getTime(),
      ).length;
    } catch {
      // Counted as zero.
    }
  }
  if (comments || Number(d?.replies) || Number(d?.failed))
    alertLater({
      key: `social:digest:${now.toISOString().slice(0, 10)}`,
      subject: "Instagram: today's comments and DMs",
      text: `In the last 24 hours: ${comments} new comments on our posts, ${Number(d?.replies)} keyword DMs sent, ${Number(d?.failed)} failed. Open Instagram and hide anything that names or shows a child. Nothing from comments or DMs is ever posted.`,
      everyMinutes: 20 * 60,
    });
  return "checked";
}

/**
 * The read-only DM diagnostic (/api/social/dm-debug): our latest
 * social_dm_replies rows and what Meta says about each right now: the
 * comment (who wrote it, the words, when, on which media) and our
 * Instagram conversation with that person, latest messages first. Read
 * from Meta for the answer only: nothing here is stored or logged.
 */
export async function dmDebug(
  limit = 5,
  { fetchImpl }: { fetchImpl?: typeof fetch } = {},
) {
  const o = graphOpts(fetchImpl);
  const page = pageIdEnv();
  const rows = await db
    .select()
    .from(socialDmReplies)
    .orderBy(desc(socialDmReplies.id))
    .limit(Math.min(Math.max(1, limit), 20));
  const env = {
    dmsOn: dmsOn(),
    pageId: page,
    igUserId: o?.igUserId ?? null,
    hasToken: !!o,
    hasAppSecret: !!o?.appSecret,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };
  if (!o) return { env, rows, note: "No IG_ACCESS_TOKEN or IG_USER_ID." };
  const err = (e: unknown) => (e as Error)?.message ?? String(e);
  const out = [];
  for (const row of rows) {
    const item: Record<string, unknown> = { row };
    let igsid = row.recipientId;
    if (row.kind === "comment") {
      try {
        const c = await commentDetail(row.extId, o);
        item.comment = c;
        igsid ??= c.from?.id ?? null;
      } catch (e) {
        item.comment = { error: err(e) };
      }
    }
    if (row.messageId) {
      try {
        item.sentMessage = await messageDetail(row.messageId, o);
      } catch (e) {
        item.sentMessage = { error: err(e) };
      }
    }
    if (page && igsid) {
      try {
        item.conversation = await conversationWith(page, igsid, o);
      } catch (e) {
        item.conversation = { error: err(e) };
      }
    } else {
      item.conversation = {
        error: page ? "No recipient id to look up" : "No FB_PAGE_ID",
      };
    }
    out.push(item);
  }
  return { env, items: out };
}
