import { describe, expect, it, vi } from "vitest";

// The sitemap and llms.txt, with the data loaders stubbed (no database).
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/seo-data", async (orig) => ({
  ...(await orig<typeof import("@/lib/seo-data")>()),
  publicParks: async () => [
    {
      id: 1,
      slug: "alpenglow-park-bend",
      name: "Alpenglow Park",
      city: "Bend",
      lat: 44.03,
      lng: -121.29,
      kind: "park",
      features: ["splash_pad"],
      confidence: "confirmed",
      avgTenths: null,
      reviewCount: 0,
      lastVisit: null,
      visitCount: 0,
      reports: {},
      play: "playground",
      notes: null,
      status: "active",
      statusNote: null,
      approved: true,
      updated: "2026-10-02",
    },
  ],
}));
vi.mock("@/lib/news/data", () => ({ sentIssues: async () => [] }));
vi.mock("@/lib/events/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/events/store")>()),
  allEvents: async () => [],
}));
vi.mock("@/lib/park-profiles-check", async () => {
  const { PROFILES } = await import("@/lib/park-profiles");
  return { currentProfiles: async () => PROFILES };
});
vi.mock("@/db", () => ({ db: {} }));

import { GUIDES } from "@/lib/guides";
import sitemap from "../sitemap";
import { GET as llms } from "../llms.txt/route";

describe("guides in the sitemap and llms.txt", () => {
  it("lists /guides and every guide, with a real lastmod from data", async () => {
    const map = await sitemap();
    const urls = map.map((e) => e.url);
    expect(urls).toContain("https://parkroulette.quest/guides");
    for (const g of GUIDES)
      expect(urls).toContain(`https://parkroulette.quest/guides/${g.slug}`);
    const splash = map.find((e) => e.url.endsWith("/guides/splash-pads-bend"));
    // The park's change day or its trait's check day, never "now".
    expect(splash?.lastModified).toBeInstanceOf(Date);
    expect((splash!.lastModified as Date).toISOString().slice(0, 10)).toMatch(
      /^2026-(10-02|11-\d\d)$/,
    );
  });

  it("puts every guide in llms.txt", async () => {
    const text = await (await llms()).text();
    expect(text).toContain("## Seasonal guides");
    for (const g of GUIDES) expect(text).toContain(`/guides/${g.slug}`);
  });
});
