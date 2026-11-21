import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Retro } from "./lessons";

/**
 * Lessons against a real (local) Postgres: storing retros, merging
 * repeats, the plan's open lessons and the maintainer's status changes.
 * Opt-in: set TEST_DATABASE_URL (see sender.db.test.ts). It wipes
 * news_retros, news_lessons and kid_event_handins.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);

const PR = "https://github.com/jamesrstew/park-roulette/pull/77";

describe.skipIf(!local)("lessons, against Postgres", () => {
  let store: typeof import("./lessons-store");
  let lessons: typeof import("./lessons");
  let q: (s: string) => Promise<Record<string, unknown>[]>;

  const retro = (over: Partial<Retro> = {}): Retro =>
    lessons.RetroSchema.parse({
      run: { kind: "writer", issue_date: "2026-11-26" },
      ...over,
    });
  const windowProblem = (when: string) => ({
    category: "validator" as const,
    title: "Draft accepted after the send window started",
    detail: `The drafts endpoint stored a draft for today at ${when}, after the 7:00 send window, and reported success.`,
  });

  /** A stored retro's answer (fails the test when it wasn't stored). */
  const put = async (r: Retro) => {
    const out = await store.storeRetro(r);
    if (!out.stored) throw new Error(out.error);
    return out;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    store = await import("./lessons-store");
    lessons = await import("./lessons");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    await q(
      "truncate news_retros, news_lessons, kid_event_handins restart identity",
    );
  });

  it("stores the Sunday Instagram routine's retro (kind social, week_of)", async () => {
    const r = lessons.RetroSchema.parse({
      run: { kind: "social", week_of: "2026-11-23" },
      problems: [
        {
          category: "source",
          title: "Park photo would not download",
          detail:
            "The catalog photo for Pine Nursery Park answered 404, so the park post used the crayon card.",
        },
      ],
    });
    await put(r);
    const rows = await q("select kind, issue_date, body from news_retros");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "social", issue_date: null });
    expect((rows[0].body as Retro).run.week_of).toBe("2026-11-23");
  });

  it("stores the raw retro and makes a lesson, then merges a repeat", async () => {
    const a = await put(
      retro({
        problems: [windowProblem("6:23 pm")],
        blocked_hosts: [
          {
            host: "www.oldmilldistrict.com",
            kind: "reset",
            url: "https://www.oldmilldistrict.com/events/",
          },
        ],
      }),
    );
    expect(a).toMatchObject({ stored: true, new: [1, 2], merged: [] });
    const b = await put(
      retro({
        problems: [windowProblem("7:40 pm")],
        blocked_hosts: [
          {
            host: "oldmilldistrict.com",
            kind: "reset",
            url: "https://oldmilldistrict.com/santaland/",
          },
        ],
      }),
    );
    expect(b.new).toEqual([]);
    expect(b.merged.sort()).toEqual([1, 2]);
    const rows = await q(
      "select id, seen_count, jsonb_array_length(examples) n from news_lessons order by id",
    );
    expect(rows.map((r) => r.seen_count)).toEqual([2, 2]);
    expect(rows[1].n).toBe(2);
    expect(await q("select id from news_retros")).toHaveLength(2);
  });

  it("counts two copies of one problem in a single retro once", async () => {
    const r = await put(
      retro({ problems: [windowProblem("6:23 pm"), windowProblem("6:30 pm")] }),
    );
    expect(r.new).toEqual([1]);
    expect(r.merged).toEqual([]);
    const [l] = await q("select seen_count from news_lessons");
    expect(l.seen_count).toBe(1);
  });

  it("takes 20 retros per kind a day, then refuses", async () => {
    for (let i = 0; i < 20; i++) await put(retro());
    const r = await store.storeRetro(retro());
    expect(r).toMatchObject({ stored: false });
    // Another kind has its own count.
    await put(retro({ run: { kind: "events" } }));
  });

  it("reopens a fixed lesson as regressed when it's seen again", async () => {
    await put(retro({ problems: [windowProblem("6:23 pm")] }));
    const fixed = await store.patchLesson(1, { status: "fixed", pr_url: PR });
    expect(fixed.ok).toBe(true);
    await put(retro({ problems: [windowProblem("6:50 pm")] }));
    const [l] = await q(
      "select status, regressed, closed_at from news_lessons",
    );
    expect(l).toMatchObject({
      status: "open",
      regressed: true,
      closed_at: null,
    });
  });

  it("the plan carries live lessons from the last 8 weeks, most seen first, 20 at most", async () => {
    // 23 hosts in two retros (20 blocked hosts per retro at most).
    const host = (i: number) => ({
      host: `host${i}.example.org`,
      kind: "timeout" as const,
      url: `https://host${i}.example.org/`,
    });
    await put(
      retro({ blocked_hosts: Array.from({ length: 12 }, (_, i) => host(i)) }),
    );
    await put(
      retro({
        blocked_hosts: Array.from({ length: 11 }, (_, i) => host(i + 12)),
      }),
    );
    // Seen twice: first in the plan.
    await put(
      retro({
        blocked_hosts: [
          {
            host: "host5.example.org",
            kind: "timeout",
            url: "https://host5.example.org/a",
          },
        ],
      }),
    );
    await q(
      "update news_lessons set last_seen = now() - interval '57 days' where id = 1",
    );
    await q(
      "update news_lessons set status = 'wontfix', note = 'x' where id = 2",
    );
    const plan = await store.planLessons();
    expect(plan).toHaveLength(20);
    expect(plan[0]).toMatchObject({ id: 6, seen_count: 2 });
    expect(plan.some((l) => l.id === 1 || l.id === 2)).toBe(false);
  });

  it("guards status changes: compliance, notes, PR links", async () => {
    await store.storeRetro(
      retro({
        problems: [
          {
            category: "rule_conflict",
            title: "Outing quotes are too strict",
            detail:
              "Lower the quote minimum for outings so a short listing can prove a price.",
          },
          windowProblem("6:23 pm"),
        ],
      }),
    );
    const [c] = await q("select compliance from news_lessons where id = 1");
    expect(c.compliance).toBe(true);
    for (const status of ["fixed", "wontfix", "fix_proposed", "open"] as const)
      expect(
        await store.patchLesson(1, {
          status,
          note: "A long enough note to pass the fix plan rule, just in case.",
        }),
      ).toMatchObject({ ok: false, status: 422 });
    expect(
      await store.patchLesson(1, {
        status: "needs_james",
        note: "James decides.",
      }),
    ).toMatchObject({ ok: true, lesson: { status: "needs_james" } });
    expect(
      await store.patchLesson(2, { status: "fix_proposed", note: "Fix it." }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/fix plan/) });
    const plan =
      "Refuse today after 7:00 in issueDateProblem (http.ts); test 6:59 and 7:00 in news.test.ts.";
    expect(
      await store.patchLesson(2, { status: "fix_proposed", note: plan }),
    ).toMatchObject({
      ok: true,
      lesson: { status: "fix_proposed", note: plan },
    });
    expect(await store.patchLesson(99, { status: "open" })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
