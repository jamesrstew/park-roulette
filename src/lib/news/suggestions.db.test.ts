import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDbOn } from "@/lib/local-db";
import type { SentIssue } from "./cooldowns";

/**
 * Parents' corner suggestions against a real (local) Postgres, with Meta
 * and Instagram's post pages mocked. Opt-in: TEST_DATABASE_URL on
 * localhost, migrated (see sender.db.test.ts).
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = testDbOn(URL_);
const NOW = new Date("2026-12-03T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const JAMES = "1441606531378643";

describe.skipIf(!local)("Parents' corner suggestions, against Postgres", () => {
  let mods: {
    db: typeof import("@/db").db;
    sql: typeof import("drizzle-orm").sql;
    s: typeof import("./suggestions");
  };
  const q = (text: string) => mods.db.execute(mods.sql.raw(text));
  const calls: string[] = [];
  /** Shared by DM, per message id. */
  let shares: Record<string, string[]>;
  let messages: {
    id: string;
    created_time: string;
    from: { id: string; username: string };
  }[];
  /** The media each account's Business Discovery returns. */
  let pages: Record<string, object[]>;
  /** Business Discovery answers this status (a rate limit is 403). */
  let discoveryStatus: number;
  /** Milliseconds Business Discovery takes to answer. */
  let discoveryDelay: number;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${u.hostname}${u.pathname}`);
    if (u.hostname === "www.instagram.com") {
      expect(init?.redirect).toBe("manual");
      const code = u.pathname.split("/")[2];
      if (code === "REDIRECT01")
        return new Response(null, {
          status: 302,
          headers: { location: "https://www.instagram.com/accounts/login/" },
        });
      const owner =
        code === "DgDE7QIBEMP"
          ? "corporate.bro"
          : code === "DROPPED001"
            ? "dropped.acct"
            : "lukedonkin";
      return new Response(
        `<meta property="og:url" content="https://www.instagram.com/${owner}/reel/${code}/" />`,
        { headers: { "content-type": "text/html" } },
      );
    }
    const path = u.pathname.replace(/^\/v\d+\.\d+\//, "");
    if (path === "page1/conversations")
      return Response.json({
        data: [
          {
            id: "conv1",
            participants: {
              data: [{ id: JAMES, username: "jamesrstewart" }],
            },
          },
        ],
      });
    if (path === "conv1")
      return Response.json({ messages: { data: messages } });
    if (shares[path])
      return Response.json({
        shares: { data: shares[path].map((link) => ({ link })) },
      });
    if (path === "17890000") {
      if (discoveryDelay)
        await new Promise((r) => setTimeout(r, discoveryDelay));
      if (discoveryStatus !== 200)
        return Response.json(
          { error: { code: 4, message: "Application request limit reached" } },
          { status: discoveryStatus },
        );
      const f = u.searchParams.get("fields") ?? "";
      const user = f.match(/username\(([^)]+)\)/)?.[1] ?? "";
      return Response.json({
        business_discovery: {
          username: user,
          profile_picture_url: null,
          media: { data: pages[user] ?? [] },
        },
      });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  const reel = (code: string, id: string, extra: object = {}) => ({
    id,
    caption: "Good talk see ya next year",
    media_type: "VIDEO",
    media_product_type: "REELS",
    media_url: "https://scontent.cdninstagram.com/v.mp4",
    thumbnail_url: "https://scontent.cdninstagram.com/t.jpg",
    permalink: `https://www.instagram.com/reel/${code}/`,
    timestamp: ago(12).toISOString(),
    like_count: 49_000,
    ...extra,
  });
  const from = (id = JAMES) => ({ id, username: "jamesrstewart" });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.IG_ACCESS_TOKEN = "tok";
    process.env.IG_USER_ID = "17890000";
    process.env.FB_PAGE_ID = "page1";
    delete process.env.IG_APP_SECRET;
    const [{ db }, { sql }, s] = await Promise.all([
      import("@/db"),
      import("drizzle-orm"),
      import("./suggestions"),
    ]);
    mods = { db, sql, s };
  });

  afterAll(() => {
    delete process.env.IG_ACCESS_TOKEN;
    delete process.env.IG_USER_ID;
    delete process.env.FB_PAGE_ID;
  });

  beforeEach(async () => {
    calls.length = 0;
    discoveryStatus = 200;
    discoveryDelay = 0;
    await q(
      `truncate news_ig_suggestions, news_ig_dm_seen, x_author_stats restart identity`,
    );
    messages = [
      { id: "m1", created_time: ago(10).toISOString(), from: from() },
      { id: "m2", created_time: ago(9).toISOString(), from: from() },
      // Just words, no share: recorded as seen all the same.
      { id: "m4", created_time: ago(8).toISOString(), from: from() },
      // The right username with another id: never counts.
      { id: "m5", created_time: ago(8).toISOString(), from: from("999") },
      {
        id: "m3",
        created_time: ago(9).toISOString(),
        from: { id: "1", username: "park_roulette" },
      },
    ];
    shares = {
      m1: ["https://www.instagram.com/reel/DgDE7QIBEMP/"],
      m2: [
        "https://www.instagram.com/reel/DfT1HFTRyiv/",
        "https://example.com/not-a-post",
      ],
      m4: [],
      m5: ["https://www.instagram.com/reel/IMPOSTER01/"],
      m3: ["https://www.instagram.com/reel/NOTJAMES01/"],
    };
    pages = {
      "corporate.bro": [reel("DgDE7QIBEMP", "111")],
      // Credits another creator: fails a check, so it's skipped.
      lukedonkin: [reel("DfT1HFTRyiv", "222", { caption: "via @someone" })],
      "dropped.acct": [reel("DROPPED001", "333")],
    };
  });

  const run = (
    history: SentIssue[] = [],
    cooling = new Set<string>(),
    deadlineMs?: number,
  ) =>
    mods.s.suggestedCandidates({
      now: NOW,
      history,
      cooling,
      fetchImpl,
      deadlineMs,
    });

  it("turns James's shared posts into candidates that passed every check", async () => {
    const r = await run();
    expect(r.status).toBe("ok");
    expect(r.unparsed).toBe(1);
    expect(r.candidates.map((c) => [c.id, c.username, c.suggested_by])).toEqual(
      [["111", "corporate.bro", "jamesrstewart"]],
    );
    expect(r.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: "lukedonkin",
          status: "skipped",
          why: "credits another creator",
        }),
        expect.objectContaining({
          account: "corporate.bro",
          status: "candidate",
        }),
      ]),
    );
    // Only James's own messages, by id; nothing is written to Meta.
    const rows = await q(
      `select shortcode, sender_id from news_ig_suggestions order by shortcode`,
    );
    expect(rows).toEqual([
      { shortcode: "DfT1HFTRyiv", sender_id: JAMES },
      { shortcode: "DgDE7QIBEMP", sender_id: JAMES },
    ]);
    expect(calls.some((c) => c.endsWith("/m5"))).toBe(false);
    expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
    // Every handled message is recorded, a share or not.
    const seen = await q(
      `select message_id from news_ig_dm_seen order by message_id`,
    );
    expect(seen.map((x) => x.message_id)).toEqual(["m1", "m2", "m4"]);
  });

  it("doesn't read a handled message twice", async () => {
    await run();
    calls.length = 0;
    await run();
    expect(calls.some((c) => /\/m[124]$/.test(c))).toBe(false);
  });

  it("retires a suggestion after 2 failures", async () => {
    await run();
    await run();
    const [row] = await q(
      `select status, failures from news_ig_suggestions where shortcode = 'DfT1HFTRyiv'`,
    );
    expect(row).toEqual({ status: "retired", failures: 2 });
    calls.length = 0;
    const r = await run();
    expect(r.report.some((x) => x.account === "lukedonkin")).toBe(false);
  });

  it("reports a Meta rate limit as api_error, with no strike", async () => {
    discoveryStatus = 403;
    const r = await run();
    expect(r.status).toBe("api_error");
    expect(r.candidates).toEqual([]);
    expect(r.report.every((x) => x.why?.startsWith("Meta error"))).toBe(true);
    const rows = await q(`select failures, status from news_ig_suggestions`);
    expect(rows.every((x) => x.failures === 0 && x.status === "open")).toBe(
      true,
    );
  });

  it("returns on time with what it has", async () => {
    discoveryDelay = 400;
    const t = Date.now();
    const r = await run([], new Set(), 250);
    expect(Date.now() - t).toBeLessThan(380);
    expect(r.status).toBe("timeout");
  });

  it("never brings back an account dropped or flagged from the universe", async () => {
    await q(`insert into x_author_stats (author_id, username, dropped_reason)
      values ('9', 'Dropped.Acct', 'political')`);
    messages = [{ id: "m7", created_time: ago(5).toISOString(), from: from() }];
    shares = { m7: ["https://www.instagram.com/reel/DROPPED001/"] };
    const r = await run();
    expect(r.candidates).toEqual([]);
    expect(r.report[0]).toMatchObject({
      account: "dropped.acct",
      why: "dropped or flagged from the universe",
    });
  });

  it("keeps an account featured in the last 8 weeks out", async () => {
    const r = await run([], new Set(["corporate.bro"]));
    expect(r.candidates).toEqual([]);
  });

  it("follows no redirect on the post page", async () => {
    messages = [{ id: "m8", created_time: ago(5).toISOString(), from: from() }];
    shares = { m8: ["https://www.instagram.com/reel/REDIRECT01/"] };
    const r = await run();
    expect(r.report[0]).toMatchObject({
      account: null,
      why: "couldn't tell whose post it is",
    });
    expect(calls.some((c) => c.includes("/accounts/login"))).toBe(false);
  });

  it("marks a suggestion used once an issue ran it, and never offers it again", async () => {
    await run();
    const history = [
      {
        issueDate: "2026-11-26",
        body: {
          meme: {
            snapshot: {
              kind: "instagram",
              id: "111",
              permalink: "https://www.instagram.com/reel/DgDE7QIBEMP/",
            },
          },
        },
      },
    ] as unknown as SentIssue[];
    const r = await run(history);
    expect(r.candidates).toEqual([]);
    const [row] = await q(
      `select status, used_issue_date::text as d from news_ig_suggestions where shortcode = 'DgDE7QIBEMP'`,
    );
    expect(row).toEqual({ status: "used", d: "2026-11-26" });
  });

  it("expires suggestions older than 60 days", async () => {
    await q(`insert into news_ig_suggestions (message_id, sender, sender_id, permalink, shortcode, sent_at)
      values ('old', 'jamesrstewart', '${JAMES}', 'https://www.instagram.com/reel/OLDCODE01/', 'OLDCODE01', '${ago(61).toISOString()}')`);
    await run();
    const [row] = await q(
      `select status from news_ig_suggestions where message_id = 'old'`,
    );
    expect(row.status).toBe("expired");
  });

  it("does nothing without Meta keys", async () => {
    delete process.env.FB_PAGE_ID;
    try {
      const r = await run();
      expect(r).toEqual({
        candidates: [],
        report: [],
        status: "no_token",
        unparsed: 0,
      });
      expect(calls).toEqual([]);
    } finally {
      process.env.FB_PAGE_ID = "page1";
    }
  });
});
