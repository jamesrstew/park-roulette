import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
    store = await import("./texts-store");
    inbound = await import("@/app/api/texts/inbound/route");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) => db.execute(sql.raw(s)) as unknown as Promise<unknown[]>;
  });
  beforeEach(async () => {
    await q(
      `truncate contact_consents, sms_opt_outs, sms_last_texts, webhook_events restart identity cascade`,
    );
  });

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

  it("STOP turns it off, replies once, and then a yes needs START from the phone", async () => {
    await store.optIn(A, "texts_page", details);
    const r = await reply(A, "stop", "SM1");
    expect(r.text).toContain("You're unsubscribed");
    expect(await store.textsOn(A)).toBe(false);
    // The same message again (Twilio retry): handled once, no second reply.
    expect((await reply(A, "stop", "SM1")).text).not.toContain("unsubscribed");
    expect(await store.optIn(A, "settings", details)).toBe("needs_start");
    expect(await store.textsOn(A)).toBe(false);
    const s = await reply(A, "START", "SM2");
    expect(s.text).toContain("Welcome back");
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

  it("holds the confirmation while sending is off, sends it first once on, and never texts an unconfirmed number (M3)", async () => {
    await store.optIn(A, "texts_page", details);
    expect(await store.textsOn(A)).toBe(true);
    expect(await store.confirmedForTexts(A)).toBe(false);
    expect((await store.sendProgramText(A, "Weekend pick")).ok).toBe(false);
    // Off: nothing goes.
    expect(await store.sendPendingConfirmations()).toBe(0);
    process.env.TEXTS_SENDING_ENABLED = "1";
    process.env.TWILIO_TEXTS_SERVICE_SID = "MG_test";
    const sent: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new URLSearchParams(String(init?.body)).get("Body") ?? "");
      return Response.json({ sid: "SMx" }, { status: 201 });
    }) as typeof fetch;
    try {
      expect(await store.sendPendingConfirmations()).toBe(1);
      expect(sent[0]).toContain("You're in!");
      expect(await store.confirmedForTexts(A)).toBe(true);
      // Only once.
      expect(await store.sendPendingConfirmations()).toBe(0);
    } finally {
      globalThis.fetch = real;
      delete process.env.TEXTS_SENDING_ENABLED;
      delete process.env.TWILIO_TEXTS_SERVICE_SID;
    }
  });

  it("honors a stop in plain words, and lets Twilio answer when it already did", async () => {
    await store.optIn(B, "texts_page", details);
    const r = await reply(B, "please stop texting me", "SM3");
    expect(r.text).toContain("You're unsubscribed");
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
});
