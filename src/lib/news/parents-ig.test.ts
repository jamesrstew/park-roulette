import { describe, expect, it, vi } from "vitest";

/**
 * Release 2 review L7: an Instagram pick's image is copied into Blob at a
 * content-addressed path with its pixel size, and at send a drafted pick
 * only has to still exist.
 */
const puts: { path: string; type: string; overwrite?: boolean }[] = [];
vi.mock("@vercel/blob", () => ({
  put: async (
    path: string,
    _b: unknown,
    o: { contentType: string; allowOverwrite?: boolean },
  ) => {
    puts.push({ path, type: o.contentType, overwrite: o.allowOverwrite });
    return { pathname: path };
  },
  get: async () => null,
}));
// A 1080x720 JPEG header is all the size reader needs.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08,
  0x02, 0xd0, 0x04, 0x38, 0x03,
]);
vi.mock("./fetcher", () => ({
  // The CDN says PNG; the bytes say JPEG, and the bytes win.
  fetchImage: async () => ({ bytes: JPEG, type: "image/png" }),
}));
let alive = true;
vi.mock("./igapi", async (orig) => ({
  ...(await orig<typeof import("./igapi")>()),
  igLookup: async () =>
    alive
      ? {
          avatar: null,
          media: {
            id: "17900000000000001",
            caption: "Bedtime, round three.",
            media_type: "IMAGE",
            media_url: "https://scontent.cdninstagram.com/x.jpg",
            permalink: "https://www.instagram.com/p/AbC123/",
            timestamp: new Date(Date.now() - 86_400_000).toISOString(),
            like_count: 5000,
          },
        }
      : null,
}));
vi.mock("./cards", () => ({
  storeCard: async () => ({
    path: "news/cards/abc.png",
    width: 1200,
    height: 1510,
    alt: "a",
  }),
  checkCard: async () => true,
}));

const meme = {
  platform: "instagram" as const,
  url: "https://www.instagram.com/p/AbC123/",
  postId: "17900000000000001",
  account: "thedumbdads",
};

describe("Instagram snapshots", () => {
  it("copies the image to a content-addressed path, typed by its bytes, with its size", async () => {
    const { memeSnapshot } = await import("./parents");
    const s = await memeSnapshot(meme, { mode: "store" });
    expect(s?.kind).toBe("instagram");
    if (s?.kind !== "instagram") return;
    expect(s.image).toMatchObject({
      width: 1080,
      height: 720,
      type: "image/jpeg",
    });
    expect(s.image.path).toMatch(/^news\/ig\/[0-9a-f]{64}\.jpg$/);
    expect(puts[0]).toMatchObject({ type: "image/jpeg", overwrite: false });
    expect(s.card?.path).toBe("news/cards/abc.png");
  });
  it("at send keeps the drafted snapshot while the post exists, and drops it when gone", async () => {
    const { memeSnapshot } = await import("./parents");
    const drafted = await memeSnapshot(meme, { mode: "store" });
    const before = puts.length;
    expect(
      await memeSnapshot(meme, { mode: "reuse", snapshot: drafted! }),
    ).toEqual(drafted);
    expect(puts.length).toBe(before); // nothing re-copied or re-drawn
    alive = false;
    expect(
      await memeSnapshot(meme, { mode: "reuse", snapshot: drafted! }),
    ).toBeNull();
  });
});
