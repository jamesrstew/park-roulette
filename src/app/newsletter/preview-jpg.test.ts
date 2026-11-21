import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The issue's preview picture: only issues that went out, rendered once
 * and stored in Blob, cached for good; drafts need the dry-run key.
 */
const ISSUE = {
  issue_date: "2026-12-03",
  subject: "Juniper and the rain",
  preview: "Plus a covered skate this week.",
  hello: { text: "h".repeat(40) },
  weekend_ahead: {
    days: [
      {
        date: "2026-12-04",
        label: "Friday",
        condition: "Sunny",
        icon: "sun",
        high: 45,
        low: 25,
        precip: 0,
      },
      {
        date: "2026-12-05",
        label: "Saturday",
        condition: "Snow",
        icon: "snow",
        high: 29,
        low: 20,
        precip: 80,
      },
      {
        date: "2026-12-06",
        label: "Sunday",
        condition: "Sunny",
        icon: "sun",
        high: 36,
        low: 20,
        precip: 0,
      },
    ],
  },
  wheel_pick: {
    park: "wildflower-park-bend",
    why_now: "w",
    who_for: "w",
    bring: "b",
  },
  passport: { challenge_id: "x", text: "t" },
  signoff: { text: "s" },
};
let sent: unknown = null;
let draft: unknown = null;
vi.mock("@/lib/news/data", () => ({
  sentIssue: async () => sent,
  weatherIssue: async () => draft,
  loadParks: async () => [
    { slug: "wildflower-park-bend", name: "Wildflower Park", city: "Bend" },
  ],
}));
const stored = new Map<string, Buffer>();
const put = vi.fn(async (path: string, body: Buffer) => {
  if (stored.has(path)) throw new Error("This blob already exists");
  stored.set(path, body);
});
vi.mock("@vercel/blob", () => ({
  get: async (path: string) =>
    stored.has(path)
      ? { stream: new Response(new Uint8Array(stored.get(path)!)).body }
      : null,
  put: (path: string, body: Buffer) => put(path, body),
}));
vi.mock("@/lib/alerts", () => ({ alertLater: () => {} }));

const call = async (q = "") => {
  const { GET } = await import("./[date]/preview.jpg/route");
  return GET(new Request(`https://x/newsletter/2026-12-03/preview.jpg${q}`), {
    params: Promise.resolve({ date: "2026-12-03" }),
  });
};

describe("preview.jpg", () => {
  beforeEach(() => {
    sent = null;
    draft = null;
    stored.clear();
    put.mockClear();
    process.env.VERCEL = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_x";
    process.env.CRON_SECRET = "test-secret";
  });

  it("404s an issue that didn't go out, and a draft without the key", async () => {
    expect((await call()).status).toBe(404);
    draft = { issue: ISSUE, plan: null, frozen: false };
    expect((await call("?k=wrong")).status).toBe(404);
  });

  it("serves a draft with the dry-run key, never cached or stored", async () => {
    draft = { issue: ISSUE, plan: null, frozen: false };
    const { draftImageKey } = await import("@/lib/news/image-key");
    const r = await call(`?k=${draftImageKey("2026-12-03")}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(put).not.toHaveBeenCalled();
  });

  it("renders a sent issue once, stores it, and serves the same bytes for good", async () => {
    sent = { issue: ISSUE, plan: null };
    const first = await call();
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=31536000, s-maxage=31536000, immutable",
    );
    expect(first.headers.get("cdn-cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const bytes = Buffer.from(await first.arrayBuffer());
    expect(bytes.length).toBeLessThan(600 * 1024);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG
    expect(put).toHaveBeenCalledTimes(1);
    expect([...stored.keys()]).toEqual(["news/previews/2026-12-03.jpg"]);
    const again = Buffer.from(await (await call()).arrayBuffer());
    expect(again.equals(bytes)).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("doesn't store a picture whose park photo failed, and caches it briefly", async () => {
    sent = {
      issue: {
        ...ISSUE,
        wheel_pick: {
          ...ISSUE.wheel_pick,
          photo: {
            src: "https://www.bendparksandrec.org/x.jpg",
            width: 800,
            height: 600,
            alt: "a",
            sourceUrl: "https://www.bendparksandrec.org/park/x/",
          },
        },
      },
      plan: null,
    };
    vi.stubGlobal("fetch", async () => new Response("no", { status: 503 }));
    try {
      const r = await call();
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe(
        "public, max-age=300, s-maxage=300",
      );
      expect(put).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
