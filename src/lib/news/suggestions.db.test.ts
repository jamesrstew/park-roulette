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
  let messages: { id: string; created_time: string; from: string }[];
  /** The media each account's Business Discovery returns. */
  let pages: Record<string, object[]>;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${u.hostname}${u.pathname}`);
    if (u.hostname === "www.instagram.com") {
      const code = u.pathname.split("/")[2];
      const owner = code === "DgDE7QIBEMP" ? "corporate.bro" : "lukedonkin";
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
            participants: { data: [{ username: "jamesrstewart" }] },
          },
        ],
      });
    if (path === "conv1")
      return Response.json({
        messages: {
          data: messages.map((m) => ({ ...m, from: { username: m.from } })),
        },
      });
    if (shares[path])
      return Response.json({
        shares: { data: shares[path].map((link) => ({ link })) },
      });
    if (path === "17890000") {
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
    await q(`truncate news_ig_suggestions restart identity`);
    messages = [
      {
        id: "m1",
        created_time: ago(10).toISOString(),
        from: "jamesrstewart",
      },
      { id: "m2", created_time: ago(9).toISOString(), from: "jamesrstewart" },
      { id: "m3", created_time: ago(9).toISOString(), from: "park_roulette" },
    ];
    shares = {
      m1: ["https://www.instagram.com/reel/DgDE7QIBEMP/"],
      m2: ["https://www.instagram.com/reel/DfT1HFTRyiv/"],
      m3: ["https://www.instagram.com/reel/NOTJAMES01/"],
    };
    pages = {
      "corporate.bro": [reel("DgDE7QIBEMP", "111")],
      // Credits another creator: fails a check, so it's skipped.
      lukedonkin: [reel("DfT1HFTRyiv", "222", { caption: "via @someone" })],
    };
  });

  const run = (history: SentIssue[] = [], cooling = new Set<string>()) =>
    mods.s.suggestedCandidates({ now: NOW, history, cooling, fetchImpl });

  it("turns James's shared posts into candidates that passed every check", async () => {
    const r = await run();
    expect(r.status).toBe("ok");
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
    // Our own message never becomes a suggestion, and nothing is written
    // to Meta.
    const rows = await q(`select shortcode from news_ig_suggestions`);
    expect(rows.map((x) => x.shortcode).sort()).toEqual([
      "DfT1HFTRyiv",
      "DgDE7QIBEMP",
    ]);
    expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
  });

  it("doesn't read a handled message twice", async () => {
    await run();
    calls.length = 0;
    await run();
    expect(calls.some((c) => c.endsWith("/m1"))).toBe(false);
  });

  it("keeps an account featured in the last 8 weeks out", async () => {
    const r = await run([], new Set(["corporate.bro"]));
    expect(r.candidates).toEqual([]);
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
    await q(`insert into news_ig_suggestions (message_id, sender, permalink, shortcode, sent_at)
      values ('old', 'jamesrstewart', 'https://www.instagram.com/reel/OLDCODE01/', 'OLDCODE01', '${ago(61).toISOString()}')`);
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
      expect(r).toEqual({ candidates: [], report: [], status: "no_token" });
      expect(calls).toEqual([]);
    } finally {
      process.env.FB_PAGE_ID = "page1";
    }
  });
});
