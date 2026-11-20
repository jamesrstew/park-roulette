import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Friday Weekend Pick sender against a real (local) Postgres. Opt-in:
 * set TEST_DATABASE_URL (see news/sender.db.test.ts). Twilio and NWS are
 * stubbed: no text ever leaves.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);
const A = "+15415550123";
const B = "+15415550124";
/** Friday, December 4, 2026, 4:00 pm Pacific. */
const FRI = new Date("2026-12-05T00:00:00Z");
/** Twilio's stand-in records who was texted. */
const texted: string[] = [];
const ISSUE = `{"issue_date":"2026-12-03","subject":"Juniper and the rain","preview":"Plus a covered skate this week.","hello":{"text":"Hi there, a quick one this week about the weather and a fenced park."},"wheel_pick":{"park":"wildflower-park-bend","why_now":"Now.","who_for":"All.","bring":"Gloves."},"passport":{"challenge_id":"x","text":"Stamp it."},"signoff":{"text":"Hit reply."}}`;

describe.skipIf(!local)("Weekend Pick, against Postgres", () => {
  let pick: typeof import("./weekend-pick-store");
  let store: typeof import("./texts-store");
  let q: (s: string) => Promise<Record<string, unknown>[]>;
  const details = { path: "/texts", ip: null, userAgent: null, codeAt: null };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    vi.stubGlobal("fetch", async (u: RequestInfo | URL, init?: RequestInit) => {
      if (String(u).startsWith("https://api.twilio.com/")) {
        texted.push(new URLSearchParams(String(init?.body)).get("To") ?? "");
        return Response.json({ sid: `SM${texted.length}` }, { status: 201 });
      }
      return new Response("no", { status: 503 });
    });
    pick = await import("./weekend-pick-store");
    store = await import("./texts-store");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    process.env.TEXTS_SENDING_ENABLED = "1";
    process.env.TWILIO_TEXTS_SERVICE_SID = "MG_test";
    texted.length = 0;
    await q(
      "truncate sms_program_sends, contact_consents, sms_opt_outs, sms_last_texts, news_sends, news_issues, news_settings, parks, explorers, crews restart identity cascade",
    );
    await q(`insert into parks (slug, name, city, lat, lng, approved_at, features)
      values ('wildflower-park-bend', 'Wildflower Park', 'Bend', 44.05, -121.29, now(), '{toddler_area,fenced}')`);
    await q(`insert into news_settings (id, texts_dry_run) values (1, false)`);
    await q(
      `insert into crews (name, color, join_code, friend_code) values ('Test', 'blue', 'j1', 'f1')`,
    );
    // A and B are on; A has had its confirmation, B's is still held.
    await store.optIn(A, "texts_page", details);
    await q(
      `insert into contact_consents (channel, action, address, consent_version, source) values ('sms', 'confirmation_sent', '${A}', 'sms-2026-11-21', 'test')`,
    );
    await store.optIn(B, "texts_page", details);
  });
  const sentIssue2 = () =>
    q(`insert into news_issues (issue_date, status, body, sent_body, sent_at, send_started_at)
      values ('2026-12-03', 'sent', '{}', '${ISSUE}'::jsonb, now(), now())`);
  it("sends nothing without a sent issue that week", async () => {
    const r = await pick.runWeekendPick(FRI);
    expect(r.action).toBe("skipped");
    expect(await q("select id from sms_program_sends")).toEqual([]);
  });

  it("dry run tests on a validated draft when nothing went out; a real run never does", async () => {
    // A validated draft for a later week, and a failed one for this week.
    const later = ISSUE.replace("2026-12-03", "2026-12-10");
    await q(`insert into news_issues (issue_date, status, body, report)
      values ('2026-12-10', 'draft', '${later}'::jsonb, '{"ok":true}'::jsonb),
             ('2026-12-03', 'draft', '{"issue_date":"2026-12-03"}'::jsonb, '{"ok":false}'::jsonb)`);
    // Real run: no sent issue, no text.
    expect((await pick.runWeekendPick(FRI)).action).toBe("skipped");
    expect(texted).toEqual([]);
    await q(`update news_settings set texts_dry_run = true`);
    await q(
      `insert into explorers (crew_id, name, color, avatar, is_admin, phone) values (1, 'James', 'blue', 'fox', true, '${B}')`,
    );
    const r = await pick.runWeekendPick(FRI);
    expect(r.action).toBe("dry_run");
    expect(texted).toEqual([B]);
    // Keyed to this week, never the draft's own week.
    const [row] = await q(
      "select issue_date::text as d, body from sms_program_sends",
    );
    expect(row.d).toBe("2026-12-03");
    expect(String(row.body)).toContain("Wildflower Park");
  });

  it("dry run prefers this week's validated draft", async () => {
    const later = ISSUE.replace("2026-12-03", "2026-12-10").replace(
      "wildflower-park-bend",
      "nowhere-park",
    );
    await q(`insert into news_issues (issue_date, status, body, report)
      values ('2026-12-10', 'draft', '${later}'::jsonb, '{"ok":true}'::jsonb),
             ('2026-12-03', 'draft', '${ISSUE}'::jsonb, '{"ok":true}'::jsonb)`);
    await q(`update news_settings set texts_dry_run = true`);
    await q(
      `insert into explorers (crew_id, name, color, avatar, is_admin, phone) values (1, 'James', 'blue', 'fox', true, '${B}')`,
    );
    expect((await pick.runWeekendPick(FRI)).action).toBe("dry_run");
    expect(texted).toEqual([B]);
  });

  it("texts each confirmed number once, never twice on a retry", async () => {
    // The issue body only needs the featured park for the text.
    await q(`insert into news_issues (issue_date, status, body, sent_body, sent_at, send_started_at)
      values ('2026-12-03', 'sent', '{}', '{"issue_date":"2026-12-03","subject":"Juniper and the rain","preview":"Plus a covered skate this week.","hello":{"text":"Hi there, a quick one this week about the weather and a fenced park."},"wheel_pick":{"park":"wildflower-park-bend","why_now":"Now.","who_for":"All.","bring":"Gloves."},"passport":{"challenge_id":"x","text":"Stamp it."},"signoff":{"text":"Hit reply."}}'::jsonb, now(), now())`);
    const first = await pick.runWeekendPick(FRI);
    expect(first.counts?.sent).toBe(1);
    const rows = await q("select phone, status, body from sms_program_sends");
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe(A);
    expect(rows[0].body).toBe(
      "Park Roulette: Weekend Pick: Wildflower Park, Bend. Fenced toddler area. https://parkroulette.quest/parks/wildflower-park-bend Reply STOP to opt out",
    );
    const again = await pick.runWeekendPick(
      new Date(FRI.getTime() + 15 * 60_000),
    );
    expect(again.counts?.sent ?? 0).toBe(0);
    expect(await q("select id from sms_program_sends")).toHaveLength(1);
  });

  it("respects the kill switch, and pauses itself after two sends above 1% STOP", async () => {
    await sentIssue2();
    await q("update news_settings set texts_paused = true");
    expect((await pick.runWeekendPick(FRI)).action).toBe("paused");
    await q("update news_settings set texts_paused = false");
    // Two weeks, one number each, and each said STOP the next day: 100%.
    for (const [d, phone] of [
      ["2026-11-19", "+15415559998"],
      ["2026-11-26", "+15415559999"],
    ]) {
      await q(
        `insert into sms_program_sends (issue_date, phone, status, sent_at) values ('${d}', '${phone}', 'sent', '${d}T23:30:00Z')`,
      );
      // "Stop texts" in settings counts too (M5).
      await q(
        `insert into contact_consents (channel, action, address, consent_version, source, created_at) values ('sms', 'opt_out', '${phone}', 'sms-2026-11-21', 'settings', timestamptz '${d}T23:30:00Z' + interval '1 day')`,
      );
    }
    const r = await pick.runWeekendPick(FRI);
    expect(r.action).toBe("paused");
    const [s] = await q(
      "select texts_paused, texts_paused_reason from news_settings",
    );
    expect(s.texts_paused).toBe(true);
    expect(String(s.texts_paused_reason)).toMatch(/STOP rate/);
    // An admin turns texts back on: the guardrail starts over (H2).
    const { setNewsSettings } = await import("./news/data");
    await setNewsSettings({ textsPaused: false });
    const again = await pick.runWeekendPick(FRI);
    expect(again.counts?.sent).toBe(1);
    expect(texted).toEqual([A]);
  });

  it("doesn't count number changes, deleted accounts or failed confirmations as stops (M5)", async () => {
    for (const [d, phone, source] of [
      ["2026-11-19", "+15415559998", "number_changed"],
      ["2026-11-26", "+15415559999", "confirmation_failed"],
    ]) {
      await q(
        `insert into sms_program_sends (issue_date, phone, status, sent_at) values ('${d}', '${phone}', 'sent', '${d}T23:30:00Z')`,
      );
      await q(
        `insert into contact_consents (channel, action, address, consent_version, source, created_at) values ('sms', 'opt_out', '${phone}', 'sms-2026-11-21', '${source}', timestamptz '${d}T23:30:00Z' + interval '1 day')`,
      );
    }
    expect(await pick.recentStopRates("2026-12-03")).toEqual([0, 0]);
    // One week of history never trips it.
    await q("truncate sms_program_sends");
    await q(
      `insert into sms_program_sends (issue_date, phone, status, sent_at) values ('2026-11-26', '+15415559999', 'sent', '2026-11-26T23:30:00Z')`,
    );
    await q(
      `insert into contact_consents (channel, action, address, consent_version, source, created_at) values ('sms', 'opt_out', '+15415559999', 'sms-2026-11-21', 'stop', '2026-11-27T10:00:00Z')`,
    );
    await sentIssue2();
    expect((await pick.runWeekendPick(FRI)).counts?.sent).toBe(1);
  });

  it("refuses a real run with sending off, and logs (never counts) a dry run's sends (M3, M4)", async () => {
    await sentIssue2();
    delete process.env.TEXTS_SENDING_ENABLED;
    const r = await pick.runWeekendPick(FRI);
    expect(r.action).toBe("paused");
    expect(await q("select id from sms_program_sends")).toEqual([]);
    // Dry run with sending off: admins' rows are "logged", never "sent".
    await q(`update news_settings set texts_dry_run = true`);
    await q(
      `insert into explorers (crew_id, name, color, avatar, is_admin, phone) values (1, 'James', 'blue', 'fox', true, '${B}'), (1, 'Stopped', 'blue', 'fox', true, '+15415550125')`,
    );
    await q(
      `insert into sms_opt_outs (phone, source) values ('+15415550125', 'stop')`,
    );
    await pick.runWeekendPick(FRI);
    const rows = await q(
      "select phone, status, sent_at from sms_program_sends",
    );
    expect(rows).toEqual([{ phone: B, status: "logged", sent_at: null }]);
    expect(texted).toEqual([]);
  });

  it("texts only admins in a dry run, with the whole STOP line (M4)", async () => {
    await sentIssue2();
    await q(`update news_settings set texts_dry_run = true`);
    await q(
      `insert into explorers (crew_id, name, color, avatar, is_admin, phone) values (1, 'James', 'blue', 'fox', true, '${B}')`,
    );
    const r = await pick.runWeekendPick(FRI);
    expect(r.action).toBe("dry_run");
    expect(texted).toEqual([B]);
    const [row] = await q("select status from sms_program_sends");
    expect(row.status).toBe("dry_run");
  });

  it("waits until 3:30 and skips whoever is left at 5 pm (M2, L6)", async () => {
    await sentIssue2();
    const early = await pick.runWeekendPick(new Date("2026-12-04T22:00:00Z"));
    expect(early).toMatchObject({ action: "idle" });
    expect(await q("select id from sms_program_sends")).toEqual([]);
    const late = await pick.runWeekendPick(new Date("2026-12-05T01:00:00Z"));
    expect(late.counts).toMatchObject({ sent: 0, skipped: 1 });
    const [row] = await q("select status, reason from sms_program_sends");
    expect(row).toMatchObject({ status: "skipped" });
    expect(texted).toEqual([]);
  });

  it("two runs at once text each number once (the lease and the claim)", async () => {
    await sentIssue2();
    await q(
      `insert into contact_consents (channel, action, address, consent_version, source) values ('sms', 'confirmation_sent', '${B}', 'sms-2026-11-21', 'test')`,
    );
    const runs = await Promise.all([
      pick.runWeekendPick(FRI),
      pick.runWeekendPick(FRI),
      pick.runWeekendPick(FRI),
    ]);
    expect(runs.filter((r) => r.counts).length).toBeGreaterThanOrEqual(1);
    expect([...texted].sort()).toEqual([A, B]);
    // Even past the lease, a claimed (issue, number) never goes twice.
    await q("update news_settings set texts_lock_until = null");
    await pick.runWeekendPick(FRI);
    expect(texted).toHaveLength(2);
  });

  it("caps a number at 5 a month", async () => {
    await q(`insert into news_issues (issue_date, status, body, sent_body, sent_at, send_started_at)
      values ('2026-12-03', 'sent', '{}', '{"issue_date":"2026-12-03","subject":"Juniper and the rain","preview":"Plus a covered skate this week.","hello":{"text":"Hi there, a quick one this week about the weather and a fenced park."},"wheel_pick":{"park":"wildflower-park-bend","why_now":"Now.","who_for":"All.","bring":"Gloves."},"passport":{"challenge_id":"x","text":"Stamp it."},"signoff":{"text":"Hit reply."}}'::jsonb, now(), now())`);
    for (const d of [
      "2026-12-01",
      "2026-12-02",
      "2026-12-08",
      "2026-12-09",
      "2026-12-10",
    ])
      await q(
        `insert into sms_program_sends (issue_date, phone, status, sent_at) values ('${d}', '${A}', 'sent', now())`,
      );
    const r = await pick.runWeekendPick(FRI);
    expect(r.counts?.sent ?? 0).toBe(0);
    const [row] = await q(
      `select status, reason from sms_program_sends where issue_date = '2026-12-03'`,
    );
    expect(row).toMatchObject({ status: "skipped" });
  });
});
