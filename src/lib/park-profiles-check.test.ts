import { beforeEach, describe, expect, it, vi } from "vitest";

const alerts = vi.hoisted(() => ({
  sent: [] as { key: string; text: string; everyMinutes?: number }[],
}));
vi.mock("@/lib/alerts", () => ({
  sendAlert: async (a: {
    key: string;
    text: string;
    everyMinutes?: number;
  }) => {
    alerts.sent.push(a);
    return "sent";
  },
}));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  revalidateTag: () => {},
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
  glance: null,
  glance_source: null,
  glance_on: null,
  facts: {},
});

function memStore(): CheckStore & { rows: Map<string, CheckRow> } {
  const rows = new Map<string, CheckRow>();
  return {
    rows,
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
  it("drops a trait only after 2 misses in a row, re-checks misses nightly, and clears on a hit", async () => {
    const profiles = new Map([
      ["a-park", profile("https://example.org/a", QA)],
    ]);
    const store = memStore();
    let text = "The page changed completely.";
    const fetcher = async (url: string) => res({ finalUrl: url, text });
    const opts = { fetcher, profiles, store };
    const r1 = await recheckProfiles(1, opts);
    expect(r1.missing).toHaveLength(1);
    expect(r1.dropped).toEqual([]);
    expect(store.rows.get("https://example.org/a")!.missStreak).toBe(1);
    expect(alerts.sent).toHaveLength(0);
    // Day 2 isn't a's day, but a miss is re-checked every night.
    const r2 = await recheckProfiles(2, opts);
    expect(r2.checked).toBe(1);
    expect(r2.dropped).toEqual([
      {
        slug: "a-park",
        trait: "A pirate ship to climb",
        url: "https://example.org/a",
      },
    ]);
    expect(alerts.sent).toHaveLength(1);
    expect(alerts.sent[0].key).toBe("park-profiles");
    expect(alerts.sent[0].everyMinutes).toBe(7 * 24 * 60);
    expect(alerts.sent[0].text).toMatch(/a-park/);
    expect(store.rows.get("https://example.org/a")!.notifiedAt).not.toBeNull();
    // Already told: no second email while it stays missing.
    await recheckProfiles(3, opts);
    expect(alerts.sent).toHaveLength(1);
    // A bot wall in between neither confirms nor clears.
    const walled = async (url: string) =>
      res({ status: 403, finalUrl: url, blocked: "cloudflare" });
    await recheckProfiles(4, { ...opts, fetcher: walled });
    expect(store.rows.get("https://example.org/a")!.status).toBe("missing");
    // The quote is back: cleared.
    text = `Here is ${QA}.`;
    const r5 = await recheckProfiles(5, opts);
    expect(r5.dropped).toEqual([]);
    expect(store.rows.get("https://example.org/a")).toMatchObject({
      status: "ok",
      missStreak: 0,
      notifiedAt: null,
    });
  });
  it("mentions a page unknown 2 checks in a row, and retries a notice the window swallowed", async () => {
    const profiles = new Map([
      ["b-park", profile("https://example.org/b", QB)],
    ]);
    const store = memStore();
    const fetcher = async (url: string) =>
      res({ status: 403, finalUrl: url, blocked: "cloudflare" });
    let outcome: "sent" | "suppressed" = "suppressed";
    const sent: string[] = [];
    const notify = async (a: { text: string }) => {
      if (outcome === "sent") sent.push(a.text);
      return outcome;
    };
    const day = pagesForDay(evidencePages(profiles), 1).length ? 1 : 2;
    const opts = { fetcher, profiles, store, notify };
    const r1 = await recheckProfiles(day, opts);
    expect(r1.stuck).toEqual([]);
    expect(r1.notice).toBeNull();
    const r2 = await recheckProfiles(day, opts);
    expect(r2.stuck).toEqual(["https://example.org/b"]);
    expect(r2.notice).toBe("suppressed");
    expect(store.rows.get("https://example.org/b")!.notifiedAt).toBeNull();
    // Next month the window is open: the swallowed notice goes out.
    outcome = "sent";
    const r3 = await recheckProfiles(day, opts);
    expect(r3.notice).toBe("sent");
    expect(sent[0]).toMatch(/example\.org\/b/);
    // Told once: a fourth unknown sends nothing.
    const r4 = await recheckProfiles(day, opts);
    expect(r4.notice).toBeNull();
    expect(store.rows.get("https://example.org/b")!.unknownStreak).toBe(4);
  });
  it("lists Google-sourced traits and glances aging out within 30 days, on the 1st only", async () => {
    const base = profile("https://example.org/c", QA);
    const profiles = new Map([
      [
        "c-park",
        {
          ...base,
          traits: [
            ...base.traits,
            {
              text: "A hillside slide",
              keys: ["hillside slide"],
              kind: "signature_structure" as const,
              source: "google_places" as const,
              evidence: [],
              verified_on: "2025-12-10",
            },
          ],
          glance: "A pirate ship and a hillside slide.",
          glance_source: "both" as const,
          glance_on: "2025-12-20",
        },
      ],
    ]);
    const store = memStore();
    const fetcher = async (url: string) => res({ finalUrl: url, text: QA });
    const sent: string[] = [];
    const notify = async (a: { text: string }) => {
      sent.push(a.text);
      return "sent" as const;
    };
    const now = new Date("2026-12-01T12:00:00Z");
    const opts = { fetcher, profiles, store, notify, now };
    const r2 = await recheckProfiles(2, opts);
    expect(r2.expiring).toHaveLength(2);
    expect(sent).toEqual([]);
    const r1 = await recheckProfiles(1, opts);
    expect(r1.notice).toBe("sent");
    expect(sent[0]).toMatch(/c-park: trait: A hillside slide \(2026-12-10\)/);
    expect(sent[0]).toMatch(/c-park: glance: .* \(2026-12-20\)/);
    const later = await recheckProfiles(1, {
      ...opts,
      now: new Date("2026-06-01T12:00:00Z"),
    });
    expect(later.expiring).toEqual([]);
  });
  it("drops a trait whose quote is confirmed gone from the live profiles", async () => {
    const store = memStore();
    const now = new Date("2026-11-21T12:00:00Z");
    const col = (await currentProfiles(now, store)).get("columbia-park-bend")!;
    const ship = col.traits[0];
    const row = {
      url: ship.evidence[0].url,
      status: "missing" as const,
      missingQuotes: [ship.evidence[0].quote],
      unknownStreak: 0,
      notifiedAt: null,
    };
    await store.save([{ ...row, missStreak: 1 }]);
    expect(
      (await currentProfiles(now, store)).get("columbia-park-bend")!.traits,
    ).toContainEqual(ship);
    await store.save([{ ...row, missStreak: 2 }]);
    const after = (await currentProfiles(now, store)).get(
      "columbia-park-bend",
    )!;
    expect(after.traits).not.toContainEqual(ship);
    expect(after.one_liner).toBeNull();
  });
});
