"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { crews, explorers, media, parks, reviews, visits } from "@/db/schema";
import { AVATARS, CRAYON_NAMES } from "./crayons";
import { FEATURE_KEYS, REVIEW_TAGS } from "./features";
import { inviteCode, slugify } from "./codes";
import { getMe } from "./data";
import { toTenths } from "./rating";
import { clearExplorer, setExplorer } from "./session";

export type ActionResult = { ok: true } | { ok: false; error: string };

const name = z.string().trim().min(1, "Give yourself a name!").max(40);
const color = z.enum(CRAYON_NAMES as [string, ...string[]]);
const avatar = z.string().refine((a) => AVATARS.includes(a), "Pick a buddy");

async function requireMe() {
  const me = await getMe();
  if (!me) throw new Error("Join a crew first!");
  return me;
}

function fail(e: unknown): ActionResult {
  if (e instanceof z.ZodError)
    return {
      ok: false,
      error: e.issues[0]?.message ?? "Hmm, that didn't work",
    };
  if (e instanceof Error) return { ok: false, error: e.message };
  return { ok: false, error: "Hmm, that didn't work" };
}

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

// ---------- crews & explorers ----------

const joinInput = z.object({
  code: z.string().min(4),
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
    const byJoin = (
      await db.select().from(crews).where(eq(crews.joinCode, data.code))
    )[0];
    let crewId: number;
    if (byJoin) {
      crewId = byJoin.id;
    } else {
      const byFriend = (
        await db.select().from(crews).where(eq(crews.friendCode, data.code))
      )[0];
      if (!byFriend)
        return {
          ok: false,
          error: "That invite code looks smudged. Ask for a new link!",
        };
      const crewName = data.crewName?.trim() || `${data.name}'s Crew`;
      const [crew] = await db
        .insert(crews)
        .values({
          name: crewName,
          color: data.color,
          joinCode: inviteCode(),
          friendCode: inviteCode(),
        })
        .returning();
      crewId = crew.id;
    }
    const [explorer] = await db
      .insert(explorers)
      .values({
        crewId,
        name: data.name,
        color: data.color,
        avatar: data.avatar,
      })
      .returning();
    await setExplorer(explorer.id);
  } catch (e) {
    if (isUniqueViolation(e))
      return {
        ok: false,
        error:
          "Someone in this crew already has that name. Tap it below if it's you!",
      };
    return fail(e);
  }
  redirect("/?welcome=1");
}

/** "That's me!" on a new phone: re-claim an explorer using the crew's join code. */
export async function claimExplorer(
  code: string,
  explorerId: number,
): Promise<ActionResult> {
  const crew = (
    await db.select().from(crews).where(eq(crews.joinCode, code))
  )[0];
  if (!crew) return { ok: false, error: "That invite code looks smudged." };
  const explorer = (
    await db
      .select()
      .from(explorers)
      .where(and(eq(explorers.id, explorerId), eq(explorers.crewId, crew.id)))
  )[0];
  if (!explorer) return { ok: false, error: "Couldn't find that explorer." };
  await setExplorer(explorer.id);
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
    await db
      .update(explorers)
      .set({ name: data.name, color: data.color, avatar: data.avatar })
      .where(eq(explorers.id, me.id));
    await db
      .update(crews)
      .set({ name: data.crewName })
      .where(eq(crews.id, me.crew.id));
    refresh();
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e))
      return {
        ok: false,
        error: "Someone in your crew already has that name.",
      };
    return fail(e);
  }
}

// ---------- visits ----------

const visitInput = z.object({
  parkId: z.number().int().positive(),
  visitedOn: z.iso.date(),
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
    return fail(e);
  }
}

export async function removeVisit(visitId: number): Promise<ActionResult> {
  try {
    const me = await requireMe();
    await db
      .delete(visits)
      .where(and(eq(visits.id, visitId), eq(visits.crewId, me.crew.id)));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- reviews ----------

const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

const reviewInput = z.object({
  parkId: z.number().int().positive(),
  stars: z.number().min(0).max(5),
  body: z.string().trim().max(4000),
  tags: z
    .array(z.enum(REVIEW_TAGS as [string, ...string[]]))
    .max(REVIEW_TAGS.length),
  addMedia: z
    .array(
      z.object({
        url: z
          .string()
          .regex(BLOB_HOST, "Uploads must come from our photo box"),
        kind: z.enum(["image", "video"]),
      }),
    )
    .max(12),
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
        await tx.insert(media).values(
          data.addMedia.map((m) => ({
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
    return fail(e);
  }
}

export async function deleteReview(parkId: number): Promise<ActionResult> {
  try {
    const me = await requireMe();
    await db
      .delete(reviews)
      .where(and(eq(reviews.parkId, parkId), eq(reviews.explorerId, me.id)));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- parks ----------

const parkInput = z.object({
  name: z.string().trim().min(2, "What's the park called?").max(80),
  city: z.string().trim().min(2, "Which town?").max(40),
  lat: z.number().min(42).max(46.5),
  lng: z.number().min(-124.7).max(-116.4),
  features: z.array(z.enum(FEATURE_KEYS as [string, ...string[]])),
  notes: z.string().trim().max(500).optional(),
});

export async function addPark(
  input: z.input<typeof parkInput>,
): Promise<ActionResult & { slug?: string }> {
  let slug: string;
  try {
    const me = await requireMe();
    const data = parkInput.parse(input);
    slug = slugify(`${data.name}-${data.city}`);
    const taken = (
      await db.select({ id: parks.id }).from(parks).where(eq(parks.slug, slug))
    )[0];
    if (taken) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
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
    return fail(e);
  }
  redirect(`/parks/${slug}?added=1`);
}

const flagInput = z.object({
  parkId: z.number().int().positive(),
  status: z.enum(["active", "no_playground", "closed"]),
  note: z.string().trim().max(300).optional(),
});

/** "There's no playground here!" Soft-hides a park; anyone can undo. */
export async function setParkStatus(
  input: z.input<typeof flagInput>,
): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const data = flagInput.parse(input);
    await db
      .update(parks)
      .set({
        status: data.status,
        statusNote:
          data.status === "active"
            ? null
            : `${data.note || "Flagged"} (${me.name})`,
        confidence: data.status === "active" ? "confirmed" : undefined,
      })
      .where(eq(parks.id, data.parkId));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const featuresInput = z.object({
  parkId: z.number().int().positive(),
  features: z.array(z.enum(FEATURE_KEYS as [string, ...string[]])),
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
        sources: sql`array(select distinct unnest(${parks.sources} || array['crowd']))`,
      })
      .where(eq(parks.id, data.parkId));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
