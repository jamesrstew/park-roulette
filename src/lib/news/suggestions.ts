import "server-only";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { newsIgDmSeen, newsIgSuggestions, xAuthorStats } from "@/db/schema";
import { suggestionShares } from "@/lib/social/graph";
import type { SentIssue } from "./cooldowns";
import {
  type IgCandidate,
  IgApiError,
  igFindByShortcode,
  igShortcode,
} from "./igapi";
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
 * suggest.ts). Each plan, after the regular Instagram discovery: mark
 * suggestions a sent issue used, expire old ones, read new DMs from
 * allow-listed senders (by pinned id), then look up each open suggestion
 * and keep those that pass every check. Meta's message API gives a
 * share's link only, so the account comes from the post page's public
 * og:url, then Business Discovery reads the post itself (the same call
 * found posts use). Nothing here sends or changes anything on Instagram.
 *
 * Bounded: the whole pass has a deadline (SUGGESTIONS_DEADLINE_MS) and
 * returns what it has by then; at most SUGGESTIONS_PER_PLAN lookups; a
 * suggestion that fails twice (lookup or check) is retired.
 */

/** The longest the plan waits for suggestions (partial results after). */
export const SUGGESTIONS_DEADLINE_MS = 15_000;
/** A suggestion that fails this many plans is retired. */
export const SUGGESTION_MAX_FAILURES = 2;
/** The post page fetch: at most this many bytes read. */
const PAGE_MAX_BYTES = 1_000_000;

/** One suggestion as the plan reports it to the writer. */
export type SuggestionReport = {
  permalink: string;
  sender: string;
  sent_at: string;
  account: string | null;
  /** candidate: in instagram[] (first); skipped: failed, with why. */
  status: "candidate" | "skipped";
  why?: string;
};

/**
 * ok; no_token (Meta keys missing); api_error (Meta refused or failed,
 * a rate limit included); timeout (the deadline cut the pass short).
 */
export type SuggestionStatus = "ok" | "no_token" | "api_error" | "timeout";

export type SuggestionResult = {
  candidates: IgCandidate[];
  report: SuggestionReport[];
  status: SuggestionStatus;
  /** Shared links in allow-listed DMs that weren't an Instagram post. */
  unparsed: number;
};

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

/**
 * The suggested posts that pass every check, newest suggestion first.
 * Never takes longer than the deadline: on time, it returns what it has.
 */
export async function suggestedCandidates(o: {
  now: Date;
  history: readonly SentIssue[];
  /** Accounts featured in the last 8 weeks (lowercase handles). */
  cooling: ReadonlySet<string>;
  /** Tests: Meta and the post pages. */
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
}): Promise<SuggestionResult> {
  const out: SuggestionResult = {
    candidates: [],
    report: [],
    status: "ok",
    unparsed: 0,
  };
  const budget = o.deadlineMs ?? SUGGESTIONS_DEADLINE_MS;
  const deadline = Date.now() + budget;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeUp = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), budget);
  });
  // The work fills `out` as it goes; on time, the plan takes what's there.
  const work = collect(o, out, deadline).then(
    () => "done" as const,
    (e) => {
      console.warn("[news] suggestions failed", (e as Error)?.message);
      out.status = "api_error";
      return "done" as const;
    },
  );
  const r = await Promise.race([work, timeUp]);
  clearTimeout(timer);
  if (r === "late") {
    // A copy: work still running can't change what the plan stores.
    return {
      ...out,
      status: "timeout",
      candidates: [...out.candidates],
      report: [...out.report],
    };
  }
  return out;
}

async function collect(
  o: Parameters<typeof suggestedCandidates>[0],
  out: SuggestionResult,
  deadline: number,
): Promise<void> {
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
  if (!meta) {
    out.status = "no_token";
    return;
  }
  const graph = { ...meta, fetchImpl: o.fetchImpl };
  try {
    out.unparsed = await syncDms(o.now, graph, deadline);
  } catch (e) {
    console.warn("[news] suggestion DMs failed", (e as Error)?.message);
    out.status = "api_error";
  }

  const rows = await db
    .select()
    .from(newsIgSuggestions)
    .where(eq(newsIgSuggestions.status, "open"))
    .orderBy(desc(newsIgSuggestions.sentAt))
    .limit(SUGGESTIONS_PER_PLAN);
  const blocked = blockedAccounts("instagram");
  const excluded = await universeExcluded();
  const since = new Date(o.now.getTime() - SUGGESTION_MAX_AGE_DAYS * DAY);
  const seen = new Set<string>();
  for (const r of rows) {
    if (Date.now() > deadline) return;
    if (suggestionExpired(r.sentAt, o.now)) continue;
    const base = {
      permalink: r.permalink,
      sender: r.sender,
      sent_at: r.sentAt.toISOString(),
    };
    /** A failed lookup or check: two of them retire the suggestion. */
    const fail = async (
      why: string,
      account: string | null,
      mediaId?: string,
    ) => {
      out.report.push({ ...base, account, status: "skipped", why });
      const failures = r.failures + 1;
      await db
        .update(newsIgSuggestions)
        .set({
          note: why,
          account,
          ...(mediaId ? { mediaId } : {}),
          failures,
          ...(failures >= SUGGESTION_MAX_FAILURES ? { status: "retired" } : {}),
        })
        .where(eq(newsIgSuggestions.id, r.id));
    };
    const account =
      r.account ?? (await accountFor(r.permalink, r.shortcode, o.fetchImpl));
    if (!account) {
      await fail("couldn't tell whose post it is", null);
      continue;
    }
    let found: Awaited<ReturnType<typeof igFindByShortcode>>;
    try {
      found = await igFindByShortcode(account, r.shortcode, {
        ...graph,
        since,
        deadline,
      });
    } catch (e) {
      // Meta refused or failed (a rate limit): not this post's fault, so
      // no strike, and the next plan tries again.
      const why = e instanceof IgApiError ? e.message : "Meta failed";
      out.status = "api_error";
      out.report.push({
        ...base,
        account,
        status: "skipped",
        why: `Meta error: ${why}`,
      });
      await db
        .update(newsIgSuggestions)
        .set({ account, note: `Meta error: ${why}` })
        .where(eq(newsIgSuggestions.id, r.id));
      if (why === "out of time") return;
      continue;
    }
    if (!found) {
      await fail(
        "not in the account's recent posts (a personal or private account, or gone)",
        account,
      );
      continue;
    }
    const why = suggestionIneligible(found.media, account, o.now, {
      blocked,
      excluded,
      cooling: o.cooling,
      takenDown: (id) => takenDown("instagram", id),
    });
    if (why) {
      await fail(why, account, found.media.id);
      continue;
    }
    await db
      .update(newsIgSuggestions)
      .set({ account, mediaId: found.media.id, note: null })
      .where(eq(newsIgSuggestions.id, r.id));
    // The same post shared twice runs once.
    if (seen.has(found.media.id)) continue;
    seen.add(found.media.id);
    out.candidates.push(
      suggestedCandidate(found.media, account, found.avatar, found.baseline, {
        sender: r.sender,
        sentAt: r.sentAt,
      }),
    );
    out.report.push({ ...base, account, status: "candidate" });
  }
}

/**
 * Accounts dropped (political, commercial, adult) or flagged (looks taken
 * over) from the universe: a suggestion never brings them back. The drop
 * and flag store is the universe's (x_author_stats), matched by handle.
 */
async function universeExcluded(): Promise<Set<string>> {
  const rows = await db
    .select({ username: xAuthorStats.username })
    .from(xAuthorStats)
    .where(
      or(
        isNotNull(xAuthorStats.droppedReason),
        isNotNull(xAuthorStats.flaggedReason),
      ),
    );
  return new Set(rows.map((r) => r.username.toLowerCase()));
}

/**
 * New DMs from allow-listed senders: one row per shared post link, and
 * every handled message id recorded (shares or not) so none is read
 * twice. Returns how many shared links weren't an Instagram post.
 */
async function syncDms(
  now: Date,
  g: NonNullable<ReturnType<typeof opts>> & { fetchImpl?: typeof fetch },
  deadline: number,
): Promise<number> {
  const since = new Date(now.getTime() - SUGGESTION_MAX_AGE_DAYS * DAY);
  // Ids seen since the window opened (older messages are skipped by date).
  const known = await db
    .select({ id: newsIgDmSeen.messageId })
    .from(newsIgDmSeen)
    .where(gte(newsIgDmSeen.seenAt, new Date(since.getTime() - DAY)));
  const shares = await suggestionShares(
    g.page,
    SUGGESTION_SENDERS,
    since,
    new Set(known.map((k) => k.id)),
    { ...g, deadline },
  );
  let unparsed = 0;
  const rows = shares.flatMap((s) =>
    s.links.flatMap((link) => {
      const shortcode = igShortcode(link);
      if (!shortcode) {
        unparsed++;
        return [];
      }
      return [
        {
          messageId: s.messageId,
          sender: s.sender,
          senderId: s.senderId,
          permalink: link,
          shortcode,
          sentAt: new Date(s.sentAt),
        },
      ];
    }),
  );
  if (rows.length)
    await db.insert(newsIgSuggestions).values(rows).onConflictDoNothing();
  if (shares.length)
    await db
      .insert(newsIgDmSeen)
      .values(shares.map((s) => ({ messageId: s.messageId })))
      .onConflictDoNothing();
  return unparsed;
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
          inArray(newsIgSuggestions.status, ["open", "expired", "retired"]),
          code
            ? sql`(${newsIgSuggestions.mediaId} = ${s.id} or ${newsIgSuggestions.shortcode} = ${code})`
            : eq(newsIgSuggestions.mediaId, s.id),
        ),
      );
  }
}

/**
 * The account behind a shared post, from its public page's og:url (what
 * link previews read). Our own User-Agent, one GET to a URL we build from
 * the shortcode, instagram.com only, no redirects followed (any 3xx is
 * null), at most PAGE_MAX_BYTES read. Null when the page doesn't say.
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
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel();
      return null;
    }
    return accountFromPostPage(await readCapped(res.body), shortcode);
  } catch {
    return null;
  }
}

/** A response body as text, at most PAGE_MAX_BYTES of it. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < PAGE_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(n, PAGE_MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, all.length - at);
    all.set(c.subarray(0, take), at);
    at += take;
  }
  return new TextDecoder().decode(all);
}
