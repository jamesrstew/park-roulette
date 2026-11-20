import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CardPost,
  type FontDef,
  postAlt,
  postCardSize,
  xDisplayText,
} from "@/components/news/PostCard";
import { tiktokAlt, tiktokSize } from "@/components/news/TikTokTile";
import { tiktokId } from "./parents";
import type { SentIssue } from "./cooldowns";
import { accountOut, coolingAuthors, SEED } from "./universe";
import {
  CANDIDATES_MAX,
  engagement,
  fetchUniverse,
  LIKES_FLOOR,
  lookupPost,
  postUrl,
  QUERY_MAX,
  rankCandidates,
  takeoverReason,
  MAX_CALLS,
  planBatches,
  type XPost,
} from "./xapi";

/** A mocked X API: answers every request with a body, records requests. */
function mockX(body: unknown, status = 200) {
  const calls: { url: string; auth: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return Response.json(body, { status });
  }) as typeof fetch;
  return { f, calls };
}

const users = [
  {
    id: "u1",
    name: "Some Parent",
    username: "someparent",
    profile_image_url: "https://pbs.twimg.com/profile_images/1/a_normal.jpg",
    verified: true,
    verified_type: "blue",
    public_metrics: { followers_count: 20_000 },
  },
  { id: "u2", name: "Other", username: "other" },
];
const tweet = (id: string, likes: number, extra: object = {}) => ({
  id,
  text: `Post ${id} &amp; more`,
  created_at: "2026-11-18T18:42:00.000Z",
  author_id: "u1",
  lang: "en",
  public_metrics: {
    like_count: likes,
    reply_count: 3,
    retweet_count: 10,
    quote_count: 2,
  },
  edit_history_tweet_ids: [id],
  ...extra,
});

const NOW = new Date("2026-11-19T12:00:00Z");

function post(id: string, over: Partial<XPost> = {}): XPost {
  return {
    kind: "x",
    id,
    authorId: "u1",
    text: "Bedtime went to a third round.",
    links: [],
    name: "Some Parent",
    username: "someparent",
    avatar: null,
    verified: false,
    verifiedType: null,
    createdAt: "2026-11-18T18:42:00Z",
    likes: 5_000,
    replies: 0,
    reposts: 0,
    quotes: 0,
    media: [],
    possiblySensitive: false,
    standalone: true,
    ...over,
  };
}

describe("the X universe (Parents' corner v4)", () => {
  it("seeds from data/x-universe.json by permanent id: the 68-account revamp", () => {
    expect(SEED).toHaveLength(67);
    // @Gabbrielxzn posts politics now (writer run 1).
    expect(SEED.some((a) => a.username.toLowerCase() === "gabbrielxzn")).toBe(
      false,
    );
    expect(SEED.every((a) => /^\d+$/.test(a.id))).toBe(true);
    expect(SEED[0].appearances).toBeGreaterThanOrEqual(SEED[1].appearances);
    expect(SEED.every((a) => a.kind && a.postsPerWeek >= 0)).toBe(true);
    expect(SEED.some((a) => a.medianLikes > 0)).toBe(true);
  });

  it("plans the week in 6 to 8 calls, each query 512 characters or less", () => {
    const plan = planBatches(SEED);
    expect(plan.calls).toBeGreaterThanOrEqual(6);
    expect(plan.calls).toBeLessThanOrEqual(MAX_CALLS);
    expect(plan.batches.reduce((n, b) => n + b.pages, 0)).toBe(plan.calls);
    for (const b of plan.batches) {
      expect(b.query.length).toBeLessThanOrEqual(QUERY_MAX);
      expect(b.query).toMatch(
        /^\(from:\w+( OR from:\w+)*\) -is:retweet -is:reply lang:en$/,
      );
      // A batch's week of posts fits in its pages.
      const ppw = b.handles.reduce(
        (n, h) => n + (SEED.find((a) => a.username === h)?.postsPerWeek ?? 0),
        0,
      );
      expect(ppw).toBeLessThanOrEqual(b.pages * 100 + 0.001);
    }
    // Every account is searched or reported, never lost.
    const searched = plan.batches.flatMap((b) => b.handles);
    expect(searched.length + plan.skipped.length).toBe(SEED.length);
    // The best performers always make it in.
    const best = [...SEED].sort((a, b) => b.medianLikes - a.medianLikes)[0];
    expect(searched).toContain(best.username);
    // A tighter budget is respected too.
    expect(planBatches(SEED, { maxCalls: 3 }).calls).toBeLessThanOrEqual(3);
  });

  it("searches the last 7 days with the app-only bearer, pages within the plan, and nothing without a token", async () => {
    const batch = {
      query: "(from:someparent OR from:other) -is:retweet -is:reply lang:en",
      handles: ["someparent", "other"],
      pages: 2,
    };
    const first = mockX({
      data: [tweet("1", 9_000), tweet("2", 100, { lang: "es" })],
      includes: { users },
      meta: { next_token: "abc" },
    });
    expect(await fetchUniverse(undefined, [batch], NOW, first.f)).toEqual({
      posts: [],
      users: [],
      calls: 0,
    });
    const got = await fetchUniverse("token", [batch], NOW, first.f);
    const { calls } = first;
    expect(calls).toHaveLength(2);
    expect(got.calls).toBe(2);
    expect(new URL(calls[1].url).searchParams.get("next_token")).toBe("abc");
    expect(calls[0].auth).toBe("Bearer token");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/2/tweets/search/recent");
    expect(u.searchParams.get("query")).toBe(batch.query);
    expect(u.searchParams.get("start_time")! > "2026-11-12T12:00").toBe(true);
    expect(got.posts.map((p) => p.id)).toEqual(["1", "1"]);
    expect(got.posts[0]).toMatchObject({ replies: 3, reposts: 10, quotes: 2 });
  });

  it("scores by how far a post beats its author's trailing median", () => {
    expect(engagement({ likes: 1000, reposts: 100, quotes: 10 })).toBe(1210);
    const history = new Map([
      ["u1", [1000, 1200, 1100]],
      ["u2", [40_000, 50_000, 60_000]],
    ]);
    const got = rankCandidates(
      [
        post("big-but-usual", { authorId: "u2", likes: 50_000 }),
        post("small-but-wild", { likes: 9_000 }),
        post("under-floor", { likes: LIKES_FLOOR - 1 }),
      ],
      { now: NOW, history, excluded: new Set() },
    );
    expect(got.map((p) => p.id)).toEqual(["small-but-wild", "big-but-usual"]);
    expect(got[0].score).toBeCloseTo(9000 / 1100, 2);
    expect(got[0].baseline).toBe(1100);
  });

  it("scores a seed account on likes against its seed median until 3 samples (M11)", () => {
    const [p] = rankCandidates([post("a", { likes: 4000, reposts: 500 })], {
      now: NOW,
      history: new Map([["u1", [100, 200]]]),
      excluded: new Set(),
      seedMedian: new Map([["u1", 400]]),
    });
    expect(p.score).toBe(10);
    const [q] = rankCandidates([post("b", { likes: 4000, reposts: 500 })], {
      now: NOW,
      history: new Map([["u1", [1000, 1000, 1000]]]),
      excluded: new Set(),
      seedMedian: new Map([["u1", 400]]),
    });
    expect(q.score).toBe(5);
  });

  it("keeps politics and profanity out and offers at most 2 posts from one account", () => {
    const got = rankCandidates(
      [
        post("p1", { likes: 9000 }),
        post("p2", { likes: 8000 }),
        post("p3", { likes: 7000 }),
        post("pol", {
          likes: 50_000,
          text: "The election is wild, but bedtime is wilder.",
        }),
        post("swear", {
          authorId: "u3",
          username: "third",
          likes: 40_000,
          text: "Bedtime is a sh*tshow and I'm tired af",
        }),
        post("vote", {
          authorId: "u4",
          username: "fourth",
          likes: 40_000,
          text: "Go vote, then go to the playground",
        }),
        post("o1", { authorId: "u2", username: "other", likes: 3000 }),
      ],
      { now: NOW, history: new Map(), excluded: new Set() },
    );
    expect(got.map((p) => p.id).sort()).toEqual(["o1", "p1", "p2"]);
  });

  it("only offers standalone, fresh, unflagged posts off cooldown, top 10", () => {
    const history = new Map<string, number[]>();
    const many = Array.from({ length: 15 }, (_, i) =>
      post(`p${i}`, { likes: 2_000 + i, authorId: `a${i}` }),
    );
    expect(
      rankCandidates(many, { now: NOW, history, excluded: new Set() }),
    ).toHaveLength(CANDIDATES_MAX);
    const out = rankCandidates(
      [
        post("reply", { standalone: false }),
        post("old", { createdAt: "2026-11-10T00:00:00Z" }),
        post("sensitive", { possiblySensitive: true }),
        post("cooling", { authorId: "u9" }),
        post("by-handle", { authorId: "u8", username: "Cooled" }),
        post("ok"),
      ],
      { now: NOW, history, excluded: new Set(["u9", "@cooled"]) },
    );
    expect(out.map((p) => p.id)).toEqual(["ok"]);
  });

  it("flags takeovers: a reused handle, a renamed id, a follower crash", () => {
    const known = {
      id: "111",
      username: "dadmann_walking",
      followersPeak: 30_000,
    };
    expect(
      takeoverReason(known, {
        id: "999",
        username: "dadmann_walking",
        followers: 4,
      }),
    ).toMatch(/different account/);
    expect(
      takeoverReason(known, {
        id: "111",
        username: "newname",
        followers: 30_000,
      }),
    ).toMatch(/now posting as @newname/);
    expect(
      takeoverReason(known, {
        id: "111",
        username: "dadmann_walking",
        followers: 4,
      }),
    ).toMatch(/Followers fell/);
    expect(
      takeoverReason(known, {
        id: "111",
        username: "Dadmann_Walking",
        followers: 29_000,
      }),
    ).toBeNull();
  });

  it("drops accounts that are flagged, dropped or quiet for 3 months, and cools authors 8 weeks", () => {
    const base = {
      flaggedReason: null,
      droppedReason: null,
      lastFloorAt: new Date("2026-11-01"),
      createdAt: new Date("2026-01-01"),
    };
    expect(accountOut(base, NOW)).toBeNull();
    expect(accountOut({ ...base, droppedReason: "political" }, NOW)).toMatch(
      /dropped/,
    );
    expect(accountOut({ ...base, flaggedReason: "x" }, NOW)).toMatch(/flagged/);
    expect(
      accountOut({ ...base, lastFloorAt: new Date("2026-08-01") }, NOW),
    ).toMatch(/inactive/);
    const sent = (issueDate: string, authorId: string) =>
      ({
        issueDate,
        body: { meme: { snapshot: { kind: "x", authorId, username: "a" } } },
      }) as unknown as SentIssue;
    const cool = coolingAuthors(
      [sent("2026-10-01", "recent"), sent("2026-09-17", "long-ago")],
      "2026-11-19",
    );
    expect(cool.has("recent")).toBe(true);
    expect(cool.has("long-ago")).toBe(false);
  });
});

describe("X post lookup", () => {
  it("fetches a post with display text, counts and media", async () => {
    const { f, calls } = mockX({
      data: tweet("42", 12_345, {
        text: "Long day &lt;3 see https://t.co/link1 https://t.co/abc123",
        entities: {
          urls: [
            {
              url: "https://t.co/link1",
              display_url: "parkroulette.quest/bend",
              expanded_url: "https://parkroulette.quest/bend",
            },
            { url: "https://t.co/abc123", media_key: "m1" },
          ],
        },
        attachments: { media_keys: ["m1"] },
      }),
      includes: {
        users,
        media: [
          {
            media_key: "m1",
            type: "video",
            preview_image_url: "https://pbs.twimg.com/ext/1.jpg",
            width: 1280,
            height: 720,
          },
        ],
      },
    });
    const p = await lookupPost("42", "token", f);
    expect(new URL(calls[0].url).pathname).toBe("/2/tweets/42");
    expect(p).toMatchObject({
      kind: "x",
      id: "42",
      authorId: "u1",
      text: "Long day <3 see parkroulette.quest/bend",
      links: ["parkroulette.quest/bend"],
      avatar: "https://pbs.twimg.com/profile_images/1/a_400x400.jpg",
      verifiedType: "blue",
      likes: 12_345,
      replies: 3,
      reposts: 10,
      standalone: true,
    });
    expect(p?.media[0]).toMatchObject({ type: "video" });
    expect(postUrl(p!)).toBe("https://x.com/someparent/status/42");
  });

  it("isn't standalone when it's a reply, quote, edit, long post or over 280 characters", async () => {
    const one = async (extra: object) =>
      (
        await lookupPost(
          "7",
          "token",
          mockX({ data: tweet("7", 9_000, extra), includes: { users } }).f,
        )
      )?.standalone;
    expect(await one({})).toBe(true);
    expect(await one({ in_reply_to_user_id: "u2" })).toBe(false);
    expect(
      await one({ referenced_tweets: [{ type: "quoted", id: "1" }] }),
    ).toBe(false);
    expect(await one({ edit_history_tweet_ids: ["6", "7"] })).toBe(false);
    expect(await one({ note_tweet: { text: "A long story." } })).toBe(false);
    expect(await one({ text: "a".repeat(281) })).toBe(false);
    expect(await one({ text: "😀".repeat(280) })).toBe(true);
  });

  it("is null for a deleted post, a bad id or no token", async () => {
    expect(
      await lookupPost("9", "token", mockX({ errors: [{}] }).f),
    ).toBeNull();
    expect(await lookupPost("9", "token", mockX({}, 404).f)).toBeNull();
    expect(await lookupPost("../x", "token", mockX({}).f)).toBeNull();
    expect(await lookupPost("9", undefined, mockX({}).f)).toBeNull();
  });
});

describe("xDisplayText", () => {
  it("swaps t.co for display URLs, hides media and quoted-post links, decodes entities", () => {
    expect(
      xDisplayText("A &amp; B https://t.co/a https://t.co/m https://t.co/q", {
        urls: [
          { url: "https://t.co/a", display_url: "example.com/x" },
          { url: "https://t.co/m", media_key: "3_1" },
          {
            url: "https://t.co/q",
            expanded_url: "https://x.com/s/status/55",
            display_url: "x.com/s/status/55",
          },
        ],
        quotedPostId: "55",
      }),
    ).toEqual({ text: "A & B example.com/x", links: ["example.com/x"] });
  });
});

describe("the post card", () => {
  const read = (f: string) =>
    readFileSync(join(process.cwd(), "public/fonts", f));
  const fonts: FontDef[] = [
    {
      name: "Inter",
      data: read("Inter-Regular.ttf"),
      weight: 400,
      style: "normal",
    },
    {
      name: "Inter",
      data: read("Inter-Bold.ttf"),
      weight: 700,
      style: "normal",
    },
  ];
  const card: CardPost = {
    name: "Some Parent",
    handle: "someparent",
    text: "Bedtime went to a third round.",
    createdAt: "2026-11-18T18:42:00Z",
    likes: 52_300,
    replies: 10,
    reposts: 200,
  };
  it("ships its fonts and licenses", () => {
    for (const f of ["Inter-OFL.txt", "GochiHand-OFL.txt"])
      expect(read(f).toString()).toContain("SIL Open Font License");
  });
  it("grows with the text and the media, and draws a 280-character post in full", () => {
    const short = postCardSize(card, fonts);
    const long = postCardSize(
      { ...card, text: "word ".repeat(56).trim() },
      fonts,
    );
    const photo = postCardSize(
      {
        ...card,
        media: [{ src: "data:", width: 1000, height: 1000, kind: "photo" }],
      },
      fonts,
    );
    expect(short.width).toBe(1200);
    expect(long.height).toBeGreaterThan(short.height);
    expect(photo.height).toBeGreaterThan(short.height + 900);
    expect(
      postAlt({ ...card, text: "word ".repeat(56).trim() }, fonts),
    ).not.toContain("…");
  });
  it("has the whole post in words in the alt text", () => {
    expect(postAlt(card, fonts)).toBe(
      "Post by Some Parent (@someparent) on X: Bedtime went to a third round.",
    );
    expect(
      postAlt(
        { ...card, media: [{ src: "d", width: 1, height: 1, kind: "video" }] },
        fonts,
      ),
    ).toMatch(/^Post by Some Parent \(@someparent\) on X, with a video:/);
  });
  it("draws TikTok covers at 4:5, with the handle in the alt", () => {
    expect(tiktokSize("4:5").width).toBe(1200);
    expect(tiktokAlt("dadjokes", "Bedtime, round three")).toBe(
      "TikTok video by @dadjokes: Bedtime, round three",
    );
    expect(tiktokAlt("dadjokes")).toBe("TikTok video by @dadjokes.");
  });
  it("reads TikTok video ids only from tiktok.com links", () => {
    expect(
      tiktokId("https://www.tiktok.com/@dadjokes/video/7312345678901234567"),
    ).toBe("7312345678901234567");
    expect(
      tiktokId("https://www.tiktok.com.evil.com/@a/video/7312345678901234567"),
    ).toBeNull();
    expect(tiktokId("https://www.tiktok.com/@dadjokes")).toBeNull();
  });
});
