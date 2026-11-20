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

describe("weather and season v1 catalog fields", () => {
  it("knows each venue's enclosure, and The Pavilion is open-sided", () => {
    const v = (id: string) => CATALOG.venues.find((x) => x.id === id)!;
    expect(v("venue-the-pavilion").enclosure).toBe("covered");
    expect(v("venue-high-desert-museum").enclosure).toBe("indoor");
    expect(v("venue-sunriver-nature-center").covered).toBe(false);
    for (const x of CATALOG.venues.filter((x) => x.verified)) {
      expect(x.ages_label, x.id).toMatch(/\S/);
      expect(x.visit_minutes, x.id).toBeGreaterThan(0);
      expect(x.address, x.id).not.toBeNull();
    }
    // An address we couldn't confirm stays out of every pick.
    expect(v("venue-little-bug-play-hub")).toMatchObject({
      verified: false,
      address: null,
    });
  });
  it("has about 12 winter and 6 summer dress lines, each 120 characters at most", () => {
    const winter = CATALOG.dress_tips.filter((t) => t.months.includes(1));
    const summer = CATALOG.dress_tips.filter((t) => t.months.includes(7));
    expect(winter.length).toBeGreaterThanOrEqual(10);
    expect(summer.length).toBeGreaterThanOrEqual(6);
    for (const t of CATALOG.dress_tips)
      expect(t.text.length).toBeLessThanOrEqual(120);
  });
  it("covers every month in the seasonal calendar, and the rink and smoke seasons agree with the tips", () => {
    expect(CATALOG.season_calendar.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    const d = (id: string) =>
      CATALOG.seasonal_defaults.find((x) => x.id === id)!.months;
    expect(d("rink-season")).toEqual([10, 11, 12, 1, 2, 3]);
    expect(d("smoke-season")).toContain(10);
  });
  it("has school breaks through June 2027, verified or marked unverified", () => {
    const june = CATALOG.breaks.filter((b) => b.to >= "2027-06-15");
    expect(june.filter((b) => b.verified).length).toBeGreaterThanOrEqual(4);
    expect(
      CATALOG.breaks.find(
        (b) => b.district === "Bend-La Pine Schools" && b.from >= "2027-06-01",
      ),
    ).toMatchObject({ verified: false });
  });
});
