import { describe, expect, it } from "vitest";
import { septets } from "./texts";
import {
  beforeWindow,
  composeText,
  confirmWindowOpen,
  dryRunText,
  fitWords,
  guardrailTrips,
  hookFor,
  SITE,
  textProblems,
  US_ZONES,
  weekendText,
  windowMissed,
  windowOpen,
  zonesFor,
} from "./weekend-pick";

const park = (over: Partial<Parameters<typeof composeText>[0]> = {}) => ({
  name: "Wildflower Park",
  city: "Bend",
  slug: "wildflower-park-bend",
  features: ["toddler_area", "fenced"],
  status: "active",
  ...over,
});

describe("the Weekend Pick text", () => {
  it("follows the template, in GSM-7, 160 characters at most", () => {
    const t = composeText(park(), null, 12)!;
    expect(t).toBe(
      "Park Roulette: Weekend Pick: Wildflower Park, Bend. Fenced toddler area. https://parkroulette.quest/parks/wildflower-park-bend Reply STOP to opt out",
    );
    expect(textProblems(t)).toBeNull();
    const snowy = composeText(
      park({
        name: "Pine Nursery Park",
        slug: "pine-nursery-park-bend",
        features: ["accessible", "restrooms", "swings", "slides"],
      }),
      "Snowy weekend?",
      12,
    )!;
    expect(
      snowy.startsWith(
        "Park Roulette: Weekend Pick: Snowy weekend? Pine Nursery Park, Bend.",
      ),
    ).toBe(true);
    expect(snowy.length).toBeLessThanOrEqual(160);
  });
  it("adds fit words in order while they fit, and skips when none do", () => {
    expect(
      fitWords(
        ["restrooms", "swings", "spinny", "toddler_area", "splash_pad"],
        12,
      ),
    ).toEqual(["Toddler area", "Swings", "Spinny things", "Restrooms"]);
    expect(fitWords(["splash_pad"], 7)).toEqual(["Splash pad"]);
    expect(
      composeText(
        park({
          features: ["swings", "spinny", "restrooms"],
          name: "Juniper Park",
          slug: "juniper-park-bend",
        }),
        null,
        1,
      ),
    ).toContain("Swings, spinny things, restrooms.");
    expect(composeText(park({ features: [] }), null, 1)).toBeNull();
    expect(composeText(park({ status: "closed" }), null, 1)).toBeNull();
    const long = composeText(
      park({
        name: "A Very Long Park Name That Goes On And On Memorial Grounds",
        slug: "a-very-long-park-name-that-goes-on-and-on-memorial-grounds-bend",
        features: ["toddler_area", "swings", "slides", "restrooms"],
      }),
      null,
      1,
    );
    expect(long === null || long.length <= 160).toBe(true);
  });
  it("uses a weather word only when the issue and Friday's forecast agree", () => {
    const snow = { short: "Snow Likely", labels: ["snow", "cold"] };
    expect(hookFor({ icon: "snow" }, snow)).toBe("Snowy weekend?");
    expect(
      hookFor({ icon: "snow" }, { short: "Partly Cloudy", labels: [] }),
    ).toBeNull();
    expect(hookFor({ icon: "cloudy" }, snow)).toBeNull();
    expect(hookFor({ icon: "sun" }, { short: "Sunny", labels: [] })).toBe(
      "Sunny weekend?",
    );
    expect(
      hookFor({ icon: "sun" }, { short: "Mostly Clear", labels: [] }),
    ).toBe("Sunny weekend?");
    expect(
      hookFor({ icon: "sun" }, { short: "Chance Rain", labels: ["rain"] }),
    ).toBeNull();
    expect(hookFor(null, snow)).toBeNull();
  });
  it("gives no sunny word for partly sunny, cold or smoke (L4)", () => {
    expect(
      hookFor({ icon: "sun" }, { short: "Partly Sunny", labels: [] }),
    ).toBeNull();
    expect(
      hookFor({ icon: "sun" }, { short: "Sunny", labels: ["cold"] }),
    ).toBeNull();
    expect(
      hookFor({ icon: "sun" }, { short: "Sunny", labels: ["smoke"] }),
    ).toBeNull();
  });
  it("drops the weather word rather than the week (M1)", () => {
    // 146 characters without the word, 161 with it.
    const p = park({
      name: "B".repeat(34),
      slug: "b-bend",
      features: ["toddler_area"],
    });
    expect(composeText(p, "Snowy weekend?", 1)).toBeNull();
    const t = weekendText(p, "Snowy weekend?", 1);
    expect(t).not.toBeNull();
    expect(t).not.toContain("Snowy");
    // With room, the word stays.
    expect(
      weekendText(
        park({ name: "Pine Park", slug: "pine" }),
        "Sunny weekend?",
        1,
      ),
    ).toContain("Sunny weekend?");
  });
  it("counts septets and maps curly quotes and dashes to ASCII (L2)", () => {
    expect(septets("abc")).toBe(3);
    expect(septets("a[b]~")).toBe(8);
    // 160 characters, but "[" takes two septets: 161.
    const t = `Park Roulette: [ ${SITE}/parks/a ${"x".repeat(86)} Reply STOP to opt out`;
    expect(t.length).toBe(160);
    expect(textProblems(t)).toBe("over 160 characters");
    const curly = composeText(
      park({ name: "Kids’ Corner – North", features: ["swings"] }),
      null,
      1,
    );
    expect(curly).toContain("Kids' Corner - North");
    expect(textProblems(curly!)).toBeNull();
  });
  it("marks a dry run only when the STOP line still fits (M4)", () => {
    const short = composeText(park(), null, 1)!;
    expect(dryRunText(short)).toBe(`[Dry run] ${short}`);
    const long = composeText(
      park({
        name: "B".repeat(40),
        slug: "b-bend",
        features: ["toddler_area"],
      }),
      null,
      1,
    )!;
    expect(long.length).toBe(152);
    expect(dryRunText(long)).toBe(long);
  });
});

describe("when a number gets its text", () => {
  const OR = "+15415550123";
  const NY = "+12125550123";
  it("places Pacific area codes, and keeps unknown ones inside every US zone", () => {
    expect(zonesFor(OR)).toEqual(["America/Los_Angeles"]);
    expect(zonesFor(NY).length).toBeGreaterThan(1);
  });
  it("sends Fridays from 3:30 to 5 pm Pacific, in PST and PDT (M2)", () => {
    // Friday, December 4, 2026 (PST is UTC-8).
    expect(windowOpen(new Date("2026-12-04T23:00:00Z"))).toBe(false); // 3:00 pm
    expect(beforeWindow(new Date("2026-12-04T23:00:00Z"))).toBe(true);
    expect(windowOpen(new Date("2026-12-04T23:30:00Z"))).toBe(true); // 3:30 pm
    expect(windowOpen(new Date("2026-12-05T00:59:00Z"))).toBe(true); // 4:59 pm
    expect(windowOpen(new Date("2026-12-05T01:00:00Z"))).toBe(false); // 5 pm
    expect(windowMissed(new Date("2026-12-05T01:00:00Z"))).toBe(true);
    // Friday, June 4, 2027 (PDT is UTC-7).
    expect(windowOpen(new Date("2027-06-04T22:29:00Z"))).toBe(false); // 3:29 pm
    expect(windowOpen(new Date("2027-06-04T22:30:00Z"))).toBe(true); // 3:30 pm
    expect(windowOpen(new Date("2027-06-04T23:59:00Z"))).toBe(true); // 4:59 pm
    expect(windowMissed(new Date("2027-06-05T00:00:00Z"))).toBe(true); // 5 pm
    // Not Friday.
    expect(windowOpen(new Date("2026-12-03T23:30:00Z"))).toBe(false);
  });
  it("keeps the program window inside 8 am to 8 pm in every US zone, Hawaii included", () => {
    // The window's edges, both seasons: 3:30 pm and 4:59 pm Pacific.
    for (const t of [
      "2026-12-04T23:30:00Z",
      "2026-12-05T00:59:00Z",
      "2027-06-04T22:30:00Z",
      "2027-06-04T23:59:00Z",
    ])
      for (const zone of US_ZONES) {
        const h = Number(
          new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            hour: "numeric",
            hourCycle: "h23",
          }).format(new Date(t)),
        );
        expect(h >= 8 && h < 20, `${zone} at ${t}`).toBe(true);
      }
  });
  it("sends confirmations 8 am to 5 pm Pacific, and in the number's own morning (H3)", () => {
    // Thursday, December 3, 2026, PST.
    expect(confirmWindowOpen(OR, new Date("2026-12-03T15:59:00Z"))).toBe(false); // 7:59 am
    expect(confirmWindowOpen(OR, new Date("2026-12-03T16:00:00Z"))).toBe(true); // 8 am
    expect(confirmWindowOpen(OR, new Date("2026-12-04T00:59:00Z"))).toBe(true); // 4:59 pm
    expect(confirmWindowOpen(OR, new Date("2026-12-04T01:00:00Z"))).toBe(false); // 5 pm
    expect(confirmWindowOpen(OR, new Date("2026-12-03T11:17:00Z"))).toBe(false); // 3:17 am
    // A Hawaii number (808): 8 am Pacific is 6 am there.
    const HI = "+18085550123";
    expect(confirmWindowOpen(HI, new Date("2026-12-03T16:00:00Z"))).toBe(false);
    expect(confirmWindowOpen(HI, new Date("2026-12-03T18:17:00Z"))).toBe(true); // 8:17 am HST
    // PDT: 8 am Pacific is 5 am in Hawaii; 18:17 UTC is 8:17 am there.
    expect(confirmWindowOpen(HI, new Date("2027-06-03T15:00:00Z"))).toBe(false);
    expect(confirmWindowOpen(HI, new Date("2027-06-03T18:17:00Z"))).toBe(true);
    expect(confirmWindowOpen(OR, new Date("2027-06-03T15:00:00Z"))).toBe(true); // 8 am PDT
  });
  it("pauses after two sends above 1% STOP", () => {
    expect(guardrailTrips([0.02, 0.015])).toBe(true);
    expect(guardrailTrips([0.02, 0.005])).toBe(false);
    expect(guardrailTrips([0.02])).toBe(false);
  });
});
