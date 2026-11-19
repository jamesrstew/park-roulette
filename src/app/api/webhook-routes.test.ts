import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The webhook routes refuse anything not signed by their sender, before
 * touching the database: Twilio replies (403), Resend deliveries (401),
 * and Resend replays more than 5 minutes old.
 */
const alerts: string[] = [];
vi.mock("@/lib/alerts", () => ({
  alertLater: (a: { key: string }) => alerts.push(a.key),
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

const SECRET = `whsec_${Buffer.from("a test secret of 24 bytes").toString("base64")}`;

beforeAll(() => {
  process.env.TWILIO_AUTH_TOKEN = "twilio-test-token";
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
});

describe("POST /api/texts/inbound", () => {
  it("refuses a bad Twilio signature with 403, and alerts James", async () => {
    const { POST } = await import("./texts/inbound/route");
    const res = await POST(
      new Request("https://parkroulette.quest/api/texts/inbound", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": "bm9wZQ==",
        },
        body: new URLSearchParams({
          From: "+15415550123",
          Body: "STOP",
          MessageSid: "SM1",
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect(alerts).toContain("texts:bad-signature");
  });
});

describe("POST /api/news/webhook", () => {
  const body = '{"type":"email.bounced"}';
  const post = async (headers: Record<string, string>) => {
    const { POST } = await import("./news/webhook/route");
    return POST(
      new Request("https://parkroulette.quest/api/news/webhook", {
        method: "POST",
        headers,
        body,
      }),
    );
  };
  it("refuses a bad Svix signature with 401", async () => {
    const res = await post({
      "svix-id": "msg_1",
      "svix-timestamp": String(Math.floor(Date.now() / 1000)),
      "svix-signature": "v1,bm9wZQ==",
    });
    expect(res.status).toBe(401);
  });
  it("refuses a correctly signed replay older than 5 minutes", async () => {
    const { signSvix, verifySvix } = await import("@/lib/news/svix");
    // The same signing, fresh, passes: so the refusal below is the age.
    const now = String(Math.floor(Date.now() / 1000));
    expect(
      verifySvix(
        SECRET,
        {
          id: "msg_2",
          timestamp: now,
          signature: `v1,${signSvix(SECRET, "msg_2", now, body)}`,
        },
        body,
      ),
    ).toBe(true);
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const res = await post({
      "svix-id": "msg_2",
      "svix-timestamp": ts,
      "svix-signature": `v1,${signSvix(SECRET, "msg_2", ts, body)}`,
    });
    expect(res.status).toBe(401);
  });
});
