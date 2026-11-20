import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EventInput } from "./model";
import type { EventVerdict } from "./validate";

/**
 * Kids' events against a real (local) Postgres: storing hand-ins and the
 * nightly re-check. Opt-in: set TEST_DATABASE_URL (see
 * news/sender.db.test.ts). It wipes kid_events.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);
const PAGE = "https://www.deschuteslibrary.org/storytime";

describe.skipIf(!local)("kid_events, against Postgres", () => {
  let store: typeof import("./store");
  let model: typeof import("./model");
  let q: (s: string) => Promise<Record<string, unknown>[]>;

  const verdict = (
    title: string,
    day: string,
    over: Partial<EventVerdict> = {},
    input: Partial<EventInput> = {},
  ): EventVerdict => {
    const e: EventInput = {
      title,
      dates: [{ day, start: "10:30" }],
      venue: { name: "Downtown Bend Library", town: "Bend" },
      what: "Songs and a picture book for the littlest listeners.",
      url: PAGE,
      evidence: [{ url: PAGE, quote: `Saturday, ${day}, 10:30 am.` }],
      ...input,
    };
    return {
      index: 0,
      title,
      ok: true,
      problems: [],
      warnings: [],
      slug: model.eventSlug(e),
      key: model.seriesKey(e),
      kind: model.kindOf(e),
      event: {
        ...model.storedFrom(e, null, e.evidence[0].quote),
        targets: { [day]: { url: PAGE, quote: e.evidence[0].quote } },
      },
      ...over,
    };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    store = await import("./store");
    model = await import("./model");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    await q("truncate kid_events restart identity");
  });

  it("merges weekly single-date hand-ins into one series page (H3)", async () => {
    await store.upsertEvents([verdict("Story Time: Dinosaurs", "2026-11-21")], {
      network: true,
    });
    await store.upsertEvents([verdict("Story Time: Snow", "2026-11-28")], {
      network: true,
    });
    const rows = await q("select slug, kind, data from kid_events");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("series");
    expect((rows[0].data as { dates: unknown[] }).dates).toHaveLength(2);
  });

  it("gives a clashing slug a stable hash of its series key (H3)", async () => {
    const a = verdict("Story Time", "2026-11-21");
    const b = verdict("Story Time", "2026-11-21", { key: "series:other-key" });
    await store.upsertEvents([a], { network: true });
    const [r] = await store.upsertEvents([b], { network: true });
    expect(r.slug).toBe(`${a.slug}-${store.slugSuffix("series:other-key")}`);
  });

  it("keeps going after one event fails to store (H3)", async () => {
    const bad = verdict("Broken", "2026-11-21", { kind: "bogus" as never });
    const good = verdict("Lego Afternoon", "2026-11-21");
    const out = await store.upsertEvents([bad, good], { network: true });
    expect(out[0].error).toBeTruthy();
    expect(out[1].created).toBe(true);
    expect(await q("select slug from kid_events")).toHaveLength(1);
  });

  it("keeps a canceled date canceled until a status hand-in changes it (M3)", async () => {
    const quote = "Saturday, 2026-11-21, 10:30 am. This event is canceled.";
    const canceled = verdict(
      "Story Time",
      "2026-11-21",
      {},
      {
        status: { kind: "canceled", quote },
        evidence: [{ url: PAGE, quote }],
      },
    );
    canceled.event!.statusByDay = { "2026-11-21": "canceled" };
    await store.upsertEvents([canceled], { network: true });
    await store.upsertEvents([verdict("Story Time", "2026-11-21")], {
      network: true,
    });
    const [row] = await q("select status, data from kid_events");
    expect(row.status).toBe("canceled");
    expect((row.data as { statusByDay: object }).statusByDay).toEqual({
      "2026-11-21": "canceled",
    });
  });

  it("re-checks the next date's target: two misses unconfirm, and a row changed meanwhile isn't overwritten (H4, L11)", async () => {
    await store.upsertEvents([verdict("Story Time", "2026-11-21")], {
      network: true,
    });
    const now = new Date("2026-11-19T12:00:00Z");
    const gone = async () => ({
      status: 200,
      finalUrl: PAGE,
      text: "Nothing here now.",
    });
    await store.recheckEvents(now, gone);
    expect(
      (await q("select confirm, misses from kid_events"))[0],
    ).toMatchObject({ confirm: "ok", misses: 1 });
    const r = await store.recheckEvents(now, gone);
    expect(r.changed).toHaveLength(1);
    expect((await q("select confirm from kid_events"))[0].confirm).toBe(
      "unconfirmed",
    );
    // A hand-in lands while tonight's fetch is running: the check backs off.
    const racing = async () => {
      await q("update kid_events set updated_at = now() + interval '1 second'");
      return {
        status: 200,
        finalUrl: PAGE,
        text: "Saturday, 2026-11-21, 10:30 am.",
      };
    };
    await store.recheckEvents(now, racing);
    expect((await q("select seen_streak from kid_events"))[0].seen_streak).toBe(
      0,
    );
  });

  it("stops starting checks when the time budget runs out (M8)", async () => {
    await store.upsertEvents(
      [verdict("A one", "2026-11-21"), verdict("B two", "2026-11-21")],
      { network: true },
    );
    const r = await store.recheckEvents(
      new Date("2026-11-19T12:00:00Z"),
      async () => ({ status: 200, finalUrl: PAGE, text: "" }),
      { budgetMs: -1 },
    );
    expect(r.checked).toBe(0);
    expect(r.left).toBe(2);
  });
});
