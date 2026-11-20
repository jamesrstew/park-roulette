import { describe, expect, it } from "vitest";
import { igAlt, igCardSize, igImageUrl } from "@/components/news/InstagramCard";
import {
  creditsAnother,
  discoverPage,
  IG_UNIVERSE,
  igCandidates,
  igIneligible,
  type IgMedia,
  igLookup,
  isIgPermalink,
  scorePage,
} from "./igapi";
import { imageSize } from "./image-size";
import { snapshotTakenDown } from "./takedowns";
import { sniffImageType } from "./parents";

const NOW = new Date("2026-11-19T12:00:00Z");
const media = (id: string, over: Partial<IgMedia> = {}): IgMedia => ({
  id,
  caption: "Bedtime, round three.",
  media_type: "IMAGE",
  media_product_type: "FEED",
  media_url: `https://scontent.cdninstagram.com/${id}.jpg`,
  permalink: `https://www.instagram.com/p/${id}/`,
  timestamp: "2026-11-17T18:00:00+0000",
  like_count: 2000,
  ...over,
});

/** A mocked Graph API: answers Business Discovery per username. */
function mockMeta(pages: Record<string, IgMedia[] | null>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const fields = url.searchParams.get("fields") ?? "";
    const name = fields.match(/username\(([^)]+)\)/)?.[1] ?? "";
    const data = pages[name];
    if (data === null)
      return Response.json(
        { error: { message: "not professional" } },
        { status: 400 },
      );
    return Response.json({
      business_discovery: {
        username: name,
        profile_picture_url: "https://scontent.cdninstagram.com/a.jpg",
        media: { data: data ?? [] },
      },
    });
  }) as typeof fetch;
  return { f, calls };
}

describe("the Instagram universe", () => {
  it("holds the 20 checked accounts (November 19), each with its numbers", () => {
    expect(IG_UNIVERSE).toHaveLength(20);
    for (const a of IG_UNIVERSE) {
      expect(a.postsLast14d, a.username).toBeGreaterThanOrEqual(3);
      expect(a.medianLikes, a.username).toBeGreaterThanOrEqual(200);
      expect(a.creditShare, a.username).toBeDefined();
    }
    expect(IG_UNIVERSE.filter((a) => a.kind === "meme_page")).toHaveLength(5);
    expect(IG_UNIVERSE.find((a) => a.username === "oneawkwardmom")?.kind).toBe(
      "meme_page",
    );
  });
});

describe("Business Discovery (mocked)", () => {
  it("does nothing without IG_ACCESS_TOKEN and IG_USER_ID", async () => {
    const { f, calls } = mockMeta({});
    expect(await discoverPage("x", { fetchImpl: f })).toBeNull();
    expect(await igCandidates({ now: NOW, fetchImpl: f })).toEqual([]);
    expect(calls).toEqual([]);
  });
  it("asks for a page's recent media through our own account", async () => {
    const { f, calls } = mockMeta({ thedumbdads: [media("1")] });
    const page = await discoverPage("thedumbdads", {
      token: "tok",
      igUserId: "17841400000000000",
      fetchImpl: f,
    });
    expect(page?.media?.data).toHaveLength(1);
    const u = new URL(calls[0]);
    expect(u.pathname).toBe("/v21.0/17841400000000000");
    expect(u.searchParams.get("fields")).toContain(
      "business_discovery.username(thedumbdads)",
    );
    expect(u.searchParams.get("fields")).toContain("children{id,media_type}");
  });
  it("scores against the page's median likes, best first, and skips blocked and cooling pages", async () => {
    const usual = Array.from({ length: 5 }, (_, i) =>
      media(`u${i}`, {
        like_count: 1000,
        timestamp: "2026-11-01T00:00:00+0000",
      }),
    );
    const { f, calls } = mockMeta({
      dudedad: [media("big", { like_count: 9000 }), ...usual],
      thedumbdads: [media("small", { like_count: 3000 }), ...usual],
      scarymommy: null,
    });
    const got = await igCandidates({
      now: NOW,
      token: "t",
      igUserId: "17841400000000000",
      blocked: new Set(["fitdadceo"]),
      cooling: new Set(["parentnormal"]),
      fetchImpl: f,
    });
    expect(got.map((c) => c.id)).toEqual(["big", "small"]);
    expect(got[0].score).toBe(9);
    expect(calls.some((c) => c.includes("fitdadceo"))).toBe(false);
    expect(calls.some((c) => c.includes("parentnormal"))).toBe(false);
  });
  it("finds one post again by id, or null when it's gone", async () => {
    const { f } = mockMeta({ thedumbdads: [media("7")] });
    const opts = { token: "t", igUserId: "17841400000000000", fetchImpl: f };
    expect((await igLookup("thedumbdads", "7", opts))?.media.id).toBe("7");
    expect(await igLookup("thedumbdads", "8", opts)).toBeNull();
  });
});

describe("original content only", () => {
  it("skips posts that credit another creator", () => {
    for (const c of [
      "via @someoneelse",
      "Credit: @funnymom",
      "🎥: @dad.jokes",
      "📸 @kidpics",
      "Repost from @x",
      "Follow @otherpage for more",
      "@otherpage",
    ])
      expect(creditsAnother(c, "thedumbdads"), c).toBe(true);
    // Any other account named counts, and so do disclaimers (review M4).
    for (const c of [
      "Me and @mywife at bedtime",
      "DM for credit",
      "Credit to owner",
      "All rights belong to the creator",
      "© someone",
      "Tag the creator!",
    ])
      expect(creditsAnother(c, "thedumbdads"), c).toBe(true);
    for (const c of [
      "Bedtime, round three.",
      "Follow @thedumbdads for more",
      "Tag a dad who gets it",
      undefined,
    ])
      expect(creditsAnother(c, "thedumbdads"), String(c)).toBe(false);
  });
  it("catches credits Instagram stripped of their @ (captions from the Nov 19 check)", () => {
    // Real captions from /tmp/pr-news/ig-raw (Business Discovery, Nov 19).
    for (const [c, owner] of [
      [
        "A blessing and a curse. 😂  Credit scarymommy  . . . #parenting",
        "parentnormal",
      ],
      ["I WANT TO GO TO BED!!!!!   (via kimberlydinaro)", "scarymommy"],
      ["and I hit the ground runnin' [indoor_mom]", "thedad"],
      [
        "He couldn’t hear the tv.   —> oneawkwardmom   mike_bahati22  asuiterc",
        "oneawkwardmom",
      ],
      ["Neigh 🐴   —> oneawkwardmom", "oneawkwardmom"],
      ["moulded by it. Inspo: thattwinmama_", "fitdadceo"],
      ["#challenge #marriedlife   IC: kimberlykarjadi.dance", "lindseygurk"],
      ["Oh ShmooOoP! Ic: devynlundy #couple", "lindseygurk"],
      ["Repost from checkyourkidsatthedoor • The Witch", "someone"],
    ] as const)
      expect(creditsAnother(c, owner), c).toBe(true);
    // Words, not handles; a plain "->" sequence; and an audio credit
    // (the sound is borrowed, the video is the page's own).
    for (const c of [
      "Halloween inspo for the kids",
      "sees [my kids] for who they are, [but] be kind",
      "Bedtime -> bath -> books",
      "Motherhood.  Audio cred TT@ soundeffectsforyou",
    ])
      expect(creditsAnother(c, "fitdadceo"), c).toBe(false);
  });
  it("drops captions with politics or profanity, X and Instagram alike", () => {
    expect(
      igIneligible(
        media("1", { caption: "Go vote today, parents!" }),
        "p",
        NOW,
      ),
    ).toBe("politics");
    expect(
      igIneligible(
        media("1", { caption: "Tired af and out of coffee" }),
        "p",
        NOW,
      ),
    ).toBe("profanity");
    expect(
      igIneligible(
        media("1", { caption: "What the f*ck is this toy" }),
        "p",
        NOW,
      ),
    ).toBe("profanity");
    expect(
      igIneligible(
        media("1", { caption: "Well, crap. Snack time." }),
        "p",
        NOW,
      ),
    ).toBeNull();
  });
  it("ranks a meme page's original post at half (Instagram strips the @)", () => {
    const page = {
      username: "oneawkwardmom",
      media: {
        data: [
          media("own", { like_count: 4000 }),
          ...Array.from({ length: 4 }, (_, i) =>
            media(`u${i}`, {
              like_count: 1000,
              timestamp: "2026-11-01T00:00:00+0000",
            }),
          ),
        ],
      },
    };
    expect(scorePage(page, NOW, "person")[0].score).toBe(4);
    expect(scorePage(page, NOW, "meme_page")[0].score).toBe(2);
  });
  it("needs likes showing, a week's freshness, an image, and a reel's media", () => {
    expect(igIneligible(media("1"), "p", NOW)).toBeNull();
    expect(igIneligible(media("1", { like_count: undefined }), "p", NOW)).toBe(
      "likes hidden",
    );
    expect(
      igIneligible(
        media("1", { timestamp: "2026-11-01T00:00:00+0000" }),
        "p",
        NOW,
      ),
    ).toBe("not this week");
    expect(
      igIneligible(
        media("1", {
          media_type: "VIDEO",
          media_product_type: "REELS",
          media_url: undefined,
          thumbnail_url: "https://x.cdninstagram.com/t.jpg",
        }),
        "p",
        NOW,
      ),
    ).toBe("reel without media");
    expect(igIneligible(media("1", { caption: "via @other" }), "p", NOW)).toBe(
      "credits another creator",
    );
    expect(
      igImageUrl({
        media_type: "VIDEO",
        media_url: "v.mp4",
        thumbnail_url: "t.jpg",
      }),
    ).toBe("t.jpg");
  });
  it("counts carousel items and keeps the page's median", () => {
    const [c] = scorePage(
      {
        username: "p",
        media: {
          data: [
            media("c", {
              media_type: "CAROUSEL_ALBUM",
              children: { data: [{ id: "a" }, { id: "b" }] },
            }),
          ],
        },
      },
      NOW,
    );
    expect(c.carouselCount).toBe(2);
    expect(c.baseline).toBe(2000);
  });
  it("only takes real permalinks", () => {
    expect(isIgPermalink("https://www.instagram.com/p/AbC123/")).toBe(true);
    expect(isIgPermalink("https://www.instagram.com/reel/AbC123/")).toBe(true);
    expect(isIgPermalink("https://instagram.com.evil.com/p/x/")).toBe(false);
  });
});

describe("the card's image size and the takedown list", () => {
  it("reads a PNG's and a JPEG's pixel size from the bytes", () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 1080);
    new DataView(png.buffer).setUint32(20, 1350);
    expect(imageSize(png)).toEqual({ width: 1080, height: 1350 });
    const jpg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x02, 0xd0, 0x04, 0x38, 0x03,
    ]);
    expect(imageSize(jpg)).toEqual({ width: 1080, height: 720 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("draws landscape at its ratio and square for portrait", () => {
    const base = {
      username: "p",
      mediaType: "IMAGE" as const,
      image: "d",
      timestamp: "2026-11-17T18:00:00Z",
      likes: 10,
    };
    const wide = igCardSize({ ...base, imageWidth: 1200, imageHeight: 900 });
    const tall = igCardSize({ ...base, imageWidth: 1080, imageHeight: 1350 });
    expect(wide.width).toBe(1200);
    expect(tall.height).toBeGreaterThan(wide.height);
    expect(igAlt({ ...base, mediaType: "VIDEO", productType: "REELS" })).toBe(
      "Instagram reel by @p.",
    );
  });
  it("treats a post with nothing taken down as showable", () => {
    expect(
      snapshotTakenDown({
        kind: "instagram",
        id: "1",
        username: "thedumbdads",
      }),
    ).toBe(false);
  });
});

describe("release 2 review: Instagram at send and storage", () => {
  it("sends the token in a header with an optional appsecret_proof (M13)", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({
        business_discovery: { username: "p", media: { data: [] } },
      });
    }) as typeof fetch;
    await discoverPage("p", {
      token: "tok",
      igUserId: "17841400000000000",
      appSecret: "sec",
      fetchImpl: f,
    });
    expect(seen[0].auth).toBe("Bearer tok");
    expect(seen[0].url).not.toContain("tok&");
    expect(new URL(seen[0].url).searchParams.get("access_token")).toBeNull();
    expect(new URL(seen[0].url).searchParams.get("appsecret_proof")).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
  it("pages back until it finds the post or passes its time (H6)", async () => {
    let call = 0;
    const f = (async () => {
      call++;
      return Response.json({
        business_discovery: {
          username: "p",
          media:
            call === 1
              ? {
                  data: [
                    media("new", { timestamp: "2026-11-18T00:00:00+0000" }),
                  ],
                  paging: { cursors: { after: "c1" } },
                }
              : {
                  data: [
                    media("old", { timestamp: "2026-11-10T00:00:00+0000" }),
                  ],
                },
        },
      });
    }) as typeof fetch;
    const got = await igLookup("p", "old", {
      token: "t",
      igUserId: "17841400000000000",
      timestamp: "2026-11-10T00:00:00+0000",
      fetchImpl: f,
    });
    expect(got?.media.id).toBe("old");
    expect(call).toBe(2);
  });
  it("skips a carousel that opens on a video (L5)", () => {
    expect(
      igIneligible(
        media("c", {
          media_type: "CAROUSEL_ALBUM",
          children: { data: [{ id: "a", media_type: "VIDEO" }] },
        }),
        "p",
        NOW,
      ),
    ).toBe("carousel that opens on a video");
  });
  it("stores images under the type their bytes say (L5)", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      "image/png",
    );
    expect(sniffImageType(new Uint8Array([0x3c, 0x68, 0x74, 0x6d]))).toBeNull();
  });
});
