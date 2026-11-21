import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testDbOn } from "@/lib/local-db";

/**
 * The Thursday sender against a real (local) Postgres. Opt-in, like the
 * rest of the database tests here would be: set TEST_DATABASE_URL to a
 * throwaway local database with the migrations applied, e.g.
 *
 *   createdb -h localhost -p 5544 -U postgres park_roulette_test
 *   DATABASE_URL=postgres://postgres@localhost:5544/park_roulette_test \
 *     pnpm exec tsx scripts/migrate.mts
 *   TEST_DATABASE_URL=postgres://postgres@localhost:5544/park_roulette_test \
 *     pnpm exec vitest run src/lib/news/sender.db.test.ts
 *
 * It wipes the newsletter tables, explorers, crews and parks in that
 * database, so it refuses anything that isn't on localhost.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = testDbOn(URL_);

const DATE = "2026-12-03";
/** Thursday, 7:30 Pacific. */
const NOW = new Date("2026-12-03T15:30:00Z");

type Batch = (emails: { to: string[] }[], key: string) => Response;
/** One-off emails (welcome, link) the app sent through Resend. */
const singles: {
  to: string[];
  subject: string;
  text: string;
  headers?: Record<string, string>;
}[] = [];

describe.skipIf(!local)("the sender, against Postgres", () => {
  let mods: {
    db: typeof import("@/db").db;
    sql: typeof import("drizzle-orm").sql;
    runNewsSend: typeof import("./sender").runNewsSend;
    subs: typeof import("./subscribers");
  };
  let batch: Batch;
  const keys: string[] = [];
  const delivered: string[] = [];

  const q = (text: string) => mods.db.execute(mods.sql.raw(text));

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NEWS_POSTAL_ADDRESS = "PO Box 0, Hillsboro, OR";
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (new URL(url).pathname.endsWith("/weather.png"))
          return new Response("png", {
            headers: { "content-type": "image/png" },
          });
        if (url === "https://api.resend.com/emails/batch") {
          const emails = JSON.parse(String(init?.body)) as { to: string[] }[];
          const key = new Headers(init?.headers).get("idempotency-key")!;
          keys.push(key);
          const res = batch(emails, key);
          if (res.ok) delivered.push(...emails.map((e) => e.to[0]));
          return res;
        }
        if (url === "https://api.resend.com/emails") {
          singles.push(
            JSON.parse(String(init?.body)) as (typeof singles)[number],
          );
          return Response.json({ id: "one" });
        }
        return new Response("nope", { status: 404 });
      },
    );
    const [{ db }, { sql }, sender, subs] = await Promise.all([
      import("@/db"),
      import("drizzle-orm"),
      import("./sender"),
      import("./subscribers"),
    ]);
    mods = {
      db,
      sql,
      runNewsSend: sender.runNewsSend,
      subs,
    };
  });

  afterAll(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    keys.length = 0;
    delivered.length = 0;
    batch = (emails) =>
      Response.json({ data: emails.map((_, i) => ({ id: `em_${i}` })) });
    await q(`truncate news_sends, news_issues, news_plans, news_settings, news_clicks,
      email_confirmations, contact_consents, email_subscribers, news_salts, alert_log, park_changes, park_votes,
      visits, reviews, explorers, crews, parks restart identity cascade`);
    await q(`insert into news_settings (id, dry_run) values (1, false)`);
    await q(`insert into parks (slug, name, city, lat, lng, approved_at, features)
      values ('juniper-park-bend', 'Juniper Park', 'Bend', 44.05, -121.29, now(), '{swings}')`);
    await q(
      `insert into crews (name, color, join_code, friend_code) values ('Test', 'blue', 'j1', 'f1')`,
    );
    await q(
      `insert into news_plans (issue_date, plan) values ('${DATE}', '${JSON.stringify(plan).replace(/'/g, "''")}')`,
    );
    await q(
      `insert into news_issues (issue_date, body) values ('${DATE}', '${JSON.stringify(draft).replace(/'/g, "''")}')`,
    );
  });

  /** n confirmed subscribers (no accounts: email_subscribers only). */
  async function subscribers(n: number) {
    if (!n) return;
    await q(`insert into email_subscribers (email, email_hash, status, token, confirmed_at, source, consent_version)
      select 'p' || g || '@example.com', 'sha256:x' || g, 'confirmed', 'tok' || lpad(g::text, 40, '0'), now(), 'footer', 'email-2026-11-20'
      from generate_series(1, ${n}) g`);
  }

  async function issue() {
    const [r] = (await q(
      `select id, status, skip_reason, rendered is not null as rendered from news_issues where issue_date = '${DATE}'`,
    )) as unknown as {
      id: number;
      status: string;
      skip_reason: string | null;
      rendered: boolean;
    }[];
    return r;
  }
  async function sends() {
    return (await q(
      `select status, count(*)::int as n from news_sends group by status order by status`,
    )) as unknown as { status: string; n: number }[];
  }

  it("sends to every confirmed subscriber and marks the issue sent", async () => {
    await subscribers(150);
    // Waiting and stopped rows never get it.
    await q(`insert into email_subscribers (email, email_hash, status, source, consent_version)
      values ('waiting@example.com', 'sha256:w', 'pending', 'footer', 'v'), (null, 'sha256:s', 'stopped', 'footer', 'v')`);
    const r = await mods.runNewsSend(NOW);
    expect(r.action).toBe("sent");
    expect(keys).toEqual(["news-1-0-a0", "news-1-1-a0"]);
    expect(delivered).toHaveLength(150);
    expect((await issue()).status).toBe("sent");
    expect((await issue()).rendered).toBe(true);
    // The lease is released.
    const [s] = (await q(
      `select lock_owner from news_settings`,
    )) as unknown as { lock_owner: string | null }[];
    expect(s.lock_owner).toBeNull();
  });

  it("resumes after a mid-batch 500, on the next key, with no one emailed twice", async () => {
    await subscribers(250);
    let failed = false;
    batch = (emails, key) => {
      if (key === "news-1-1-a0" && !failed) {
        failed = true;
        return Response.json({ name: "application_error" }, { status: 500 });
      }
      return Response.json({ data: emails.map((_, i) => ({ id: `em_${i}` })) });
    };
    const first = await mods.runNewsSend(NOW);
    expect(first.action).toBe("partial");
    expect((await issue()).status).toBe("draft");
    // 15 minutes later (and after 9:00 it would still resume).
    const second = await mods.runNewsSend(new Date("2026-12-03T17:45:00Z"));
    expect(second.action).toBe("sent");
    expect(keys).toEqual([
      "news-1-0-a0",
      "news-1-1-a0",
      "news-1-2-a0",
      "news-1-1-a1",
    ]);
    expect(new Set(delivered).size).toBe(250);
    expect(delivered).toHaveLength(250);
    expect(await sends()).toEqual([{ status: "sent", n: 250 }]);
  });

  it("marks the issue failed (not sent) when every chunk fails", async () => {
    await subscribers(120);
    batch = () => Response.json({ name: "validation_error" }, { status: 403 });
    const r = await mods.runNewsSend(NOW);
    expect(r.action).toBe("failed");
    expect((await issue()).status).toBe("failed");
    expect(await sends()).toEqual([{ status: "failed", n: 120 }]);
    // A failed week never shows on the web or counts as history.
    const [{ n }] = (await q(
      `select count(*)::int as n from news_issues where status = 'sent'`,
    )) as unknown as { n: number }[];
    expect(n).toBe(0);
  });

  it("skips the week, with its own reason, when nobody is subscribed", async () => {
    const r = await mods.runNewsSend(NOW);
    expect(r.action).toBe("skipped");
    const i = await issue();
    expect(i.status).toBe("skipped");
    expect(i.skip_reason).toMatch(/no one to send to|Nobody has confirmed/);
    expect(await sends()).toEqual([]);
  });

  it("closes an unfinished send from an earlier week: sent if anyone got it, failed if no one did", async () => {
    await subscribers(3);
    await q(`insert into news_issues (issue_date, status, body, sent_body, send_started_at)
      values ('2026-11-19', 'draft', '${JSON.stringify(draft).replace(/'/g, "''")}', '${JSON.stringify(draft).replace(/'/g, "''")}', now() - interval '14 days'),
             ('2026-11-12', 'draft', '${JSON.stringify(draft).replace(/'/g, "''")}', '${JSON.stringify(draft).replace(/'/g, "''")}', now() - interval '21 days')`);
    await q(`insert into news_sends (issue_id, subscriber_id, chunk, status)
      select i.id, e.id, 0, case when e.id = 1 and i.issue_date = '2026-11-19' then 'sent' else 'queued' end
      from news_issues i, email_subscribers e where i.issue_date in ('2026-11-19', '2026-11-12')`);
    // Blocked this week, so only the close runs.
    await q(`update news_settings set paused = true`);
    await mods.runNewsSend(NOW);
    const rows = (await q(
      `select issue_date, status from news_issues where issue_date < '${DATE}' order by issue_date`,
    )) as unknown as { issue_date: string; status: string }[];
    expect(rows).toEqual([
      { issue_date: "2026-11-12", status: "failed" },
      { issue_date: "2026-11-19", status: "sent" },
    ]);
    const [{ n }] = (await q(
      `select count(*)::int as n from news_sends where status in ('queued', 'sending')`,
    )) as unknown as { n: number }[];
    expect(n).toBe(0);
  });

  it("a plan refused as too far ahead still names next_issue_date", async () => {
    process.env.NEWS_INGEST_TOKEN = "t".repeat(32);
    const { GET } = await import("@/app/api/news/plan/route");
    const res = await GET(
      new Request("http://localhost/api/news/plan?date=2099-01-01", {
        headers: { authorization: `Bearer ${"t".repeat(32)}` },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { next_issue_date?: string };
    expect(body.next_issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("tells the writer the next Thursday to draft for (next_issue_date)", async () => {
    const { nextDraftDate } = await import("./data");
    // Thursday, December 3, 2026 (DATE's week): 4:30 am Pacific is this
    // Thursday; 7:30 am, past the send window's start, is next week's.
    expect(await nextDraftDate(new Date("2026-12-03T12:30:00Z"))).toBe(
      "2026-12-03",
    );
    expect(await nextDraftDate(new Date("2026-12-03T15:30:00Z"))).toBe(
      "2026-12-10",
    );
    // A Tuesday: that week's Thursday.
    expect(await nextDraftDate(new Date("2026-12-08T18:00:00Z"))).toBe(
      "2026-12-10",
    );
    // Christmas Eve and New Year's Eve are skip dates.
    expect(await nextDraftDate(new Date("2026-12-22T18:00:00Z"))).toBe(
      "2027-01-07",
    );
  });

  it("waits while another run holds the lease", async () => {
    await subscribers(5);
    await q(
      `update news_settings set lock_until = now() + interval '5 minutes', lock_owner = 'other'`,
    );
    const r = await mods.runNewsSend(NOW);
    expect(r).toMatchObject({ action: "idle" });
    expect(keys).toEqual([]);
  });

  // --- Signing up (email_subscribers) ------------------------------------

  async function explorer(name: string) {
    const [r] = (await q(
      `insert into explorers (crew_id, name, color, avatar) values (1, '${name}', 'blue', 'fox') returning id`,
    )) as unknown as { id: number }[];
    return r.id;
  }
  async function rowsFor(email: string) {
    return (await q(
      `select id, status, explorer_id, token is not null as token from email_subscribers where email = '${email}' or (email is null and email_hash like '%${email}%') order by id`,
    )) as unknown as {
      id: number;
      status: string;
      explorer_id: number | null;
      token: boolean;
    }[];
  }
  /** The token from the last confirmation link we "emailed" (logged). */
  const tokens: string[] = [];
  const realInfo = console.info;
  beforeAll(() => {
    console.info = (...a: unknown[]) => {
      const m = String(a[0]).match(/confirm\?t=([A-Za-z0-9_-]{43})/);
      if (m) tokens.push(m[1]);
      else realInfo(...a);
    };
  });
  afterAll(() => {
    console.info = realInfo;
  });
  async function lastLink() {
    // Links are logged when the outbox runs (no RESEND key in that path).
    return tokens.at(-1)!;
  }

  it("signs up signed out at once, with a welcome email, never revealing who's on the list", async () => {
    singles.length = 0;
    const first = await mods.subs.subscribe({
      email: " New@Example.com ",
      source: "footer",
      ip: "1.2.3.4",
    });
    expect(first).toHaveLength(1);
    await mods.subs.flush(first);
    expect(await rowsFor("new@example.com")).toMatchObject([
      { status: "confirmed", explorer_id: null, token: true },
    ]);
    // The welcome email: what arrives, and the way out.
    expect(singles).toHaveLength(1);
    expect(singles[0].subject).toBe("You're in: Bend Playground Passport");
    expect(singles[0].text).toContain("Didn't sign up? Unsubscribe anytime");
    expect(singles[0].text).toMatch(/news\/unsubscribe\?t=[A-Za-z0-9_-]{43}/);
    expect(singles[0].headers?.["List-Unsubscribe"]).toMatch(
      /^<.*\/api\/news\/unsubscribe\?t=[A-Za-z0-9_-]{43}>$/,
    );
    expect(singles[0].headers?.["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
    // Signing up again: no second welcome, the same answer, one row.
    const again = await mods.subs.subscribe({
      email: "new@example.com",
      source: "footer",
      ip: "1.2.3.4",
    });
    expect(again).toHaveLength(0);
    expect(await rowsFor("new@example.com")).toHaveLength(1);
    const [c] = (await q(
      `select count(*)::int as n from contact_consents where address = 'new@example.com' and action = 'opt_in'`,
    )) as unknown as { n: number }[];
    expect(c.n).toBe(1);
  });

  it("records the welcome sheet's pre-checked yes with its own version and details (batch 6)", async () => {
    singles.length = 0;
    await mods.subs.flush(
      await mods.subs.subscribe({
        email: "sheet@example.com",
        source: "welcome_sheet",
        ip: "1.2.3.5",
        consentVersion: "email-2026-11-22-prechecked",
        details: { prechecked: true, path: "/" },
      }),
    );
    await mods.subs.flush(
      await mods.subs.subscribe({
        email: "plain@example.com",
        source: "footer",
        ip: "1.2.3.5",
      }),
    );
    const rows = (await q(
      `select address, consent_version as v, details from contact_consents where action = 'opt_in' order by id`,
    )) as unknown as { address: string; v: string; details: unknown }[];
    expect(rows).toEqual([
      {
        address: "sheet@example.com",
        v: "email-2026-11-22-prechecked",
        details: { prechecked: true, path: "/" },
      },
      { address: "plain@example.com", v: "email-2026-11-21", details: null },
    ]);
    // One welcome email each, the same as any sign-up.
    expect(singles).toHaveLength(2);
  });

  it("joins an existing address to an account only on the tap; a new one is on at once", async () => {
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const sam = await explorer("Sam");
      await mods.subs.flush(
        await mods.subs.subscribe({
          email: "fam@example.com",
          source: "footer",
        }),
      );
      // Sam types the same address in settings: nothing joins yet.
      await mods.subs.flush(
        await mods.subs.subscribe({
          email: "fam@example.com",
          source: "settings",
          explorerId: sam,
        }),
      );
      expect(await rowsFor("fam@example.com")).toMatchObject([
        { explorer_id: null, status: "confirmed" },
      ]);
      expect(await mods.subs.confirmEmail(await lastLink())).toEqual({
        result: "confirmed",
        linked: true,
      });
      expect(await mods.subs.subscriptionFor(sam)).toEqual({
        status: "on",
        email: "fam@example.com",
      });
      // A new address: the old one stops right away; the new one is on.
      await mods.subs.flush(
        await mods.subs.subscribe({
          email: "sam2@example.com",
          source: "settings",
          explorerId: sam,
        }),
      );
      const [{ n }] = (await q(
        `select count(*)::int as n from email_subscribers where status = 'stopped' and email is null`,
      )) as unknown as { n: number }[];
      expect(n).toBe(1);
      expect(await mods.subs.subscriptionFor(sam)).toEqual({
        status: "on",
        email: "sam2@example.com",
      });
      // Deleting the account stops it.
      await mods.subs.stopForExplorers([sam], "account_deleted");
      expect(await mods.subs.subscriptionFor(sam)).toEqual({
        status: "off",
        email: null,
      });
    } finally {
      process.env.RESEND_API_KEY = key;
    }
  });

  it("rate limits per IP fingerprint, and a double tap welcomes once", async () => {
    const outs = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        mods.subs.subscribe({ email: "same@example.com", source: "footer" }),
      ),
    );
    expect(outs.filter((o) => o.length === 1)).toHaveLength(1);
    expect(await rowsFor("same@example.com")).toHaveLength(1);
    const byIp = [];
    for (let i = 0; i < 12; i++)
      byIp.push(
        await mods.subs.subscribe({
          email: `ip${i}@example.com`,
          source: "footer",
          ip: "9.9.9.9",
        }),
      );
    expect(byIp.filter((o) => o.length === 1)).toHaveLength(10);
    // The salt is stored; the IP never is.
    const [c] = (await q(
      `select count(*)::int as n from email_confirmations where ip_hash like 'ip:%'`,
    )) as unknown as { n: number }[];
    expect(c.n).toBe(10);
  });

  it("keeps counting toward the caps when a signed-in grown-up keeps switching addresses (H-1, M2)", async () => {
    const pat = await explorer("Pat");
    let welcomes = 0;
    let busy = 0;
    for (let i = 0; i < 12; i++) {
      const out = await mods.subs.subscribe({
        email: `switch${i}@example.com`,
        source: "settings",
        explorerId: pat,
        ip: "203.0.113.9",
      });
      welcomes += out.length;
      if (out.busy) busy++;
    }
    expect(welcomes).toBe(10);
    expect(busy).toBe(2);
    // The rows behind the caps stay (expired), never deleted.
    const [c] = (await q(
      `select count(*)::int as n from email_confirmations where created_at > now() - interval '1 day'`,
    )) as unknown as { n: number }[];
    expect(c.n).toBe(10);
    expect(await mods.subs.signupsBusy("203.0.113.9")).toBe(true);
    expect(await mods.subs.signupsBusy("198.51.100.1")).toBe(false);
  });

  it("deleting an account never stops an address it only asked to connect: the link just expires", async () => {
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      await mods.subs.subscribe({ email: "lee@example.com", source: "footer" });
      const lee = await explorer("Lee");
      await mods.subs.subscribe({
        email: "lee@example.com",
        source: "settings",
        explorerId: lee,
      });
      expect(await mods.subs.subscriptionFor(lee)).toEqual({
        status: "pending",
        email: "lee@example.com",
      });
      await mods.subs.stopForExplorers([lee], "account_deleted");
      // The other person's subscription stays; the account's link expires.
      expect(await rowsFor("lee@example.com")).toMatchObject([
        { status: "confirmed", explorer_id: null },
      ]);
      const [l] = (await q(
        `select count(*)::int as n from email_confirmations where purpose = 'link' and (used_at is null or expires_at > now())`,
      )) as unknown as { n: number }[];
      expect(l.n).toBe(0);
    } finally {
      process.env.RESEND_API_KEY = key;
    }
  });

  it("turns old pending sign-ups into subscribers, with no email (migration 0015)", async () => {
    await q(
      `insert into email_subscribers (email, email_hash, status, source, consent_version) values ('old@example.com', 'sha256:x', 'pending', 'migrated', 'email-2026-11-20')`,
    );
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await q(
      readFileSync(
        join(process.cwd(), "drizzle/0015_single_opt_in.sql"),
        "utf8",
      ),
    );
    expect(await rowsFor("old@example.com")).toMatchObject([
      { status: "confirmed", token: true },
    ]);
    const [t] = (await q(
      `select token from email_subscribers where email = 'old@example.com'`,
    )) as unknown as { token: string }[];
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [c] = (await q(
      `select count(*)::int as n from contact_consents where address = 'old@example.com' and source = 'single_opt_in_migration'`,
    )) as unknown as { n: number }[];
    expect(c.n).toBe(1);
  });

  it("deletes old pending sign-ups nobody confirmed within 7 days", async () => {
    // Pending rows only come from before single opt-in now.
    for (const e of ["stale@example.com", "fresh@example.com"])
      await q(
        `insert into email_subscribers (email, email_hash, status, source, consent_version) values ('${e}', 'sha256:${e}', 'pending', 'footer', 'email-2026-11-20')`,
      );
    await q(
      `insert into email_confirmations (subscriber_id, purpose, token_hash, address_hash, expires_at) select id, 'subscribe', 'h-' || id, email_hash, now() + interval '7 days' from email_subscribers where email = 'stale@example.com'`,
    );
    await q(
      `update email_subscribers set created_at = now() - interval '8 days' where email = 'stale@example.com'`,
    );
    // Its link still works (a resend renewed it): kept until the latest
    // link expires.
    expect(await mods.subs.purgePending()).toBe(0);
    await q(
      `update email_confirmations set expires_at = now() - interval '1 hour' where subscriber_id in (select id from email_subscribers where email = 'stale@example.com')`,
    );
    expect(await mods.subs.purgePending()).toBe(1);
    expect(await rowsFor("stale@example.com")).toEqual([]);
    expect(await rowsFor("fresh@example.com")).toHaveLength(1);
    const [c] = (await q(
      `select count(*)::int as n from contact_consents where address = 'stale@example.com'`,
    )) as unknown as { n: number }[];
    expect(c.n).toBe(0);
  });
});

// --- Fixtures --------------------------------------------------------------

const plan = {
  issue_date: DATE,
  generated_at: "2026-12-03T12:30:00Z",
  calendar: { skip: null, holidays: [], breaks: [], dst: null, season: null },
  weather: { ok: true, source: "test", days: [], bad_days: [], labels: [] },
  forecast: {
    source: "test",
    days: [
      {
        date: "2026-12-04",
        label: "Friday",
        condition: "Sunny",
        icon: "sun",
        high: 42,
        low: 20,
        precip: 0,
      },
      {
        date: "2026-12-05",
        label: "Saturday",
        condition: "Snow",
        icon: "snow",
        high: 30,
        low: 18,
        precip: 80,
      },
      {
        date: "2026-12-06",
        label: "Sunday",
        condition: "Partly sunny",
        icon: "partly",
        high: 38,
        low: 19,
        precip: 10,
      },
    ],
  },
  wheel_pick: {
    slug: "juniper-park-bend",
    name: "Juniper Park",
    city: "Bend",
    url: "https://parkroulette.quest/parks/juniper-park-bend",
    features: [],
    reasons: [],
    eligible_count: 1,
    photo: null,
  },
  plan_b: { mode: "window", relaxed_to_weeks: 4, venues: [], tips: [] },
  deltas: { since: null, changes: [] },
  cooldowns: {
    wheel: [],
    featured: [],
    venue: [],
    tip: [],
    challenge: [],
    series: [],
  },
  challenges: [],
  event_series: [],
  seasonal_defaults: [],
  rules: {},
};

const draft = {
  issue_date: DATE,
  subject: "Juniper Park before the snow",
  preview: "A dry Friday window for swings, then snow on Saturday morning.",
  hello: {
    text: "Hi there, James here. The first real cold snap of the season is coming, and Saturday looks snowy across Bend, Redmond and Sisters. Friday stays dry and bright, so this week is about picking the right day for the playground and keeping a warm backup plan ready for the snowy one at home.",
  },
  weekend_ahead: { note: "Best park window: Friday afternoon" },
  wheel_pick: {
    park: "juniper-park-bend",
    why_now:
      "The wheel landed on Juniper Park, and Friday is the dry window. The spinny things and swings are a good warmup before the weekend turns white, and the paths around the ponds stay easy for strollers and small boots.",
    who_for:
      "Big kids who like to spin until they wobble, and toddlers who are happy on the low swings near the restrooms by the pool building.",
    bring:
      "Gloves for cold metal, a thermos of cocoa, dry socks in the car, and a towel for the bottom of the slide after the frost.",
  },
  passport: {
    challenge_id: "challenge-first-critic",
    text: "Find a park on the map with no stars yet, play there this weekend, and leave the very first review so the next family knows what to expect when they get there.",
  },
  signoff: {
    text: "Spotted a closure, a broken swing or a brand new playground? Hit reply and tell me. Every note gets read, and the good ones end up in the next issue.",
  },
};
