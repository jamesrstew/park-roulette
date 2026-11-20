import { describe, expect, it, vi } from "vitest";

/** A taken-down post's card stops serving (release 2 review L7). */
vi.mock("@/lib/news/data", () => ({
  weatherIssue: async () => ({
    frozen: true,
    issue: {
      meme: {
        snapshot: {
          kind: "x",
          id: "1",
          username: "someone",
          card: { path: "news/cards/a.png", width: 1, height: 1, alt: "a" },
        },
      },
    },
  }),
}));
let down = false;
vi.mock("@/lib/news/takedowns", () => ({ snapshotTakenDown: () => down }));
vi.mock("@vercel/blob", () => ({
  get: async () => ({ stream: new Response("png").body }),
}));

describe("post.png", () => {
  const call = async () => {
    const { GET } = await import("./[date]/post.png/route");
    return GET(new Request("https://x/newsletter/2026-12-03/post.png"), {
      params: Promise.resolve({ date: "2026-12-03" }),
    });
  };
  it("serves a frozen card for a day, and 404s once taken down", async () => {
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=86400");
    down = true;
    expect((await call()).status).toBe(404);
  });
});
