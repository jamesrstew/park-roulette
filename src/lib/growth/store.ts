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
      setWhere: isNull(growthSnapshots.emailSentAt),
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
