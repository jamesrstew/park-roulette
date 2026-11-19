import { describe, expect, it } from "vitest";
import { allowedLink, CATALOG, seasonalDefault } from "./catalog";

describe("news catalog", () => {
  it("parses, with unique ids and allowlisted links", () => {
    const items = [
      ...CATALOG.venues,
      ...CATALOG.event_series,
      ...CATALOG.tips,
      ...CATALOG.challenges,
    ];
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of [...CATALOG.venues, ...CATALOG.event_series])
      expect(allowedLink(v.url, CATALOG.link_domains), v.url).toBe(true);
  });
  it("matches links to a domain or its subdomains, https only", () => {
    const d = ["bendparksandrec.org"];
    expect(allowedLink("https://www.bendparksandrec.org/x", d)).toBe(true);
    expect(allowedLink("https://bendparksandrec.org", d)).toBe(true);
    expect(allowedLink("http://bendparksandrec.org", d)).toBe(false);
    expect(allowedLink("https://evilbendparksandrec.org", d)).toBe(false);
    expect(allowedLink("https://bendparksandrec.org.evil.com", d)).toBe(false);
  });
  it("knows the seasonal defaults", () => {
    const d = CATALOG.seasonal_defaults;
    expect(
      seasonalDefault("The splash pad is off for the season", 11, d),
    ).not.toBeNull();
    expect(
      seasonalDefault("The splash pad is off for the season", 7, d),
    ).toBeNull();
    expect(seasonalDefault("New swings went in", 11, d)).toBeNull();
  });
});
