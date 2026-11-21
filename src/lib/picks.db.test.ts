import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The welcome sheet's savePicks, end to end against a real (local)
 * Postgres: the session, cookies and headers are stubbed; the action, the
 * consent check, optIn and subscribe are the real ones. Opt-in: set
 * TEST_DATABASE_URL (see news/sender.db.test.ts). Confirmations stay off,
 * so no text ever leaves, and with no Resend key no email does.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);
const PHONE = "+15415550133";

const h = vi.hoisted(() => {
  const jar = new Map<string, string>();
  return {
    jar,
    me: null as null | Record<string, unknown>,
    later: [] as Promise<unknown>[],
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) =>
      h.jar.has(k) ? { name: k, value: h.jar.get(k)! } : undefined,
    has: (k: string) => h.jar.has(k),
    set: (k: string, v: string) => void h.jar.set(k, v),
    delete: (k: string) => void h.jar.delete(k),
  }),
  headers: async () =>
    new Headers({ "user-agent": "test", "x-forwarded-for": "1.2.3.9" }),
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => void h.later.push(fn()),
}));
vi.mock("./data", async (orig) => ({
  ...(await orig<typeof import("./data")>()),
  getMe: async () => h.me,
}));

describe.skipIf(!local)("savePicks, against Postgres", () => {
  let actions: typeof import("./texts-actions");
  let texts: typeof import("./texts");
  let q: (s: string) => Promise<unknown[]>;
  let explorerId = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.NEXT_PUBLIC_TEXTS_NUMBER = "+15417198628";
    process.env.TEXTS_SENDING_ENABLED = "1";
    process.env.TWILIO_TEXTS_SERVICE_SID = "MG_test";
    delete process.env.TEXTS_CONFIRMATIONS_ENABLED;
    delete process.env.RESEND_API_KEY;
    actions = await import("./texts-actions");
    texts = await import("./texts");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) => db.execute(sql.raw(s)) as unknown as Promise<unknown[]>;
  });
  beforeEach(async () => {
    await q(
      `truncate contact_consents, sms_opt_outs, email_subscribers, email_confirmations, news_settings, explorers, crews restart identity cascade`,
    );
    // Texts really going out: dry run and the kill switch off.
    await q(
      `insert into news_settings (id, texts_dry_run, texts_paused) values (1, false, false)`,
    );
    await q(
      `insert into crews (name, color, join_code, friend_code) values ('Test', 'blue', 'j1', 'f1')`,
    );
    const [r] = (await q(
      `insert into explorers (crew_id, name, color, avatar, phone, phone_verified_at, terms_accepted_at) values (1, 'Sam', 'blue', '🦊', '${PHONE}', now(), now()) returning id`,
    )) as { id: number }[];
    explorerId = r.id;
    h.me = {
      id: explorerId,
      name: "Sam",
      isKid: false,
      trusted: true,
      phone: PHONE,
    };
    h.jar.clear();
    h.later.length = 0;
  });

  const yes = (version: string) => ({
    agreed: true,
    version,
    checkbox: texts.checkboxLine(version, PHONE),
    disclosure: texts.TEXTS_CONSENT_TEXT[version].disclosure,
  });
  const consents = async () =>
    (await q(
      `select channel, action, consent_version as v, source, details from contact_consents order by id`,
    )) as {
      channel: string;
      action: string;
      v: string;
      source: string;
      details: Record<string, unknown> | null;
    }[];

  it("a blank email and an unchecked texts box sign no one up", async () => {
    const r = await actions.savePicks({ email: "  ", texts: null, path: "/" });
    await Promise.all(h.later);
    expect(r).toMatchObject({ ok: true, tracks: [] });
    expect(await consents()).toEqual([]);
    expect(await q("select id from email_subscribers")).toEqual([]);
    expect(h.jar.has("pr_on")).toBe(false);
  });

  it("records each yes with the sheet's source and versions", async () => {
    const r = await actions.savePicks({
      email: "sam@example.com",
      texts: yes("sms-2026-11-22-sheet"),
      path: "/",
    });
    await Promise.all(h.later);
    expect(r).toMatchObject({
      ok: true,
      email: { ok: true },
      texts: { ok: true, state: "on" },
    });
    const rows = await consents();
    const sms = rows.filter((c) => c.channel === "sms");
    expect(sms.map((c) => c.action)).toEqual([
      "requested",
      "opt_in",
      "confirmation_pending",
    ]);
    for (const c of sms) {
      expect(c.v).toBe("sms-2026-11-22-sheet");
      expect(c.source).toBe("welcome_sheet");
    }
    expect(sms[1].details).toMatchObject({
      agreed: true,
      buttonShown: "Let's spin!",
      explorerId,
      path: "/",
    });
    const email = rows.filter((c) => c.channel === "email");
    expect(email).toEqual([
      {
        channel: "email",
        action: "opt_in",
        v: "email-2026-11-22-prechecked",
        source: "welcome_sheet",
        details: { prechecked: true, path: "/" },
      },
    ]);
    expect(h.jar.get("pr_on")).toBe("et");
  });

  it("refuses another surface's words, and texts while they aren't going out", async () => {
    const footer = await actions.savePicks({
      email: null,
      texts: yes("sms-2026-11-22-footer"),
      path: "/",
    });
    expect(footer).toMatchObject({ ok: true, texts: { ok: false } });
    await q(`update news_settings set texts_dry_run = true`);
    const dry = await actions.savePicks({
      email: null,
      texts: yes("sms-2026-11-22-sheet"),
      path: "/",
    });
    expect(dry).toMatchObject({ ok: true, texts: { ok: false } });
    expect(
      (await consents()).filter((c) => c.action === "opt_in"),
    ).toHaveLength(0);
  });

  it("never lets the Count us in! form claim the welcome sheet", async () => {
    const news = await import("./park-news-actions");
    const r = await news.signUpForEmail("sam@example.com", "welcome_sheet");
    await Promise.all(h.later);
    expect(r.ok).toBe(false);
    expect(await q("select id from email_subscribers")).toEqual([]);
  });
});
