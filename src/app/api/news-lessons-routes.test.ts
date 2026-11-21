import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The self-improvement endpoints: the writer token only POSTs retros, the
 * maintainer token (off when unset) reads lessons and stats, triages and
 * sends the summary. Every refusal happens before the database.
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
const sent: { key: string; text: string; everyMinutes?: number }[] = [];
let outcome: "sent" | "suppressed" | "failed" = "sent";
vi.mock("@/lib/alerts", () => ({
  alertLater: () => {},
  sendAlert: async (a: { key: string; text: string }) => {
    sent.push(a);
    return outcome;
  },
}));

const WRITER = "an-ingest-token-of-24-chars-or-more";
const MAINT = "a-maintainer-token-of-24-chars-plus";
const SOCIAL = "a-social-token-of-24-chars-or-more";
beforeAll(() => {
  process.env.NEWS_INGEST_TOKEN = WRITER;
  process.env.MAINTAINER_TOKEN = MAINT;
  process.env.SOCIAL_TOKEN = SOCIAL;
});
beforeEach(() => {
  sent.length = 0;
  outcome = "sent";
});
const req = (url: string, method: string, body?: unknown, token = MAINT) =>
  new Request(`https://parkroulette.quest${url}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = { params: Promise.resolve({ id: "1" }) };

describe("lessons routes: who may call what", () => {
  it("the writer token can't read lessons or stats, triage, or email", async () => {
    const list = await import("./news/lessons/route");
    const one = await import("./news/lessons/[id]/route");
    const stats = await import("./news/stats/route");
    const summary = await import("./news/maintainer-summary/route");
    for (const token of [WRITER, "wrong"])
      for (const res of [
        await list.GET(req("/api/news/lessons", "GET", undefined, token)),
        await one.PATCH(
          req("/api/news/lessons/1", "PATCH", { status: "open" }, token),
          ctx,
        ),
        await stats.GET(req("/api/news/stats", "GET", undefined, token)),
        await summary.POST(
          req("/api/news/maintainer-summary", "POST", { text: "hi" }, token),
        ),
      ])
        expect(res.status).toBe(401);
  });

  it("an unset MAINTAINER_TOKEN turns the maintainer endpoints off", async () => {
    delete process.env.MAINTAINER_TOKEN;
    try {
      const stats = await import("./news/stats/route");
      for (const token of ["", MAINT])
        expect(
          (await stats.GET(req("/api/news/stats", "GET", undefined, token)))
            .status,
        ).toBe(401);
    } finally {
      process.env.MAINTAINER_TOKEN = MAINT;
    }
  });

  it("retros: each routine sends its own kind with its own token", async () => {
    const { POST } = await import("./news/retro/route");
    const as = (kind: string, token: string) =>
      POST(req("/api/news/retro", "POST", { run: { kind } }, token));
    expect((await as("writer", "wrong")).status).toBe(401);
    expect((await as("maintainer", WRITER)).status).toBe(403);
    expect((await as("writer", MAINT)).status).toBe(403);
    // SOCIAL_TOKEN sends kind "social" only, and only it sends "social".
    for (const kind of ["writer", "events", "maintainer"])
      expect((await as(kind, SOCIAL)).status, kind).toBe(403);
    for (const token of [WRITER, MAINT])
      expect((await as("social", token)).status).toBe(403);
    const unset = process.env.SOCIAL_TOKEN;
    delete process.env.SOCIAL_TOKEN;
    try {
      expect((await as("social", SOCIAL)).status).toBe(401);
    } finally {
      process.env.SOCIAL_TOKEN = unset;
    }
  });

  it("refuses unknown keys and personal details before storing", async () => {
    const { POST } = await import("./news/retro/route");
    const res = await POST(
      req(
        "/api/news/retro",
        "POST",
        { run: { kind: "writer" }, mood: "fine" },
        WRITER,
      ),
    );
    expect(res.status).toBe(400);
    const pii = await POST(
      req(
        "/api/news/retro",
        "POST",
        {
          run: { kind: "writer" },
          problems: [
            {
              category: "idea",
              title: "A reader asked for parks",
              detail: "Write back to jo@example.com about Sisters parks.",
            },
          ],
        },
        WRITER,
      ),
    );
    expect(pii.status).toBe(422);
  });

  it("refuses a body over 64 KB", async () => {
    const { POST } = await import("./news/retro/route");
    const big = new Request("https://parkroulette.quest/api/news/retro", {
      method: "POST",
      headers: { authorization: `Bearer ${WRITER}` },
      body: "x".repeat(70 * 1024),
    });
    expect((await POST(big)).status).toBe(400);
  });

  it("a bad status list and a bad sends count are refused", async () => {
    const list = await import("./news/lessons/route");
    expect(
      (await list.GET(req("/api/news/lessons?status=open,closed", "GET")))
        .status,
    ).toBe(400);
    const stats = await import("./news/stats/route");
    expect(
      (await stats.GET(req("/api/news/stats?sends=50", "GET"))).status,
    ).toBe(400);
  });
});

describe("the summary email", () => {
  it("goes through the alerts channel under one key, at most every 6 days", async () => {
    const { POST } = await import("./news/maintainer-summary/route");
    const ok = await POST(
      req("/api/news/maintainer-summary", "POST", {
        text: "Last 4 sends: 120 clicks, 1 unsubscribe, 0 bounces, 3 validator drops. Opens aren't tracked.",
      }),
    );
    expect(ok.status).toBe(200);
    expect(sent[0]).toMatchObject({
      key: "maintainer",
      everyMinutes: 6 * 24 * 60,
    });
    outcome = "suppressed";
    const held = await POST(
      req("/api/news/maintainer-summary", "POST", { text: "Again." }),
    );
    expect(held.status).toBe(429);
    expect(await held.json()).toMatchObject({ sent: false, suppressed: true });
  });

  it("refuses addresses, phone numbers and other sites' links", async () => {
    const { POST } = await import("./news/maintainer-summary/route");
    for (const body of [
      { text: "A reader, jo@example.com, asked for more parks." },
      { text: "Call 5415550100." },
      { text: "See https://evil.example/x for the plan." },
      { text: "Fixed two.", pr_url: "https://github.com/someone/else/pull/1" },
    ])
      expect(
        (await POST(req("/api/news/maintainer-summary", "POST", body))).status,
      ).toBe(422);
    expect(sent).toHaveLength(0);
  });
});
