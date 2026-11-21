import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDbOn } from "@/lib/local-db";
import type { Me } from "./data";

/**
 * The scoop's fresh reviews against a real (local) Postgres: the 3 newest
 * this viewer may see, by visibility.ts. Opt-in: set TEST_DATABASE_URL
 * (see news/sender.db.test.ts).
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = testDbOn(URL_);

vi.mock("./session", () => ({
  readSession: async () => null,
  trusted: () => true,
}));

const meOf = (id: number, crewId: number) =>
  ({ id, crew: { id: crewId } }) as unknown as Me;

describe.skipIf(!local)("fresh reviews on The scoop, against Postgres", () => {
  let feed: typeof import("./data-feed");
  let q: (s: string) => Promise<Record<string, unknown>[]>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    feed = await import("./data-feed");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });

  beforeEach(async () => {
    await q(
      "truncate reviews, explorers, crews, parks restart identity cascade",
    );
    await q(
      `insert into crews (name, color, join_code, friend_code) values
        ('Team A', 'blue', 'j1', 'f1'), ('Team B', 'red', 'j2', 'f2')`,
    );
    // 1: A's grown-up, 2: A's kid, 3: B's grown-up.
    await q(
      `insert into explorers (crew_id, name, color, avatar, is_kid) values
        (1, 'Ann', 'blue', 'fox', false),
        (1, 'Kiddo', 'red', 'owl', true),
        (2, 'Bo', 'green', 'frog', false)`,
    );
    // One review per park and explorer: a park each.
    await q(`insert into parks (slug, name, city, lat, lng, approved_at)
      select 'park-' || n, 'Park ' || n, 'Bend', 44.05, -121.29, now()
      from generate_series(1, 7) n`);
    const at = (ago: string) =>
      `now() - interval '${ago}', now() - interval '${ago}'`;
    await q(`insert into reviews (park_id, explorer_id, rating_tenths, body, visibility, created_at, updated_at, hidden_at) values
      (1, 3, 40, 'B public, 2h', 'public', ${at("2 hours")}, null),
      (2, 3, 40, 'B public, 10 min', 'public', ${at("10 minutes")}, null),
      (3, 3, 40, 'B members, 3h', 'members', ${at("3 hours")}, null),
      (4, 3, 40, 'B family, 4h', 'family', ${at("4 hours")}, null),
      (5, 3, 40, 'B hidden, 5h', 'public', ${at("5 hours")}, now()),
      (6, 2, 50, '', 'public', ${at("6 hours")}, null),
      (7, 1, 30, 'A public, 1 day', 'public', ${at("1 day")}, null)`);
  });

  it("signed out: public, settled, not hidden; kids are 'A kid'", async () => {
    const r = await feed.freshReviews(null);
    expect(r.map((x) => x.body)).toEqual([
      "B public, 2h",
      "",
      "A public, 1 day",
    ]);
    expect(r.map((x) => x.explorer.name)).toEqual(["Bo", "A kid", "Ann"]);
    expect(r.every((x) => !x.ours)).toBe(true);
  });

  it("another family sees members' reviews too, never family or hidden", async () => {
    const r = await feed.freshReviews(meOf(1, 1), 10);
    expect(r.map((x) => x.body)).toEqual([
      "B public, 2h",
      "B members, 3h",
      "",
      "A public, 1 day",
    ]);
    // Your own family's kid keeps their name.
    expect(r[2].explorer.name).toBe("Kiddo");
    expect(r[2].ours).toBe(true);
  });

  it("your own family's reviews show at once, hidden or private", async () => {
    const r = await feed.freshReviews(meOf(3, 2));
    expect(r.map((x) => x.body)).toEqual([
      "B public, 10 min",
      "B public, 2h",
      "B members, 3h",
    ]);
  });
});
