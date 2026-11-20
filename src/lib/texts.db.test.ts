import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { twilioSignature } from "./twilio-signature";

/**
 * Weekend texts against a real (local) Postgres. Opt-in: set
 * TEST_DATABASE_URL (see news/sender.db.test.ts). Sending stays off, so no
 * text ever leaves.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);
const A = "+15415550123";
const B = "+15415550124";

describe.skipIf(!local)("Weekend texts, against Postgres", () => {
  let store: typeof import("./texts-store");
  let inbound: typeof import("@/app/api/texts/inbound/route");
  let q: (s: string) => Promise<unknown[]>;
  const details = {
    path: "/texts",
    ip: "1.2.3.4",
    userAgent: "test",
    codeAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    delete process.env.TEXTS_SENDING_ENABLED;
    delete process.env.TEXTS_CONFIRMATIONS_ENABLED;
    store = await import("./texts-store");
    inbound = await import("@/app/api/texts/inbound/route");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) => db.execute(sql.raw(s)) as unknown as Promise<unknown[]>;
  });
  beforeEach(async () => {
    await q(
      `truncate contact_consents, sms_opt_outs, sms_last_texts, webhook_events, sms_program_sends restart identity cascade`,
    );
  });
  /** Thursday, December 3, 2026, 11 am Pacific: inside every window. */
  const DAY = new Date("2026-12-03T19:00:00Z");
  /** Twilio stand-in: what each send gets back, and what was sent. */
  let sent: string[] = [];
  const real = globalThis.fetch;
  function twilio(answer: () => Response) {
    process.env.TEXTS_CONFIRMATIONS_ENABLED = "1";
    process.env.TWILIO_TEXTS_SERVICE_SID = "MG_test";
    sent = [];
    globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new URLSearchParams(String(init?.body)).get("Body") ?? "");
      return answer();
    }) as typeof fetch;
  }
  afterEach(() => {
    globalThis.fetch = real;
    delete process.env.TEXTS_SENDING_ENABLED;
    delete process.env.TEXTS_CONFIRMATIONS_ENABLED;
    delete process.env.TWILIO_TEXTS_SERVICE_SID;
  });
  const ok = () => Response.json({ sid: "SMok" }, { status: 201 });

  async function reply(
    from: string,
    body: string,
    sid: string,
    extra: Record<string, string> = {},
  ) {
    const params = {
      From: from,
      Body: body,
      MessageSid: sid,
      To: "+15415550199",
      ...extra,
    };
    const sig = twilioSignature(
      "test_auth_token",
      "https://parkroulette.quest/api/texts/inbound",
      params,
    );
    const res = await inbound.POST(
      new Request("http://localhost/api/texts/inbound", {
        method: "POST",
        headers: { "x-twilio-signature": sig },
        body: new URLSearchParams(params),
      }),
    );
    return { status: res.status, text: await res.text() };
  }

  it("records a yes once per number (a double tap sends one confirmation)", async () => {
    expect(await store.optIn(A, "texts_page", details)).toBe("on");
    expect(await store.optIn(A, "texts_page", details)).toBe("already");
    expect(await store.textsOn(A)).toBe(true);
    const rows = (await q(
      `select action from contact_consents where address = '${A}' order by id`,
    )) as { action: string }[];
    // Sending is off: the confirmation is held, not sent (M3).
    expect(rows.map((r) => r.action)).toEqual([
      "requested",
      "opt_in",
      "confirmation_pending",
      "requested",
    ]);
  });

  it("STOP, START and HELP that Twilio handled (OptOutType) are recorded with no reply of ours; a yes after STOP needs START from the phone", async () => {
    await store.optIn(A, "texts_page", details);
    const r = await reply(A, "stop", "SM1", { OptOutType: "STOP" });
    expect(r.text).not.toContain("<Message>");
    expect(await store.textsOn(A)).toBe(false);
    expect(await store.optIn(A, "settings", details)).toBe("needs_start");
    expect(await store.textsOn(A)).toBe(false);
    const s = await reply(A, "START", "SM2", { OptOutType: "START" });
    expect(s.text).not.toContain("<Message>");
    expect(await store.textsOn(A)).toBe(true);
    const [v] = (await q(
      `select consent_version from contact_consents where source = 'sms_start' and action = 'opt_in'`,
    )) as { consent_version: string }[];
    expect(v.consent_version).toBe("start_keyword");
    expect(
      (await reply(A, "HELP", "SM5", { OptOutType: "HELP" })).text,
    ).not.toContain("<Message>");
  });

  it("answers keywords Twilio didn't handle, and only those (H4)", async () => {
    let n = 100;
    for (const [body, type, kind] of [
      ["Stop.", "STOP", "stop"],
      ["STOP ALL", "STOP", "stop"],
      ["Don’t text me", "", "stop"],
      ["Help!", "HELP", "help"],
    ] as const) {
      for (const withType of [true, false]) {
        if (withType && !type) continue;
        await q("truncate contact_consents, sms_opt_outs restart identity");
        await store.optIn(A, "texts_page", details);
        const r = await reply(
          A,
          body,
          `SM${n++}`,
          withType ? { OptOutType: type } : {},
        );
        const label = `${body} ${withType ? "with" : "without"} OptOutType`;
        if (withType) expect(r.text, label).not.toContain("<Message>");
        else if (kind === "stop")
          expect(r.text, label).toContain("You're unsubscribed");
        else expect(r.text, label).toContain("Help: hello@parkroulette.quest");
        expect(await store.textsOn(A), label).toBe(kind !== "stop");
      }
    }
    // "Start." from a number on our STOP list, unhandled by Twilio: ours.
    await reply(A, "Stop.", `SM${n++}`);
    const back = await reply(A, "Start.", `SM${n++}`);
    expect(back.text).toContain("Welcome back");
    expect(await store.textsOn(A)).toBe(true);
  });

  it("START and YES do nothing from a number that never texted STOP (L6)", async () => {
    for (const [body, sid] of [
      ["START", "SM20"],
      ["YES", "SM21"],
    ]) {
      const r = await reply(B, body, sid);
      expect(r.text).not.toContain("Welcome back");
    }
    expect(await store.textsOn(B)).toBe(false);
  });

  it("holds the confirmation while confirmations are off, sends it once on, and never texts an unconfirmed number (M3)", async () => {
    await store.optIn(A, "texts_page", details, DAY);
    expect(await store.textsOn(A)).toBe(true);
    expect(await store.confirmedForTexts(A)).toBe(false);
    expect((await store.sendProgramText(A, "Weekend pick")).ok).toBe(false);
    // Off: nothing goes. Program sending alone doesn't release them (H3).
    process.env.TEXTS_SENDING_ENABLED = "1";
    process.env.TWILIO_TEXTS_SERVICE_SID = "MG_test";
    expect((await store.sendPendingConfirmations(DAY)).sent).toBe(0);
    twilio(ok);
    // 3:17 am Pacific (the old cleanup time): it waits (H3).
    const night = new Date("2026-12-03T11:17:00Z");
    expect(await store.sendPendingConfirmations(night)).toMatchObject({
      sent: 0,
      waiting: 1,
    });
    expect(sent).toEqual([]);
    expect((await store.sendPendingConfirmations(DAY)).sent).toBe(1);
    expect(sent[0]).toContain("You're in!");
    expect(await store.confirmedForTexts(A)).toBe(true);
    // Only once.
    expect((await store.sendPendingConfirmations(DAY)).sent).toBe(0);
  });

  it("holds a yes made at night until the morning (H3)", async () => {
    twilio(ok);
    const night = new Date("2026-12-04T05:00:00Z"); // 9 pm Pacific
    expect(await store.optIn(A, "texts_page", details, night)).toBe("on");
    expect(sent).toEqual([]);
    expect(await store.confirmedForTexts(A)).toBe(false);
    expect((await store.sendPendingConfirmations(DAY)).sent).toBe(1);
    expect(await store.confirmedForTexts(A)).toBe(true);
  });

  it("acts on Twilio's answers: 21610 lists the number, a 5xx retries, a hard refusal turns it off (H1)", async () => {
    twilio(() => Response.json({ code: 21610 }, { status: 400 }));
    expect(await store.optIn(A, "texts_page", details, DAY)).toBe(
      "needs_start",
    );
    expect(await store.textedStop(A)).toBe(true);
    expect(await store.textsOn(A)).toBe(false);

    twilio(() => new Response("down", { status: 503 }));
    expect(await store.optIn(B, "texts_page", details, DAY)).toBe("on");
    expect(await store.textsOn(B)).toBe(true);
    expect(await store.confirmedForTexts(B)).toBe(false);
    expect(await store.sendPendingConfirmations(DAY)).toMatchObject({
      retry: 1,
    });
    expect(await store.textsOn(B)).toBe(true);
    twilio(ok);
    expect((await store.sendPendingConfirmations(DAY)).sent).toBe(1);
    expect(await store.confirmedForTexts(B)).toBe(true);

    await q("truncate contact_consents, sms_opt_outs restart identity");
    twilio(() => Response.json({ code: 21211 }, { status: 400 }));
    expect(await store.optIn(B, "texts_page", details, DAY)).toBe("failed");
    expect(await store.textsOn(B)).toBe(false);
    expect(await store.textedStop(B)).toBe(false);
  });

  it("records delivery reports, signed, and turns off numbers that can't get texts (H1)", async () => {
    await store.optIn(A, "texts_page", details);
    await store.optIn(B, "texts_page", details);
    await q(
      `insert into sms_program_sends (issue_date, phone, status, twilio_sid, sent_at) values ('2026-12-03', '${A}', 'sent', 'SMd1', now())`,
    );
    const status = await import("@/app/api/texts/status/route");
    const post = (params: Record<string, string>, sig?: string) =>
      status.POST(
        new Request("http://localhost/api/texts/status", {
          method: "POST",
          headers: {
            "x-twilio-signature":
              sig ??
              twilioSignature(
                "test_auth_token",
                "https://parkroulette.quest/api/texts/status",
                params,
              ),
          },
          body: new URLSearchParams(params),
        }),
      );
    const forged = await post(
      { MessageSid: "SMd1", MessageStatus: "delivered", To: A },
      "AAAA",
    );
    expect(forged.status).toBe(403);
    await post({
      MessageSid: "SMd1",
      MessageStatus: "undelivered",
      To: A,
      ErrorCode: "30003",
    });
    const [row] = (await q(
      "select delivery_status, error_code from sms_program_sends",
    )) as Record<string, unknown>[];
    expect(row).toMatchObject({
      delivery_status: "undelivered",
      error_code: 30003,
    });
    expect(await store.textsOn(A)).toBe(false);
    expect(await store.textedStop(A)).toBe(false);
    // Carrier filtering: James hears about it; the number stays on.
    await post({
      MessageSid: "SMd2",
      MessageStatus: "undelivered",
      To: B,
      ErrorCode: "30007",
    });
    expect(await store.textsOn(B)).toBe(true);
    // Twilio has a STOP we never heard: listed.
    await post({
      MessageSid: "SMd3",
      MessageStatus: "failed",
      To: B,
      ErrorCode: "21610",
    });
    expect(await store.textedStop(B)).toBe(true);
  });

  it("honors a stop in plain words, and lets Twilio answer when it already did", async () => {
    await store.optIn(B, "texts_page", details);
    // A stop in plain words: the only reply we send ourselves.
    const r = await reply(B, "please stop texting me", "SM3");
    expect(r.text).toContain("You're unsubscribed");
    // The same message again (Twilio retry): handled once, no second reply.
    expect(
      (await reply(B, "please stop texting me", "SM3")).text,
    ).not.toContain("unsubscribed");
    expect(await store.textsOn(B)).toBe(false);
    await store.optIn(A, "texts_page", details);
    const handled = await reply(A, "STOP", "SM4", { OptOutType: "STOP" });
    expect(handled.text).not.toContain("<Message>");
    expect(await store.textsOn(A)).toBe(false);
  });

  it("refuses a forged webhook", async () => {
    const res = await inbound.POST(
      new Request("http://localhost/api/texts/inbound", {
        method: "POST",
        headers: { "x-twilio-signature": "AAAA" },
        body: new URLSearchParams({
          From: A,
          Body: "START",
          MessageSid: "SM9",
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("a changed number or a deleted account stops texts without listing the number", async () => {
    await store.optIn(A, "texts_page", { ...details, explorerId: 7 });
    await store.stopTextsFor([{ phone: A, explorerId: 7 }], "number_changed");
    expect(await store.textsOn(A)).toBe(false);
    expect(await store.offByNumberChange(7)).toBe(true);
    // The number's new owner can say yes with a code (not on the STOP list).
    expect(await store.optIn(A, "texts_page", details)).toBe("on");
  });

  it("keeps consent records 4 years from the last text sent", async () => {
    await store.optIn(A, "texts_page", details);
    await q(
      `update contact_consents set created_at = now() - interval '5 years'`,
    );
    await q(
      `insert into sms_last_texts (phone, sent_at) values ('${A}', now() - interval '1 year')`,
    );
    expect(await store.pruneTextConsents()).toBe(0);
    await q(
      `update sms_last_texts set sent_at = now() - interval '4 years 1 day'`,
    );
    expect(await store.pruneTextConsents()).toBeGreaterThan(0);
  });

  it("drops the number and text from send rows at 13 months, and the rows at 4 years (M7)", async () => {
    await q(`insert into sms_program_sends (issue_date, phone, status, body, created_at) values
      ('2026-01-01', '${A}', 'sent', 'x', now() - interval '2 months'),
      ('2025-01-01', '${A}', 'sent', 'x', now() - interval '14 months'),
      ('2021-01-01', '${B}', 'sent', 'x', now() - interval '4 years 1 day')`);
    await store.pruneTextConsents();
    const rows = (await q(
      "select issue_date::text as d, phone, body from sms_program_sends order by issue_date",
    )) as Record<string, unknown>[];
    expect(rows).toEqual([
      { d: "2025-01-01", phone: null, body: null },
      { d: "2026-01-01", phone: A, body: "x" },
    ]);
  });
});
