import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDbOn } from "@/lib/local-db";

/**
 * The ask moments' server facts against a real (local) Postgres. Opt-in:
 * set TEST_DATABASE_URL (see news/sender.db.test.ts).
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = testDbOn(URL_);

vi.mock("./session", () => ({
  readSession: async () => null,
  trusted: () => true,
}));

describe.skipIf(!local)("ask moments, against Postgres", () => {
  let data: typeof import("./data");
  let q: (s: string) => Promise<Record<string, unknown>[]>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    data = await import("./data");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    await q(
      "truncate visits, explorers, crews, parks restart identity cascade",
    );
    await q(
      `insert into crews (name, color, join_code, friend_code) values ('Test', 'blue', 'j1', 'f1'), ('Other', 'red', 'j2', 'f2')`,
    );
    await q(
      `insert into explorers (crew_id, name, color, avatar, phone, phone_verified_at) values
        (1, 'James', 'blue', 'fox', '+15415550123', now() - interval '3 days'),
        (2, 'Pat', 'red', 'owl', '+15415550124', now() - interval '40 days')`,
    );
    await q(`insert into parks (slug, name, city, lat, lng, approved_at) values
      ('larkspur-park-bend', 'Larkspur Park', 'Bend', 44.05, -121.29, now()),
      ('juniper-park-bend', 'Juniper Park', 'Bend', 44.05, -121.29, now())`);
  });

  it("names the crew's latest stamp, by when it was made", async () => {
    expect(await data.lastStamp(1)).toBeNull();
    await q(`insert into visits (park_id, crew_id, logged_by, visited_on, created_at) values
      (2, 1, 1, '2026-11-28', '2026-11-28T20:00:00Z'),
      (1, 1, 1, '2026-11-20', '2026-11-29T20:00:00Z'),
      (2, 2, 2, '2026-11-30', '2026-11-30T20:00:00Z')`);
    // Logged last, even for an older day: Larkspur. Another crew's never counts.
    expect(await data.lastStamp(1)).toEqual({
      key: "v2",
      park: "Larkspur Park",
      at: "2026-11-29T20:00:00.000Z",
    });
  });

  it("knows whether a number passed a code in the last 30 days", async () => {
    expect(await data.phoneFresh(1)).toBe(true);
    expect(await data.phoneFresh(2)).toBe(false);
  });
});
