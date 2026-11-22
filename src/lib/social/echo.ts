import "server-only";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { socialPhotoChecks, socialPosts } from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import { SITE_URL } from "@/lib/site";
import {
  containerStatus,
  createContainer,
  GraphError,
  type GraphOpts,
  publishContainer,
  publishingQuota,
} from "./graph";
import {
  DAILY_PUBLISH_LIMIT,
  ECHO_MAX_AGE_MIN,
  echoLine,
  type PostKind,
  type PostSpec,
} from "./model";
import type { EchoFile } from "./echo-render";
import type { MediaFile } from "./render";

/**
 * The Story echo: once a feed post is out, one Instagram Story points
 * people at it (its cover on a crayon card, "New post" and a line by post
 * type). It runs at the end of each social cron run, under the same lease,
 * kill switch, SOCIAL_PUBLISH and dry run, and it never touches the feed
 * post's own status: everything it records is in the echo_* columns.
 *
 *   null -> creating (container made) -> publishing (claimed) -> published
 *   null -> dry_run (drawn, never sent) | skipped (too old, or no quota)
 *   any  -> failed (James is told, once a day per post)
 *
 * Only the cover that went out is used (the stored JPEG), so a post that
 * drew the crayon card because of the photo check echoes the same card.
 * The photo check is asked again before every create and every publish:
 * flagged before the container, the crayon cover is drawn; flagged once a
 * container with the photo exists, it is skipped and never published.
 * The Friday Story is never echoed. Facebook gets no echo: the Story
 * path doesn't cross-post (crossPost skips Stories).
 */

const echoRender = () => import("./echo-render");

type PostRow = typeof socialPosts.$inferSelect;

/** A null echo looks back this far, so an old one is closed as skipped. */
const LOOKBACK_DAYS = 7;
/** The cron allows 300 s; echoes stop after this much of a run is gone. */
export const ECHO_BUDGET_MS = 200_000;

const echoUrl = (f: EchoFile) => `${SITE_URL}/social/m/${f.sha}.${f.ext}`;

/**
 * When the feed post went out: never before its slot time (a dry run
 * never went out at all: its slot time).
 */
const outAt = (p: PostRow) =>
  p.publishedAt && p.publishedAt > p.publishAt ? p.publishedAt : p.publishAt;
const tooOld = (p: PostRow, now: Date) =>
  now.getTime() - outAt(p).getTime() > ECHO_MAX_AGE_MIN * 60_000;

async function setEcho(
  id: number,
  patch: Partial<typeof socialPosts.$inferInsert>,
) {
  await db
    .update(socialPosts)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(socialPosts.id, id));
}

function tellEcho(post: PostRow, what: string, text: string) {
  alertLater({
    key: `social:echo ${what}:${post.id}`,
    subject: `Instagram ${post.kind} for ${post.slotDate}: Story echo ${what}`,
    text: `${text} The feed post itself is fine.`,
    everyMinutes: 24 * 60,
  });
}

async function fail(post: PostRow, reason: string, notes: string[]) {
  await setEcho(post.id, {
    echoStatus: "failed",
    echoReason: reason.slice(0, 300),
  });
  tellEcho(post, "failed", `The Story echo failed: ${reason}.`);
  notes.push(`${post.id}: echo failed (${reason})`);
}

/** Was the cover's photo flagged (people or unsure) since it was drawn? */
async function coverFlagged(spec: PostSpec): Promise<boolean> {
  const s = spec.slides[0];
  const ref = s && "photo" in s ? s.photo : null;
  if (!ref) return false;
  const rows = await db
    .select({ verdict: socialPhotoChecks.verdict })
    .from(socialPhotoChecks)
    .where(eq(socialPhotoChecks.src, ref.src));
  return rows.some((r) => r.verdict !== "clear");
}

/** Does the cover name a photo at all? */
const coverHasPhoto = (spec: PostSpec) => {
  const s = spec.slides[0];
  return !!(s && "photo" in s && s.photo);
};

/** Draw and store the Story from the post's cleared cover. */
async function drawEcho(post: PostRow): Promise<EchoFile> {
  const spec = post.spec as PostSpec;
  const media = post.media as MediaFile[];
  if (!media[0] || !spec.slides[0]) throw new Error("The post has no cover");
  const R = await echoRender();
  const flagged = await coverFlagged(spec);
  const cover = flagged
    ? await R.crayonCover(spec.slides)
    : await R.storedBytes(media[0]);
  const file = await R.storeEcho(
    await R.renderEcho(
      spec.kind as PostKind,
      echoLine(spec),
      cover,
      spec.slides[0].t === "headline",
    ),
  );
  return { ...file, photoFree: flagged || !coverHasPhoto(spec) };
}

/** Would this Story show a photo that is flagged now? */
async function flaggedNow(post: PostRow, file: EchoFile | null) {
  return !file?.photoFree && (await coverFlagged(post.spec as PostSpec));
}

/**
 * Asked right before every media_publish: a Story whose photo was flagged
 * after its container was made is skipped, never published.
 */
async function safeToPublish(post: PostRow, notes: string[]) {
  if (!(await flaggedNow(post, post.echoMedia as EchoFile | null))) return true;
  await setEcho(post.id, {
    echoStatus: "skipped",
    echoReason: "Photo flagged after the Story was made; never published.",
  });
  if (post.echoStatus === "publishing")
    // An earlier publish didn't answer: it may be up.
    tellEcho(
      post,
      "photo flagged",
      "The cover photo was flagged after an earlier publish of its Story didn't answer. Check @park_roulette's Stories and delete it if it's up.",
    );
  notes.push(`${post.id}: echo skipped (photo flagged)`);
  return false;
}

/**
 * One pass over feed posts that are out: start, advance or close each
 * one's echo. `live` is null in dry run (or off production). Errors stay
 * here: the caller's feed posts are already settled.
 */
export async function runEchoes(
  now: Date,
  live: GraphOpts | null,
  notes: string[],
  startedAt = Date.now(),
): Promise<void> {
  const outOfTime = () => Date.now() - startedAt > ECHO_BUDGET_MS;
  if (outOfTime()) {
    notes.push("echo: out of time, the next run goes on");
    return;
  }
  const rows = await db
    .select()
    .from(socialPosts)
    .where(
      and(
        ne(socialPosts.kind, "story"),
        inArray(socialPosts.status, ["published", "dry_run"]),
        or(
          inArray(socialPosts.echoStatus, ["creating", "publishing"]),
          and(
            isNull(socialPosts.echoStatus),
            sql`greatest(${socialPosts.publishedAt}, ${socialPosts.publishAt}) > ${new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()}::timestamptz`,
          ),
        ),
      ),
    )
    .orderBy(socialPosts.publishAt);
  let quota: number | null | undefined;
  for (const post of rows) {
    if (outOfTime()) {
      notes.push("echo: out of time, the next run goes on");
      return;
    }
    try {
      if (post.echoStatus == null) {
        if (tooOld(post, now)) {
          await setEcho(post.id, {
            echoStatus: "skipped",
            echoReason: post.echoReason
              ? `Over 6 hours old (${post.echoReason}).`
              : "Over 6 hours old.",
          });
          if (post.echoReason)
            tellEcho(
              post,
              "skipped",
              `No publisher run got it out in time: the cron runs only in each post's window, and 6 hours after the post it still hadn't gone (last error: ${post.echoReason}). It was skipped; no Story went out.`,
            );
          continue;
        }
        if (!live) {
          if (post.status === "published") continue; // went live; dry run now: wait
          const file = await drawEcho(post);
          await setEcho(post.id, {
            echoStatus: "dry_run",
            echoMedia: file,
            echoReason: "Dry run.",
          });
          notes.push(`${post.id}: echo dry run ${echoUrl(file)}`);
          continue;
        }
        if (post.status !== "published") continue; // a dry-run post never echoes live
        if (quota === undefined)
          quota = await publishingQuota(live).catch(() => null);
        if (quota != null && quota >= DAILY_PUBLISH_LIMIT) {
          await setEcho(post.id, {
            echoStatus: "skipped",
            echoReason: "Daily publishing limit reached.",
          });
          notes.push(`${post.id}: echo skipped (quota)`);
          continue;
        }
        await createEcho(post, live, notes, now);
        continue;
      }
      if (!live) continue; // a live echo caught by a switch to dry run waits
      if (post.echoStatus === "creating") {
        if (tooOld(post, now)) {
          await setEcho(post.id, {
            echoStatus: "skipped",
            echoReason: "No publisher run in time (6 hours).",
          });
          tellEcho(
            post,
            "skipped",
            "No publisher run got the Story out in time: the cron runs only in each post's window, and 6 hours after the post it still wasn't published. It was skipped; no Story went out.",
          );
          continue;
        }
        if (!post.echoContainerId) await createEcho(post, live, notes, now);
        else await publishEchoStep(post, live, notes);
        continue;
      }
      await resolveEcho(post, live, notes, now);
    } catch (e) {
      // Drawing or Blob: try again next run (closed as skipped at 6 hours).
      const msg = ((e as Error)?.message ?? "error").slice(0, 300);
      await setEcho(post.id, { echoReason: msg }).catch(() => {});
      notes.push(`${post.id}: echo retry (${msg})`);
    }
  }
}

async function createEcho(
  post: PostRow,
  o: GraphOpts,
  notes: string[],
  now: Date,
) {
  const old = post.echoMedia as EchoFile | null;
  // The photo check, again: a flagged photo is redrawn as the crayon card.
  const file =
    old && !(await flaggedNow(post, old)) ? old : await drawEcho(post);
  // Recorded before Meta is asked, so a crash never draws a second one.
  await setEcho(post.id, { echoStatus: "creating", echoMedia: file });
  try {
    const id = await createContainer(
      { kind: "story", imageUrl: echoUrl(file) },
      o,
    );
    await setEcho(post.id, { echoContainerId: id, echoReason: null });
    notes.push(`${post.id}: echo container ${id}`);
  } catch (e) {
    const err = e as GraphError;
    if (err instanceof GraphError && err.retryable && !tooOld(post, now)) {
      await setEcho(post.id, { echoReason: err.message });
      notes.push(`${post.id}: echo create retry (${err.message})`);
      return;
    }
    await fail(post, `creating it failed: ${err?.message ?? "error"}`, notes);
  }
}

async function publishEchoStep(post: PostRow, o: GraphOpts, notes: string[]) {
  let status;
  try {
    status = await containerStatus(post.echoContainerId!, o);
  } catch (e) {
    notes.push(`${post.id}: echo status unknown (${(e as Error).message})`);
    return;
  }
  if (status.code === "IN_PROGRESS") return;
  if (status.code === "ERROR" || status.code === "EXPIRED")
    return fail(post, `Meta couldn't process it (${status.code})`, notes);
  if (status.code === "PUBLISHED") {
    await setEcho(post.id, {
      echoStatus: "published",
      echoPublishedAt: new Date(),
    });
    return;
  }
  if (!(await safeToPublish(post, notes))) return;
  // Claim it, so no other run ever publishes the same Story.
  const claimed = await db
    .update(socialPosts)
    .set({ echoStatus: "publishing", updatedAt: sql`now()` })
    .where(
      and(eq(socialPosts.id, post.id), eq(socialPosts.echoStatus, "creating")),
    )
    .returning({ id: socialPosts.id });
  if (!claimed.length) return;
  await publishEcho(post, o, notes);
}

/**
 * media_publish, once; on an error the container's status decides, as for
 * feed posts (store.ts publish): PUBLISHED went out, FINISHED with a
 * retryable error goes back to creating, unclear waits, anything else fails.
 */
async function publishEcho(post: PostRow, o: GraphOpts, notes: string[]) {
  if (!(await safeToPublish(post, notes))) return;
  try {
    const mediaId = await publishContainer(post.echoContainerId!, o);
    await setEcho(post.id, {
      echoStatus: "published",
      echoMediaId: mediaId,
      echoPublishedAt: new Date(),
      echoReason: null,
    });
    notes.push(`${post.id}: echo published ${mediaId}`);
  } catch (e) {
    const err = e as GraphError;
    if (/already (been )?published/i.test(err?.message ?? "")) {
      await setEcho(post.id, {
        echoStatus: "published",
        echoPublishedAt: new Date(),
        echoReason: null,
      });
      notes.push(`${post.id}: echo published (Meta: already published)`);
      return;
    }
    let status;
    try {
      status = await containerStatus(post.echoContainerId!, o);
    } catch {
      await setEcho(post.id, { echoReason: err?.message ?? "error" });
      notes.push(`${post.id}: echo publish unclear (${err?.message})`);
      return;
    }
    if (status.code === "PUBLISHED") {
      await setEcho(post.id, {
        echoStatus: "published",
        echoPublishedAt: new Date(),
        echoReason: null,
      });
      notes.push(`${post.id}: echo published (resolved)`);
      return;
    }
    if (
      err instanceof GraphError &&
      err.ambiguous &&
      status.code !== "ERROR" &&
      status.code !== "EXPIRED"
    ) {
      await setEcho(post.id, { echoReason: err.message });
      notes.push(`${post.id}: echo publish unclear (${err.message})`);
      return;
    }
    if (
      status.code === "FINISHED" &&
      err instanceof GraphError &&
      err.retryable
    ) {
      await setEcho(post.id, {
        echoStatus: "creating",
        echoReason: err.message,
      });
      notes.push(`${post.id}: echo publish retry (${err.message})`);
      return;
    }
    await fail(post, `publishing failed: ${err?.message ?? "error"}`, notes);
  }
}

/** A publish that didn't answer: ask the container (it publishes once, ever). */
async function resolveEcho(
  post: PostRow,
  o: GraphOpts,
  notes: string[],
  now: Date,
) {
  let status;
  try {
    status = await containerStatus(post.echoContainerId!, o);
  } catch {
    if (tooOld(post, now)) {
      await setEcho(post.id, {
        echoStatus: "failed",
        echoReason: "Publish never confirmed, and Meta's status can't be read.",
      });
      tellEcho(
        post,
        "unclear",
        "Publishing the Story didn't answer and its status still can't be read. Check @park_roulette: it may or may not be up.",
      );
    }
    return;
  }
  if (status.code === "PUBLISHED") {
    await setEcho(post.id, {
      echoStatus: "published",
      echoPublishedAt: new Date(),
      echoReason: null,
    });
    notes.push(`${post.id}: echo published (resolved)`);
    return;
  }
  if (status.code === "FINISHED" && !tooOld(post, now)) {
    await publishEcho(post, o, notes);
    return;
  }
  await fail(post, `unclear publish, then ${status.code}`, notes);
}
