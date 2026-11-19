import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Release 1 review H3: cards are content-addressed and written once; the
 * writer's /check renders in memory and writes nothing.
 */
const puts: { path: string; allowOverwrite?: boolean }[] = [];
vi.mock("@vercel/blob", () => ({
  put: async (path: string, _b: unknown, o: { allowOverwrite?: boolean }) => {
    if (puts.some((p) => p.path === path))
      throw new Error(`Vercel Blob: This blob already exists`);
    puts.push({ path, allowOverwrite: o.allowOverwrite });
    return { pathname: path };
  },
}));

const snap = {
  kind: "x" as const,
  id: "42",
  authorId: "u1",
  text: "Bedtime went to a third round.",
  links: [],
  name: "Some Parent",
  username: "someparent",
  avatar: null,
  verified: false,
  verifiedType: null,
  createdAt: "2026-11-18T18:42:00Z",
  likes: 5000,
  replies: 1,
  reposts: 2,
  quotes: 0,
  media: [],
  possiblySensitive: false,
  standalone: true,
};
const images = { avatar: null, media: null };

describe("stored post cards", () => {
  beforeEach(() => {
    puts.length = 0;
  });
  it("names the file by its bytes, never overwrites, and the same card stores once", async () => {
    const { storeCard } = await import("./cards");
    const a = await storeCard(snap, images);
    const b = await storeCard(snap, images);
    expect(a?.path).toMatch(/^news\/cards\/[0-9a-f]{64}\.png$/);
    expect(b).toEqual(a);
    expect(puts).toEqual([{ path: a!.path, allowOverwrite: false }]);
    // Different words, different file.
    const c = await storeCard({ ...snap, text: "Round four." }, images);
    expect(c?.path).not.toBe(a?.path);
    expect(a?.alt).toBe(
      "Post by Some Parent (@someparent) on X: Bedtime went to a third round.",
    );
  });
  it("renders in memory for a check, writing nothing", async () => {
    const { checkCard } = await import("./cards");
    expect(await checkCard(snap, images)).toBe(true);
    expect(puts).toEqual([]);
  });
});
