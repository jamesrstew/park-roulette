import { describe, expect, it } from "vitest";
import { suggestionShares } from "@/lib/social/graph";
import { IG_LIKES_FLOOR, type IgMedia, igShortcode } from "./igapi";
import type { Plan } from "./plan-types";
import {
  accountFromPostPage,
  igMaxAgeDays,
  SUGGESTERS,
  SUGGESTION_MAX_AGE_DAYS,
  suggestedCandidate,
  suggestionExpired,
  suggestionIneligible,
  withSuggestionsFirst,
} from "./suggest";

const NOW = new Date("2026-12-03T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const media = (extra: Partial<IgMedia> = {}): IgMedia => ({
  id: "17900000000000001",
  caption: "When the toddler packs the snacks",
  media_type: "VIDEO",
  media_product_type: "REELS",
  media_url: "https://scontent.cdninstagram.com/v.mp4",
  thumbnail_url: "https://scontent.cdninstagram.com/t.jpg",
  permalink: "https://www.instagram.com/reel/DgDE7QIBEMP/",
  timestamp: days(12).toISOString(),
  like_count: 49_000,
  ...extra,
});

const none = {
  blocked: new Set<string>(),
  excluded: new Set<string>(),
  cooling: new Set<string>(),
  takenDown: () => false,
};

describe("the suggestion allow-list", () => {
  it("is only James for now, and expires at 60 days", () => {
    // Pinned by James's page-scoped id; the username is display only.
    expect(SUGGESTERS.senders).toEqual([
      { id: "1441606531378643", username: "jamesrstewart" },
    ]);
    expect(SUGGESTION_MAX_AGE_DAYS).toBe(60);
    expect(suggestionExpired(days(59), NOW)).toBe(false);
    expect(suggestionExpired(days(61), NOW)).toBe(true);
  });
});

describe("a shared post's shortcode and account", () => {
  it("reads the shortcode from post, reel and tv links", () => {
    expect(igShortcode("https://www.instagram.com/reel/DaUF_fJyd3H/")).toBe(
      "DaUF_fJyd3H",
    );
    expect(igShortcode("https://instagram.com/p/Df9u3Y3lwJ1")).toBe(
      "Df9u3Y3lwJ1",
    );
    expect(
      igShortcode("https://www.instagram.com/corporate.bro/reel/DgDE7QIBEMP/"),
    ).toBe("DgDE7QIBEMP");
    expect(igShortcode("https://evil.example/reel/DgDE7QIBEMP/")).toBeNull();
    expect(igShortcode("https://www.instagram.com/corporate.bro/")).toBeNull();
  });
  it("takes the account from og:url only when it is the same post", () => {
    const page = (url: string) =>
      `<html><head><meta property="og:url" content="${url}" /></head></html>`;
    expect(
      accountFromPostPage(
        page("https://www.instagram.com/corporate.bro/reel/DgDE7QIBEMP/"),
        "DgDE7QIBEMP",
      ),
    ).toBe("corporate.bro");
    // Another post, another host, a login page: no account.
    expect(
      accountFromPostPage(
        page("https://www.instagram.com/someone/reel/OTHERCODE1/"),
        "DgDE7QIBEMP",
      ),
    ).toBeNull();
    expect(
      accountFromPostPage(
        page("https://evil.example/corporate.bro/reel/DgDE7QIBEMP/"),
        "DgDE7QIBEMP",
      ),
    ).toBeNull();
    expect(
      accountFromPostPage(
        page("https://www.instagram.com/accounts/login/"),
        "DgDE7QIBEMP",
      ),
    ).toBeNull();
    expect(accountFromPostPage("<html></html>", "DgDE7QIBEMP")).toBeNull();
  });
});

describe("a suggestion passes every check a found post passes", () => {
  it("passes a clean post up to 60 days old", () => {
    expect(suggestionIneligible(media(), "corporate.bro", NOW, none)).toBe(
      null,
    );
    expect(
      suggestionIneligible(
        media({ timestamp: days(61).toISOString() }),
        "corporate.bro",
        NOW,
        none,
      ),
    ).toBe("too old");
  });
  it("still applies the likes, credit, safety and image rules", () => {
    const why = (m: Partial<IgMedia>) =>
      suggestionIneligible(media(m), "corporate.bro", NOW, none);
    expect(why({ like_count: undefined })).toBe("likes hidden");
    expect(why({ like_count: IG_LIKES_FLOOR - 1 })).toBe(
      "under the likes floor",
    );
    expect(why({ caption: "via @someoneelse" })).toBe(
      "credits another creator",
    );
    expect(why({ caption: "Repost, credit to the owner" })).toBe(
      "credits another creator",
    );
    expect(why({ caption: "Vote for the school board" })).toBe("politics");
    expect(why({ caption: "what the f*ck" })).toBe("profanity");
    expect(why({ media_url: undefined })).toBe("reel without media");
    expect(why({ thumbnail_url: undefined })).toBe("no image");
  });
  it("keeps blocked, taken-down and cooling accounts out", () => {
    const m = media();
    expect(
      suggestionIneligible(m, "Corporate.Bro", NOW, {
        ...none,
        blocked: new Set(["corporate.bro"]),
      }),
    ).toBe("blocked account");
    expect(
      suggestionIneligible(m, "corporate.bro", NOW, {
        ...none,
        takenDown: (id) => id === m.id,
      }),
    ).toBe("taken down");
    expect(
      suggestionIneligible(m, "corporate.bro", NOW, {
        ...none,
        cooling: new Set(["corporate.bro"]),
      }),
    ).toBe("account featured in the last 8 weeks");
  });
  it("keeps the competitor bans", () => {
    expect(
      suggestionIneligible(
        media({ caption: "As seen in Bend Family Loop" }),
        "corporate.bro",
        NOW,
        none,
      ),
    ).toBe("names another newsletter");
    expect(
      suggestionIneligible(
        media({ caption: "More at https://example.substack.com/p/x" }),
        "corporate.bro",
        NOW,
        none,
      ),
    ).toBe("links another newsletter");
    expect(
      suggestionIneligible(media(), "thebendbuzz", NOW, none),
    ).not.toBeNull();
  });
});

describe("the universe gate", () => {
  it("lets in an account outside the universe, never a dropped or flagged one", () => {
    expect(suggestionIneligible(media(), "someone.new", NOW, none)).toBeNull();
    expect(
      suggestionIneligible(media(), "Dropped.Acct", NOW, {
        ...none,
        excluded: new Set(["dropped.acct"]),
      }),
    ).toBe("dropped or flagged from the universe");
  });
  it("gives a meme page's suggestion no discount", () => {
    const c = suggestedCandidate(media(), "parentnormal", null, 10_000, {
      sender: "jamesrstewart",
      sentAt: NOW,
    });
    expect(c.score).toBe(4.9);
  });
});

describe("suggested candidates lead the list", () => {
  const cand = (id: string, at: string) =>
    suggestedCandidate(
      media({ id, permalink: `https://www.instagram.com/reel/C${id}/` }),
      "corporate.bro",
      null,
      10_000,
      { sender: "jamesrstewart", sentAt: new Date(at) },
    );
  it("marks who suggested it and scores it like a found post", () => {
    const c = cand("1", "2026-11-23T21:19:00Z");
    expect(c.suggested_by).toBe("jamesrstewart");
    expect(c.suggested_at).toBe("2026-11-23T21:19:00.000Z");
    expect(c.score).toBe(4.9);
    expect(c.imageUrl).toBe("https://scontent.cdninstagram.com/t.jpg");
  });
  it("puts suggestions first, newest first, without repeats", () => {
    const a = cand("1", "2026-11-20T00:00:00Z");
    const b = cand("2", "2026-11-23T00:00:00Z");
    const found = [
      { ...a, suggested_by: undefined, score: 9 },
      { ...cand("3", "2026-11-01T00:00:00Z"), suggested_by: undefined },
    ];
    const out = withSuggestionsFirst([a, b], found);
    expect(out.map((c) => c.id)).toEqual(["2", "1", "3"]);
  });
});

describe("reading James's shared posts from the DMs", () => {
  const graphFetch = (calls: string[]) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      calls.push(u.pathname + u.search);
      // The token is a header, never the URL.
      expect(u.search).not.toContain("tok");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer tok",
      );
      const path = u.pathname.replace(/^\/v\d+\.\d+\//, "");
      if (path === "page1/conversations")
        return Response.json({
          data: [
            {
              id: "c-james",
              participants: {
                data: [
                  { id: "1", username: "park_roulette" },
                  { id: "1441606531378643", username: "jamesrstewart" },
                ],
              },
            },
            {
              // A renamed account took James's old username: different id.
              id: "c-imposter",
              participants: {
                data: [
                  { id: "1", username: "park_roulette" },
                  { id: "999999999", username: "jamesrstewart" },
                ],
              },
            },
            {
              id: "c-other",
              participants: {
                data: [
                  { id: "1", username: "park_roulette" },
                  { id: "3", username: "stranger" },
                ],
              },
            },
          ],
        });
      if (path === "c-imposter")
        return Response.json({
          messages: {
            data: [
              {
                id: "m9",
                created_time: "2026-11-23T21:19:17+0000",
                from: { id: "999999999", username: "jamesrstewart" },
              },
            ],
          },
        });
      if (path === "c-james")
        return Response.json({
          messages: {
            data: [
              {
                id: "m1",
                created_time: "2026-11-23T21:19:17+0000",
                from: { id: "1441606531378643", username: "jamesrstewart" },
              },
              {
                // The right username with the wrong id never counts.
                id: "m5",
                created_time: "2026-11-23T21:20:00+0000",
                from: { id: "999999999", username: "jamesrstewart" },
              },
              {
                id: "m2",
                created_time: "2026-11-23T14:21:41+0000",
                from: { id: "1", username: "park_roulette" },
              },
              {
                id: "m3",
                created_time: "2026-08-01T00:00:00+0000",
                from: { id: "1441606531378643", username: "jamesrstewart" },
              },
              {
                id: "m4",
                created_time: "2026-11-24T00:00:00+0000",
                from: { id: "1441606531378643", username: "jamesrstewart" },
              },
            ],
          },
        });
      if (path === "m1")
        return Response.json({
          shares: {
            data: [{ link: "https://www.instagram.com/reel/DaUF_fJyd3H/" }],
          },
        });
      return new Response("nope", { status: 404 });
    }) as typeof fetch;

  it("reads only the allow-listed sender's own new messages", async () => {
    const calls: string[] = [];
    const out = await suggestionShares(
      "page1",
      new Map([["1441606531378643", "jamesrstewart"]]),
      new Date("2026-10-01T00:00:00Z"),
      new Set(["m4"]),
      { token: "tok", igUserId: "1789", fetchImpl: graphFetch(calls) },
    );
    expect(out).toEqual([
      {
        messageId: "m1",
        senderId: "1441606531378643",
        sender: "jamesrstewart",
        sentAt: "2026-11-23T21:19:17.000Z",
        links: ["https://www.instagram.com/reel/DaUF_fJyd3H/"],
      },
    ]);
    // Our own reply, the old message and the seen one are never fetched,
    // and the stranger's conversation is never opened.
    expect(calls.some((c) => c.includes("c-other"))).toBe(false);
    expect(calls.some((c) => c.includes("c-imposter"))).toBe(false);
    expect(calls.some((c) => /\/m[2345]\?/.test(c))).toBe(false);
    // Read only: every call is a GET.
  });
});

describe("how old the draft lets an Instagram pick be", () => {
  const plan = (c: object) =>
    ({ parents_corner: { instagram: [c] } }) as unknown as Plan;
  const meme = {
    platform: "instagram" as const,
    url: "https://www.instagram.com/reel/DgDE7QIBEMP/",
    postId: "111",
    account: "corporate.bro",
  };
  const sug = {
    id: "111",
    username: "corporate.bro",
    suggested_by: "jamesrstewart",
    suggested_at: days(10).toISOString(),
  };
  it("allows 60 days only for a live suggestion the stored plan offered", () => {
    expect(igMaxAgeDays(plan(sug), meme, NOW)).toBe(60);
    expect(
      igMaxAgeDays(plan({ ...sug, suggested_by: undefined }), meme, NOW),
    ).toBe(7);
    expect(igMaxAgeDays(plan({ ...sug, username: "other" }), meme, NOW)).toBe(
      7,
    );
    expect(
      igMaxAgeDays(
        plan({ ...sug, suggested_at: days(61).toISOString() }),
        meme,
        NOW,
      ),
    ).toBe(7);
    expect(igMaxAgeDays(null, meme, NOW)).toBe(7);
  });
});
