import { describe, expect, it } from "vitest";
import type { ForecastDay } from "./news/issue";
import { septets } from "./texts";
import {
  beforeWindow,
  betterDay,
  composeText,
  confirmWindowOpen,
  dateCode,
  dateFromCode,
  dryRunText,
  fitWords,
  guardrailTrips,
  issueLink,
  parkCode,
  parkIdFromCode,
  SITE,
  textDays,
  textProblems,
  tierFlipped,
  US_ZONES,
  weatherWords,
  weekendText,
  type WeekInput,
  windowMissed,
  windowOpen,
  zonesFor,
} from "./weekend-pick";

const park = (over: Partial<NonNullable<WeekInput["park"]>> = {}) => ({
  id: 1234,
  name: "Wildflower Park",
  city: "Bend",
  slug: "wildflower-park-bend",
  features: ["toddler_area", "fenced", "swings"],
  status: "active",
  ...over,
});

/** The card's three days: Friday to Sunday after the issue's Thursday. */
function card(
  thursday: string,
  sat: [string, ForecastDay["icon"], number, number?],
  sun: [string, ForecastDay["icon"], number, number?],
): ForecastDay[] {
  const d = (n: number) => {
    const t = new Date(`${thursday}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  return [
    {
      date: d(1),
      label: "Friday",
      condition: "Sunny",
      icon: "sun",
      high: 50,
      low: 30,
      precip: 0,
    },
    {
      date: d(2),
      label: "Saturday",
      condition: sat[0],
      icon: sat[1],
      high: sat[2],
      low: 20,
      precip: sat[3] ?? 0,
    },
    {
      date: d(3),
      label: "Sunday",
      condition: sun[0],
      icon: sun[1],
      high: sun[2],
      low: 20,
      precip: sun[3] ?? 0,
    },
  ];
}

describe("the Weekend Pick text (batch 6 samples)", () => {
  it("1. snowy: the better day, then the STOP line, then the link (147)", () => {
    const w = weekendText({
      issueDate: "2026-12-10",
      days: card(
        "2026-12-10",
        ["Snow", "snow", 29, 80],
        ["Mostly sunny", "sun", 36],
      ),
      tiers: { "2026-12-12": "disruptive", "2026-12-13": "plan_around" },
      park: park({
        name: "Pine Nursery Park",
        slug: "pine-nursery-park-bend",
        features: ["restrooms"],
      }),
      indoor: { name: "High Desert Museum", city: "Bend" },
    })!;
    expect(w.text).toBe(
      "Park Roulette: Snow Sat, 29. Sunny Sun, 36. Go Sunday: Pine Nursery Park, Bend. Restrooms. Reply STOP to opt out. https://parkroulette.quest/w/5lju",
    );
    expect(septets(w.text)).toBe(147);
    expect(w.update).toBeNull();
    expect(textProblems(w.text)).toBeNull();
  });
  it("2. sunny: one weather phrase for both days, Saturday on a tie (158)", () => {
    const w = weekendText({
      issueDate: "2026-12-03",
      days: card(
        "2026-12-03",
        ["Sunny", "sun", 47],
        ["Mostly sunny", "sun", 49],
      ),
      tiers: { "2026-12-05": "fine", "2026-12-06": "fine" },
      park: park(),
      indoor: null,
    })!;
    // Swings would make it 161: the fit words stop at what fits.
    expect(w.text).toBe(
      "Park Roulette: Sunny Sat and Sun, 47 and 49. Go Saturday: Wildflower Park, Bend. Fenced toddler area. Reply STOP to opt out. https://parkroulette.quest/w/5ljn",
    );
    expect(septets(w.text)).toBe(158);
  });
  it("3. smoky both days: the Indoor pick (140)", () => {
    const w = weekendText({
      issueDate: "2027-09-09",
      days: card("2027-09-09", ["Smoky", "smoke", 81], ["Smoky", "smoke", 84]),
      tiers: { "2027-09-11": "disruptive", "2027-09-12": "disruptive" },
      park: park(),
      indoor: { name: "High Desert Museum", city: "Bend" },
    })!;
    expect(w.text).toBe(
      "Park Roulette: Smoky Sat and Sun, 81 and 84. Indoor pick: High Desert Museum, Bend. Reply STOP to opt out. https://parkroulette.quest/w/5t19",
    );
    expect(septets(w.text)).toBe(140);
  });
  it("4. no park and no Indoor pick: no text", () => {
    const base = {
      issueDate: "2026-12-03",
      days: card("2026-12-03", ["Sunny", "sun", 47], ["Sunny", "sun", 49]),
      tiers: null,
      indoor: null,
    };
    expect(weekendText({ ...base, park: null })).toBeNull();
    expect(
      weekendText({ ...base, park: park({ status: "closed" }) }),
    ).toBeNull();
  });
});

describe("the text's parts", () => {
  it("says the weather long, or short when it has to", () => {
    const days = textDays(
      card(
        "2026-12-10",
        ["Rain and snow", "mixed", 33, 60],
        ["Partly sunny", "partly", 41],
      ),
      "2026-12-10",
    );
    expect(weatherWords(days)).toBe(
      "Rain and snow Sat, 33. Partly sunny Sun, 41",
    );
    expect(weatherWords(days, true)).toBe(
      "Sat rain and snow 33, Sun partly sunny 41",
    );
    // A missing day is left out; no days, no weather.
    const one = card("2026-12-10", ["Snow", "snow", 29], ["Sunny", "sun", 36]);
    one[2] = { ...one[2], missing: true, high: null };
    expect(weatherWords(textDays(one, "2026-12-10"))).toBe("Snow Sat, 29");
    expect(weatherWords([])).toBeNull();
  });
  it("shortens in order: fit words, short weather, Go Sat, then the town; else nothing", () => {
    const days = textDays(
      card(
        "2026-12-10",
        ["Rain and snow", "mixed", 33, 60],
        ["Partly sunny", "partly", 41],
      ),
      "2026-12-10",
    );
    const link = issueLink("2026-12-10");
    const at = (name: string) =>
      composeText({
        update: true,
        days,
        plan: {
          kind: "park",
          date: "2026-12-13",
          name,
          city: "La Pine",
          fit: ["Swings"],
        },
        link,
      });
    const a = at("Big")!;
    expect(a).toBe(
      "Park Roulette: Update: Rain and snow Sat, 33. Partly sunny Sun, 41. Go Sunday: Big, La Pine. Swings. Reply STOP to opt out. https://parkroulette.quest/w/5lju",
    );
    // Longer names step through each shortening.
    const b = at("A".repeat(10))!;
    expect(b).not.toContain("Swings");
    expect(b).toContain(
      "Rain and snow Sat, 33. Partly sunny Sun, 41. Go Sunday:",
    );
    const c = at("A".repeat(15))!;
    expect(c).toContain(
      "Sat rain and snow 33, Sun partly sunny 41. Go Sunday:",
    );
    const d = at("A".repeat(18))!;
    expect(d).toContain(`Go Sun: ${"A".repeat(18)}, La Pine.`);
    const e = at("A".repeat(24))!;
    expect(e).toContain(`Go Sun: ${"A".repeat(24)}. Reply STOP`);
    // Then the other day's weather, then all of it.
    const f = at("A".repeat(30))!;
    expect(f).toContain(
      `Update: Sun partly sunny 41. Go Sun: ${"A".repeat(30)}.`,
    );
    const g = at("A".repeat(60))!;
    expect(g).toContain(`Update: Go Sun: ${"A".repeat(60)}.`);
    expect(at("A".repeat(90))).toBeNull();
    for (const t of [a, b, c, d, e, f, g]) {
      expect(septets(t)).toBeLessThanOrEqual(160);
      expect(textProblems(t)).toBeNull();
    }
  });
  it("picks the better day by tier, Saturday on a tie", () => {
    expect(betterDay("2026-12-12", {})).toBe("2026-12-12");
    expect(betterDay("2026-12-12", { "2026-12-12": "plan_around" })).toBe(
      "2026-12-13",
    );
    expect(
      betterDay("2026-12-12", {
        "2026-12-12": "disruptive",
        "2026-12-13": "disruptive",
      }),
    ).toBe("2026-12-12");
  });
  it("starts 'Update:' only when Friday flips a day into or out of disruptive", () => {
    const days = ["2026-12-12", "2026-12-13"];
    expect(
      tierFlipped(
        { "2026-12-12": "fine" },
        { "2026-12-12": "plan_around" },
        days,
      ),
    ).toBe(false);
    expect(
      tierFlipped(
        { "2026-12-12": "fine" },
        { "2026-12-12": "disruptive" },
        days,
      ),
    ).toBe(true);
    expect(
      tierFlipped(
        { "2026-12-13": "disruptive" },
        { "2026-12-13": "fine" },
        days,
      ),
    ).toBe(true);
    // Missing data never decides.
    expect(tierFlipped({ "2026-12-12": "fine" }, {}, days)).toBe(false);
    expect(tierFlipped(null, { "2026-12-12": "disruptive" }, days)).toBe(false);
    const w = weekendText({
      issueDate: "2026-12-10",
      days: card("2026-12-10", ["Sunny", "sun", 40], ["Sunny", "sun", 41]),
      tiers: { "2026-12-12": "fine", "2026-12-13": "fine" },
      park: park({ features: [] }),
      indoor: null,
      fresh: {
        days: [
          { date: "2026-12-12", word: "Snow", high: 29 },
          { date: "2026-12-13", word: "Sunny", high: 36 },
        ],
        tiers: { "2026-12-12": "disruptive", "2026-12-13": "fine" },
      },
    })!;
    expect(w.text).toBe(
      "Park Roulette: Update: Snow Sat, 29. Sunny Sun, 36. Go Sunday: Wildflower Park, Bend. Reply STOP to opt out. https://parkroulette.quest/w/5lju",
    );
    expect(w.update).toBe("Snow Sat, 29. Sunny Sun, 36");
  });
  it("never opens the Indoor pick on rough tiers (an issue with no stored tiers)", () => {
    const w = weekendText({
      issueDate: "2026-12-10",
      days: card(
        "2026-12-10",
        ["Snow", "snow", 29, 90],
        ["Rain", "rain", 36, 90],
      ),
      tiers: null,
      park: park({ features: [] }),
      indoor: { name: "High Desert Museum", city: "Bend" },
    })!;
    expect(w.text).toContain("Go Saturday: Wildflower Park, Bend.");
  });
  it("adds fit words in order while they fit", () => {
    expect(
      fitWords(
        ["restrooms", "swings", "spinny", "toddler_area", "splash_pad"],
        12,
      ),
    ).toEqual(["Toddler area", "Swings", "Spinny things", "Restrooms"]);
    expect(fitWords(["splash_pad"], 7)).toEqual(["Splash pad"]);
  });
  it("maps curly quotes and dashes in names to ASCII", () => {
    const w = weekendText({
      issueDate: "2026-12-03",
      days: undefined,
      tiers: null,
      park: park({ name: "Kids’ Corner – North", features: ["swings"] }),
      indoor: null,
    })!;
    expect(w.text).toBe(
      "Park Roulette: Go Saturday: Kids' Corner - North, Bend. Swings. Reply STOP to opt out. https://parkroulette.quest/w/5ljn",
    );
  });
});

describe("short links", () => {
  it("codes the issue date as YYMMDD in base 36, always 4 characters", () => {
    expect(dateCode("2026-12-10")).toBe("5lju");
    expect(dateCode("2026-12-03")).toBe("5ljn");
    expect(dateCode("2027-09-09")).toBe("5t19");
    expect(dateCode("2010-01-01")).toHaveLength(4);
    expect(dateCode("2099-12-31")).toHaveLength(4);
    for (const d of ["2026-01-01", "2026-02-28", "2028-02-29", "2040-07-04"])
      expect(dateFromCode(dateCode(d))).toBe(d);
    for (const bad of ["", "5lj", "5ljuu", "5LJU", "zzzz", "1000", "../x"])
      expect(dateFromCode(bad), bad).toBeNull();
    for (const bad of ["", "2026-1-1", "26-12-10", "x2026-12-10", "1999-12-10"])
      expect(() => dateCode(bad), bad).toThrow();
    // Not a real day: February 30.
    expect(dateFromCode(Number("260230").toString(36))).toBeNull();
    expect(issueLink("2026-12-10")).toBe("https://parkroulette.quest/w/5lju");
  });
  it("keeps old park codes at 1 to 3 characters", () => {
    expect(parkCode(1234)).toBe("ya");
    expect(parkIdFromCode("ya")).toBe(1234);
    expect(parkIdFromCode("zzz")).toBe(46655);
    for (const bad of ["", "0", "00a", "YA", "5lju", "abcd", "a-b", "../x"])
      expect(parkIdFromCode(bad), bad).toBeNull();
  });
  it("checks the text: STOP line, then our issue link, last", () => {
    const ok = `Park Roulette: Go Saturday: X, Bend. Reply STOP to opt out. ${SITE}/w/5lju`;
    expect(textProblems(ok)).toBeNull();
    expect(
      textProblems(
        `Park Roulette: Go Saturday: X, Bend. ${SITE}/w/5lju Reply STOP to opt out.`,
      ),
    ).toMatch(/last/);
    expect(
      textProblems(`Park Roulette: Go Saturday: X, Bend. ${SITE}/w/5lju`),
    ).toMatch(/STOP/);
    // Old park links and long links no longer pass.
    expect(
      textProblems(`Park Roulette: X. Reply STOP to opt out. ${SITE}/w/ya`),
    ).toMatch(/short link/);
    expect(
      textProblems(`Park Roulette: X. Reply STOP to opt out. ${SITE}/parks/x`),
    ).toMatch(/short link/);
    // 160 characters, but "[" takes two septets: 161.
    const t = `Park Roulette: [ ${"x".repeat(86)} Reply STOP to opt out. ${SITE}/w/5lju`;
    expect(t.length).toBe(160);
    expect(textProblems(t)).toBe("over 160 characters");
  });
  it("marks a dry run only when the whole still fits", () => {
    const short = `Park Roulette: Go Saturday: X, Bend. Reply STOP to opt out. ${SITE}/w/5lju`;
    expect(dryRunText(short)).toBe(`[Dry run] ${short}`);
    const long = `Park Roulette: ${"x".repeat(85)}. Reply STOP to opt out. ${SITE}/w/5lju`;
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
  it("pauses only after two sends that EACH had at least 3 STOPs and over 1%", () => {
    expect(
      guardrailTrips([
        { sent: 100, stops: 3 },
        { sent: 200, stops: 3 },
      ]),
    ).toBe(true);
    // 3 STOPs but exactly 1%: not over.
    expect(
      guardrailTrips([
        { sent: 300, stops: 3 },
        { sent: 100, stops: 5 },
      ]),
    ).toBe(false);
    // Over 1%, but only 2 STOPs in one send (a small list).
    expect(
      guardrailTrips([
        { sent: 50, stops: 2 },
        { sent: 50, stops: 9 },
      ]),
    ).toBe(false);
    expect(guardrailTrips([{ sent: 100, stops: 9 }])).toBe(false);
  });
});
