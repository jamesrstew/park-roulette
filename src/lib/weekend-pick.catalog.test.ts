import { describe, expect, it } from "vitest";
import parks from "../../data/parks.json";
import { CATALOG } from "./news/catalog";
import { septets } from "./texts";
import { textProblems, weekendText, type WeekInput } from "./weekend-pick";

/**
 * No real name may silence a week: every park in data/parks.json and every
 * catalog venue makes a text, with the longest weather words the card can
 * say and the widest highs, with and without "Update:".
 */
const THU = "2026-12-10";
const SAT = "2026-12-12";
const SUN = "2026-12-13";
const LONG = [
  { date: SAT, word: "Rain and snow", high: -10 },
  { date: SUN, word: "Partly sunny", high: 105 },
];
const card = [
  {
    date: "2026-12-11",
    label: "Friday",
    condition: "Sunny",
    icon: "sun" as const,
    high: 50,
    low: 30,
    precip: 0,
  },
  {
    date: SAT,
    label: "Saturday",
    condition: "Rain and snow",
    icon: "mixed" as const,
    high: -10,
    low: -20,
    precip: 90,
  },
  {
    date: SUN,
    label: "Sunday",
    condition: "Partly sunny",
    icon: "partly" as const,
    high: 105,
    low: 80,
    precip: 0,
  },
];
const disruptive = { [SAT]: "disruptive", [SUN]: "disruptive" } as const;
const ALL_FEATURES = [
  "toddler_area",
  "fenced",
  "baby_swings",
  "swings",
  "slides",
  "spinny",
  "climbing",
  "accessible",
  "splash_pad",
  "restrooms",
  "trail",
];

function check(input: WeekInput) {
  for (const update of [false, true]) {
    const w = weekendText({
      ...input,
      tiers: update ? { [SAT]: "fine", [SUN]: "fine" } : input.tiers,
      fresh: update ? { days: LONG, tiers: input.tiers ?? {} } : null,
    });
    expect(
      w,
      `${input.park?.name ?? input.indoor?.name} update=${update}`,
    ).not.toBeNull();
    expect(septets(w!.text)).toBeLessThanOrEqual(160);
    expect(textProblems(w!.text)).toBeNull();
    if (update) expect(w!.text).toContain("Update: ");
  }
}

describe("every real name fits", () => {
  it("every park in data/parks.json", () => {
    expect(parks.length).toBeGreaterThan(100);
    for (const p of parks as { slug: string; name: string; city: string }[])
      check({
        issueDate: THU,
        days: card,
        tiers: { [SAT]: "disruptive", [SUN]: "plan_around" },
        park: {
          id: 1,
          name: p.name,
          city: p.city,
          slug: p.slug,
          features: ALL_FEATURES,
          status: "active",
        },
        indoor: null,
      });
  });
  it("every catalog venue, as an Indoor pick", () => {
    for (const v of CATALOG.venues) {
      const input: WeekInput = {
        issueDate: THU,
        days: card,
        tiers: disruptive,
        park: null,
        indoor: { name: v.short_name, city: v.town },
      };
      check(input);
      const w = weekendText(input)!;
      expect(w.plan.kind).toBe("indoor");
      expect(w.text).toContain(`Indoor pick: ${v.short_name}`);
    }
  });
  it("an Indoor pick that can't fit falls back to the park", () => {
    const w = weekendText({
      issueDate: THU,
      days: card,
      tiers: disruptive,
      park: {
        id: 1,
        name: "Pine Park",
        city: "Bend",
        slug: "pine",
        features: [],
        status: "active",
      },
      indoor: { name: "X".repeat(140), city: "Bend" },
    })!;
    expect(w.plan).toEqual({ kind: "park", date: SAT });
    expect(w.text).toContain("Go Saturday: Pine Park, Bend.");
  });
  it("drops a parenthetical from a name", () => {
    const w = weekendText({
      issueDate: THU,
      days: undefined,
      tiers: null,
      park: {
        id: 1,
        name: "The Circuit (Bend)",
        city: "Bend",
        slug: "c",
        features: [],
        status: "active",
      },
      indoor: null,
    })!;
    expect(w.text).toContain("Go Saturday: The Circuit, Bend.");
  });
});
