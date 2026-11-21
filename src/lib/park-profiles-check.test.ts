import { describe, expect, it, vi } from "vitest";

const alerts = vi.hoisted(() => ({ sent: [] as { text: string }[] }));
vi.mock("@/lib/alerts", () => ({
  alertLater: (a: { text: string }) => alerts.sent.push(a),
}));
vi.mock("@/lib/news/fetcher", () => ({ fetchPage: async () => null }));

import type { ParkProfile } from "./park-profiles";
import {
  evidencePages,
  pagesForDay,
  recheckProfiles,
  SPREAD_DAYS,
} from "./park-profiles-check";

const profile = (url: string, quote: string): ParkProfile => ({
  place_id: null,
  traits: [
    {
      text: "A pirate ship to climb",
      kind: "signature_structure",
      source: "official",
      evidence: [{ url, quote }],
      verified_on: "2026-11-21",
    },
  ],
  one_liner: "A pirate ship to climb.",
  facts: {},
});

describe("the monthly evidence re-check", () => {
  it("checks every real evidence page once over days 1 to 28", () => {
    const pages = evidencePages();
    const seen = Array.from({ length: 31 }, (_, d) =>
      pagesForDay(pages, d + 1),
    ).flat();
    expect(seen).toHaveLength(pages.length);
    expect(new Set(seen.map((p) => p.url)).size).toBe(pages.length);
    expect(pagesForDay(pages, 29)).toEqual([]);
    expect(
      Math.max(
        ...Array.from(
          { length: SPREAD_DAYS },
          (_, d) => pagesForDay(pages, d + 1).length,
        ),
      ),
    ).toBeLessThanOrEqual(5);
  });
  it("flags a quote that's gone, and shrugs at a bot wall", async () => {
    const profiles = new Map([
      [
        "a-park",
        profile("https://example.org/a", "the SS Columbia ship-like structure"),
      ],
      [
        "b-park",
        profile("https://example.org/b", "a big wooden boat for climbing"),
      ],
    ]);
    const fetcher = async (url: string) =>
      url.endsWith("/a")
        ? { status: 200, finalUrl: url, text: "The page changed completely." }
        : { status: 403, finalUrl: url, text: "", blocked: "cloudflare" };
    const r1 = await recheckProfiles(1, { fetcher, profiles });
    const r2 = await recheckProfiles(2, { fetcher, profiles });
    expect(r1.missing).toEqual([
      {
        slug: "a-park",
        trait: "A pirate ship to climb",
        url: "https://example.org/a",
      },
    ]);
    expect(r2.unknown).toEqual(["https://example.org/b"]);
    expect(alerts.sent).toHaveLength(1);
    expect(alerts.sent[0].text).toMatch(/a-park/);
  });
  it("passes a page that still prints the quote", async () => {
    const profiles = new Map([
      [
        "a-park",
        profile("https://example.org/a", "the SS Columbia ship-like structure"),
      ],
    ]);
    const r = await recheckProfiles(1, {
      profiles,
      fetcher: async (url) => ({
        status: 200,
        finalUrl: url,
        text: "Here is the SS Columbia ship-like structure, a favorite.",
      }),
    });
    expect(r).toEqual({ checked: 1, missing: [], unknown: [] });
  });
});
