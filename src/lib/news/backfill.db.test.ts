import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addressHash } from "./tokens";

/**
 * Release 1 review H1: the backfill in drizzle/0012_release1_fixes.sql,
 * run against accounts as they look on main (the old explorers.email and
 * email_opt_in columns, no email_subscribers rows). Opt-in: set
 * TEST_DATABASE_URL (see sender.db.test.ts); it wipes subscribers,
 * explorers and crews.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);

/** The backfill statement: the migration's last one. */
const BACKFILL = readFileSync(
  join(process.cwd(), "drizzle/0012_release1_fixes.sql"),
  "utf8",
)
  .split("--> statement-breakpoint")
  .pop()!;

describe.skipIf(!local)(
  "the email_subscribers backfill, against Postgres",
  () => {
    let q: (s: string) => Promise<Record<string, unknown>[]>;
    let subs: typeof import("./subscribers");

    beforeAll(async () => {
      process.env.DATABASE_URL = URL_;
      const { db } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      subs = await import("./subscribers");
      q = (s) =>
        db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
    });
    beforeEach(async () => {
      await q(
        `truncate email_confirmations, contact_consents, email_subscribers, explorers, crews restart identity cascade`,
      );
      await q(
        `insert into crews (name, color, join_code, friend_code) values ('Test', 'blue', 'j1', 'f1')`,
      );
      // A main-branch seed: two grown-ups said yes, one said no, one kid.
      await q(`insert into explorers (crew_id, name, color, avatar, email, email_opt_in) values
      (1, 'Ann', 'blue', 'fox', ' Ann@Example.COM ', true),
      (1, 'Bo', 'red', 'owl', 'bo@example.com', true),
      (1, 'Cy', 'green', 'cat', 'cy@example.com', false)`);
      await q(`insert into explorers (crew_id, name, color, avatar, email, email_opt_in, is_kid)
      values (1, 'Kid', 'pink', 'bee', 'kid@example.com', true, true)`);
    });

    it("makes one pending, linked, normalized row per opted-in grown-up, and sends nothing", async () => {
      await q(BACKFILL);
      const rows = await q(
        `select email, email_hash, status, explorer_id, source from email_subscribers order by explorer_id`,
      );
      expect(rows).toEqual([
        {
          email: "ann@example.com",
          email_hash: addressHash("ann@example.com"),
          status: "pending",
          explorer_id: 1,
          source: "migrated",
        },
        {
          email: "bo@example.com",
          email_hash: addressHash("bo@example.com"),
          status: "pending",
          explorer_id: 2,
          source: "migrated",
        },
      ]);
      expect(await q(`select id from email_confirmations`)).toEqual([]);
      // Running it again adds nothing.
      await q(BACKFILL);
      expect(await q(`select id from email_subscribers`)).toHaveLength(2);
      // Settings shows them waiting to confirm.
      expect(await subs.subscriptionFor(1)).toEqual({
        status: "pending",
        email: "ann@example.com",
      });
    });

    it("keeps migrated rows past the 7-day purge until 30 days", async () => {
      await q(BACKFILL);
      await q(
        `update email_subscribers set created_at = now() - interval '10 days' where explorer_id = 1`,
      );
      await q(
        `update email_subscribers set created_at = now() - interval '31 days' where explorer_id = 2`,
      );
      expect(await subs.purgePending()).toBe(1);
      const left = await q(`select explorer_id from email_subscribers`);
      expect(left).toEqual([{ explorer_id: 1 }]);
    });

    it("stopping clears the old columns too, with or without a row", async () => {
      await q(BACKFILL);
      // Cy has no row (said no) but still has an address in the old column.
      await subs.stopForExplorers([1, 3], "settings");
      const ex = await q(
        `select id, email, email_opt_in from explorers where id in (1, 3) order by id`,
      );
      expect(ex).toEqual([
        { id: 1, email: null, email_opt_in: false },
        { id: 3, email: null, email_opt_in: false },
      ]);
      const stops = await q(
        `select explorer_id, address from contact_consents where action = 'opt_out' order by id`,
      );
      expect(stops.every((s) => String(s.address).startsWith("sha256:"))).toBe(
        true,
      );
      expect(stops.map((s) => s.explorer_id)).toEqual(
        expect.arrayContaining([1, 3]),
      );
    });

    it("purges stopped rows and their consent records 4 years after the stop", async () => {
      await q(BACKFILL);
      await subs.stopForExplorers([2], "settings");
      expect(await subs.purgeStopped()).toBe(0);
      await q(
        `update email_subscribers set stopped_at = now() - interval '4 years 1 day' where status = 'stopped'`,
      );
      expect(await subs.purgeStopped()).toBe(1);
      expect(
        await q(
          `select id from contact_consents where subscriber_id is not null and action = 'opt_out' and explorer_id = 2 and subscriber_id not in (select id from email_subscribers)`,
        ),
      ).toEqual([]);
    });
  },
);
