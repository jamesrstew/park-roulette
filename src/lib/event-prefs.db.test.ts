import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saved and hidden events, against a real (local) Postgres: the actions,
 * the family scoping, merge, caps and pruning. getMe and the cached event
 * list are stubbed. Opt-in: set TEST_DATABASE_URL.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);

const h = vi.hoisted(() => ({
  me: null as null | { id: number; crew: { id: number } },
  slugs: ["lego", "nutcracker", "story-a", "story-b"],
}));

vi.mock("next/cache", () => ({
  refresh: () => {},
  cacheLife: () => {},
  cacheTag: () => {},
  revalidateTag: () => {},
}));
vi.mock("./data", async (orig) => ({
  ...(await orig<typeof import("./data")>()),
  getMe: async () => h.me,
}));
vi.mock("./events/store", () => ({
  allEvents: async () => h.slugs.map((slug) => ({ slug })),
}));

describe.skipIf(!local)("saved and hidden events, against Postgres", () => {
  let A: typeof import("./event-prefs-actions");
  let q: (s: string) => Promise<unknown[]>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    A = await import("./event-prefs-actions");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) => db.execute(sql.raw(s)) as unknown as Promise<unknown[]>;
  });
  beforeEach(async () => {
    await q(
      `truncate event_saves, event_hides, explorers, crews restart identity cascade`,
    );
    await q(
      `insert into crews (name, color, join_code, friend_code) values ('One', 'blue', 'j1', 'f1'), ('Two', 'red', 'j2', 'f2')`,
    );
    await q(
      `insert into explorers (crew_id, name, color, avatar) values (1, 'Mom', 'blue', '🦊'), (1, 'Kid', 'blue', '🐻'), (2, 'Other', 'red', '🦖')`,
    );
    h.me = { id: 1, crew: { id: 1 } };
  });

  const prefsOf = async () => {
    const r = await A.loadEventPrefs();
    return r.ok ? r.prefs : null;
  };

  it("signed out: nothing to load, and every write is refused", async () => {
    h.me = null;
    expect(await A.loadEventPrefs()).toEqual({ ok: true, prefs: null });
    const r = await A.setEventSaved({ slug: "lego", occ: "", on: true });
    expect(r.ok).toBe(false);
    expect(await q(`select * from event_saves`)).toEqual([]);
    expect(await A.mergeEventPrefs({ saves: ["lego|"], hides: [] })).toEqual({
      ok: true,
      prefs: null,
    });
  });

  it("saves and hides belong to the family: one member's edits, everyone's list", async () => {
    await A.setEventSaved({
      slug: "nutcracker",
      occ: "2026-12-06-1400",
      on: true,
    });
    await A.setEventHidden({ slugs: ["story-a", "story-b"], on: true });
    h.me = { id: 2, crew: { id: 1 } };
    expect(await prefsOf()).toEqual({
      crewId: 1,
      saves: ["nutcracker|2026-12-06-1400"],
      hides: ["story-a", "story-b"],
    });
    // Another family sees none of it, and can't touch it.
    h.me = { id: 3, crew: { id: 2 } };
    expect(await prefsOf()).toEqual({ crewId: 2, saves: [], hides: [] });
    await A.setEventHidden({ slugs: ["story-a"], on: false });
    h.me = { id: 1, crew: { id: 1 } };
    expect((await prefsOf())?.hides).toEqual(["story-a", "story-b"]);
  });

  it("saving twice is one save; unsave and unhide remove them", async () => {
    await A.setEventSaved({ slug: "lego", occ: "", on: true });
    await A.setEventSaved({ slug: "lego", occ: "", on: true });
    expect((await prefsOf())?.saves).toEqual(["lego|"]);
    await A.setEventSaved({ slug: "lego", occ: "", on: false });
    await A.setEventHidden({ slugs: ["lego"], on: true });
    await A.setEventHidden({ slugs: ["lego"], on: false });
    expect(await prefsOf()).toEqual({ crewId: 1, saves: [], hides: [] });
  });

  it("refuses unknown pages and bad input", async () => {
    expect(
      (await A.setEventSaved({ slug: "not-ours", occ: "", on: true })).ok,
    ).toBe(false);
    expect(
      (await A.setEventSaved({ slug: "lego", occ: "soon", on: true })).ok,
    ).toBe(false);
    expect((await A.setEventSaved({ slug: 'x"]', occ: "", on: true })).ok).toBe(
      false,
    );
    await A.setEventHidden({ slugs: ["not-ours", "lego"], on: true });
    expect((await prefsOf())?.hides).toEqual(["lego"]);
  });

  it("merges this phone's list into the family's (a union, unknown pages dropped)", async () => {
    await A.setEventSaved({ slug: "lego", occ: "", on: true });
    const r = await A.mergeEventPrefs({
      saves: ["lego|", "nutcracker|2026-12-06-1400", "not-ours|", "garbage"],
      hides: ["story-a", "not-ours"],
    });
    expect(r).toEqual({
      ok: true,
      prefs: {
        crewId: 1,
        saves: expect.arrayContaining(["lego|", "nutcracker|2026-12-06-1400"]),
        hides: ["story-a"],
      },
    });
    expect((r.ok && r.prefs?.saves.length) || 0).toBe(2);
  });

  it("dated saves a month past drop off; regulars stay", async () => {
    await q(
      `insert into event_saves (crew_id, slug, occ) values (1, 'nutcracker', '2025-01-04-1400'), (1, 'lego', '')`,
    );
    await A.setEventSaved({ slug: "story-a", occ: "2026-12-06", on: true });
    expect((await prefsOf())?.saves.sort()).toEqual([
      "lego|",
      "story-a|2026-12-06",
    ]);
  });

  it("caps a family's list", async () => {
    await q(
      `insert into event_saves (crew_id, slug, occ) select 1, 'lego', '2099-01-01-' || lpad(g::text, 4, '0') from generate_series(1, 300) g`,
    );
    const r = await A.setEventSaved({ slug: "nutcracker", occ: "", on: true });
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/a lot of saved/),
    });
  });

  it("the shortlist's facts are public event data for the refs asked", async () => {
    const r = await A.shortlistInfo([{ slug: "gone-page", occ: "2026-12-06" }]);
    expect(r).toMatchObject({
      ok: true,
      facts: [{ slug: "gone-page", state: "gone" }],
    });
    expect((await A.shortlistInfo([{ slug: "BAD", occ: "" }])).ok).toBe(false);
  });
});
