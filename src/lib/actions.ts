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
import { toTenths } from "./rating";
import {
  type ActionResult,
  fail,
  isUniqueViolation,
  requireMe,
  uniqueConstraint,
  UserError,
} from "./action-utils";
import {
  clearExplorer,
  forgetVerifiedPhone,
  setExplorer,
  verifiedPhone,
} from "./session";

export type { ActionResult };

/** Markers in parks.sources that tell the seed "a person fixed this; keep it". */
const CROWD_FEATURES = "crowd";
const CROWD_PLAY = "crowd:play";

/** Max photos + videos on one review, across every save. */
const MAX_MEDIA_PER_REVIEW = 24;

const name = z.string().trim().min(1, "Give yourself a name!").max(40);
const color = z.enum(CRAYON_NAMES as [string, ...string[]]);
const avatar = z.string().refine((a) => AVATARS.includes(a), "Pick a buddy");
const featureList = z
  .array(z.enum(FEATURE_KEYS as [string, ...string[]]))
  .max(FEATURE_KEYS.length)
  .transform((f) => [...new Set(f)]);

/** Adds a marker to parks.sources once (keeps the array tidy). */
const addSource = (marker: string) =>
  sql`array(select distinct unnest(${parks.sources} || array[${marker}]::text[]))`;

// ---------- crews & explorers ----------

const joinInput = z.object({
  code: z.string().trim().min(4).max(80),
  /** Attach the number they just proved (they ticked the box). */
  usePhone: z.boolean().optional(),
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
    // A number they proved a minute ago ("we don't know that number yet")
    // comes along only if they said so on the join form.
    const proved = data.usePhone ? await verifiedPhone() : null;
    let explorerId: number;
    try {
      explorerId = await insertExplorer(data, proved);
    } catch (e) {
      // Someone else grabbed that number in the meantime: join without it.
      if (proved && uniqueConstraint(e) === "explorers_phone_unique")
        explorerId = await insertExplorer(data, null);
      else throw e;
    }
    if (proved) await forgetVerifiedPhone();
    await setExplorer(explorerId, 0, "j");
    console.info(
      `[auth] explorer ${explorerId} joined${proved ? " with a number" : ""}`,
    );
  } catch (e) {
    if (isUniqueViolation(e))
      return {
        ok: false,
        error:
          "Someone in this family already has that name. Tap it below if it's you!",
      };
    return fail("joinWithCode", e);
  }
  redirect("/?welcome=1");
}

/** The family for a join or friend code (a friend code starts a new one). */
async function insertExplorer(
  data: z.output<typeof joinInput>,
  phone: string | null,
): Promise<number> {
  return db.transaction(async (tx) => {
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
          name: data.crewName?.trim() || `${data.name}'s Family`,
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
        ...(phone ? { phone, phoneVerifiedAt: new Date() } : {}),
      })
      .returning({ id: explorers.id });
    return explorer.id;
  });
}

const kidInput = z.object({ name, color, avatar });

/**
 * "A kid on this phone": make an explorer in my family and switch to them.
 * Kids don't get numbers; switching back to a grown-up with a number takes a
 * code (Me → "Who's playing?").
 */
export async function addKid(
  input: z.input<typeof kidInput>,
): Promise<ActionResult & { name?: string }> {
  try {
    const me = await requireMe();
    const data = kidInput.parse(input);
    const [kid] = await db
      .insert(explorers)
      .values({ crewId: me.crew.id, ...data })
      .returning({ id: explorers.id, epoch: explorers.sessionEpoch });
    await setExplorer(kid.id, kid.epoch, "l");
    console.info(`[auth] explorer ${me.id} added kid ${kid.id}`);
    return { ok: true, name: data.name };
  } catch (e) {
    if (isUniqueViolation(e))
      return {
        ok: false,
        error: "Someone in your family already has that name.",
      };
    return fail("addKid", e);
  }
}

export async function signOut() {
  await clearExplorer();
  await forgetVerifiedPhone();
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
        error: "Someone in your family already has that name.",
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
