import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { xAuthorStats } from "@/db/schema";
import type { SentIssue } from "./cooldowns";
import { blockedLink } from "./validate";
import { accountOut, coolingAuthors, SEED } from "./universe";
import {
  type Candidate,
  CANDIDATES_MAX,
  engagement,
  fetchUniverse,
  type KnownAccount,
  LIKES_FLOOR,
  lookupPost,
  lookupUsers,
  rankCandidates,
  median,
  planBatches,
  takeoverReason,
  type XPost,
} from "./xapi";

/** Samples kept per author for the trailing median. */
const SAMPLES_MAX = 40;
/** Roundup picks the writer may add to one plan (one lookup each). */
export const PICKS_MAX = 5;

type Row = typeof xAuthorStats.$inferSelect;

/** What the plan says about the universe this week. */
export type UniverseReport = {
  searched: number;
  /** Search calls made this week (pages included; 8 at most). */
  queries: number;
  /** Accounts left out this week to stay within the call budget. */
  skipped?: string[];
  posts: number;
  out: { username: string; reason: string }[];
  flagged: { username: string; reason: string }[];
};

/** Make sure every seed account has a row (its inactivity clock starts now). */
async function seedRows(): Promise<Row[]> {
  await db
    .insert(xAuthorStats)
    .values(
      SEED.map((a) => ({
        authorId: a.id,
        username: a.username,
        name: a.name,
        followers: a.followers,
        followersPeak: a.followers,
        addedFrom: "seed",
        roundups: a.sources,
      })),
    )
    .onConflictDoNothing();
  return db.select().from(xAuthorStats);
}

/**
 * This week's Parents' corner candidates: search the universe (3 to 4
 * calls), flag accounts that look taken over, score posts against each
 * author's trailing median, then fold this week's posts into the stats.
 * `picks` are post ids a roundup featured (one lookup each, at most 5);
 * they join the pool under the same rules.
 */
export async function discoverCandidates(opts: {
  issueDate: string;
  now: Date;
  history: readonly SentIssue[];
  picks?: readonly string[];
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ candidates: Candidate[]; report: UniverseReport }> {
  const token = opts.token ?? process.env.X_BEARER_TOKEN;
  const report: UniverseReport = {
    searched: 0,
    queries: 0,
    posts: 0,
    out: [],
    flagged: [],
  };
  if (!token) return { candidates: [], report };
  const rows = await seedRows();
  const byId = new Map(rows.map((r) => [r.authorId, r]));
  const seedOrder = new Map(SEED.map((a, i) => [a.id, i]));
  const excluded = coolingAuthors(opts.history, opts.issueDate);
  const live: Row[] = [];
  for (const r of rows) {
    const why =
      r.addedFrom === "seed" && !seedOrder.has(r.authorId)
        ? "left the seed list (November 19 revamp)"
        : accountOut(r, opts.now);
    if (why) {
      excluded.add(r.authorId);
      report.out.push({ username: r.username, reason: why });
    } else live.push(r);
  }
  // A week's batches within the call budget: seed numbers for seed
  // accounts, our own samples for accounts added from roundups.
  const seedBy = new Map(SEED.map((a) => [a.id, a]));
  const plan = planBatches(
    live.map((r) => {
      const seed = seedBy.get(r.authorId);
      const recent = (r.samples ?? []).filter(
        (x) => opts.now.getTime() - Date.parse(x.at) < 28 * 86_400_000,
      );
      return {
        username: r.username,
        postsPerWeek: seed?.postsPerWeek ?? Math.max(1, recent.length / 4),
        medianLikes:
          seed?.medianLikes ?? median((r.samples ?? []).map((x) => x.e)) ?? 0,
        appearances: seed?.appearances ?? (r.roundups ?? []).length,
      };
    }),
  );
  report.searched = live.length - plan.skipped.length;
  report.skipped = plan.skipped;

  const got = await fetchUniverse(
    token,
    plan.batches,
    opts.now,
    opts.fetchImpl,
  );
  report.posts = got.posts.length;
  report.queries = got.calls;

  // Takeovers: compare who answered with who we vetted.
  const byHandle = new Map(rows.map((r) => [r.username.toLowerCase(), r]));
  for (const u of got.users) {
    const known = byId.get(u.id) ?? byHandle.get(u.username.toLowerCase());
    if (!known) {
      excluded.add(u.id); // a stranger answering for a vetted handle
      continue;
    }
    const k: KnownAccount = {
      id: known.authorId,
      username: known.username,
      followersPeak: known.followersPeak,
    };
    const why = takeoverReason(k, {
      id: u.id,
      username: u.username,
      followers: u.public_metrics?.followers_count ?? null,
    });
    if (!why) continue;
    excluded.add(u.id);
    excluded.add(known.authorId);
    report.flagged.push({ username: known.username, reason: why });
    await db
      .update(xAuthorStats)
      .set({
        flaggedReason: why,
        flaggedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(xAuthorStats.authorId, known.authorId));
  }
  const vetted = got.posts.filter((p) => byId.has(p.authorId));
  const history = new Map(
    rows.map((r) => [r.authorId, (r.samples ?? []).map((s) => s.e)]),
  );
  const seedMedian = new Map(SEED.map((a) => [a.id, a.medianLikes]));
  const ranked = rankCandidates(vetted, {
    now: opts.now,
    history,
    excluded,
    seedMedian,
  });

  // Roundup picks: one lookup each, the same rules, never a duplicate.
  const pickPosts = (
    await Promise.all(
      [...new Set(opts.picks ?? [])]
        .slice(0, PICKS_MAX)
        .map((id) => lookupPost(id, token, opts.fetchImpl)),
    )
  ).filter((p): p is XPost => !!p);
  const picked = rankCandidates(pickPosts, {
    now: opts.now,
    history,
    excluded,
    via: "roundup",
  }).filter((p) => !ranked.some((r) => r.id === p.id));

  await foldStats(vetted, got.users, byId);
  return {
    candidates: [...ranked.slice(0, CANDIDATES_MAX), ...picked],
    report,
  };
}

/** Fold this week's posts and follower counts into the stats. */
async function foldStats(
  posts: readonly XPost[],
  users: readonly {
    id: string;
    public_metrics?: { followers_count?: number };
  }[],
  byId: ReadonlyMap<string, Row>,
): Promise<void> {
  const byAuthor = new Map<string, XPost[]>();
  for (const p of posts)
    byAuthor.set(p.authorId, [...(byAuthor.get(p.authorId) ?? []), p]);
  for (const [id, ps] of byAuthor) {
    const row = byId.get(id);
    if (!row || row.flaggedReason) continue;
    const old = row.samples ?? [];
    const fresh = ps
      .filter((p) => !old.some((s) => s.id === p.id))
      .map((p) => ({ id: p.id, e: engagement(p), at: p.createdAt }));
    const samples = [...fresh, ...old]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, SAMPLES_MAX);
    const floorAt = ps
      .filter((p) => p.likes >= LIKES_FLOOR)
      .map((p) => new Date(p.createdAt))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const followers =
      users.find((u) => u.id === id)?.public_metrics?.followers_count ?? null;
    await db
      .update(xAuthorStats)
      .set({
        samples,
        username: ps[0].username,
        name: ps[0].name,
        ...(followers != null
          ? {
              followers,
              followersPeak: Math.max(followers, row.followersPeak ?? 0),
            }
          : {}),
        ...(floorAt &&
        (!row.lastFloorAt || floorAt.getTime() > row.lastFloorAt.getTime())
          ? { lastFloorAt: floorAt }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(xAuthorStats.authorId, id));
  }
}

export const DROP_REASONS = ["political", "commercial", "adult"] as const;

/**
 * The universe grows itself: the weekly routine sends handles it saw in
 * roundups. A handle needs two or more distinct roundup links (never
 * another newsletter), then one users lookup for all of them; protected
 * or missing accounts are refused. Drops are for good.
 */
export async function growUniverse(
  input: {
    add?: { username: string; roundups: string[] }[];
    drop?: { username: string; reason: (typeof DROP_REASONS)[number] }[];
  },
  opts: { token?: string; fetchImpl?: typeof fetch } = {},
): Promise<{
  added: string[];
  refused: { username: string; reason: string }[];
  dropped: string[];
}> {
  const refused: { username: string; reason: string }[] = [];
  const asks = new Map<string, string[]>();
  for (const a of input.add ?? []) {
    const handle = a.username.replace(/^@/, "");
    const links = [
      ...new Set(
        a.roundups.filter((u) => {
          try {
            return new URL(u).protocol === "https:" && !blockedLink(u);
          } catch {
            return false;
          }
        }),
      ),
    ];
    if (!/^\w{1,15}$/.test(handle))
      refused.push({ username: handle, reason: "Not an X handle." });
    else if (links.length < 2)
      refused.push({
        username: handle,
        reason: "Needs two or more roundup links (not other newsletters).",
      });
    else asks.set(handle.toLowerCase(), links);
  }
  const added: string[] = [];
  if (asks.size) {
    const users = await lookupUsers(
      [...asks.keys()],
      opts.token ?? process.env.X_BEARER_TOKEN,
      opts.fetchImpl,
    );
    for (const [handle, links] of asks) {
      const u = users.find((x) => x.username.toLowerCase() === handle);
      if (!u) {
        refused.push({ username: handle, reason: "Not found on X." });
        continue;
      }
      if (u.protected) {
        refused.push({ username: handle, reason: "Protected account." });
        continue;
      }
      const followers = u.public_metrics?.followers_count ?? null;
      await db
        .insert(xAuthorStats)
        .values({
          authorId: u.id,
          username: u.username,
          name: u.name,
          followers,
          followersPeak: followers,
          addedFrom: "roundup",
          roundups: links,
        })
        .onConflictDoUpdate({
          target: xAuthorStats.authorId,
          set: {
            roundups: sql`(select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements(${xAuthorStats.roundups} || ${JSON.stringify(links)}::jsonb) v)`,
            updatedAt: sql`now()`,
          },
        });
      added.push(u.username);
    }
  }
  const dropped: string[] = [];
  const drops = (input.drop ?? []).filter((d) =>
    (DROP_REASONS as readonly string[]).includes(d.reason),
  );
  if (drops.length) {
    const rows = await db
      .select({
        authorId: xAuthorStats.authorId,
        username: xAuthorStats.username,
      })
      .from(xAuthorStats)
      .where(
        inArray(
          sql`lower(${xAuthorStats.username})`,
          drops.map((d) => d.username.replace(/^@/, "").toLowerCase()),
        ),
      );
    for (const r of rows) {
      const d = drops.find(
        (x) =>
          x.username.replace(/^@/, "").toLowerCase() ===
          r.username.toLowerCase(),
      )!;
      await db
        .update(xAuthorStats)
        .set({
          droppedReason: d.reason,
          droppedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(xAuthorStats.authorId, r.authorId));
      dropped.push(r.username);
    }
  }
  return { added, refused, dropped };
}
