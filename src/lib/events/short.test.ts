import { describe, expect, it } from "vitest";
import { eventDescriptor } from "@/lib/social/roundup";
import whats from "./__fixtures__/prod-whats.json";
import { checkShort, shortProblems } from "./short";
import { firstSentence } from "./short-what";

/**
 * An event's `short`: a complete phrase, in its own summary's words, that
 * the Tuesday roundup prints under the title (lib/events/short.ts).
 */

const burst = {
  title: "B.U.R.S.T. - Wonderful Winter!",
  what: "Babies through preschoolers dig into winter-themed sensory play stations and group activities that build early skills.",
};
const clay = {
  title: "Clay Creations",
  what: "Kids squish and sculpt air-dry clay into a new little creature or treat each week and bring it home.",
};
const story = {
  title: "Family Story Time",
  what: "Little kids and their grown-ups share picture books, sing songs and do action rhymes together in a short, lively circle.",
};

describe("the short validator", () => {
  it("takes complete phrases in the event's own words", () => {
    for (const [src, s] of [
      [
        burst,
        "Babies through preschoolers dig into winter sensory play stations",
      ],
      [clay, "Kids sculpt air-dry clay into a little creature or treat"],
      [
        story,
        "Little kids and grown-ups share picture books, songs and rhymes",
      ],
      [story, "Family story time with picture books and songs"],
    ] as const)
      expect(shortProblems(s, src), s).toEqual([]);
  });

  it('refuses the clause cut that started this: "Babies through preschoolers dig"', () => {
    expect(
      shortProblems("Babies through preschoolers dig", burst).join(" "),
    ).toMatch(/ends on a verb/);
  });

  it("refuses an end on a comma, conjunction, preposition or article", () => {
    for (const s of [
      "Kids squish and sculpt air-dry clay into",
      "Kids squish and sculpt air-dry clay and",
      "Kids sculpt air-dry clay into a",
      "Kids squish and sculpt air-dry clay,",
    ])
      expect(shortProblems(s, clay).join(" "), s).toMatch(/mid-phrase/);
  });

  it("refuses a dangling list", () => {
    expect(
      shortProblems("Picture books, songs, action rhymes", story).join(" "),
    ).toMatch(/dangling list/);
  });

  it("refuses words the event's summary and title don't have", () => {
    expect(
      shortProblems("Kids sculpt clay dinosaurs and paint them", clay).join(
        " ",
      ),
    ).toMatch(/"dinosaurs, paint" isn't in the event's own summary/);
  });

  it("refuses negations, rules, logistics, we, free, prices, newsletters, links", () => {
    const cases: [string, RegExp][] = [
      ["Kids sculpt clay, no experience needed", /No negations/],
      ["Kids must bring clay to sculpt each week", /No negations/],
      ["Register to sculpt air-dry clay each week", /No negations/],
      ["We sculpt air-dry clay into a little creature", /first person/],
      ["Kids sculpt air-dry clay for free each week", /"free"/],
      ["Kids sculpt air-dry clay for $5 each week", /price/],
      ["Kids sculpt clay, as seen in Bend Family Loop", /another newsletter/],
      ["Kids sculpt air-dry clay at example.com", /links/],
      ["kids sculpt air-dry clay into a little creature", /capital/],
    ];
    for (const [s, re] of cases)
      expect(shortProblems(s, clay).join(" "), s).toMatch(re);
  });

  it("refuses words the roundup's text rules would drop (vote reads as politics)", () => {
    expect(
      shortProblems("Kids wander gingerbread houses and vote for a favorite", {
        title: "Gingerbread Junction",
        what: "Kids wander a room full of gingerbread houses built by local families and groups, then vote for their favorite creation.",
      }).join(" "),
    ).toMatch(/politics/);
  });

  it("holds the length to 12 to 70 characters, and tidies a final period", () => {
    expect(shortProblems("Kids sculpt", clay).join(" ")).toMatch(/12 to 70/);
    expect(
      shortProblems(
        `${"Kids sculpt air-dry clay ".repeat(3)}creature`,
        clay,
      ).join(" "),
    ).toMatch(/12 to 70/);
    expect(
      checkShort("Kids sculpt air-dry clay into a little creature.", clay),
    ).toEqual({
      short: "Kids sculpt air-dry clay into a little creature",
      problems: [],
    });
    expect(checkShort(undefined, clay)).toEqual({ short: null, problems: [] });
  });
});

describe("the roundup's descriptor: short, else the whole first sentence, else none", () => {
  it("prefers a checked short", () => {
    expect(
      eventDescriptor({
        ...clay,
        short: "Kids sculpt air-dry clay into a little creature",
      }),
    ).toEqual({
      text: "Kids sculpt air-dry clay into a little creature",
      from: "short",
    });
  });

  it("a failing short falls back to the whole first sentence, when it's 70 or fewer", () => {
    const shortWhat = {
      title: "Toddler Time",
      what: "Toddlers wiggle through songs and rhymes. Grown-ups stay close.",
    };
    expect(
      eventDescriptor({ ...shortWhat, short: "Toddlers wiggle through" }),
    ).toEqual({
      text: "Toddlers wiggle through songs and rhymes",
      from: "sentence",
    });
  });

  it("no short and a long first sentence: no descriptor (never a cut)", () => {
    expect(eventDescriptor(burst)).toBeNull();
    expect(eventDescriptor(clay)).toBeNull();
  });

  it("a first sentence that's logistics is no descriptor", () => {
    expect(
      eventDescriptor({
        title: "Craft Hour",
        what: "Registration is required for this one.",
      }),
    ).toBeNull();
  });

  it("never prints a clause-cut line: on every stored summary, it's the whole first sentence or nothing", () => {
    for (const what of whats as string[]) {
      const d = eventDescriptor({ what, title: "" });
      if (d) {
        expect(d.from).toBe("sentence");
        expect(d.text, what).toBe(firstSentence(what, 70));
        expect(what.replace(/\s+/g, " ")).toContain(d.text);
      }
    }
  });
});
