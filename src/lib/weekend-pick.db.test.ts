import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDbOn } from "@/lib/local-db";

/**
 * The Friday Weekend Pick sender against a real (local) Postgres. Opt-in:
 * set TEST_DATABASE_URL (see news/sender.db.test.ts). Twilio and NWS are
 * stubbed: no text ever leaves.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = testDbOn(URL_);
const A = "+15415550123";
const B = "+15415550124";
/** Friday, December 4, 2026, 4:00 pm Pacific. */
const FRI = new Date("2026-12-05T00:00:00Z");
/** Twilio's stand-in records who was texted, and each request. */
const texted: string[] = [];
const requests: URLSearchParams[] = [];
/** When set, Twilio refuses any MMS with this code (400). */
let refuseMedia: number | null = null;
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
        const form = new URLSearchParams(String(init?.body));
        requests.push(form);
        if (refuseMedia && form.get("MediaUrl"))
          return Response.json({ code: refuseMedia }, { status: 400 });
        texted.push(form.get("To") ?? "");
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
    requests.length = 0;
    refuseMedia = null;
    await q(
      "truncate sms_program_sends, contact_consents, sms_opt_outs, sms_last_texts, news_sends, news_issues, news_settings, news_clicks, parks, explorers, crews restart identity cascade",
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

  it("the short link goes to the park page and counts taps per issue, nothing more", async () => {
    const { GET } = await import("@/app/w/[code]/route");
    const tap = async (code: string) => {
      const r = await GET(new Request(`http://localhost/w/${code}`), {
        params: Promise.resolve({ code }),
      });
      return { status: r.status, to: r.headers.get("location") };
    };
    // Before any issue featured it: the redirect works, nothing counted.
    expect(await tap("1")).toEqual({
      status: 302,
      to: "https://parkroulette.quest/parks/wildflower-park-bend",
    });
    expect(await q("select * from news_clicks")).toEqual([]);
    await sentIssue2();
    await tap("1");
    await tap("1");
    expect(
      await q("select issue_date::text as d, slug, clicks from news_clicks"),
    ).toEqual([{ d: "2026-12-03", slug: "weekend-pick-text", clicks: 2 }]);
    // Unknown or malformed codes go home.
    for (const code of ["zz", "0", "Ab", "a/b", "abcde"])
      expect((await tap(code)).to, code).toBe("https://parkroulette.quest/");
  });

  it("a 4-character code is an issue date: a sent issue's page, marked src=text, counting nothing", async () => {
    const { GET } = await import("@/app/w/[code]/route");
    const tap = async (code: string) =>
      (
        await GET(new Request(`http://localhost/w/${code}`), {
          params: Promise.resolve({ code }),
        })
      ).headers.get("location");
    // Not sent yet: home.
    expect(await tap("5ljn")).toBe("https://parkroulette.quest/");
    await sentIssue2();
    expect(await tap("5ljn")).toBe(
      "https://parkroulette.quest/newsletter/2026-12-03?src=text",
    );
    // Another date, or no real date: home.
    expect(await tap("5lju")).toBe("https://parkroulette.quest/");
    expect(await tap("zzzz")).toBe("https://parkroulette.quest/");
    expect(await q("select * from news_clicks")).toEqual([]);
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
      "Park Roulette: Go Saturday: Wildflower Park, Bend. Fenced toddler area. Reply STOP to opt out. https://parkroulette.quest/w/5ljn",
    );
    // An MMS with the issue's preview picture.
    expect(requests[0].get("MediaUrl")).toBe(
      "https://parkroulette.quest/newsletter/2026-12-03/preview.jpg",
    );
    expect(requests[0].get("Body")).toBe(rows[0].body);
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
    // Each send needs at least 3 STOPs AND over 1% of its own. Two STOPs
    // a week (40%) isn't enough.
    const week = async (d: string, n: number, stops: number, tag: string) => {
      for (let i = 0; i < n; i++) {
        const phone = `+1541555${tag}${String(i).padStart(2, "0")}`;
        await q(
          `insert into sms_program_sends (issue_date, phone, status, sent_at) values ('${d}', '${phone}', 'sent', '${d}T23:30:00Z')`,
        );
        // "Stop texts" in settings counts too (M5).
        if (i < stops)
          await q(
            `insert into contact_consents (channel, action, address, consent_version, source, created_at) values ('sms', 'opt_out', '${phone}', 'sms-2026-11-21', 'settings', timestamptz '${d}T23:30:00Z' + interval '1 day')`,
          );
      }
    };
    await week("2026-11-19", 5, 2, "91");
    await week("2026-11-26", 5, 3, "92");
    expect(await pick.recentStopRates("2026-12-03")).toEqual([
      { sent: 5, stops: 3 },
      { sent: 5, stops: 2 },
    ]);
    expect((await pick.runWeekendPick(FRI)).counts?.sent).toBe(1);
    await q("truncate sms_program_sends");
    texted.length = 0;
    await week("2026-11-19", 5, 3, "93");
    await week("2026-11-26", 5, 3, "94");
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
    expect(await pick.recentStopRates("2026-12-03")).toEqual([
      { sent: 1, stops: 0 },
      { sent: 1, stops: 0 },
    ]);
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

  it("falls back to plain SMS with the same body when Twilio refuses the picture", async () => {
    await sentIssue2();
    refuseMedia = 21620;
    const r = await pick.runWeekendPick(FRI);
    expect(r.counts?.sent).toBe(1);
    expect(requests.map((x) => !!x.get("MediaUrl"))).toEqual([true, false]);
    expect(requests[1].get("Body")).toBe(requests[0].get("Body"));
    expect(texted).toEqual([A]);
    // 21610 (Twilio has its STOP) never falls back.
    await q("truncate sms_program_sends");
    requests.length = 0;
    refuseMedia = 21610;
    await pick.runWeekendPick(FRI);
    expect(requests).toHaveLength(1);
  });

  it("starts 'Update:' when Friday flips a day, notes it for the page once, and keeps the words all window", async () => {
    const issue = JSON.parse(ISSUE);
    issue.weekend_ahead = {
      days: [
        {
          date: "2026-12-04",
          label: "Friday",
          condition: "Sunny",
          icon: "sun",
          high: 45,
          low: 25,
          precip: 0,
        },
        {
          date: "2026-12-05",
          label: "Saturday",
          condition: "Sunny",
          icon: "sun",
          high: 47,
          low: 25,
          precip: 0,
        },
        {
          date: "2026-12-06",
          label: "Sunday",
          condition: "Sunny",
          icon: "sun",
          high: 49,
          low: 25,
          precip: 0,
        },
      ],
    };
    const plan = {
      weather: {
        tiers: {
          towns: {
            Bend: [
              { date: "2026-12-05", tier: "fine" },
              { date: "2026-12-06", tier: "fine" },
            ],
          },
        },
      },
    };
    await q(`insert into news_issues (issue_date, status, body, sent_body, plan, sent_at, send_started_at)
      values ('2026-12-03', 'sent', '{}', '${JSON.stringify(issue)}'::jsonb, '${JSON.stringify(plan)}'::jsonb, now(), now())`);
    const fresh = async () => ({
      days: [
        { date: "2026-12-05", word: "Snow", high: 29 },
        { date: "2026-12-06", word: "Sunny", high: 36 },
      ],
      tiers: {
        "2026-12-05": "disruptive" as const,
        "2026-12-06": "fine" as const,
      },
    });
    await pick.runWeekendPick(FRI, { fresh });
    const [row] = await q("select body from sms_program_sends");
    expect(row.body).toBe(
      "Park Roulette: Update: Snow Sat, 29. Sunny Sun, 36. Go Sunday: Wildflower Park, Bend. Reply STOP to opt out. https://parkroulette.quest/w/5ljn",
    );
    const [p] = await q(
      "select plan->'friday_update'->>'words' as w, plan->'friday_update'->'plan' as plan from news_issues",
    );
    expect(p.w).toBe("Snow Sat, 29. Sunny Sun, 36");
    expect(p.plan).toEqual({ kind: "park", date: "2026-12-06" });
    // An Update week goes as plain SMS: the picture shows Thursday's card.
    expect(requests.every((r) => !r.get("MediaUrl"))).toBe(true);
    // A later run (B confirmed meanwhile) sends the same words, even if
    // the forecast changed back.
    await q(
      `insert into contact_consents (channel, action, address, consent_version, source) values ('sms', 'confirmation_sent', '${B}', 'sms-2026-11-21', 'test')`,
    );
    await pick.runWeekendPick(new Date(FRI.getTime() + 15 * 60_000), {
      fresh: async () => null,
    });
    const bodies = await q("select distinct body from sms_program_sends");
    expect(bodies).toHaveLength(1);
    expect(texted.sort()).toEqual([A, B]);
  });

  it("the page's beacon counts a tap per sent issue, from our own pages, 20 an hour from one address", async () => {
    const { POST } = await import("@/app/api/news/tap/route");
    const beacon = (
      body: string,
      origin = "https://parkroulette.quest",
      ip = "203.0.113.9",
    ) =>
      POST(
        new Request("http://localhost/api/news/tap", {
          method: "POST",
          body,
          headers: { origin, "x-real-ip": ip },
        }),
      );
    const tap = JSON.stringify({ date: "2026-12-03" });
    await beacon(tap);
    expect(await q("select * from news_clicks")).toEqual([]);
    await sentIssue2();
    await beacon(tap);
    await beacon(tap);
    await beacon("not json");
    await beacon(JSON.stringify({ date: "2026-12-10" }));
    // Another site's page, or no Origin: nothing.
    await beacon(tap, "https://evil.example");
    await beacon(tap, "");
    const count = async () =>
      (
        await q("select issue_date::text as d, slug, clicks from news_clicks")
      )[0];
    expect(await count()).toEqual({
      d: "2026-12-03",
      slug: "weekend-pick-tap",
      clicks: 2,
    });
    // That address has used 5 of its 20 an hour (other sites' calls don't
    // count): 15 more count, then none.
    for (let i = 0; i < 20; i++) await beacon(tap);
    expect((await count()).clicks).toBe(17);
    // Another address still counts.
    await beacon(tap, undefined, "198.51.100.1");
    expect((await count()).clicks).toBe(18);
  });

  it("re-sends a Weekend Pick once as plain SMS when its picture fails late", async () => {
    await sentIssue2();
    await pick.runWeekendPick(FRI);
    expect(requests).toHaveLength(1);
    const mms = requests[0];
    expect(mms.get("MediaUrl")).toBeTruthy();
    const report = {
      sid: "SM1",
      status: "undelivered",
      to: A,
      errorCode: 30019,
    };
    await store.recordDelivery(report);
    expect(requests).toHaveLength(2);
    expect(requests[1].get("MediaUrl")).toBeNull();
    expect(requests[1].get("Body")).toBe(mms.get("Body"));
    const [row] = await q(
      "select twilio_sid, reason, delivery_status from sms_program_sends",
    );
    expect(row).toMatchObject({ twilio_sid: "SM2", delivery_status: null });
    expect(String(row.reason)).toMatch(/media error 30019: re-sent as SMS/);
    // The same report again, or a failure that isn't the picture: no more.
    await store.recordDelivery(report);
    await store.recordDelivery({ ...report, sid: "SM2", errorCode: 30003 });
    expect(requests).toHaveLength(2);
  });

  it("checks the link preview in production: og:image named, a JPEG, under 600 KB", async () => {
    const page = "https://parkroulette.quest/newsletter/2026-12-03";
    const img = `${page}/preview.jpg`;
    const serve = (html: string, image: Response) =>
      vi.stubGlobal("fetch", async (u: RequestInfo | URL) =>
        String(u) === page ? new Response(html) : image,
      );
    const meta = `<meta property="og:image" content="${img}"/>`;
    const jpeg = (bytes: number, type = "image/jpeg") =>
      new Response(new Uint8Array(bytes), {
        headers: { "content-type": type },
      });
    const before = process.env.VERCEL_ENV;
    const twilio = globalThis.fetch;
    try {
      expect(await pick.previewProblem(page)).toBeNull(); // not production
      process.env.VERCEL_ENV = "production";
      serve(meta, jpeg(1000));
      expect(await pick.previewProblem(page)).toBeNull();
      serve("<html></html>", jpeg(1000));
      expect(await pick.previewProblem(page)).toMatch(/og:image/);
      serve(meta, jpeg(700 * 1024));
      expect(await pick.previewProblem(page)).toMatch(/over 600/);
      serve(meta, jpeg(1000, "image/png"));
      expect(await pick.previewProblem(page)).toMatch(/JPEG/);
      serve(meta, new Response("no", { status: 503 }));
      expect(await pick.previewProblem(page)).toMatch(/503/);
    } finally {
      if (before === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = before;
      vi.stubGlobal("fetch", twilio);
    }
  });
});
