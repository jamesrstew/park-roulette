import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { newsLessons, newsRetros } from "@/db/schema";
import {
  type Candidate,
  type LessonPatch,
  type LessonStatus,
  LIVE_STATUSES,
  matchLesson,
  patchProblem,
  PLAN_LESSON_DAYS,
  PLAN_LESSON_MAX,
  type Retro,
  retroCandidates,
  withExamples,
} from "./lessons";

/**
 * The lessons in the database: storing a retro (raw, then merged into
 * lessons under one advisory lock), the plan's open lessons, and the
 * maintainer's reads and status changes.
 */

export type LessonRow = typeof newsLessons.$inferSelect;

/** What the plan and the maintainer see of a lesson. */
export function lessonOut(l: LessonRow, examples = 3) {
  return {
    id: l.id,
    category: l.category,
    title: l.title,
    detail: l.detail,
    host: l.host,
    status: l.status,
    seen_count: l.seenCount,
    first_seen: l.firstSeen.toISOString(),
    last_seen: l.lastSeen.toISOString(),
    regressed: l.regressed,
    compliance: l.compliance,
    pr_url: l.prUrl,
    note: l.note,
    examples: (Array.isArray(l.examples) ? l.examples : []).slice(-examples),
  };
}
export type PlanLesson = ReturnType<typeof lessonOut>;

/**
 * Store a retro and merge its problems into lessons. One transaction under
 * an advisory lock, comparing in memory (a few hundred lessons at most).
 */
/** Retros per kind in 24 hours at most (a looping routine can't flood). */
export const RETROS_PER_DAY = 20;

export async function storeRetro(
  retro: Retro,
  now = new Date(),
): Promise<
  | { stored: true; retro: number; new: number[]; merged: number[] }
  | { stored: false; error: string }
> {
  const candidates = retroCandidates(retro, now);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('news_lessons'))`,
    );
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(newsRetros)
      .where(
        and(
          eq(newsRetros.kind, retro.run.kind),
          gte(newsRetros.createdAt, new Date(now.getTime() - 86_400_000)),
        ),
      );
    if ((recent?.n ?? 0) >= RETROS_PER_DAY)
      return {
        stored: false as const,
        error: `${RETROS_PER_DAY} ${retro.run.kind} retros in 24 hours already. Put everything in one retro per run.`,
      };
    const [row] = await tx
      .insert(newsRetros)
      .values({
        kind: retro.run.kind,
        issueDate: retro.run.issue_date ?? null,
        body: retro,
      })
      .returning({ id: newsRetros.id });
    const lessons = await tx.select().from(newsLessons);
    const created: number[] = [];
    const merged: number[] = [];
    /** Lessons this retro already counted: a repeat in one run counts once. */
    const counted = new Set<number>();
    for (const c of candidates) {
      const m = matchLesson(c, lessons);
      if (m.kind === "merge") {
        const l = lessons.find((x) => x.id === m.lesson.id)!;
        const again = counted.has(l.id);
        counted.add(l.id);
        const next = {
          seenCount: again ? l.seenCount : l.seenCount + 1,
          lastSeen: now,
          examples: withExamples(l.examples, c.examples),
          // Compliance only ever turns on.
          compliance: l.compliance || c.compliance,
          ...(m.reopen
            ? {
                status: "open" as const,
                regressed: true,
                closedAt: null,
              }
            : {}),
        };
        await tx.update(newsLessons).set(next).where(eq(newsLessons.id, l.id));
        Object.assign(l, next);
        if (!created.includes(l.id) && !merged.includes(l.id))
          merged.push(l.id);
        continue;
      }
      const [ins] = await tx
        .insert(newsLessons)
        .values(newRow(c, now))
        .returning();
      lessons.push(ins);
      created.push(ins.id);
      counted.add(ins.id);
    }
    return { stored: true as const, retro: row.id, new: created, merged };
  });
}

function newRow(c: Candidate, now: Date) {
  return {
    category: c.category,
    title: c.title,
    detail: c.detail,
    host: c.host,
    fingerprint: c.fingerprint,
    examples: withExamples([], c.examples),
    seenCount: 1,
    firstSeen: now,
    lastSeen: now,
    status: "open",
    compliance: c.compliance,
  };
}

/**
 * The plan's lessons: open, needs_james or fix_proposed, seen in the last
 * 8 weeks, most seen first, then most recent; 20 at most.
 */
export async function planLessons(now = new Date()): Promise<PlanLesson[]> {
  const since = new Date(now.getTime() - PLAN_LESSON_DAYS * 86_400_000);
  const rows = await db
    .select()
    .from(newsLessons)
    .where(
      and(
        inArray(newsLessons.status, [...LIVE_STATUSES]),
        gte(newsLessons.lastSeen, since),
      ),
    )
    .orderBy(desc(newsLessons.seenCount), desc(newsLessons.lastSeen))
    .limit(PLAN_LESSON_MAX);
  return rows.map((r) => lessonOut(r));
}

export async function listLessons(
  statuses: readonly LessonStatus[],
): Promise<PlanLesson[]> {
  const rows = await db
    .select()
    .from(newsLessons)
    .where(inArray(newsLessons.status, [...statuses]))
    .orderBy(desc(newsLessons.seenCount), desc(newsLessons.lastSeen))
    .limit(200);
  return rows.map((r) => lessonOut(r, EXAMPLES_FOR_MAINTAINER));
}
const EXAMPLES_FOR_MAINTAINER = 10;

/** This repository on GitHub (pull request links in lessons and the summary). */
export const GITHUB_REPO =
  process.env.GITHUB_REPO || "jamesrstew/park-roulette";

/** Change a lesson's status (the maintainer), with the guardrails. */
export async function patchLesson(
  id: number,
  patch: LessonPatch,
): Promise<
  | { ok: true; lesson: PlanLesson }
  | { ok: false; status: number; error: string }
> {
  const [l] = await db.select().from(newsLessons).where(eq(newsLessons.id, id));
  if (!l) return { ok: false, status: 404, error: "No such lesson." };
  const problem = patchProblem(l, patch, GITHUB_REPO);
  if (problem) return { ok: false, status: 422, error: problem };
  const closed = patch.status === "fixed" || patch.status === "wontfix";
  const [row] = await db
    .update(newsLessons)
    .set({
      status: patch.status,
      ...(patch.pr_url !== undefined ? { prUrl: patch.pr_url } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      closedAt: closed ? sql`now()` : null,
      ...(patch.status === "fixed" ? { regressed: false } : {}),
    })
    .where(eq(newsLessons.id, id))
    .returning();
  return { ok: true, lesson: lessonOut(row, EXAMPLES_FOR_MAINTAINER) };
}
