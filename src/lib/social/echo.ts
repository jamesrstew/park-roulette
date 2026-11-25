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
import { photoClear, type PhotoVerdicts } from "./links";
import { envKilled, getSocialSettings } from "./settings";
import {
  DAILY_PUBLISH_LIMIT,
  ECHO_MAX_AGE_MIN,
  type PhotoRef,
  type PostSpec,
} from "./model";

/**
 * The Story echo: once a feed post is out, the post itself goes out again
 * as Instagram Stories, one per slide, in slide order (a single image is
 * one Story; a carousel of N slides is N Stories). Each frame is the
 * slide drawn again at 9:16 by the same slide components (echo-render,
 * Slides.tsx frame "story"). It runs at the end of each social cron run,
 * under the same lease, kill switch, SOCIAL_PUBLISH and dry run, and it
 * never touches the feed post's own status: everything it records is in
 * the echo_* columns, the frames in echo_frames.
 *
 *   null -> creating -> publishing (one frame's publish, claimed)
 *        -> creating (the next frame) ... -> published
 *   null -> dry_run (drawn, never sent) | skipped (too old, or no quota)
 *   any  -> failed (James is told, once a day per post)
 *
 * Frames go out strictly one after another: the first frame not yet
 * published or skipped is the only one with a container in flight, so a
 * run that stops midway (an error, the time budget, the quota) resumes at
 * that frame next run and never makes or publishes one twice. In one run
 * a frame is created, its container read every 2.5 s (up to 30 s) until
 * Meta has it ready, and published, so a carousel goes out in one run.
 * SOCIAL_PUBLISH, the kill switch and dry run are read again before every
 * create and every publish.
 *
 * Child safety: a frame draws its slide's photo only while that photo is
 * clear on its exact bytes and never flagged (links.ts photoClear, the
 * rule /social/m serves by), else the crayon card. That is asked again
 * before every create (a flagged frame is redrawn photo-free) and every
 * publish (flagged once its container exists: that frame is skipped and
 * never published; the rest go on).
 *
 * The quota: the frames all count against Meta's 50 API publishes a day.
 * An echo starts only when the whole post fits (a carousel's Stories cut
 * short read as broken); if the room runs out midway anyway (something
 * else published meanwhile), it stops and resumes next run, until the
 * 6-hour limit closes it. A quota that can't be read never counts as
 * room: the echo waits for the next run.
 *
 * The Friday Story is never echoed. Facebook gets no echo: the Story path
 * doesn't cross-post (crossPost skips Stories). Echoes from before frames
 * (one "New post" card in echo_media) finish as a single frame.
 */

const render = () => import("./render");
const echoRender = () => import("./echo-render");

type PostRow = typeof socialPosts.$inferSelect;

/** One Story frame: one slide of the post, at 9:16. */
export type EchoFrame = {
  /** The feed slide it shows (0-based, in slide order). */
  slide: number;
  sha: string;
  ext: "jpg";
  width: number;
  height: number;
  /** The checked photo drawn in it, pinned to its bytes; null: photo-free. */
  photo: Pick<PhotoRef, "src" | "sha256"> | null;
  status: "pending" | "published" | "skipped";
  containerId: string | null;
  mediaId: string | null;
  reason?: string;
};

/** An echo from before frames (echo_media): one card, from the cover. */
type LegacyEcho = {
  sha: string;
  ext: "jpg";
  width: number;
  height: number;
  photoFree?: boolean;
};

/** A null echo looks back this far, so an old one is closed as skipped. */
const LOOKBACK_DAYS = 7;
/** The cron allows 300 s; echoes stop after this much of a run is gone. */
export const ECHO_BUDGET_MS = 200_000;

const frameUrl = (f: Pick<EchoFrame, "sha" | "ext">) =>
  `${SITE_URL}/social/m/${f.sha}.${f.ext}`;

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

// --- The photo check ---------------------------------------------------------

/** The photo slide `i` names (null: none). */
function slidePhoto(spec: PostSpec, i: number): PhotoRef | null {
  const s = spec.slides[i];
  return s && "photo" in s && s.photo ? s.photo : null;
}

/**
 * The photo frame `i` may draw: the one its feed slide drew (a post that
 * fell back to the crayon card names none), only while it's clear on
 * those exact bytes and never flagged. Null: the crayon card.
 */
export function framePhoto(
  spec: PostSpec,
  i: number,
  verdicts: PhotoVerdicts,
): PhotoRef | null {
  const ref = slidePhoto(spec, i);
  return ref && photoClear(ref, verdicts) ? ref : null;
}

/** The vision check's verdicts on these photos (never the whole table). */
export async function verdictsFor(srcs: string[]): Promise<PhotoVerdicts> {
  const v: PhotoVerdicts = { clear: new Set(), flagged: new Set() };
  if (!srcs.length) return v;
  for (const c of await db
    .select({
      src: socialPhotoChecks.src,
      sha256: socialPhotoChecks.sha256,
      verdict: socialPhotoChecks.verdict,
    })
    .from(socialPhotoChecks)
    .where(inArray(socialPhotoChecks.src, [...new Set(srcs)])))
    if (c.verdict === "clear") v.clear.add(`${c.src} ${c.sha256}`);
    else v.flagged.add(c.src);
  return v;
}

/** Would this frame show a photo that isn't clear now? */
async function frameFlagged(f: EchoFrame): Promise<boolean> {
  return !!f.photo && !photoClear(f.photo, await verdictsFor([f.photo.src]));
}

// --- Drawing -------------------------------------------------------------------

/**
 * Draw and store slide `i` as a Story frame. Its photo is drawn only if
 * the feed post drew it (the spec still names it: a post that fell back
 * to the crayon card names none), it's clear on those exact bytes now,
 * and the bytes still load and hash to what was checked; anything else
 * draws the crayon card.
 */
async function drawFrame(
  spec: PostSpec,
  i: number,
  verdicts?: PhotoVerdicts,
): Promise<EchoFrame> {
  const named = slidePhoto(spec, i);
  const ref = named
    ? framePhoto(spec, i, verdicts ?? (await verdictsFor([named.src])))
    : null;
  const photo = ref ? await (await render()).loadPhoto(ref) : null;
  const E = await echoRender();
  const file = await E.storeFrame(await E.renderFrame(spec.slides, i, photo));
  return {
    slide: i,
    ...file,
    photo: photo && ref ? { src: ref.src, sha256: ref.sha256 } : null,
    status: "pending",
    containerId: null,
    mediaId: null,
  };
}

/** Every slide of the post as a Story frame, in slide order. */
async function drawFrames(post: PostRow): Promise<EchoFrame[]> {
  const spec = post.spec as PostSpec;
  if (!spec.slides?.length) throw new Error("The post has no slides");
  const verdicts = await verdictsFor(
    spec.slides.flatMap((_, i) => slidePhoto(spec, i)?.src ?? []),
  );
  const frames: EchoFrame[] = [];
  for (let i = 0; i < spec.slides.length; i++)
    frames.push(await drawFrame(spec, i, verdicts));
  return frames;
}

/**
 * The echo's frames: echo_frames, or an echo from before frames as its
 * one frame (its card, its container, its cover photo).
 */
export function framesOf(post: {
  spec: unknown;
  echoFrames: unknown;
  echoMedia: unknown;
  echoContainerId: string | null;
}): EchoFrame[] {
  if (Array.isArray(post.echoFrames))
    return (post.echoFrames as EchoFrame[]).map((f) => ({ ...f }));
  const m = post.echoMedia as LegacyEcho | null;
  if (!m?.sha) return [];
  const ref = slidePhoto(post.spec as PostSpec, 0);
  return [
    {
      slide: 0,
      sha: m.sha,
      ext: m.ext,
      width: m.width,
      height: m.height,
      photo: m.photoFree || !ref ? null : { src: ref.src, sha256: ref.sha256 },
      status: "pending",
      containerId: post.echoContainerId,
      mediaId: null,
    },
  ];
}

// --- The run -------------------------------------------------------------------

/**
 * How long a run waits on Meta to finish a frame's container before it
 * publishes it: a read every 2.5 s, up to 30 s per frame (and never past
 * the run's time budget), so a carousel's frames go out in one run.
 */
export const ECHO_POLL = { everyMs: 2_500, maxMs: 30_000 };

/** The container's status, read again while Meta is still processing it. */
async function readyStatus(
  id: string,
  o: GraphOpts,
  outOfTime: () => boolean,
): Promise<Awaited<ReturnType<typeof containerStatus>>> {
  const start = Date.now();
  for (;;) {
    const s = await containerStatus(id, o);
    if (
      s.code !== "IN_PROGRESS" ||
      Date.now() - start + ECHO_POLL.everyMs > ECHO_POLL.maxMs ||
      outOfTime()
    )
      return s;
    await new Promise((r) => setTimeout(r, ECHO_POLL.everyMs));
  }
}

/**
 * Why nothing may go out right now (SOCIAL_PUBLISH=off, the kill switch,
 * dry run), or null. Asked again before every create and every publish,
 * so a switch flipped mid-run stops the next frame, not the next run.
 */
async function stopped(): Promise<string | null> {
  if (envKilled()) return "SOCIAL_PUBLISH is off";
  const s = await getSocialSettings();
  if (!s.enabled) return "the kill switch is on";
  if (s.dryRun) return "dry run is on";
  return null;
}

/** What one run knows about Meta's publishing quota. */
type Quota = { usage: number | null | undefined; used: number };

async function quotaLeft(q: Quota, o: GraphOpts): Promise<number | null> {
  if (q.usage === undefined)
    q.usage = await publishingQuota(o).catch(() => null);
  return q.usage == null ? null : DAILY_PUBLISH_LIMIT - q.usage - q.used;
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
  const quota: Quota = { usage: undefined, used: 0 };
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
          const frames = await drawFrames(post);
          await setEcho(post.id, {
            echoStatus: "dry_run",
            echoFrames: frames,
            echoReason: "Dry run.",
          });
          notes.push(
            `${post.id}: echo dry run, ${frames.length} ${frames.length === 1 ? "Story" : "Stories"}: ${frames.map(frameUrl).join(" ")}`,
          );
          continue;
        }
        if (post.status !== "published") continue; // a dry-run post never echoes live
        const n = (post.spec as PostSpec).slides?.length ?? 0;
        const left = await quotaLeft(quota, live);
        if (left == null) {
          // Never fail open: without the quota, wait for the next run.
          await setEcho(post.id, {
            echoReason: "Meta's publishing limit couldn't be read.",
          });
          notes.push(`${post.id}: echo waits (quota unknown)`);
          continue;
        }
        if (left < n) {
          await setEcho(post.id, {
            echoStatus: "skipped",
            echoReason: "Daily publishing limit reached.",
          });
          notes.push(
            `${post.id}: echo skipped (quota: ${n} Stories, ${left} left)`,
          );
          continue;
        }
        const frames = await drawFrames(post);
        await setEcho(post.id, {
          echoStatus: "creating",
          echoFrames: frames,
          echoReason: null,
        });
        await advance(
          { post, frames, status: "creating" },
          live,
          notes,
          now,
          quota,
          outOfTime,
        );
        continue;
      }
      if (!live) continue; // a live echo caught by a switch to dry run waits
      await advance(
        {
          post,
          frames: framesOf(post),
          status: post.echoStatus as "creating" | "publishing",
        },
        live,
        notes,
        now,
        quota,
        outOfTime,
      );
    } catch (e) {
      // Drawing or Blob: try again next run (closed as skipped at 6 hours).
      const msg = ((e as Error)?.message ?? "error").slice(0, 300);
      await setEcho(post.id, { echoReason: msg }).catch(() => {});
      notes.push(`${post.id}: echo retry (${msg})`);
    }
  }
}

/** An echo under way: the row, its frames and its status, as stored. */
type Echo = {
  post: PostRow;
  frames: EchoFrame[];
  status: "creating" | "publishing";
};

/** What a step leaves: go on to the next frame now, or stop this run. */
type Step = "next" | "stop";

async function save(
  e: Echo,
  patch: Partial<typeof socialPosts.$inferInsert> = {},
) {
  await setEcho(e.post.id, {
    echoFrames: e.frames,
    echoStatus: e.status,
    ...patch,
  });
}

const count = (e: Echo, s: EchoFrame["status"]) =>
  e.frames.filter((f) => f.status === s).length;
const sentLine = (e: Echo) => {
  const k = count(e, "published");
  return k
    ? ` ${k} of its ${e.frames.length} Stories went out before it.`
    : " No Story went out.";
};
const label = (e: Echo, i: number) =>
  e.frames.length > 1 ? `frame ${i + 1} of ${e.frames.length}` : "the Story";

async function fail(e: Echo, i: number, reason: string, notes: string[]) {
  await setEcho(e.post.id, {
    echoFrames: e.frames,
    echoStatus: "failed",
    echoReason: reason.slice(0, 300),
  });
  tellEcho(
    e.post,
    "failed",
    `The Story echo failed at ${label(e, i)}: ${reason}.${sentLine(e)}`,
  );
  notes.push(`${e.post.id}: echo failed (${reason})`);
}

/**
 * Work through the frames in order, as far as this run can: each step
 * creates, publishes or settles the first frame still pending.
 */
async function advance(
  e: Echo,
  o: GraphOpts,
  notes: string[],
  now: Date,
  quota: Quota,
  outOfTime: () => boolean,
): Promise<void> {
  // The row was "publishing" when the run found it: that publish never answered.
  let unanswered = e.status === "publishing";
  for (;;) {
    const i = e.frames.findIndex((f) => f.status === "pending");
    if (i < 0) return finish(e, notes);
    if (outOfTime()) {
      notes.push("echo: out of time, the next run goes on");
      return;
    }
    const why = await stopped();
    if (why) {
      notes.push(`${e.post.id}: echo waits (${why})`);
      return;
    }
    let step: Step;
    if (e.status === "publishing") {
      step = await resolveFrame(e, i, o, notes, now, quota, unanswered);
      unanswered = false;
    } else if (tooOld(e.post, now)) {
      return closeLate(e, notes);
    } else if (!e.frames[i].containerId) {
      step = await createFrame(e, i, o, notes, now, quota);
    } else {
      step = await publishStep(e, i, o, notes, quota, outOfTime);
    }
    if (step === "stop") return;
  }
}

/** Every frame published or skipped: the echo is done. */
async function finish(e: Echo, notes: string[]) {
  const sent = count(e, "published");
  const skipped = count(e, "skipped");
  if (!sent) {
    await setEcho(e.post.id, {
      echoFrames: e.frames,
      echoStatus: "skipped",
      echoReason: "Photo flagged after the Story was made; never published.",
    });
    notes.push(`${e.post.id}: echo skipped (photo flagged)`);
    return;
  }
  await setEcho(e.post.id, {
    echoFrames: e.frames,
    echoStatus: "published",
    echoMediaId: e.frames.find((f) => f.mediaId)?.mediaId ?? null,
    echoPublishedAt: new Date(),
    echoReason: skipped
      ? `${skipped} of ${e.frames.length} frames skipped (photo flagged).`
      : null,
  });
  notes.push(
    `${e.post.id}: echo published (${sent} ${sent === 1 ? "Story" : "Stories"})`,
  );
}

/** 6 hours on and frames still waiting: they never go out. */
async function closeLate(e: Echo, notes: string[]) {
  const sent = count(e, "published");
  for (const f of e.frames)
    if (f.status === "pending")
      Object.assign(f, { status: "skipped", reason: "Too late (6 hours)." });
  await setEcho(e.post.id, {
    echoFrames: e.frames,
    echoStatus: sent ? "published" : "skipped",
    echoReason: sent
      ? `Only ${sent} of ${e.frames.length} Stories went out: no publisher run in time (6 hours).`
      : "No publisher run in time (6 hours).",
    ...(sent ? { echoPublishedAt: new Date() } : {}),
  });
  tellEcho(
    e.post,
    "skipped",
    sent
      ? `No publisher run got the rest of the Stories out in time (6 hours after the post): only ${sent} of ${e.frames.length} went out, the rest were skipped.`
      : "No publisher run got the Story out in time: the cron runs only in each post's window, and 6 hours after the post it still wasn't published. It was skipped; no Story went out.",
  );
  notes.push(`${e.post.id}: echo closed (6 hours)`);
}

async function createFrame(
  e: Echo,
  i: number,
  o: GraphOpts,
  notes: string[],
  now: Date,
  quota: Quota,
): Promise<Step> {
  const left = await quotaLeft(quota, o);
  if (left == null || left < 1) {
    await save(e, {
      echoReason:
        left == null
          ? `Meta's publishing limit couldn't be read at ${label(e, i)}; it goes on next run.`
          : `Daily publishing limit reached at ${label(e, i)}; it goes on next run.`,
    });
    notes.push(`${e.post.id}: echo waits (quota)`);
    return "stop";
  }
  // The photo check, again: a flagged photo is redrawn as the crayon card.
  if (await frameFlagged(e.frames[i]))
    e.frames[i] = await drawFrame(e.post.spec as PostSpec, i);
  // Recorded before Meta is asked, so a crash never draws a second one.
  await save(e);
  try {
    const id = await createContainer(
      { kind: "story", imageUrl: frameUrl(e.frames[i]) },
      o,
    );
    e.frames[i].containerId = id;
    await save(e, { echoReason: null });
    notes.push(`${e.post.id}: echo container ${id} (${label(e, i)})`);
    return "next";
  } catch (err) {
    const g = err as GraphError;
    if (g instanceof GraphError && g.retryable && !tooOld(e.post, now)) {
      await setEcho(e.post.id, { echoReason: g.message });
      notes.push(`${e.post.id}: echo create retry (${g.message})`);
      return "stop";
    }
    await fail(e, i, `creating it failed: ${g?.message ?? "error"}`, notes);
    return "stop";
  }
}

/**
 * Asked right before every media_publish: a frame whose photo was flagged
 * after its container was made is skipped, never published. The echo
 * goes on with the next frame.
 */
async function safeToPublish(
  e: Echo,
  i: number,
  notes: string[],
  unanswered: boolean,
): Promise<boolean> {
  if (!(await frameFlagged(e.frames[i]))) return true;
  Object.assign(e.frames[i], {
    status: "skipped",
    reason: "Photo flagged after the Story was made; never published.",
  });
  e.status = "creating";
  await save(e);
  if (unanswered)
    // An earlier publish didn't answer: it may be up.
    tellEcho(
      e.post,
      "photo flagged",
      `A photo was flagged after an earlier publish of its Story (${label(e, i)}) didn't answer. Check @park_roulette's Stories and delete it if it's up.`,
    );
  notes.push(`${e.post.id}: echo ${label(e, i)} skipped (photo flagged)`);
  return false;
}

async function published(
  e: Echo,
  i: number,
  mediaId: string | null,
  quota: Quota,
  notes: string[],
  how = "",
) {
  Object.assign(e.frames[i], { status: "published", mediaId });
  quota.used++;
  e.status = "creating";
  await save(e, { echoReason: null });
  notes.push(
    `${e.post.id}: echo ${label(e, i)} published${mediaId ? ` ${mediaId}` : ""}${how}`,
  );
}

async function publishStep(
  e: Echo,
  i: number,
  o: GraphOpts,
  notes: string[],
  quota: Quota,
  outOfTime: () => boolean,
): Promise<Step> {
  let status;
  try {
    status = await readyStatus(e.frames[i].containerId!, o, outOfTime);
  } catch (err) {
    notes.push(`${e.post.id}: echo status unknown (${(err as Error).message})`);
    return "stop";
  }
  if (status.code === "IN_PROGRESS") return "stop";
  if (status.code === "ERROR" || status.code === "EXPIRED")
    return failFrame(e, i, `Meta couldn't process it (${status.code})`, notes);
  if (status.code === "PUBLISHED") {
    await published(e, i, null, quota, notes, " (resolved)");
    return "next";
  }
  if (!(await safeToPublish(e, i, notes, false))) return "next";
  // Claim it, so no other run ever publishes the same frame.
  const claimed = await db
    .update(socialPosts)
    .set({ echoStatus: "publishing", updatedAt: sql`now()` })
    .where(
      and(
        eq(socialPosts.id, e.post.id),
        eq(socialPosts.echoStatus, "creating"),
      ),
    )
    .returning({ id: socialPosts.id });
  if (!claimed.length) return "stop";
  e.status = "publishing";
  return publishFrame(e, i, o, notes, quota, false);
}

/**
 * media_publish, once; on an error the container's status decides, as for
 * feed posts (store.ts publish): PUBLISHED went out, FINISHED with a
 * retryable error goes back to creating, unclear waits, anything else fails.
 */
async function publishFrame(
  e: Echo,
  i: number,
  o: GraphOpts,
  notes: string[],
  quota: Quota,
  unanswered: boolean,
): Promise<Step> {
  if (!(await safeToPublish(e, i, notes, unanswered))) return "next";
  // A switch flipped while Meta finished the container: hold it.
  const why = await stopped();
  if (why) {
    if (!unanswered) {
      e.status = "creating";
      await save(e);
    }
    notes.push(`${e.post.id}: echo waits (${why})`);
    return "stop";
  }
  const container = e.frames[i].containerId!;
  try {
    const mediaId = await publishContainer(container, o);
    await published(e, i, mediaId, quota, notes);
    return "next";
  } catch (err) {
    const g = err as GraphError;
    if (/already (been )?published/i.test(g?.message ?? "")) {
      await published(e, i, null, quota, notes, " (Meta: already published)");
      return "next";
    }
    let status;
    try {
      status = await containerStatus(container, o);
    } catch {
      await setEcho(e.post.id, { echoReason: g?.message ?? "error" });
      notes.push(`${e.post.id}: echo publish unclear (${g?.message})`);
      return "stop";
    }
    if (status.code === "PUBLISHED") {
      await published(e, i, null, quota, notes, " (resolved)");
      return "next";
    }
    if (
      g instanceof GraphError &&
      g.ambiguous &&
      status.code !== "ERROR" &&
      status.code !== "EXPIRED"
    ) {
      await setEcho(e.post.id, { echoReason: g.message });
      notes.push(`${e.post.id}: echo publish unclear (${g.message})`);
      return "stop";
    }
    if (status.code === "FINISHED" && g instanceof GraphError && g.retryable) {
      e.status = "creating";
      await save(e, { echoReason: g.message });
      notes.push(`${e.post.id}: echo publish retry (${g.message})`);
      return "stop";
    }
    return failFrame(
      e,
      i,
      `publishing failed: ${g?.message ?? "error"}`,
      notes,
    );
  }
}

/**
 * Meta won't take a frame: if its photo was flagged meanwhile, only that
 * frame is skipped and the rest go on; otherwise the echo fails.
 */
async function failFrame(
  e: Echo,
  i: number,
  reason: string,
  notes: string[],
): Promise<Step> {
  if (!(await safeToPublish(e, i, notes, false))) return "next";
  await fail(e, i, reason, notes);
  return "stop";
}

/** A publish that didn't answer: ask the container (it publishes once, ever). */
async function resolveFrame(
  e: Echo,
  i: number,
  o: GraphOpts,
  notes: string[],
  now: Date,
  quota: Quota,
  unanswered: boolean,
): Promise<Step> {
  let status;
  try {
    status = await containerStatus(e.frames[i].containerId!, o);
  } catch {
    if (tooOld(e.post, now)) {
      await setEcho(e.post.id, {
        echoFrames: e.frames,
        echoStatus: "failed",
        echoReason: "Publish never confirmed, and Meta's status can't be read.",
      });
      tellEcho(
        e.post,
        "unclear",
        `Publishing ${label(e, i)} didn't answer and its status still can't be read. Check @park_roulette: it may or may not be up.${sentLine(e)}`,
      );
    }
    return "stop";
  }
  if (status.code === "PUBLISHED") {
    await published(e, i, null, quota, notes, " (resolved)");
    return "next";
  }
  if (status.code === "FINISHED" && !tooOld(e.post, now))
    return publishFrame(e, i, o, notes, quota, unanswered);
  return failFrame(e, i, `unclear publish, then ${status.code}`, notes);
}
