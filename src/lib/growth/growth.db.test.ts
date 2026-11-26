import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDbOn } from "@/lib/local-db";

/**
 * The growth digest against a real (local) Postgres: the week's counts,
 * the texts list as of a week's end, the snapshot freeze, and the send
 * going once per week however many runs overlap. Vercel and Meta are not
 * configured here, so their numbers come back as gaps. Opt-in: set
 * TEST_DATABASE_URL (it wipes the tables it uses).
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = testDbOn(URL_);

/** Monday Nov 30, 7:12 Pacific (PST). */
const MONDAY = new Date("2026-11-30T15:12:00Z");

describe.skipIf(!local)("the growth digest, against Postgres", () => {
  let db: typeof import("@/db").db;
  let sql: typeof import("drizzle-orm").sql;
  let collectWeek: typeof import("./collect").collectWeek;
  let runDigest: typeof import("./digest").runDigest;
  let weekOf: typeof import("./week").weekOf;
  const sent: { key: string | null; to: string[]; subject: string }[] = [];
  const q = (t: string) => db.execute(sql.raw(t));
  const resendOk = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/emails")) {
      const body = JSON.parse(String(init?.body));
      sent.push({
        key: new Headers(init?.headers).get("idempotency-key"),
        to: body.to,
        subject: body.subject,
      });
      return Response.json({ id: `re_${sent.length}` });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ALERT_EMAIL = "owner@example.test";
    delete process.env.VERCEL_ANALYTICS_TOKEN;
    delete process.env.IG_ACCESS_TOKEN;
    vi.stubGlobal("fetch", vi.fn(resendOk));
    ({ db } = await import("@/db"));
    ({ sql } = await import("drizzle-orm"));
    ({ collectWeek } = await import("./collect"));
    ({ runDigest } = await import("./digest"));
    ({ weekOf } = await import("./week"));
  });

  beforeEach(async () => {
    sent.length = 0;
    vi.mocked(fetch).mockImplementation(resendOk);
    await q(
      `truncate growth_snapshots, contact_consents, sms_opt_outs, email_subscribers, visits, reviews, media, event_saves, event_hides, park_votes, explorers, crews, parks, alert_log, places_usage, social_posts, social_dm_replies, news_sends, news_issues, news_clicks, sms_program_sends, kid_events, pairing_pages restart identity cascade`,
    );
    // Two families: one from before the week (comes back), one new.
    await q(`
      insert into crews (id, name, color, join_code, friend_code, created_at) values
        (1, 'Old', 'red', 'j1', 'f1', '2026-11-10T12:00:00Z'),
        (2, 'New', 'blue', 'j2', 'f2', '2026-11-25T12:00:00Z');
      insert into explorers (id, crew_id, name, color, avatar, phone, phone_verified_at, is_kid, created_at) values
        (1, 1, 'A', 'red', 'x', '+15415550001', '2026-11-10T12:00:00Z', false, '2026-11-10T12:00:00Z'),
        (2, 2, 'B', 'blue', 'x', '+15415550002', '2026-11-25T12:00:00Z', false, '2026-11-25T12:00:00Z'),
        (3, 2, 'Kid', 'blue', 'x', null, null, true, '2026-11-25T12:05:00Z');
      insert into parks (id, slug, name, city, lat, lng) values (1, 'p', 'P', 'Bend', 44, -121);
      insert into visits (park_id, crew_id, logged_by, visited_on, created_at) values
        (1, 1, 1, '2026-11-12', '2026-11-12T20:00:00Z'),
        (1, 1, 1, '2026-11-26', '2026-11-26T20:00:00Z'),
        (1, 2, 2, '2026-11-27', '2026-11-27T20:00:00Z');
      insert into email_subscribers (email, email_hash, status, source, consent_version, created_at, confirmed_at, stopped_at) values
        ('a@x.test', 'h1', 'confirmed', 'footer', 'v', '2026-11-19T12:00:00Z', '2026-11-19T12:00:00Z', null),
        ('b@x.test', 'h2', 'confirmed', 'welcome_sheet', 'v', '2026-11-25T12:00:00Z', '2026-11-25T12:00:00Z', null),
        (null, 'h3', 'stopped', 'footer', 'v', '2026-11-18T12:00:00Z', '2026-11-18T12:00:00Z', '2026-11-27T12:00:00Z');
      update email_subscribers set explorer_id = 2 where email = 'b@x.test';
      insert into contact_consents (channel, action, address, consent_version, source, created_at) values
        ('sms', 'opt_in', '+15415550001', 'v', 'texts_page', '2026-11-20T12:00:00Z'),
        ('sms', 'opt_in', '+15415550002', 'v', 'welcome_sheet', '2026-11-25T12:00:00Z'),
        ('sms', 'opt_in', '+15415550003', 'v', 'texts_page', '2026-11-24T12:00:00Z'),
        ('sms', 'opt_out', '+15415550003', 'v', 'stop', '2026-11-28T12:00:00Z'),
        ('sms', 'opt_in', '+15415550004', 'v', 'texts_page', '2026-12-01T12:00:00Z');
      insert into sms_opt_outs (phone, source, created_at) values ('+15415550003', 'stop', '2026-11-28T12:00:00Z');
      insert into alert_log (key, sent_at, suppressed) values
        ('error:cron-social', '2026-11-24T12:00:00Z', 0),
        ('report:12', '2026-11-25T12:00:00Z', 0),
        ('_hour', '2026-11-25T12:00:00Z', 1),
        ('inbox:tempfail:abc', '2026-11-25T12:00:00Z', 1),
        ('error:cron-cleanup', '2026-11-29T12:00:00Z', 4),
        ('error:cron-events-check', '2026-11-10T12:00:00Z', 2);
    `);
  });

  it("counts the week", async () => {
    const s = await collectWeek(weekOf("2026-11-23"), { live: true });
    const m = s.metrics;
    expect(m.families_new).toBe(1);
    expect(m.families_total).toBe(2);
    expect(m.grownups_new).toBe(1);
    expect(m.kids_new).toBe(1);
    expect(m.stamps).toBe(2);
    expect(m.first_stamps).toBe(1);
    expect(m.returning_families).toBe(1);
    expect(m.active_families).toBe(2);
    expect(m.email_list).toBe(2);
    expect(m.email_new).toBe(1);
    expect(m.email_stopped).toBe(1);
    // +1 and +2 are on; +3 stopped in the week; +4 came after it.
    expect(m.texts_list).toBe(2);
    expect(m.texts_new).toBe(2);
    expect(m.texts_stop_replies).toBe(1);
    expect(m.both_lists).toBe(1);
    // Kinds, not keys; counter rows (_hour, inbox:tempfail:<id>) aren't alerts.
    expect(m.alerts).toBe(3);
    expect(m.cron_errors).toBe(2);
    // Sent since the week began (so this morning's too); not older ones.
    expect(s.details.alertKeys).toEqual([
      "error:cron-social",
      "report",
      "error:cron-cleanup",
    ]);
    expect(s.details.emailBySource).toEqual({ welcome_sheet: 1 });
    // Not connected here: null, never 0, and named as a gap.
    expect(m.visitors ?? null).toBeNull();
    expect(m.audience_total ?? null).toBeNull();
    expect(s.details.missing?.join(" ")).toMatch(/Vercel|Instagram/);
  });

  it("reads the texts list as it stood at an earlier week's end", async () => {
    const s = await collectWeek(weekOf("2026-11-16"), { live: false });
    expect(s.metrics.texts_list).toBe(1);
    expect(s.metrics.email_list).toBe(2);
    // A rebuilt week can't know "so far" or "right now" numbers.
    expect(s.metrics.alerts).toBeNull();
    expect(s.metrics.email_clicks).toBeNull();
    expect(s.metrics.both_lists).toBeNull();
  });

  it("sends once per week, however many runs", async () => {
    const live = { sitemap: async () => [{ url: "https://x.test/guides/a" }] };
    const first = await runDigest(MONDAY, live);
    expect(first).toMatchObject({ action: "sent", week: "2026-11-23" });
    expect(first.action === "sent" && first.backfilled).toHaveLength(4);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["owner@example.test"]);
    expect(sent[0].key).toBe("growth-digest-2026-11-23-a0");
    const again = await Promise.all([
      runDigest(new Date(MONDAY.getTime() + 30 * 60_000), live),
      runDigest(new Date(MONDAY.getTime() + 30 * 60_000), live),
    ]);
    expect(again.map((r) => r.action)).toEqual(["skipped", "skipped"]);
    expect(sent).toHaveLength(1);
    const rows = (await q(
      `select week_start::text as w, backfilled, email_sent_at is not null as sent, metrics->>'guides_live' as guides from growth_snapshots order by week_start`,
    )) as unknown as {
      w: string;
      backfilled: boolean;
      sent: boolean;
      guides: string | null;
    }[];
    expect(rows.map((r) => r.w)).toEqual([
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
    ]);
    expect(rows.filter((r) => r.backfilled)).toHaveLength(4);
    expect(rows.at(-1)).toMatchObject({ sent: true, guides: "1" });
  });

  it("freezes a sent week's numbers", async () => {
    await runDigest(MONDAY, {});
    await q(
      `insert into crews (id, name, color, join_code, friend_code, created_at) values (9, 'Late', 'red', 'j9', 'f9', '2026-11-26T12:00:00Z')`,
    );
    const { saveSnapshot } = await import("./store");
    const fresh = await collectWeek(weekOf("2026-11-23"), { live: false });
    await saveSnapshot(fresh);
    const [r] = (await q(
      `select metrics->>'families_new' as n from growth_snapshots where week_start = '2026-11-23'`,
    )) as unknown as { n: string }[];
    expect(r.n).toBe("1");
  });

  it("retries with the stored bytes, and a new key only when Resend clearly refused", async () => {
    // First try: Resend times out ("later"), then a 500, then it works.
    const answers = [0, 500, 200];
    const keys: string[] = [];
    const bodies: string[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const key = new Headers(init?.headers).get("idempotency-key");
      // The failure alert itself (no key): let it through.
      if (!key) return Response.json({ id: "alert" });
      keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      bodies.push(String(init?.body));
      const status = answers.shift()!;
      if (status === 0) throw new Error("timeout");
      return status === 200
        ? Response.json({ id: "re_ok" })
        : Response.json({ name: "internal_server_error" }, { status });
    });
    const r1 = await runDigest(MONDAY, {});
    expect(r1.action).toBe("failed");
    // More happens between runs: the stored email must not change.
    await q(
      `insert into crews (id, name, color, join_code, friend_code, created_at) values (8, 'Later', 'red', 'j8', 'f8', '2026-11-26T12:00:00Z')`,
    );
    const r2 = await runDigest(new Date(MONDAY.getTime() + 30 * 60_000), {});
    expect(r2.action).toBe("failed");
    const r3 = await runDigest(new Date(MONDAY.getTime() + 60 * 60_000), {});
    expect(r3.action).toBe("sent");
    expect(keys).toEqual([
      "growth-digest-2026-11-23-a0",
      "growth-digest-2026-11-23-a0",
      "growth-digest-2026-11-23-a1",
    ]);
    expect(new Set(bodies).size).toBe(1);
    const [r] = (await q(
      `select metrics->>'families_new' as n, email_sent_at is not null as sent from growth_snapshots where week_start = '2026-11-23'`,
    )) as unknown as { n: string; sent: boolean }[];
    // The stored snapshot is the one that was emailed (1, not 2).
    expect(r).toMatchObject({ n: "1", sent: true });
  });

  it("does nothing outside Monday morning", async () => {
    const r = await runDigest(new Date("2026-12-01T15:12:00Z"), {});
    expect(r.action).toBe("skipped");
    expect(sent).toHaveLength(0);
  });
});
