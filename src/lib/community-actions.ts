"use server";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  crews,
  explorers,
  media,
  parks,
  parkVotes,
  reviewReports,
  reviews,
  visits,
} from "@/db/schema";
import {
  type ActionResult,
  fail,
  requireAdmin,
  requireGrownUp,
  requireVoter,
  UserError,
} from "./action-utils";
import { castVote, validVote } from "./park-votes";
import { REPORT_REASONS } from "./reports";
import { deleteFiles } from "./photos";
import { clearExplorer, forgetGrownUp, forgetVerifiedPhone } from "./session";
import { canSee } from "./visibility";

// ---------- reports ----------

/** Reports one family can send in a day (so nobody can hide the whole town). */
const REPORTS_PER_DAY = 3;
/** Families it takes to hide a review for anything but "my kid". */
const HIDE_AT = 2;

const reportInput = z.object({
  reviewId: z.number().int().positive(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(300).optional(),
});

/**
 * "Something's not right with this review." A photo of your kid hides it
 * right away; anything else hides it once a second family agrees. Either
 * way an admin takes a look.
 */
export async function reportReview(
  input: z.input<typeof reportInput>,
): Promise<ActionResult & { hidden?: boolean }> {
  try {
    const me = await requireVoter();
    const data = reportInput.parse(input);
    const [r] = await db
      .select({
        visibility: reviews.visibility,
        hiddenAt: reviews.hiddenAt,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        crewId: explorers.crewId,
      })
      .from(reviews)
      .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
      .where(eq(reviews.id, data.reviewId));
    if (
      !r ||
      !canSee({ crewId: me.crew.id }, { ...r, hidden: r.hiddenAt != null })
    )
      throw new UserError("We couldn't find that review.");
    if (r.crewId === me.crew.id)
      throw new UserError(
        "That's your family's review. Edit or delete it instead!",
      );

    const hidden = await db.transaction(async (tx) => {
      // One report at a time per review (two families at once both count)
      // and per reporting family (the daily cap holds).
      await tx.execute(
        sql`select 1 from ${reviews} where id = ${data.reviewId} for update`,
      );
      await tx.execute(sql`select pg_advisory_xact_lock(4242, ${me.crew.id})`);
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(reviewReports)
        .where(
          and(
            eq(reviewReports.reporterCrewId, me.crew.id),
            sql`${reviewReports.createdAt} > now() - interval '1 day'`,
          ),
        );
      if (n >= REPORTS_PER_DAY)
        throw new UserError(
          "That's a lot of reports today. Email hello@parkroulette.quest and we'll help.",
        );
      const added = await tx
        .insert(reviewReports)
        .values({
          reviewId: data.reviewId,
          reporterId: me.id,
          reporterCrewId: me.crew.id,
          reason: data.reason,
          note: data.note || null,
        })
        .onConflictDoNothing()
        .returning({ id: reviewReports.id });
      if (!added.length) return false;
      const [{ families }] = await tx
        .select({ families: sql<number>`count(*)::int` })
        .from(reviewReports)
        .where(
          and(
            eq(reviewReports.reviewId, data.reviewId),
            isNull(reviewReports.resolvedAt),
          ),
        );
      if (data.reason !== "my_kid" && families < HIDE_AT) return false;
      await tx
        .update(reviews)
        .set({ hiddenAt: sql`now()` })
        .where(and(eq(reviews.id, data.reviewId), isNull(reviews.hiddenAt)));
      return true;
    });
    console.info(
      `[report] review ${data.reviewId} (${data.reason})${hidden ? " hidden" : ""}`,
    );
    refresh();
    return { ok: true, hidden };
  } catch (e) {
    return fail("reportReview", e);
  }
}

// ---------- admin ----------

const idInput = z.number().int().positive();

/** "It's fine": close the reports and show the review again. */
export async function restoreReview(reviewId: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = idInput.parse(reviewId);
    await db.transaction(async (tx) => {
      await tx
        .update(reviewReports)
        .set({ resolvedAt: sql`now()` })
        .where(
          and(eq(reviewReports.reviewId, id), isNull(reviewReports.resolvedAt)),
        );
      await tx
        .update(reviews)
        .set({ hiddenAt: null })
        .where(eq(reviews.id, id));
    });
    console.info(`[admin] restored review ${id}`);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("restoreReview", e);
  }
}

/** "Take it down": the review and its photos are deleted for good. */
export async function removeReview(reviewId: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = idInput.parse(reviewId);
    const files = await db
      .select({ url: media.url })
      .from(media)
      .where(eq(media.reviewId, id));
    await db.delete(reviews).where(eq(reviews.id, id));
    await deleteFiles(files.map((f) => f.url));
    console.info(`[admin] removed review ${id}`);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("removeReview", e);
  }
}

const fixInput = z.object({
  parkId: z.number().int().positive(),
  topic: z.string().max(60),
  value: z.string().max(20),
});

/** An admin settles a suggested park fix: apply it now. */
export async function applyFix(
  input: z.input<typeof fixInput>,
): Promise<ActionResult> {
  try {
    const me = await requireAdmin();
    const data = fixInput.parse(input);
    if (!validVote(data.topic, data.value)) throw new UserError("Unknown fix.");
    await castVote({ ...data, me });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("applyFix", e);
  }
}

/** An admin turns down a suggested fix (the park stays as it is). */
export async function dropFix(input: {
  parkId: number;
  topic: string;
}): Promise<ActionResult> {
  try {
    await requireAdmin();
    const data = fixInput.omit({ value: true }).parse(input);
    await db
      .delete(parkVotes)
      .where(
        and(eq(parkVotes.parkId, data.parkId), eq(parkVotes.topic, data.topic)),
      );
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("dropFix", e);
  }
}

/**
 * An admin turns down a family-added park. It's deleted if nothing points
 * at it yet; otherwise it stays unconfirmed (only its family sees it).
 */
export async function rejectPark(parkId: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = idInput.parse(parkId);
    const [used] = await db.execute<{ n: number }>(
      sql`select (select count(*) from ${visits} where park_id = ${id}) + (select count(*) from ${reviews} where park_id = ${id}) as n`,
    );
    if (Number(used?.n ?? 0) === 0)
      await db
        .delete(parks)
        .where(and(eq(parks.id, id), isNull(parks.approvedAt)));
    else
      await db
        .delete(parkVotes)
        .where(and(eq(parkVotes.parkId, id), eq(parkVotes.topic, "exists")));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("rejectPark", e);
  }
}

// ---------- terms ----------

/** "I'm a grown-up and I agree to the Terms and Privacy Policy." */
export async function acceptTerms(): Promise<ActionResult> {
  try {
    const me = await requireGrownUp();
    await db
      .update(explorers)
      .set({ termsAcceptedAt: sql`now()` })
      .where(eq(explorers.id, me.id));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("acceptTerms", e);
  }
}

// ---------- leaving ----------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Deletes explorers' reviews; returns their photo files to delete after. */
async function dropReviewsOf(tx: Tx, ids: number[]): Promise<string[]> {
  if (!ids.length) return [];
  const files = await tx
    .select({ url: media.url })
    .from(media)
    .innerJoin(reviews, eq(reviews.id, media.reviewId))
    .where(inArray(reviews.explorerId, ids));
  await tx.delete(reviews).where(inArray(reviews.explorerId, ids));
  return files.map((f) => f.url);
}

async function deleteWholeFamily(crewId: number): Promise<string[]> {
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ id: explorers.id })
      .from(explorers)
      .where(eq(explorers.crewId, crewId));
    const ids = members.map((m) => m.id);
    const files = await dropReviewsOf(tx, ids);
    await tx.delete(visits).where(eq(visits.crewId, crewId));
    // Parks they added stay on the map (parks.added_by becomes null).
    if (ids.length)
      await tx.delete(explorers).where(inArray(explorers.id, ids));
    await tx.delete(crews).where(eq(crews.id, crewId));
    return files;
  });
}

/** A grown-up who's signed in properly (not by a borrowed family link). */
async function requireTrustedGrownUp() {
  const me = await requireGrownUp();
  if (!me.trusted)
    throw new UserError(
      "For safety, sign in with your number (or on the phone you joined with) to do this.",
    );
  return me;
}

/**
 * Delete me. My reviews and photos go; the family's stamps stay. If I'm the
 * last grown-up, the whole family goes (kids don't stay on alone).
 */
export async function deleteMe(): Promise<ActionResult> {
  try {
    const me = await requireTrustedGrownUp();
    const others = await db
      .select({ id: explorers.id })
      .from(explorers)
      .where(
        and(
          eq(explorers.crewId, me.crew.id),
          ne(explorers.id, me.id),
          eq(explorers.isKid, false),
        ),
      );
    let files: string[];
    if (!others.length) files = await deleteWholeFamily(me.crew.id);
    else
      files = await db.transaction(async (tx) => {
        await tx
          .update(visits)
          .set({ loggedBy: others[0].id })
          .where(eq(visits.loggedBy, me.id));
        const f = await dropReviewsOf(tx, [me.id]);
        await tx.delete(explorers).where(eq(explorers.id, me.id));
        return f;
      });
    await deleteFiles(files);
    console.info(`[account] explorer ${me.id} deleted`);
  } catch (e) {
    return fail("deleteMe", e);
  }
  await clearExplorer();
  await forgetVerifiedPhone();
  await forgetGrownUp();
  redirect("/?bye=1");
}

/**
 * Delete our whole family: everyone, every stamp, review and photo. Only the
 * family's first grown-up with a number may (a family link is shared, so
 * someone who joined by link must never be able to wipe everyone).
 */
export async function deleteFamily(): Promise<ActionResult> {
  try {
    const me = await requireTrustedGrownUp();
    const [founder] = await db
      .select({ id: explorers.id })
      .from(explorers)
      .where(
        and(
          eq(explorers.crewId, me.crew.id),
          eq(explorers.isKid, false),
          sql`${explorers.phone} is not null`,
        ),
      )
      .orderBy(explorers.createdAt, explorers.id)
      .limit(1);
    if (founder && founder.id !== me.id)
      throw new UserError(
        "Only the grown-up who started your family can delete all of it. You can delete just yourself.",
      );
    await deleteFiles(await deleteWholeFamily(me.crew.id));
    console.info(`[account] crew ${me.crew.id} deleted`);
  } catch (e) {
    return fail("deleteFamily", e);
  }
  await clearExplorer();
  await forgetVerifiedPhone();
  await forgetGrownUp();
  redirect("/?bye=1");
}

/** A grown-up removes a kid's explorer (and their reviews) from the family. */
export async function removeKid(kidId: number): Promise<ActionResult> {
  try {
    const me = await requireTrustedGrownUp();
    if (!me.phone)
      throw new UserError(
        "Add your number first, so we know it's really a grown-up in your family.",
      );
    const id = idInput.parse(kidId);
    const files = await db.transaction(async (tx) => {
      const [kid] = await tx
        .select({ id: explorers.id })
        .from(explorers)
        .where(
          and(
            eq(explorers.id, id),
            eq(explorers.crewId, me.crew.id),
            eq(explorers.isKid, true),
          ),
        );
      if (!kid) throw new UserError("We couldn't find that kid.");
      await tx
        .update(visits)
        .set({ loggedBy: me.id })
        .where(eq(visits.loggedBy, id));
      const f = await dropReviewsOf(tx, [id]);
      await tx.delete(explorers).where(eq(explorers.id, id));
      return f;
    });
    await deleteFiles(files);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("removeKid", e);
  }
}
