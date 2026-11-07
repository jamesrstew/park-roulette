"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { crews, explorers, media, parks, reviews, visits } from "@/db/schema";
import { isOurBlobUrl } from "./blob";
import { AVATARS, CRAYON_NAMES } from "./crayons";
import { FEATURE_KEYS, REVIEW_TAGS } from "./features";
import { inviteCode, slugify } from "./codes";
import { getMe } from "./data";
import { toTenths } from "./rating";
import { clearExplorer, setExplorer } from "./session";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Markers in parks.sources that tell the seed "a person fixed this; keep it". */
const CROWD_FEATURES = "crowd";
const CROWD_PLAY = "crowd:play";

/** Max photos + videos on one review, across every save. */
const MAX_MEDIA_PER_REVIEW = 24;

/** An error whose message is written for people, safe to show in the UI. */
class UserError extends Error {}

const name = z.string().trim().min(1, "Give yourself a name!").max(40);
const color = z.enum(CRAYON_NAMES as [string, ...string[]]);
const avatar = z.string().refine((a) => AVATARS.includes(a), "Pick a buddy");
const featureList = z
  .array(z.enum(FEATURE_KEYS as [string, ...string[]]))
  .max(FEATURE_KEYS.length)
  .transform((f) => [...new Set(f)]);

async function requireMe() {
  const me = await getMe();
  if (!me) throw new UserError("Join a crew first!");
  return me;
}

/**
 * Turn any failure into a friendly result. Validation and UserError messages
 * are shown as-is; anything else (DB, network) is logged on the server and the
 * person sees a gentle retry message, never SQL.
 */
function fail(action: string, e: unknown): ActionResult {
  if (e instanceof z.ZodError)
    return {
      ok: false,
      error: e.issues[0]?.message ?? "Hmm, that didn't work",
    };
  if (e instanceof UserError) return { ok: false, error: e.message };
  console.error(`[action:${action}]`, e);
  return { ok: false, error: "Hmm, that didn't work. Try again in a sec?" };
}

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Adds a marker to parks.sources once (keeps the array tidy). */
const addSource = (marker: string) =>
  sql`array(select distinct unnest(${parks.sources} || array[${marker}]::text[]))`;

// ---------- crews & explorers ----------

const joinInput = z.object({
  code: z.string().trim().min(4).max(80),
  name,
  color,
  avatar,
  crewName: z.string().trim().max(40).optional(),
});

/** Join an existing crew (join code) or start a new crew (friend code). */
export async function joinWithCode(
  input: z.input<typeof joinInput>,
): Promise<ActionResult> {
  try {
    const data = joinInput.parse(input);
    const explorerId = await db.transaction(async (tx) => {
      const byJoin = (
        await tx.select().from(crews).where(eq(crews.joinCode, data.code))
      )[0];
      let crewId: number;
      if (byJoin) {
        crewId = byJoin.id;
      } else {
        const byFriend = (
          await tx.select().from(crews).where(eq(crews.friendCode, data.code))
        )[0];
        if (!byFriend)
          throw new UserError(
            "That invite code looks smudged. Ask for a new link!",
          );
        const [crew] = await tx
          .insert(crews)
          .values({
            name: data.crewName?.trim() || `${data.name}'s Crew`,
            color: data.color,
            joinCode: inviteCode(),
            friendCode: inviteCode(),
          })
          .returning();
        crewId = crew.id;
      }
      const [explorer] = await tx
        .insert(explorers)
        .values({
          crewId,
          name: data.name,
          color: data.color,
          avatar: data.avatar,
        })
        .returning();
      return explorer.id;
    });
    await setExplorer(explorerId);
  } catch (e) {
    if (isUniqueViolation(e))
      return {
        ok: false,
        error:
          "Someone in this crew already has that name. Tap it below if it's you!",
      };
    return fail("joinWithCode", e);
  }
  redirect("/?welcome=1");
}

const claimInput = z.object({
  code: z.string().trim().min(4).max(80),
  explorerId: z.number().int().positive(),
});

/** "That's me!" on a new phone: re-claim an explorer using the crew's join code. */
export async function claimExplorer(
  code: string,
  explorerId: number,
): Promise<ActionResult> {
  try {
    const data = claimInput.parse({ code, explorerId });
    const crew = (
      await db.select().from(crews).where(eq(crews.joinCode, data.code))
    )[0];
    if (!crew) return { ok: false, error: "That invite code looks smudged." };
    const explorer = (
      await db
        .select()
        .from(explorers)
        .where(
          and(eq(explorers.id, data.explorerId), eq(explorers.crewId, crew.id)),
        )
    )[0];
    if (!explorer) return { ok: false, error: "Couldn't find that explorer." };
    await setExplorer(explorer.id);
  } catch (e) {
    return fail("claimExplorer", e);
  }
  redirect("/?welcome=1");
}

export async function signOut() {
  await clearExplorer();
  redirect("/me");
}

const profileInput = z.object({
  name,
  color,
  avatar,
  crewName: z.string().trim().min(1).max(40),
});

export async function updateProfile(
  input: z.input<typeof profileInput>,
): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const data = profileInput.parse(input);
    await db.transaction(async (tx) => {
      await tx
        .update(explorers)
        .set({ name: data.name, color: data.color, avatar: data.avatar })
        .where(eq(explorers.id, me.id));
      await tx
        .update(crews)
        .set({ name: data.crewName })
        .where(eq(crews.id, me.crew.id));
    });
    refresh();
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e))
      return {
        ok: false,
        error: "Someone in your crew already has that name.",
      };
    return fail("updateProfile", e);
  }
}

// ---------- visits ----------

/** ISO date in Bend. Visits can't be in the future (a day of slack for travelers). */
function tomorrowInBend() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

const visitInput = z.object({
  parkId: z.number().int().positive(),
  visitedOn: z.iso
    .date()
    .refine((d) => d >= "2000-01-01", "That's a long time ago!")
    .refine((d) => d <= tomorrowInBend(), "That day hasn't happened yet!"),
});

export async function logVisit(
  input: z.input<typeof visitInput>,
): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const data = visitInput.parse(input);
    await db.insert(visits).values({
      parkId: data.parkId,
      crewId: me.crew.id,
      loggedBy: me.id,
      visitedOn: data.visitedOn,
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("logVisit", e);
  }
}

export async function removeVisit(visitId: number): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const id = z.number().int().positive().parse(visitId);
    await db
      .delete(visits)
      .where(and(eq(visits.id, id), eq(visits.crewId, me.crew.id)));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("removeVisit", e);
  }
}

// ---------- reviews ----------

const reviewInput = z.object({
  parkId: z.number().int().positive(),
  stars: z.number().min(0).max(5),
  body: z.string().trim().max(4000),
  tags: z
    .array(z.enum(REVIEW_TAGS as [string, ...string[]]))
    .max(REVIEW_TAGS.length)
    .transform((t) => [...new Set(t)]),
  addMedia: z
    .array(
      z.object({
        url: z
          .string()
          .refine(
            (u) => isOurBlobUrl(u),
            "Uploads must come from our photo box",
          ),
        kind: z.enum(["image", "video"]),
      }),
    )
    .max(12)
    .transform((m) => [...new Map(m.map((x) => [x.url, x])).values()]),
  removeMediaIds: z.array(z.number().int().positive()).max(50),
});

export async function saveReview(
  input: z.input<typeof reviewInput>,
): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const data = reviewInput.parse(input);
    const tenths = toTenths(data.stars);
    await db.transaction(async (tx) => {
      const [review] = await tx
        .insert(reviews)
        .values({
          parkId: data.parkId,
          explorerId: me.id,
          ratingTenths: tenths,
          body: data.body,
          tags: data.tags,
        })
        .onConflictDoUpdate({
          target: [reviews.parkId, reviews.explorerId],
          set: {
            ratingTenths: tenths,
            body: data.body,
            tags: data.tags,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      if (data.removeMediaIds.length) {
        await tx
          .delete(media)
          .where(
            and(
              eq(media.reviewId, review.id),
              inArray(media.id, data.removeMediaIds),
            ),
          );
      }
      if (data.addMedia.length) {
        const existing = await tx
          .select({ url: media.url })
          .from(media)
          .where(eq(media.reviewId, review.id));
        const have = new Set(existing.map((m) => m.url));
        const fresh = data.addMedia.filter((m) => !have.has(m.url));
        if (existing.length + fresh.length > MAX_MEDIA_PER_REVIEW)
          throw new UserError(
            `That's a lot of photos! Keep it to ${MAX_MEDIA_PER_REVIEW} per review.`,
          );
        if (fresh.length)
          await tx.insert(media).values(
            fresh.map((m) => ({
              reviewId: review.id,
              url: m.url,
              kind: m.kind,
            })),
          );
      }
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("saveReview", e);
  }
}

export async function deleteReview(parkId: number): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const id = z.number().int().positive().parse(parkId);
    await db
      .delete(reviews)
      .where(and(eq(reviews.parkId, id), eq(reviews.explorerId, me.id)));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("deleteReview", e);
  }
}

// ---------- parks ----------

/** Slugs that are real routes under /parks/. */
const RESERVED_SLUGS = new Set(["new"]);

const parkInput = z.object({
  name: z.string().trim().min(2, "What's the park called?").max(80),
  city: z.string().trim().min(2, "Which town?").max(40),
  lat: z.number().min(42).max(46.5),
  lng: z.number().min(-124.7).max(-116.4),
  features: featureList,
  notes: z.string().trim().max(500).optional(),
});

export async function addPark(
  input: z.input<typeof parkInput>,
): Promise<ActionResult & { slug?: string }> {
  let slug: string;
  try {
    const me = await requireMe();
    const data = parkInput.parse(input);
    const suffix = () => Date.now().toString(36).slice(-5);
    slug = slugify(`${data.name}-${data.city}`);
    if (slug.length < 3 || RESERVED_SLUGS.has(slug)) slug = `park-${suffix()}`;
    const taken = (
      await db.select({ id: parks.id }).from(parks).where(eq(parks.slug, slug))
    )[0];
    if (taken) slug = `${slug}-${suffix()}`;
    await db.insert(parks).values({
      slug,
      name: data.name,
      city: data.city,
      lat: data.lat,
      lng: data.lng,
      kind: "park",
      features: data.features,
      confidence: "confirmed",
      sources: [`explorer:${me.id}`],
      notes: data.notes || null,
      addedBy: me.id,
    });
  } catch (e) {
    return fail("addPark", e);
  }
  redirect(`/parks/${slug}?added=1`);
}

const flagInput = z.object({
  parkId: z.number().int().positive(),
  status: z.enum(["active", "no_playground", "closed", "private"]),
  note: z.string().trim().max(300).optional(),
});

/**
 * Cross a park off the bucket list (closed, private) or put it back.
 * "no_playground" is a correction, not a cross-off: the park stays on the
 * list as a park without a playground. Anyone in any crew can undo.
 */
export async function setParkStatus(
  input: z.input<typeof flagInput>,
): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const data = flagInput.parse(input);
    if (data.status === "no_playground") {
      await db
        .update(parks)
        .set({
          play: "none",
          status: "active",
          statusNote: `${data.note || "No playground here"} (${me.name})`,
          sources: addSource(CROWD_PLAY),
        })
        .where(eq(parks.id, data.parkId));
    } else {
      await db
        .update(parks)
        .set({
          status: data.status,
          statusNote:
            data.status === "active"
              ? null
              : `${data.note || "Crossed off"} (${me.name})`,
          confidence: data.status === "active" ? "confirmed" : undefined,
        })
        .where(eq(parks.id, data.parkId));
    }
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("setParkStatus", e);
  }
}

const playInput = z.object({
  parkId: z.number().int().positive(),
  play: z.enum(["playground", "nature", "none"]),
});

/** "Actually there IS a playground!" (or the reverse). */
export async function setParkPlay(
  input: z.input<typeof playInput>,
): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const data = playInput.parse(input);
    await db
      .update(parks)
      .set({
        play: data.play,
        // A legacy "no_playground" status would otherwise keep overriding play.
        status: sql`case when ${parks.status} = 'no_playground' then 'active' else ${parks.status} end`,
        statusNote: `Marked ${data.play === "none" ? "no playground" : data.play} by ${me.name}`,
        sources: addSource(CROWD_PLAY),
      })
      .where(eq(parks.id, data.parkId));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("setParkPlay", e);
  }
}

const featuresInput = z.object({
  parkId: z.number().int().positive(),
  features: featureList,
});

/** Crowd-fix the sticker list after a visit. */
export async function updateFeatures(
  input: z.input<typeof featuresInput>,
): Promise<ActionResult> {
  try {
    await requireMe();
    const data = featuresInput.parse(input);
    await db
      .update(parks)
      .set({
        features: data.features,
        confidence: "confirmed",
        sources: addSource(CROWD_FEATURES),
      })
      .where(eq(parks.id, data.parkId));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("updateFeatures", e);
  }
}
