import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signSvix } from "@/lib/news/svix";

/**
 * POST /api/inbound/email takes only Resend's signed email.received
 * deliveries (RESEND_INBOUND_SECRET, not the sending webhook's secret),
 * before reading any email or touching the database. The issue reads
 * need the ingest token.
 */
const handled: string[] = [];
vi.mock("@/lib/inbox/inbound", () => ({
  handleReceived: async (id: string) => {
    handled.push(id);
    return { status: 200, outcome: "stored" };
  },
}));
vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("the database must not be touched");
      },
    },
  ),
}));
vi.mock("@/lib/alerts", () => ({ alertLater: () => {} }));

const SECRET = `whsec_${Buffer.from("the inbound secret, 24 b!").toString("base64")}`;
const OTHER = `whsec_${Buffer.from("the sending secret, 24 b!").toString("base64")}`;
const ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";
const body = JSON.stringify({
  type: "email.received",
  created_at: "2026-11-20T14:02:41.000Z",
  data: { email_id: ID, from: "hello@daily-news.example", subject: "Hi" },
});

beforeAll(() => {
  process.env.RESEND_INBOUND_SECRET = SECRET;
  process.env.RESEND_WEBHOOK_SECRET = OTHER;
  process.env.NEWS_INGEST_TOKEN = "an-ingest-token-of-24-chars-or-more";
});
beforeEach(() => {
  handled.length = 0;
});

const post = async (headers: Record<string, string>, b = body) => {
  const { POST } = await import("./inbound/email/route");
  return POST(
    new Request("https://parkroulette.quest/api/inbound/email", {
      method: "POST",
      headers,
      body: b,
    }),
  );
};
const signed = (secret: string, b = body, age = 0) => {
  const ts = String(Math.floor(Date.now() / 1000) - age);
  return {
    "svix-id": "msg_in_1",
    "svix-timestamp": ts,
    "svix-signature": `v1,${signSvix(secret, "msg_in_1", ts, b)}`,
  };
};

describe("POST /api/inbound/email", () => {
  it("handles a correctly signed delivery", async () => {
    const res = await post(signed(SECRET));
    expect(res.status).toBe(200);
    expect(handled).toEqual([ID]);
  });
  it("refuses a bad signature, no signature, or the other webhook's secret", async () => {
    expect((await post({})).status).toBe(401);
    expect(
      (
        await post({
          "svix-id": "msg_in_1",
          "svix-timestamp": String(Math.floor(Date.now() / 1000)),
          "svix-signature": "v1,bm9wZQ==",
        })
      ).status,
    ).toBe(401);
    expect((await post(signed(OTHER))).status).toBe(401);
    expect(handled).toEqual([]);
  });
  it("refuses a signed replay older than 5 minutes", async () => {
    expect((await post(signed(SECRET, body, 6 * 60))).status).toBe(401);
    expect(handled).toEqual([]);
  });
  it("refuses a body changed after signing", async () => {
    const h = signed(SECRET);
    const res = await post(h, body.replace("Hi", "Hello"));
    expect(res.status).toBe(401);
  });
  it("ignores other event types", async () => {
    const b = JSON.stringify({ type: "email.sent", data: { email_id: ID } });
    const res = await post(signed(SECRET, b), b);
    expect(res.status).toBe(200);
    expect(handled).toEqual([]);
  });
});

describe("GET /api/events/issues", () => {
  it("needs the ingest token, list and one issue alike", async () => {
    const { GET } = await import("./events/issues/route");
    const list = await GET(
      new Request("https://parkroulette.quest/api/events/issues?days=14"),
    );
    expect(list.status).toBe(401);
    const wrong = await GET(
      new Request("https://parkroulette.quest/api/events/issues", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(wrong.status).toBe(401);
    const one = await import("./events/issues/[id]/route");
    const res = await one.GET(
      new Request("https://parkroulette.quest/api/events/issues/1"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(401);
  });
  it("checks days before reading anything", async () => {
    const { GET } = await import("./events/issues/route");
    const res = await GET(
      new Request("https://parkroulette.quest/api/events/issues?days=999", {
        headers: {
          authorization: "Bearer an-ingest-token-of-24-chars-or-more",
        },
      }),
    );
    expect(res.status).toBe(400);
  });
});
