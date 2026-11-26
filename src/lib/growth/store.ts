import "server-only";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { growthSnapshots } from "@/db/schema";
import type { Details, Snapshot } from "./model";

/**
 * The stored weeks (growth_snapshots). A week's numbers are written when
 * its digest is made and frozen once the email has gone; backfilled weeks
 * are only ever inserted, never overwritten.
 */

const toSnap = (r: typeof growthSnapshots.$inferSelect): Snapshot => ({
  weekStart: r.weekStart,
  metrics: r.metrics ?? {},
  details: (r.details ?? {}) as Details,
  backfilled: r.backfilled,
});

export async function loadSnapshots(weeks: string[]): Promise<Snapshot[]> {
  if (!weeks.length) return [];
  const rs = await db
    .select()
    .from(growthSnapshots)
    .where(inArray(growthSnapshots.weekStart, weeks))
    .orderBy(asc(growthSnapshots.weekStart));
  return rs.map(toSnap);
}

export async function snapshotRow(week: string) {
  const [r] = await db
    .select()
    .from(growthSnapshots)
    .where(eq(growthSnapshots.weekStart, week));
  return r ?? null;
}

/** The newest weeks stored, newest first (the web view's week picker). */
export async function storedWeeks(limit = 12): Promise<string[]> {
  const rs = await db
    .select({ w: growthSnapshots.weekStart })
    .from(growthSnapshots)
    .orderBy(sql`${growthSnapshots.weekStart} desc`)
    .limit(limit);
  return rs.map((r) => r.w);
}

/** A backfilled week: inserted once, never over a real one. */
export async function insertBackfill(s: Snapshot): Promise<void> {
  await db
    .insert(growthSnapshots)
    .values({
      weekStart: s.weekStart,
      metrics: s.metrics,
      details: s.details,
      backfilled: true,
    })
    .onConflictDoNothing();
}

/**
 * This week's numbers: written, or rewritten while the email hasn't gone
 * (a retry after a failed send). Once sent, the week is frozen.
 */
export async function saveSnapshot(s: Snapshot): Promise<void> {
  await db
    .insert(growthSnapshots)
    .values({
      weekStart: s.weekStart,
      metrics: s.metrics,
      details: s.details,
      backfilled: s.backfilled,
    })
    .onConflictDoUpdate({
      target: growthSnapshots.weekStart,
      set: {
        metrics: s.metrics,
        details: s.details,
        backfilled: s.backfilled,
        computedAt: sql`now()`,
      },
      // Frozen once the email is rendered: what's stored is what was sent.
      setWhere: isNull(growthSnapshots.renderedAt),
    });
}

/** Claim the week's send (one run at a time; a dead run frees it in 15 minutes). */
export async function claimSend(week: string): Promise<boolean> {
  const rs = await db
    .update(growthSnapshots)
    .set({ emailClaimedAt: sql`now()` })
    .where(
      and(
        eq(growthSnapshots.weekStart, week),
        isNull(growthSnapshots.emailSentAt),
        or(
          isNull(growthSnapshots.emailClaimedAt),
          lt(
            growthSnapshots.emailClaimedAt,
            sql`now() - interval '15 minutes'`,
          ),
        ),
      ),
    )
    .returning({ w: growthSnapshots.weekStart });
  return rs.length === 1;
}

export type RenderedEmail = { subject: string; html: string; text: string };

/**
 * Render once: store the email and the snapshot it was made from, in one
 * write, unless an earlier run already did (then its bytes win). Returns
 * the email to send and the key attempt it's on.
 */
export async function freezeEmail(
  s: Snapshot,
  email: RenderedEmail,
): Promise<{ email: RenderedEmail; attempt: number }> {
  await db
    .update(growthSnapshots)
    .set({
      metrics: s.metrics,
      details: s.details,
      backfilled: s.backfilled,
      computedAt: sql`now()`,
      renderedAt: sql`now()`,
      emailSubject: email.subject,
      emailHtml: email.html,
      emailText: email.text,
    })
    .where(
      and(
        eq(growthSnapshots.weekStart, s.weekStart),
        isNull(growthSnapshots.renderedAt),
      ),
    );
  const r = await snapshotRow(s.weekStart);
  if (!r?.emailSubject || r.emailHtml == null || r.emailText == null)
    throw new Error("growth digest: rendered email missing after freeze");
  return {
    email: { subject: r.emailSubject, html: r.emailHtml, text: r.emailText },
    attempt: r.emailAttempt,
  };
}

/** Resend clearly didn't take the last key: the next try uses a new one. */
export async function bumpAttempt(week: string) {
  await db
    .update(growthSnapshots)
    .set({ emailAttempt: sql`${growthSnapshots.emailAttempt} + 1` })
    .where(eq(growthSnapshots.weekStart, week));
}

export async function markSent(week: string, resendId: string | null) {
  await db
    .update(growthSnapshots)
    .set({ emailSentAt: sql`now()`, resendId })
    .where(eq(growthSnapshots.weekStart, week));
}

export async function releaseClaim(week: string) {
  await db
    .update(growthSnapshots)
    .set({ emailClaimedAt: null })
    .where(
      and(
        eq(growthSnapshots.weekStart, week),
        isNull(growthSnapshots.emailSentAt),
      ),
    );
}
