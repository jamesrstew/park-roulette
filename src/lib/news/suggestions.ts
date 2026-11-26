import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { newsIgSuggestions } from "@/db/schema";
import { suggestionShares } from "@/lib/social/graph";
import type { SentIssue } from "./cooldowns";
import { type IgCandidate, igFindByShortcode, igShortcode } from "./igapi";
import {
  accountFromPostPage,
  SUGGESTION_MAX_AGE_DAYS,
  SUGGESTION_SENDERS,
  suggestedCandidate,
  SUGGESTIONS_PER_PLAN,
  suggestionExpired,
  suggestionIneligible,
} from "./suggest";
import { blockedAccounts, takenDown } from "./takedowns";
import { UA } from "./ua";

/**
 * Parents' corner suggestions, the server half (the rules are in
 * suggest.ts). Each plan: mark suggestions a sent issue used, expire old
 * ones, read new DMs from allow-listed senders, then look up each open
 * suggestion and keep those that pass every check. Meta's message API
 * gives a share's link only, so the account comes from the post page's
 * public og:url, then Business Discovery reads the post itself (the same
 * call found posts use). Nothing here sends or changes anything on
 * Instagram.
 */

/** One suggestion as the plan reports it to the writer. */
export type SuggestionReport = {
  permalink: string;
  sender: string;
  sent_at: string;
  account: string | null;
  /** candidate: in instagram[] (first); skipped: failed a check, with why. */
  status: "candidate" | "skipped";
  why?: string;
};

export type SuggestionStatus = "ok" | "no_token" | "api_error";

const DAY = 86_400_000;

function opts() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  const page = process.env.FB_PAGE_ID;
  if (!token || !igUserId || !page) return null;
  return {
    token,
    igUserId,
    page,
    appSecret: process.env.IG_APP_SECRET || undefined,
  };
}

/** The suggested posts that pass every check, newest suggestion first. */
export async function suggestedCandidates(o: {
  now: Date;
  history: readonly SentIssue[];
  /** Accounts featured in the last 8 weeks (lowercase handles). */
  cooling: ReadonlySet<string>;
  /** Tests: Meta and the post pages. */
  fetchImpl?: typeof fetch;
}): Promise<{
  candidates: IgCandidate[];
  report: SuggestionReport[];
  status: SuggestionStatus;
}> {
  const meta = opts();
  await markUsed(o.history);
  await db
    .update(newsIgSuggestions)
    .set({ status: "expired" })
    .where(
      and(
        eq(newsIgSuggestions.status, "open"),
        lt(
          newsIgSuggestions.sentAt,
          new Date(o.now.getTime() - SUGGESTION_MAX_AGE_DAYS * DAY),
        ),
      ),
    );
  if (!meta) return { candidates: [], report: [], status: "no_token" };
  const graph = { ...meta, fetchImpl: o.fetchImpl };
  let status: SuggestionStatus = "ok";
  try {
    await syncDms(o.now, graph);
  } catch (e) {
    console.warn("[news] suggestion DMs failed", (e as Error)?.message);
    status = "api_error";
  }

  const rows = await db
    .select()
    .from(newsIgSuggestions)
    .where(eq(newsIgSuggestions.status, "open"))
    .orderBy(desc(newsIgSuggestions.sentAt))
    .limit(SUGGESTIONS_PER_PLAN);
  const blocked = blockedAccounts("instagram");
  const since = new Date(o.now.getTime() - SUGGESTION_MAX_AGE_DAYS * DAY);
  const candidates: IgCandidate[] = [];
  const report: SuggestionReport[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (suggestionExpired(r.sentAt, o.now)) continue;
    const base = {
      permalink: r.permalink,
      sender: r.sender,
      sent_at: r.sentAt.toISOString(),
    };
    const skip = async (why: string, account: string | null) => {
      report.push({ ...base, account, status: "skipped", why });
      await db
        .update(newsIgSuggestions)
        .set({ note: why, account })
        .where(eq(newsIgSuggestions.id, r.id));
    };
    const account =
      r.account ?? (await accountFor(r.permalink, r.shortcode, o.fetchImpl));
    if (!account) {
      await skip("couldn't tell whose post it is", null);
      continue;
    }
    const found = await igFindByShortcode(account, r.shortcode, {
      ...graph,
      since,
    }).catch(() => null);
    if (!found) {
      await skip(
        "not found in the account's recent posts (a personal account, private, or gone)",
        account,
      );
      continue;
    }
    const why = suggestionIneligible(found.media, account, o.now, {
      blocked,
      cooling: o.cooling,
      takenDown: (id) => takenDown("instagram", id),
    });
    await db
      .update(newsIgSuggestions)
      .set({ account, mediaId: found.media.id, note: why })
      .where(eq(newsIgSuggestions.id, r.id));
    if (why) {
      report.push({ ...base, account, status: "skipped", why });
      continue;
    }
    // The same post shared twice runs once.
    if (seen.has(found.media.id)) continue;
    seen.add(found.media.id);
    candidates.push(
      suggestedCandidate(found.media, account, found.avatar, found.baseline, {
        sender: r.sender,
        sentAt: r.sentAt,
      }),
    );
    report.push({ ...base, account, status: "candidate" });
  }
  return { candidates, report, status };
}

/** New DMs from allow-listed senders: one row per shared post link. */
async function syncDms(
  now: Date,
  g: NonNullable<ReturnType<typeof opts>> & { fetchImpl?: typeof fetch },
) {
  const since = new Date(now.getTime() - SUGGESTION_MAX_AGE_DAYS * DAY);
  const known = await db
    .select({ id: newsIgSuggestions.messageId })
    .from(newsIgSuggestions);
  const shares = await suggestionShares(
    g.page,
    SUGGESTION_SENDERS,
    since,
    new Set(known.map((k) => k.id)),
    g,
  );
  const rows = shares.flatMap((s) =>
    s.links.flatMap((link) => {
      const shortcode = igShortcode(link);
      return shortcode && SUGGESTION_SENDERS.has(s.sender)
        ? [
            {
              messageId: s.messageId,
              sender: s.sender,
              permalink: link,
              shortcode,
              sentAt: new Date(s.sentAt),
            },
          ]
        : [];
    }),
  );
  if (rows.length)
    await db.insert(newsIgSuggestions).values(rows).onConflictDoNothing();
}

/** A sent issue's Instagram post was a suggestion: it's used, for good. */
async function markUsed(history: readonly SentIssue[]) {
  for (const h of history) {
    const s = h.body.meme?.snapshot;
    if (s?.kind !== "instagram") continue;
    const code = igShortcode(s.permalink);
    await db
      .update(newsIgSuggestions)
      .set({ status: "used", usedIssueDate: h.issueDate })
      .where(
        and(
          inArray(newsIgSuggestions.status, ["open", "expired"]),
          code
            ? sql`(${newsIgSuggestions.mediaId} = ${s.id} or ${newsIgSuggestions.shortcode} = ${code})`
            : eq(newsIgSuggestions.mediaId, s.id),
        ),
      );
  }
}

/**
 * The account behind a shared post, from its public page's og:url (what
 * Meta's link previews read). Our own User-Agent, one GET, instagram.com
 * only. Null when the page doesn't say.
 */
async function accountFor(
  permalink: string,
  shortcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const kind = /\/(reels?|tv)\//.test(new URL(permalink).pathname)
    ? "reel"
    : "p";
  try {
    const res = await fetchImpl(
      `https://www.instagram.com/${kind}/${shortcode}/`,
      {
        headers: { "user-agent": UA, accept: "text/html" },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
    const host = res.url ? new URL(res.url).hostname : "www.instagram.com";
    if (!res.ok || !/^(www\.)?instagram\.com$/.test(host)) {
      await res.body?.cancel();
      return null;
    }
    const html = (await res.text()).slice(0, 1_000_000);
    return accountFromPostPage(html, shortcode);
  } catch {
    return null;
  }
}
