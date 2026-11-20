import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The events hand-in and the nightly check refuse anyone without their
 * secret, before touching the database.
 */
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

beforeAll(() => {
  process.env.NEWS_INGEST_TOKEN = "an-ingest-token-of-24-chars-or-more";
  process.env.CRON_SECRET = "a-cron-secret";
});

describe("events routes", () => {
  it("POST /api/events needs the ingest token", async () => {
    const { POST } = await import("./events/route");
    const res = await POST(
      new Request("https://parkroulette.quest/api/events", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });
  it("GET /api/cron/events-check needs the cron secret", async () => {
    const { GET } = await import("./cron/events-check/route");
    const res = await GET(
      new Request("https://parkroulette.quest/api/cron/events-check"),
    );
    expect(res.status).toBe(401);
  });
});
