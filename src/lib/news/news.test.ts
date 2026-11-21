import { describe, expect, it } from "vitest";
import type { Catalog, Venue } from "./catalog";
import {
  CHUNK_SIZE,
  type ChunkStore,
  processChunks,
  type Recipient,
} from "./chunks";
import {
  closerToHome,
  indoorVenues,
  type SentIssue,
  wheelPick,
} from "./cooldowns";
import type { ForecastDay, Issue } from "./issue";
import { classify, type OutEmail, post, type SendResult } from "./resend";
import { signSvix, verifySvix } from "./svix";
import {
  featuredHeading,
  hasWeatherCard,
  renderHtml,
  renderText,
  visitLength,
  renderWelcome,
  shortParkName,
  weatherImageUrl,
} from "./template";
import { calendarFlags, issueDateFor, pacificInstant, sendGate } from "./time";
import { fetchPage, pinnedLookup, privateAddress } from "./fetcher";
import { addressHash, bearerOk, isToken, maskEmail, newToken } from "./tokens";
import { labelPeriod, weekendForecast } from "./weather";

const venue = (id: string, extra: Partial<Venue> = {}): Venue => ({
  id,
  name: id,
  short_name: id,
  town: "Bend",
  address: null,
  kind: "indoor_play",
  covered: true,
  enclosure: "indoor",
  ages_label: "All ages",
  visit_minutes: 90,
  open_days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
  drive_minutes_from_downtown: 5,
  cost: "paid",
  access_note: null,
  hours_url: null,
  fit: "both",
  what: "",
  weather: ["rain"],
  months: [12],
  story_time: false,
  url: "https://www.bendparksandrec.org/",
  source: null,
  verified: true,
  ...extra,
});

/** A sent issue that used one Plan B venue on a date. */
const usedVenue = (date: string, venueId: string): SentIssue => ({
  issueDate: date,
  body: {
    issue_date: date,
    wheel_pick: { park: `p-${date}` },
    plan_b: { kind: "venue", venue_id: venueId },
    passport: { challenge_id: "challenge-x" },
  } as unknown as Issue,
});

describe("Indoor pick venues (weather-season v1)", () => {
  // Saturday, December 5, 2026, for the issue of December 3.
  const SAT = "2026-12-05";
  const catalog = {
    venues: [
      venue("venue-a", { kind: "museum" }),
      venue("venue-b", { kind: "pool" }),
    ],
  };
  it("uses 8 weeks when anything fits", () => {
    const r = indoorVenues(
      catalog,
      [usedVenue("2026-10-15", "venue-a")],
      "2026-12-03",
      SAT,
      ["rain"],
    );
    expect(r.weeks).toBe(8);
    // venue-a is cooling, and the last pick's kind (museum) is out anyway.
    expect(r.eligible.map((v) => v.id)).toEqual(["venue-b"]);
  });
  it("relaxes to 6, then 4, then repeats the oldest pick rather than drop the section", () => {
    const c = {
      venues: [...catalog.venues, venue("venue-c", { kind: "library" })],
    };
    // c was the last pick (kind library): a and b must carry it.
    const h6 = [
      usedVenue("2026-10-15", "venue-a"),
      usedVenue("2026-10-29", "venue-b"),
      usedVenue("2026-11-26", "venue-c"),
    ];
    const r6 = indoorVenues(c, h6, "2026-12-03", SAT, ["rain"]);
    expect(r6).toMatchObject({ weeks: 6, repeat: false });
    expect(r6.eligible.map((v) => v.id)).toEqual(["venue-a"]);
    const h4 = [
      usedVenue("2026-11-05", "venue-a"),
      usedVenue("2026-11-12", "venue-b"),
      usedVenue("2026-11-26", "venue-c"),
    ];
    const r4 = indoorVenues(c, h4, "2026-12-03", SAT, ["rain"]);
    expect(r4).toMatchObject({ weeks: 4 });
    expect(r4.eligible.map((v) => v.id)).toEqual(["venue-a"]);
    const h0 = [
      usedVenue("2026-11-19", "venue-a"),
      usedVenue("2026-11-12", "venue-b"),
      usedVenue("2026-11-26", "venue-c"),
    ];
    const r0 = indoorVenues(c, h0, "2026-12-03", SAT, ["rain"]);
    expect(r0).toMatchObject({ weeks: null, repeat: true });
    expect(r0.eligible.map((v) => v.id)).toEqual(["venue-b"]);
  });
  it("fits the hazard, the roads and the day, and puts free first", () => {
    const c = {
      venues: [
        venue("venue-paid", { cost: "paid" }),
        venue("venue-free", { cost: "free", kind: "library" }),
        venue("venue-low", { cost: "low", kind: "pool" }),
        venue("venue-covered", { enclosure: "covered", kind: "skating" }),
        venue("venue-far", { drive_minutes_from_downtown: 25, kind: "museum" }),
        venue("venue-closed-sat", {
          open_days: ["mon", "tue", "wed", "thu", "fri"],
          kind: "climbing",
        }),
        venue("venue-unverified", { verified: false }),
        venue("venue-summer", { months: [7] }),
      ],
    };
    const ids = (h: Parameters<typeof indoorVenues>[4]) =>
      indoorVenues(c, [], "2026-12-03", SAT, h).eligible.map((v) => v.id);
    // Rain: covered is fine, 35 minutes is fine.
    expect(ids(["rain"])).toEqual([
      "venue-free",
      "venue-low",
      "venue-covered",
      "venue-far",
      "venue-paid",
    ]);
    // Smoke: indoor only.
    expect(ids(["smoke"])).not.toContain("venue-covered");
    // Snow: within 15 minutes of downtown.
    expect(ids(["snow"])).not.toContain("venue-far");
  });
  it("lists one open venue in Redmond, Sisters and La Pine (free first) on snow days", () => {
    const c = {
      venues: [
        venue("venue-redmond-library", {
          name: "Redmond Library",
          town: "Redmond",
          cost: "free",
        }),
        venue("venue-redmond-pool", {
          name: "The Hub",
          town: "Redmond",
          cost: "low",
        }),
        venue("venue-sisters-library", {
          name: "Sisters Library",
          town: "Sisters",
          open_days: ["tue", "wed", "thu", "fri", "sat"],
        }),
        venue("venue-la-pine-library", {
          name: "La Pine Library",
          town: "La Pine",
          open_days: ["tue"],
        }),
      ],
    };
    expect(closerToHome(c, "2026-12-05")).toEqual([
      "Redmond Library",
      "Sisters Library",
    ]);
  });
});

describe("the Wheel Pick", () => {
  const parks = ["a", "b", "c", "d"].map((x) => ({
    slug: `${x}-park-bend`,
    name: x,
    city: x === "d" ? "Redmond" : "Bend",
    status: "active",
    play: "playground",
    approved: true,
    features: x === "b" ? ["shade"] : [],
  }));
  const hints: Catalog["parks"] = [
    { slug: "c-park-bend", no_pick: true, snow_ok: false },
  ];
  it("is the same spin for the same date", () => {
    const a = wheelPick(parks, [], "2026-12-03", [], hints);
    const b = wheelPick(parks, [], "2026-12-03", [], hints);
    expect(a?.park.slug).toBe(b?.park.slug);
    expect(a?.park.slug).not.toBe("c-park-bend");
  });
  it("respects the 10-week Wheel Pick cooldown", () => {
    const history = ["a", "b", "d"].map((x, i) => ({
      issueDate: `2026-11-${12 + i * 7}`,
      body: {
        wheel_pick: { park: `${x}-park-bend` },
        passport: { challenge_id: "x" },
      } as unknown as Issue,
    }));
    expect(wheelPick(parks, history, "2026-12-03", [], hints)).toBeNull();
  });
  it("narrows to shade on a hot week", () => {
    expect(wheelPick(parks, [], "2027-07-01", ["hot"], hints)?.park.slug).toBe(
      "b-park-bend",
    );
  });
});

describe("forecast labels", () => {
  const day = (shortForecast: string, extra = {}) => ({
    startTime: "2026-12-05T06:00:00-08:00",
    isDaytime: true,
    temperature: 45,
    windSpeed: "5 mph",
    shortForecast,
    ...extra,
  });
  it("labels what changes a park day, and nothing else", () => {
    expect(labelPeriod(day("Mostly Sunny"))).toEqual([]);
    expect(labelPeriod(day("Patchy Freezing Fog"))).toEqual([]);
    expect(labelPeriod(day("Chance Light Snow"))).toEqual(["snow"]);
    expect(
      labelPeriod(
        day("Slight Chance Light Snow", {
          probabilityOfPrecipitation: { value: 20 },
        }),
      ),
    ).toEqual([]);
    expect(labelPeriod(day("Rain Showers"))).toEqual(["rain"]);
    expect(labelPeriod(day("Sunny", { windSpeed: "15 to 25 mph" }))).toEqual([
      "wind",
    ]);
    expect(labelPeriod(day("Sunny", { temperature: 30 }))).toEqual(["cold"]);
    expect(labelPeriod(day("Haze", { temperature: 95 }))).toEqual([
      "hot",
      "smoke",
    ]);
  });
});

describe("Pacific time gate", () => {
  it("starts 7:00 to 9:00 Pacific on Thursdays, in winter and in summer", () => {
    // Winter (PST, UTC-8): 14:00 UTC is 6:00, too early; 15:00 is 7:00.
    expect(sendGate(new Date("2026-12-03T14:00:00Z"))).toMatchObject({
      thursday: true,
      tooEarly: true,
      canStart: false,
    });
    expect(sendGate(new Date("2026-12-03T15:00:00Z"))).toMatchObject({
      canStart: true,
      lastChance: false,
    });
    expect(sendGate(new Date("2026-12-03T16:45:00Z"))).toMatchObject({
      canStart: true,
      lastChance: true,
    });
    // Summer (PDT, UTC-7): 14:00 UTC is 7:00; 16:00 is 9:00, too late to start.
    expect(sendGate(new Date("2027-07-01T14:00:00Z"))).toMatchObject({
      canStart: true,
    });
    expect(sendGate(new Date("2027-07-01T15:45:00Z"))).toMatchObject({
      canStart: true,
      lastChance: true,
    });
    expect(sendGate(new Date("2027-07-01T16:00:00Z"))).toMatchObject({
      canStart: false,
      tooEarly: false,
    });
    // Not Thursday.
    expect(sendGate(new Date("2026-12-04T15:00:00Z")).thursday).toBe(false);
  });
  it("finds this week's Thursday and Pacific instants across DST", () => {
    expect(issueDateFor(new Date("2026-12-01T20:00:00Z"))).toBe("2026-12-03");
    expect(issueDateFor(new Date("2026-12-03T20:00:00Z"))).toBe("2026-12-03");
    expect(pacificInstant("2026-12-03", 7).toISOString()).toBe(
      "2026-12-03T15:00:00.000Z",
    );
    expect(pacificInstant("2027-07-01", 7).toISOString()).toBe(
      "2027-07-01T14:00:00.000Z",
    );
  });
  it("flags skip dates, holidays, DST and the solstice", () => {
    const cat = {
      skip_dates: [{ date: "2026-11-26", reason: "Thanksgiving" }],
      breaks: [],
    };
    expect(calendarFlags("2026-11-26", cat).skip).toBe("Thanksgiving");
    expect(calendarFlags("2026-11-26", cat).holidays[0].name).toBe(
      "Thanksgiving",
    );
    expect(calendarFlags("2026-12-17", cat).season?.date).toBe("2026-12-21");
    expect(calendarFlags("2027-03-11", cat).dst).toEqual({
      date: "2027-03-14",
      change: "starts",
    });
    expect(calendarFlags("2026-10-29", cat).dst).toEqual({
      date: "2026-11-01",
      change: "ends",
    });
  });
});

/** An in-memory send log, like news_sends. */
function memoryStore(n: number, opts: { paused?: () => boolean } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({
    sendId: i + 1,
    chunk: Math.floor(i / CHUNK_SIZE),
    status: "queued",
    attempts: 0,
    keyAttempt: 0,
    email: `kid${i}@example.com` as string | null,
  }));
  const pending = (r: (typeof rows)[number]) =>
    r.status === "queued" || r.status === "sending";
  const state = new Map<
    number,
    { attempts: Record<number, number[]>; oneByOne: boolean }
  >();
  const st = (c: number) => {
    if (!state.has(c)) state.set(c, { attempts: {}, oneByOne: false });
    return state.get(c)!;
  };
  const store: ChunkStore = {
    async pendingChunks() {
      return [...new Set(rows.filter(pending).map((r) => r.chunk))].sort(
        (a, b) => a - b,
      );
    },
    async recipients(chunk) {
      const mine = rows.filter((r) => r.chunk === chunk && pending(r));
      const keyAttempt = Math.max(0, ...mine.map((r) => r.keyAttempt));
      return {
        keyAttempt,
        oneByOne: st(chunk).oneByOne,
        attemptIds: st(chunk).attempts[keyAttempt] ?? null,
        recipients: mine.map((r): Recipient => ({
          sendId: r.sendId,
          email: r.email,
          token: r.email ? `tok${r.sendId}` : null,
        })),
      };
    },
    async markSending(chunk) {
      for (const r of rows)
        if (r.chunk === chunk && pending(r)) {
          r.status = "sending";
          r.attempts++;
        }
    },
    async markSkipped(ids) {
      for (const r of rows) if (ids.includes(r.sendId)) r.status = "skipped";
    },
    async markSent(sent) {
      for (const s of sent)
        rows.find((r) => r.sendId === s.sendId)!.status = "sent";
    },
    async markFailed(ids) {
      for (const r of rows) if (ids.includes(r.sendId)) r.status = "failed";
    },
    async retryChunk(chunk, newKey) {
      for (const r of rows)
        if (r.chunk === chunk && r.status === "sending") {
          r.status = r.attempts >= 3 ? "failed" : "queued";
          if (newKey) r.keyAttempt++;
        }
    },
    async recordAttempt(chunk, keyAttempt, ids) {
      st(chunk).attempts[keyAttempt] ??= ids;
    },
    async markOneByOne(chunk) {
      st(chunk).oneByOne = true;
    },
    async retrySends(ids) {
      for (const r of rows)
        if (ids.includes(r.sendId) && r.status === "sending")
          r.status = r.attempts >= 3 ? "failed" : "queued";
    },
    async keepGoing() {
      return !(opts.paused?.() ?? false);
    },
  };
  return { rows, store, state };
}

const build = (r: { email: string; token: string }): OutEmail => ({
  from: "a@b.c",
  to: [r.email],
  subject: "s",
  html: `<a href="/u?t=${r.token}">`,
  text: "t",
});

const sent = (emails: OutEmail[]): SendResult => ({
  ok: true,
  outcome: "sent",
  ids: emails.map((_, i) => `id${i}`),
});
const fail = (
  status: number,
  error: string,
  outcome: "accepted" | "later" | "invalid" | "server" | "fatal",
): SendResult => ({ ok: false, outcome, status, error });
const noOne = async (): Promise<SendResult> => {
  throw new Error("sendOne should not be called");
};

describe("chunked sending", () => {
  it("resumes only the chunks that didn't go, on a new key after a 5xx", async () => {
    const { rows, store } = memoryStore(250);
    const keys: string[] = [];
    const delivered: string[] = [];
    let fails = 1;
    const sendBatch = async (emails: OutEmail[], key: string) => {
      keys.push(key);
      if (key.startsWith("news-9-1-") && fails-- > 0)
        return fail(500, "application_error", "server");
      delivered.push(...emails.map((e) => e.to[0]));
      return sent(emails);
    };
    const first = await processChunks({
      issueId: 9,
      store,
      sendBatch,
      sendOne: noOne,
      build,
    });
    expect(first.sent).toBe(150);
    expect(keys).toEqual(["news-9-0-a0", "news-9-1-a0", "news-9-2-a0"]);
    // Someone in the failed chunk stops before the retry.
    rows[120].email = null;
    const second = await processChunks({
      issueId: 9,
      store,
      sendBatch,
      sendOne: noOne,
      build,
    });
    // Resend clearly didn't take a0 (a 5xx), so the retry uses a1.
    expect(keys.slice(3)).toEqual(["news-9-1-a1"]);
    expect(second).toMatchObject({ sent: 99, skipped: 1 });
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(delivered).toHaveLength(249);
  });
  it("keeps the same key when Resend may have taken it (timeout, 429, a request in flight)", async () => {
    const { rows, store } = memoryStore(10);
    const keys: string[] = [];
    const answers = [
      fail(0, "TimeoutError", "later"),
      fail(429, "rate_limit_exceeded", "later"),
      fail(409, "concurrent_idempotent_requests", "later"),
    ];
    for (const a of answers) {
      const r = await processChunks({
        issueId: 4,
        store,
        build,
        sendOne: noOne,
        sendBatch: async (_e, key) => (keys.push(key), a),
      });
      expect(r.stoppedEarly).toBe(true);
    }
    expect(keys).toEqual(["news-4-0-a0", "news-4-0-a0", "news-4-0-a0"]);
    expect(rows.every((r) => r.status === "sending")).toBe(true);
  });
  it("treats a key Resend already took as sent, never sends twice", async () => {
    const { rows, store } = memoryStore(10);
    const r = await processChunks({
      issueId: 1,
      store,
      build,
      sendOne: noOne,
      sendBatch: async () =>
        fail(409, "invalid_idempotent_request", "accepted"),
    });
    expect(r.outcomes[0].outcome).toBe("already_sent");
    expect(rows.every((x) => x.status === "sent")).toBe(true);
  });
  it("counts an already-taken key only for the readers it went to (M1)", async () => {
    const { rows, store } = memoryStore(10);
    // First run: a timeout after Resend took a0 for all 10.
    await processChunks({
      issueId: 7,
      store,
      build,
      sendOne: noOne,
      sendBatch: async () => fail(0, "TimeoutError", "later"),
    });
    // Reader 3 stops; the list for a0 no longer matches, so Resend says
    // the key was used with another payload.
    rows[2].email = null;
    const keys: string[] = [];
    const r = await processChunks({
      issueId: 7,
      store,
      build,
      sendOne: noOne,
      sendBatch: async (_e, key) => (
        keys.push(key),
        fail(409, "invalid_idempotent_request", "accepted")
      ),
    });
    expect(keys).toEqual(["news-7-0-a0"]);
    expect(r.outcomes[0].outcome).toBe("already_sent");
    // The 9 still on the list were in a0: sent, never again.
    expect(rows.filter((x) => x.status === "sent")).toHaveLength(9);
  });
  it("sends a newcomer to a chunk on a new key, never as part of the old one", async () => {
    const { rows, store, state } = memoryStore(3);
    // a0 was recorded for readers 1 and 2 only (say 3 was mid-snapshot).
    state.set(0, { attempts: { 0: [1, 2] }, oneByOne: false });
    const delivered: string[][] = [];
    let first = true;
    const r1 = await processChunks({
      issueId: 8,
      store,
      build,
      sendOne: noOne,
      sendBatch: async (emails, key) => {
        if (first) {
          first = false;
          return fail(409, "invalid_idempotent_request", "accepted");
        }
        delivered.push([key, ...emails.map((e) => e.to[0])]);
        return sent(emails);
      },
    });
    expect(r1.sent).toBe(2);
    expect(rows[2].keyAttempt).toBe(1);
    await processChunks({
      issueId: 8,
      store,
      build,
      sendOne: noOne,
      sendBatch: async (emails, key) => (
        delivered.push([key, ...emails.map((e) => e.to[0])]),
        sent(emails)
      ),
    });
    expect(delivered).toEqual([["news-8-0-a1", "kid2@example.com"]]);
  });
  it("keeps a chunk one by one on later runs, and retries a single 5xx (L10)", async () => {
    const { rows, store } = memoryStore(3);
    let batches = 0;
    let flaky = 1;
    const run = () =>
      processChunks({
        issueId: 9,
        store,
        build,
        sendBatch: async () => (
          batches++,
          fail(422, "invalid_parameter", "invalid")
        ),
        sendOne: async (e) => {
          if (e.to[0] === "kid1@example.com" && flaky-- > 0)
            return fail(500, "application_error", "server");
          return { ok: true, outcome: "sent", ids: ["x"] };
        },
      });
    await run();
    expect(rows.map((x) => x.status)).toEqual(["sent", "queued", "sent"]);
    await run();
    expect(batches).toBe(1);
    expect(rows.every((x) => x.status === "sent")).toBe(true);
  });
  it("fails a chunk right away on a fatal 4xx (no retries)", async () => {
    const { rows, store } = memoryStore(5);
    const r = await processChunks({
      issueId: 5,
      store,
      build,
      sendOne: noOne,
      sendBatch: async () => fail(403, "validation_error", "fatal"),
    });
    expect(r.failed).toBe(5);
    expect(rows.every((x) => x.status === "failed" && x.attempts === 1)).toBe(
      true,
    );
  });
  it("sends a chunk one by one after a 400 or 422, so one bad address doesn't sink the rest", async () => {
    const { rows, store } = memoryStore(4);
    const singles: string[] = [];
    const r = await processChunks({
      issueId: 6,
      store,
      build,
      sendBatch: async () => fail(422, "invalid_parameter", "invalid"),
      sendOne: async (e, key) => {
        singles.push(key);
        return e.to[0] === "kid2@example.com"
          ? fail(422, "invalid_parameter", "invalid")
          : { ok: true, outcome: "sent", ids: ["x"] };
      },
    });
    expect(singles).toEqual([
      "news-6-0-1",
      "news-6-0-2",
      "news-6-0-3",
      "news-6-0-4",
    ]);
    expect(r).toMatchObject({ sent: 3, failed: 1 });
    expect(rows.map((x) => x.status)).toEqual([
      "sent",
      "sent",
      "failed",
      "sent",
    ]);
  });
  it("stops on the kill switch, then picks up later", async () => {
    let paused = false;
    const { rows, store } = memoryStore(300, { paused: () => paused });
    let calls = 0;
    const r = await processChunks({
      issueId: 2,
      store,
      build,
      sendOne: noOne,
      sendBatch: async (emails) => {
        calls++;
        if (calls === 1) paused = true;
        return sent(emails);
      },
    });
    expect(r.stoppedEarly).toBe(true);
    expect(rows.filter((x) => x.status === "sent")).toHaveLength(100);
    paused = false;
    await processChunks({
      issueId: 2,
      store,
      build,
      sendOne: noOne,
      sendBatch: async (e) => sent(e),
    });
    expect(rows.filter((x) => x.status === "sent")).toHaveLength(300);
  });
  it("gives up on a chunk after 3 server errors", async () => {
    const { rows, store } = memoryStore(5);
    const keys: string[] = [];
    for (let i = 0; i < 4; i++)
      await processChunks({
        issueId: 3,
        store,
        build,
        sendOne: noOne,
        sendBatch: async (_e, key) => (
          keys.push(key),
          fail(503, "service_unavailable", "server")
        ),
      });
    expect(keys).toEqual(["news-3-0-a0", "news-3-0-a1", "news-3-0-a2"]);
    expect(rows.every((r) => r.status === "failed")).toBe(true);
  });
});

describe("Resend answers", () => {
  const respond = (status: number, body: unknown) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
      })) as unknown as typeof fetch;
  it("classifies every status and 409 name", () => {
    expect(classify(200, "")).toBe("sent");
    expect(classify(0, "TimeoutError")).toBe("later");
    expect(classify(409, "invalid_idempotent_request")).toBe("accepted");
    expect(classify(409, "concurrent_idempotent_requests")).toBe("later");
    expect(classify(409, "resource_locked")).toBe("later");
    expect(classify(409, "forge_not_enabled")).toBe("fatal");
    expect(classify(429, "rate_limit_exceeded")).toBe("later");
    expect(classify(429, "daily_quota_exceeded")).toBe("later");
    expect(classify(400, "validation_error")).toBe("invalid");
    expect(classify(422, "invalid_parameter")).toBe("invalid");
    expect(classify(401, "validation_error")).toBe("fatal");
    expect(classify(403, "validation_error")).toBe("fatal");
    expect(classify(500, "application_error")).toBe("server");
    expect(classify(503, "service_unavailable")).toBe("server");
  });
  it("post() reads ids on success and names on failure", async () => {
    expect(
      await post(
        "/emails/batch",
        [],
        "k",
        respond(200, { data: [{ id: "a" }, { id: "b" }] }),
      ),
    ).toEqual({
      ok: true,
      outcome: "sent",
      ids: ["a", "b"],
    });
    expect(
      await post("/emails", {}, "k", respond(200, { id: "a" })),
    ).toMatchObject({ ids: ["a"] });
    for (const [status, name, outcome] of [
      [409, "invalid_idempotent_request", "accepted"],
      [409, "concurrent_idempotent_requests", "later"],
      [409, "resource_locked", "later"],
      [409, "something_new", "fatal"],
      [422, "missing_required_field", "invalid"],
      [500, "application_error", "server"],
    ] as const)
      expect(
        await post("/emails/batch", [], "k", respond(status, { name })),
        name,
      ).toMatchObject({
        ok: false,
        outcome,
        status,
        error: name,
      });
    const throws = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    expect(await post("/emails", {}, "k", throws)).toMatchObject({
      outcome: "later",
      status: 0,
    });
  });
});

describe("unsubscribe tokens", () => {
  it("are random, URL-safe and checked for shape", () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(isToken(a)).toBe(true);
    expect(encodeURIComponent(a)).toBe(a);
    expect(isToken("short")).toBe(false);
    expect(isToken(`${a.slice(0, 42)}!`)).toBe(false);
    expect(isToken(null)).toBe(false);
  });
  it("fingerprint and mask addresses", () => {
    expect(addressHash(" Jane@Example.com")).toBe(
      addressHash("jane@example.com"),
    );
    expect(addressHash("jane@example.com")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
  });
});

describe("bearer tokens", () => {
  const req = (auth?: string) =>
    new Request("https://x.test", {
      headers: auth ? { authorization: auth } : {},
    });
  const secret = "a-long-ingest-token-0123456789";
  it("accepts only the exact secret, compared as digests", () => {
    expect(bearerOk(req(`Bearer ${secret}`), secret, 24)).toBe(true);
    expect(bearerOk(req(`Bearer ${secret}x`), secret, 24)).toBe(false);
    expect(bearerOk(req(`Bearer ${secret.slice(1)}`), secret, 24)).toBe(false);
    expect(bearerOk(req(), secret, 24)).toBe(false);
  });
  it("refuses everyone when the secret is missing or too short", () => {
    expect(bearerOk(req("Bearer "), "", 1)).toBe(false);
    expect(bearerOk(req("Bearer short"), "short", 24)).toBe(false);
    expect(bearerOk(req("Bearer undefined"), undefined)).toBe(false);
  });
});

describe("the validator's fetcher", () => {
  it("refuses private, loopback and link-local addresses", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.5.4",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "::ffff:0a00:0001",
      "::",
      "192.0.2.10",
      "198.18.0.1",
      "203.0.113.5",
      "224.0.0.1",
      "255.255.255.255",
      "64:ff9b::a9fe:a9fe",
      "2002:7f00:1::1",
      "2001:db8::1",
      "fec0::1",
      "ff02::1",
      "fe80::1%en0",
    ])
      expect(privateAddress(ip), ip).toBe(true);
    for (const ip of [
      "8.8.8.8",
      "172.32.0.1",
      "2606:4700::1111",
      "::ffff:8.8.8.8",
      "2002:0808:0808::1",
    ])
      expect(privateAddress(ip), ip).toBe(false);
  });
  it("pins the connection's DNS lookup to public addresses (no rebinding)", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((ok) =>
      pinnedLookup("localhost", {}, (e) => ok(e)),
    );
    expect(err?.code).toBe("EPRIVATE");
  });
  it("won't follow a link off the allowlist or onto a private host", async () => {
    expect(
      (await fetchPage("https://evil.example.com/", ["bendparksandrec.org"]))
        .status,
    ).toBe(0);
    expect((await fetchPage("https://localhost/", ["localhost"])).status).toBe(
      0,
    );
  });
});

describe("Resend webhook signatures (Svix)", () => {
  const secret = `whsec_${Buffer.from("a test secret of 24 bytes").toString("base64")}`;
  const body = '{"type":"email.bounced"}';
  const now = new Date("2026-12-03T15:00:00Z");
  const ts = String(now.getTime() / 1000);
  const sig = signSvix(secret, "msg_1", ts, body);
  it("accepts a good signature, including during a key rotation", () => {
    expect(
      verifySvix(
        secret,
        { id: "msg_1", timestamp: ts, signature: `v1,${sig}` },
        body,
        now,
      ),
    ).toBe(true);
    expect(
      verifySvix(
        secret,
        { id: "msg_1", timestamp: ts, signature: `v1,b2xk v1,${sig}` },
        body,
        now,
      ),
    ).toBe(true);
  });
  it("rejects a changed body, a wrong id, an old timestamp or no secret", () => {
    const h = { id: "msg_1", timestamp: ts, signature: `v1,${sig}` };
    expect(verifySvix(secret, h, `${body} `, now)).toBe(false);
    expect(verifySvix(secret, { ...h, id: "msg_2" }, body, now)).toBe(false);
    expect(
      verifySvix(secret, h, body, new Date(now.getTime() + 6 * 60_000)),
    ).toBe(false);
    expect(verifySvix(undefined, h, body, now)).toBe(false);
    expect(
      verifySvix(secret, { ...h, signature: `v2,${sig}` }, body, now),
    ).toBe(false);
  });
});

describe("the template", () => {
  const days: ForecastDay[] = [
    {
      date: "2026-12-04",
      label: "Friday",
      condition: "Sunny",
      icon: "sun",
      high: 41,
      low: 17,
      precip: 0,
    },
    {
      date: "2026-12-05",
      label: "Saturday",
      condition: "Snow",
      icon: "snow",
      high: 30,
      low: 18,
      precip: 90,
    },
    {
      date: "2026-12-06",
      label: "Sunday",
      condition: "",
      icon: "cloudy",
      high: null,
      low: null,
      precip: null,
      missing: true,
    },
  ];
  const issue = {
    issue_date: "2026-12-03",
    subject: "Juniper <Park> & the rain",
    preview: "Plus a covered skate.",
    hello: { text: "Hi <b>there</b>." },
    weekend_ahead: { days, note: "Best park window: Friday morning" },
    wheel_pick: {
      park: "juniper-park-bend",
      why_now: "Now.",
      who_for: "All.",
      bring: "Gloves.",
    },
    passport: { challenge_id: "challenge-snow-stamp", text: "Stamp it." },
    signoff: { text: "Hit reply." },
    meme: {
      platform: "x",
      url: "https://x.com/someparent/status/123",
      postId: "123",
      snapshot: {
        kind: "x",
        id: "123",
        text: "My toddler just asked if the moon is <following> us & I said yes.",
        name: "Some Parent",
        username: "someparent",
        avatar: null,
        verified: false,
        createdAt: "2026-11-18T18:42:00Z",
        likes: 52_300,
        media: [],
        possiblySensitive: false,
        authorId: "u1",
        links: [],
        verifiedType: null,
        replies: 10,
        reposts: 20,
        quotes: 3,
        standalone: true,
        card: {
          path: "news/cards/x-123.png",
          width: 1200,
          height: 900,
          alt: "Post by Some Parent (@someparent) on X: My toddler just asked if the moon is <following> us & I said yes.",
        },
      },
    },
  } as Issue;
  const opts = {
    catalog: { venues: [], challenges: [] } as unknown as Catalog,
    site: "https://parkroulette.quest",
    number: 3,
    park: () => ({ name: "Juniper Park", city: "Bend" }),
    links: "track" as const,
    unsubscribeUrl: "https://parkroulette.quest/news/unsubscribe?t=TOKEN",
    postalAddress: "PO Box 1, Hillsboro, OR",
    weatherImage: true,
    memeImage: true,
  };
  it("escapes text, uses plain section names and tracked links", () => {
    const html = renderHtml(issue, opts);
    expect(html).toContain("Juniper &lt;Park&gt; &amp; the rain");
    expect(html).not.toContain("<b>there</b>");
    for (const name of [
      "Featured park: Juniper",
      "The weekend ahead",
      "Passport challenge",
      "Parents&#39; corner",
    ])
      expect(html).toContain(name);
    expect(html).not.toContain("Featured park: Juniper Park");
    expect(html).toContain("https://parkroulette.quest/n/2026-12-03/pick");
    expect(html).toContain("/parks/juniper-park-bend/opengraph-image");
    // Parents' corner: one linked image of the post, its words in the alt.
    expect(html).toContain(
      'src="https://parkroulette.quest/newsletter/2026-12-03/post.png"',
    );
    expect(html).toContain("https://parkroulette.quest/n/2026-12-03/meme");
    expect(html).toContain(
      "Post by Some Parent (@someparent) on X: My toddler just asked if the moon is &lt;following&gt; us &amp; I said yes.",
    );
    // The stored card's size, shown at half (600 wide).
    expect(html).toContain('width="600" height="450"');
    // No image, no section.
    expect(renderHtml(issue, { ...opts, memeImage: false })).not.toContain(
      "Parents&#39; corner",
    );
    expect(html).not.toContain("—");
  });
  it("shows the weather card with the forecast in its alt text, and the note as text below", () => {
    const html = renderHtml(issue, opts);
    expect(html).toContain(
      'src="https://parkroulette.quest/newsletter/2026-12-03/weather.png" width="600" height="320"',
    );
    expect(html).toContain(
      "Weekend forecast for Bend. Friday: sunny, high 41°F, low 17°F. Saturday: snow, high 30°F, low 18°F, 90% chance of snow. Sunday: no forecast yet.",
    );
    expect(html).toContain("<b>Best park window: Friday morning</b>");
    expect(html).toContain("forecast.weather.gov");
    // Without the image (it didn't answer), the same words show as text.
    const noImage = renderHtml(issue, { ...opts, weatherImage: false });
    expect(noImage).not.toContain("weather.png");
    expect(noImage).toContain("Weekend forecast for Bend. Friday: sunny");
  });
  it("uses text only with fewer than 2 days of forecast", () => {
    const thin = {
      ...issue,
      weekend_ahead: {
        days: days.map((d, i) =>
          i === 0 ? d : { ...d, missing: true, high: null },
        ),
      },
    };
    expect(weatherImageUrl(opts.site, thin)).toBeNull();
    expect(renderHtml(thin, opts)).not.toContain("weather.png");
    expect(hasWeatherCard(days)).toBe(true);
  });
  it("has a plain-text twin with the forecast, unsubscribe link and address", () => {
    const text = renderText(issue, opts);
    expect(text).toContain(
      "Unsubscribe: https://parkroulette.quest/news/unsubscribe?t=TOKEN",
    );
    expect(text).toContain("PO Box 1, Hillsboro, OR");
    expect(text).toContain("THE WEEKEND AHEAD");
    expect(text).toContain("Weekend forecast for Bend. Friday: sunny");
    expect(text).toContain("Featured park: Juniper (Bend)");
  });
  it("offers the Weekend Pick in one quiet footer line, HTML and text", () => {
    const link = "https://parkroulette.quest/texts?from=email_footer";
    const html = renderHtml(issue, opts);
    expect(html).toContain(
      `Want the weekend&#39;s park by text? <a class="link" href="${link}"`,
    );
    expect(html).toContain("Get the Weekend Pick on Fridays</a>.");
    // Above the legal lines.
    expect(html.indexOf("from=email_footer")).toBeLessThan(
      html.indexOf("True Craft Ventures LLC"),
    );
    expect(renderText(issue, opts)).toContain(
      `Want the weekend's park by text? Get the Weekend Pick on Fridays: ${link}`,
    );
    const w = renderWelcome({
      site: "https://parkroulette.quest",
      unsubscribeUrl: "https://parkroulette.quest/news/unsubscribe?t=T",
      latestIssueUrl: null,
      postalAddress: "PO Box 1",
    });
    expect(w.html).toContain(`href="${link}"`);
    expect(w.text).toContain(
      `Want the weekend's park by text? Get the Weekend Pick on Fridays: ${link}`,
    );
  });
  it("credits a BPRD photo", () => {
    const html = renderHtml(
      {
        ...issue,
        wheel_pick: {
          ...issue.wheel_pick,
          photo: {
            src: "https://www.bendparksandrec.org/wp-content/uploads/j.jpg",
            width: 1024,
            height: 685,
            alt: "Juniper Park in Bend",
            sourceUrl: "https://www.bendparksandrec.org/park/juniper-park/",
          },
        },
      },
      opts,
    );
    expect(html).toContain("Photo: <a");
    expect(html).toContain("Bend Park &amp; Recreation District");
    expect(html).not.toContain("opengraph-image");
  });
});

describe("the Indoor pick in the email (weather-season v1)", () => {
  const museum = venue("venue-high-desert-museum", {
    name: "High Desert Museum",
    address: "59800 South Highway 97, Bend, OR 97702",
    kind: "museum",
    ages_label: "All ages",
    visit_minutes: 150,
    drive_minutes_from_downtown: 15,
    url: "https://www.highdesertmuseum.org/",
  });
  const catalog = {
    venues: [museum],
    challenges: [],
    dress_tips: [
      {
        id: "dress-mittens",
        text: "Mittens beat gloves for kids under 5. Pack a spare pair for wet slides.",
        label: "Dress for it",
        triggers: ["cold"],
        months: [12],
        source: null,
        verified: true,
      },
    ],
  } as unknown as Catalog;
  const issue = {
    issue_date: "2026-12-03",
    subject: "Snow Saturday, sledding Sunday",
    preview: "An Indoor pick for the snow.",
    hello: { text: "Saturday's forecast calls for 4 to 6 inches of snow." },
    wheel_pick: {
      park: "juniper-park-bend",
      why_now: "Now.",
      who_for: "All.",
      bring: "Sleds.",
    },
    plan_b: {
      kind: "venue",
      venue_id: "venue-high-desert-museum",
      for_day: "2026-12-05",
      why_kids:
        "Live river otters and a porcupine, plus walk-through history exhibits",
      hours: "10 am to 4 pm",
      cost: "$12 for ages 3 to 12, $20 for adults; 2 and under free",
      tip: "Go after 10 am, once Highway 97 has been plowed",
      closer_to_home: ["Redmond Library", "Sisters Library", "La Pine Library"],
      evidence: [],
    },
    dress: { tip_id: "dress-mittens" },
    passport: { challenge_id: "c", text: "Stamp it." },
    signoff: { text: "Hit reply." },
  } as unknown as Issue;
  const opts = {
    catalog,
    site: "https://parkroulette.quest",
    number: 4,
    park: () => ({ name: "Juniper Park", city: "Bend" }),
    links: "direct" as const,
    unsubscribeUrl: null,
    postalAddress: null,
  };
  it("lays out each field on its own line, led by its plain label", () => {
    const html = renderHtml(issue, opts);
    expect(html).toContain("Indoor pick, for Saturday");
    expect(html).toContain('href="https://www.highdesertmuseum.org/"');
    expect(html).toContain("15 minutes from downtown.");
    for (const line of [
      "<b>Why it works for kids:</b> Live river otters",
      "<b>Ages:</b> All ages.",
      "<b>Open:</b> 10 am to 4 pm.",
      "<b>Cost:</b> $12 for ages 3 to 12",
      "<b>How long:</b> about 2 and a half hours.",
      "<b>Make it work:</b> Go after 10 am",
      "<b>Closer to home:</b> Redmond Library, Sisters Library, La Pine Library.",
      "<b>Dress for it:</b> Mittens beat gloves",
    ])
      expect(html).toContain(line);
    expect(html).not.toContain("Indoor backup");
    const text = renderText(issue, opts);
    expect(text).toContain("INDOOR PICK, FOR SATURDAY");
    expect(text).toContain("Ages: All ages.");
    expect(text).toContain("Dress for it: Mittens beat gloves");
  });
  it("shortens the third Indoor pick in a row to one line", () => {
    const short = {
      ...issue,
      plan_b: { ...issue.plan_b!, short: true },
    } as Issue;
    const html = renderHtml(short, opts);
    expect(html).toContain("<b>Indoor pick:</b> <a");
    // One label, not two.
    expect(html.match(/Indoor pick(?! for the snow)/g)).toHaveLength(1);
    expect(html).toContain("High Desert Museum</a>, for Saturday.");
    expect(html).not.toContain("Why it works for kids");
  });
  it('never doubles a sentence\'s end ("Free!.")', () => {
    const free = {
      ...issue,
      plan_b: { ...issue.plan_b!, cost: "Free!", tip: "Arrive early." },
    } as Issue;
    const html = renderHtml(free, opts);
    expect(html).toContain("<b>Cost:</b> Free!</");
    expect(html).toContain("<b>Make it work:</b> Arrive early.</");
  });
  it("words the visit length plainly", () => {
    expect(visitLength(60)).toBe("about 60 minutes");
    expect(visitLength(90)).toBe("about 90 minutes");
    expect(visitLength(120)).toBe("about 2 hours");
    expect(visitLength(150)).toBe("about 2 and a half hours");
  });
});

describe("the Featured park heading", () => {
  it("never says park twice", () => {
    expect(shortParkName("Larkspur Park")).toBe("Larkspur");
    expect(featuredHeading("Larkspur Park")).toBe("Featured park: Larkspur");
    expect(shortParkName("Pine Nursery Park")).toBe("Pine Nursery");
    expect(shortParkName("Farewell Bend Park  ")).toBe("Farewell Bend");
    expect(shortParkName("Big Sky park")).toBe("Big Sky");
  });
  it("keeps names that don't end in Park", () => {
    expect(featuredHeading("Hollinshead Barn")).toBe(
      "Featured park: Hollinshead Barn",
    );
    expect(shortParkName("Park at the Pines")).toBe("Park at the Pines");
    expect(shortParkName("Parkway Commons")).toBe("Parkway Commons");
    expect(shortParkName("Skatepark")).toBe("Skatepark");
    // A name that is only "Park" stays whole.
    expect(shortParkName("Park")).toBe("Park");
  });
});

describe("the weekend forecast from NWS", () => {
  const period = (
    startTime: string,
    isDaytime: boolean,
    temperature: number,
    shortForecast: string,
    pop: number | null = null,
  ) => ({
    startTime,
    isDaytime,
    temperature,
    shortForecast,
    windSpeed: "5 mph",
    probabilityOfPrecipitation: { value: pop },
  });
  it("takes Friday to Sunday in the card's words, with the night's low", () => {
    const days = weekendForecast("2026-12-03", [
      period("2026-12-03T06:00:00-08:00", true, 40, "Sunny"),
      period("2026-12-04T06:00:00-08:00", true, 41, "Sunny", 0),
      period("2026-12-04T18:00:00-08:00", false, 17, "Clear"),
      period("2026-12-05T06:00:00-08:00", true, 30, "Snow Showers Likely", 70),
      period("2026-12-05T18:00:00-08:00", false, 18, "Snow"),
    ]);
    expect(
      days?.map((d) => [
        d.label,
        d.condition,
        d.icon,
        d.high,
        d.low,
        d.precip,
        !!d.missing,
      ]),
    ).toEqual([
      ["Friday", "Sunny", "sun", 41, 17, 0, false],
      ["Saturday", "Snow showers", "snow", 30, 18, 70, false],
      ["Sunday", "", "cloudy", null, null, null, true],
    ]);
    expect(weekendForecast("2026-12-03", [])).toBeNull();
  });
});

describe("bot checks (we report them, never get past them)", () => {
  it("names a Sucuri or Cloudflare challenge, and a redirect with nowhere to go", async () => {
    const { botWall } = await import("./fetcher");
    expect(
      botWall(
        307,
        "Sucuri/Cloudproxy",
        "<script>var sucuri_cloudproxy_js=''</script>",
      ),
    ).toMatch(/Sucuri/);
    expect(botWall(403, "cloudflare", "<div id=cf-chl-widget>")).toMatch(
      /Cloudflare/,
    );
    expect(botWall(307, "nginx", "")).toMatch(/nowhere to go/);
    expect(botWall(404, "nginx", "Not found")).toBeNull();
  });
});

describe("quotes match pages whatever their entities", () => {
  it("decodes entities before it straightens dashes and quotes", async () => {
    const { normalizeText } = await import("./validate");
    expect(normalizeText("10 am &#8211; 2 pm")).toBe("10 am - 2 pm");
    expect(normalizeText("10 am &ndash; 2 pm")).toBe("10 am - 2 pm");
    expect(normalizeText("10 am – 2 pm")).toBe("10 am - 2 pm");
    expect(normalizeText("Kids&#x2019; day&nbsp;out")).toBe("Kids' day out");
    expect(normalizeText("R&amp;D &amp;ndash; text")).toBe("R&D &ndash; text");
  });
});

describe("the writer's date rule (batch 6 item 2)", () => {
  it("refuses today's draft once the 7:00 send window has started", async () => {
    const { issueDateProblem, SEND_CUTOFF_MINUTES } = await import("./http");
    const at = (iso: string) =>
      issueDateProblem("2026-12-03", new Date(iso), {
        cutoffMinutes: SEND_CUTOFF_MINUTES,
        nextIssueDate: "2026-12-10",
      });
    expect(at("2026-12-03T14:59:00Z")).toBeNull(); // 6:59 am Pacific
    expect(at("2026-12-03T15:00:00Z")).toBe(
      "That Thursday's send window has started. Draft for next_issue_date (2026-12-10).",
    ); // 7:00 am
    expect(at("2026-12-04T02:23:00Z")).toMatch(/send window has started/); // 6:23 pm
    // The next Thursday is fine at 6:23 pm.
    expect(
      issueDateProblem("2026-12-10", new Date("2026-12-04T02:23:00Z"), {
        cutoffMinutes: SEND_CUTOFF_MINUTES,
      }),
    ).toBeNull();
    // The plan route passes no cutoff: today stays readable.
    expect(
      issueDateProblem("2026-12-03", new Date("2026-12-04T02:23:00Z")),
    ).toBeNull();
  });

  it("plans one week at a time (7 days, not 8)", async () => {
    const { issueDateProblem } = await import("./http");
    const now = new Date("2026-12-03T20:00:00Z");
    expect(issueDateProblem("2026-12-10", now)).toBeNull();
    expect(issueDateProblem("2026-12-17", now)).toMatch(/Too far ahead/);
    expect(issueDateProblem("2026-11-26", now)).toMatch(/has passed/);
    expect(issueDateProblem("2026-12-04", now)).toMatch(/Thursday/);
  });
});

describe("the writer's date rule in daylight time (PDT)", () => {
  it("cuts off at 7:00 PDT, not 7:00 PST", async () => {
    const { issueDateProblem, SEND_CUTOFF_MINUTES } = await import("./http");
    const at = (iso: string) =>
      issueDateProblem("2027-06-03", new Date(iso), {
        cutoffMinutes: SEND_CUTOFF_MINUTES,
      });
    expect(at("2027-06-03T13:59:00Z")).toBeNull(); // 6:59 am PDT
    expect(at("2027-06-03T14:00:00Z")).toMatch(/send window has started/); // 7:00 am PDT
  });
});
