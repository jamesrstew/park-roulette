import { beforeEach, describe, expect, it, vi } from "vitest";

const alerts = vi.hoisted(() => ({
  sent: [] as { key: string; text: string; everyMinutes?: number }[],
}));
vi.mock("@/lib/alerts", () => ({
  alertLater: (a: { key: string; text: string; everyMinutes?: number }) =>
    alerts.sent.push(a),
}));
vi.mock("@/lib/news/fetcher", () => ({ fetchPage: async () => null }));
vi.mock("@/db", () => ({ db: {} }));

import type { FetchResult } from "@/lib/news/validate";
import type { ParkProfile } from "./park-profiles";
import {
  type CheckRow,
  type CheckStore,
  checkPages,
  currentProfiles,
  evidencePages,
  judge,
  pagesForDay,
  recheckProfiles,
  SPREAD_DAYS,
} from "./park-profiles-check";

const QA = "the SS Columbia ship-like structure";
const QB = "a big wooden boat for climbing";

const profile = (url: string, quote: string): ParkProfile => ({
  place_id: null,
  traits: [
    {
      text: "A pirate ship to climb",
      keys: ["pirate ship"],
      kind: "signature_structure",
      source: "official",
      evidence: [{ url, quote }],
      verified_on: "2026-11-21",
    },
  ],
  one_liner: "A pirate ship to climb.",
  facts: {},
});

function memStore(): CheckStore & { rows: Map<string, CheckRow> } {
  const rows = new Map<string, CheckRow>();
  return {
    rows,
    async load(urls) {
      return urls.flatMap((u) => (rows.has(u) ? [rows.get(u)!] : []));
    },
    async save(list) {
      for (const r of list) rows.set(r.url, r);
    },
    async all() {
      return [...rows.values()];
    },
  };
}

const page = (url: string, quote: string) => ({
  url,
  items: [{ slug: "a-park", trait: "A pirate ship to climb", quote }],
});
const res = (over: Partial<FetchResult>): FetchResult => ({
  status: 200,
  finalUrl: "https://example.org/a",
  text: "",
  ...over,
});

beforeEach(() => {
  alerts.sent.length = 0;
});

describe("judging a fetch", () => {
  const p = page("https://example.org/a", QA);
  it("missing: only a 200 without the quote, or a 404 or 410", () => {
    expect(judge(p, res({ text: "Something else." })).status).toBe("missing");
    expect(judge(p, res({ status: 404 })).status).toBe("missing");
    expect(judge(p, res({ status: 410 })).status).toBe("missing");
    expect(judge(p, res({ text: `Here is ${QA}.` })).status).toBe("ok");
  });
  it("unknown: anything else", () => {
    for (const r of [
      res({ status: 403 }),
      res({ status: 429 }),
      res({ status: 0, unreachable: "timed out" }),
      res({ status: 310 }),
      res({ status: 503 }),
      res({ status: 200, text: "" }), // over 2 MB
      res({ status: 200, text: "x", blocked: "cloudflare" }),
      null,
    ])
      expect(judge(p, r).status, JSON.stringify(r)).toBe("unknown");
  });
});

describe("the monthly evidence re-check", () => {
  it("checks every real evidence page once over days 1 to 28, a few a night", () => {
    const pages = evidencePages();
    const seen = Array.from({ length: 31 }, (_, d) =>
      pagesForDay(pages, d + 1),
    ).flat();
    expect(seen).toHaveLength(pages.length);
    expect(new Set(seen.map((p) => p.url)).size).toBe(pages.length);
    expect(pagesForDay(pages, 29)).toEqual([]);
    const most = Math.max(
      ...Array.from(
        { length: SPREAD_DAYS },
        (_, d) => pagesForDay(pages, d + 1).length,
      ),
    );
    expect(most).toBeLessThanOrEqual(5);
  });
  it("fetches in parallel and calls whatever misses the deadline unknown", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = async (url: string): Promise<FetchResult> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, url.endsWith("/slow") ? 500 : 20));
      inFlight--;
      return res({ finalUrl: url, text: QA });
    };
    const pages = [
      page("https://a.example/1", QA),
      page("https://b.example/2", QA),
      page("https://c.example/3", QA),
      page("https://d.example/slow", QA),
    ];
    const got = await checkPages(pages, slow, Date.now() + 150);
    expect(peak).toBeGreaterThan(1);
    expect(got.find((r) => r.url.endsWith("/slow"))!.status).toBe("unknown");
    expect(got.filter((r) => r.status === "ok")).toHaveLength(3);
  });
  it("records results, rolls misses into one weekly email, and tracks unknown streaks", async () => {
    const profiles = new Map([
      ["a-park", profile("https://example.org/a", QA)],
      ["b-park", profile("https://example.org/b", QB)],
    ]);
    const store = memStore();
    const fetcher = async (url: string) =>
      url.endsWith("/a")
        ? res({ finalUrl: url, text: "The page changed completely." })
        : res({ status: 403, finalUrl: url, blocked: "cloudflare" });
    const opts = { fetcher, profiles, store };
    const r1 = await recheckProfiles(1, opts);
    expect(r1.missing).toEqual([
      {
        slug: "a-park",
        trait: "A pirate ship to climb",
        url: "https://example.org/a",
      },
    ]);
    expect(store.rows.get("https://example.org/a")).toMatchObject({
      status: "missing",
      missingQuotes: [QA],
    });
    expect(alerts.sent).toHaveLength(1);
    expect(alerts.sent[0].key).toBe("park-profiles");
    expect(alerts.sent[0].everyMinutes).toBe(7 * 24 * 60);
    expect(alerts.sent[0].text).toMatch(/a-park/);

    // b: unknown once (no alert), then a second month in a row (one alert).
    alerts.sent.length = 0;
    const r2 = await recheckProfiles(2, opts);
    expect(r2.unknown).toEqual(["https://example.org/b"]);
    expect(r2.stuck).toEqual([]);
    expect(alerts.sent).toHaveLength(0);
    const r3 = await recheckProfiles(2, opts);
    expect(r3.stuck).toEqual(["https://example.org/b"]);
    expect(alerts.sent).toHaveLength(1);
    // The rolling email still lists a-park, missing since day 1.
    expect(alerts.sent[0].text).toMatch(/a-park/);
    expect(alerts.sent[0].text).toMatch(/example\.org\/b/);
    const r4 = await recheckProfiles(2, opts);
    expect(r4.stuck).toEqual([]);
    expect(store.rows.get("https://example.org/b")!.unknownStreak).toBe(3);
  });
  it("drops a trait whose quote is gone from the live profiles", async () => {
    const store = memStore();
    const live = await currentProfiles(new Date("2026-11-21T12:00:00Z"), store);
    const col = live.get("columbia-park-bend")!;
    const ship = col.traits[0];
    await store.save([
      {
        url: ship.evidence[0].url,
        status: "missing",
        missingQuotes: [ship.evidence[0].quote],
        unknownStreak: 0,
      },
    ]);
    const after = await currentProfiles(
      new Date("2026-11-21T12:00:00Z"),
      store,
    );
    expect(after.get("columbia-park-bend")!.traits).not.toContainEqual(ship);
    expect(after.get("columbia-park-bend")!.one_liner).toBeNull();
  });
});
