import { describe, expect, it } from "vitest";
import { ageTags, matchesAge, typicalAgeRange } from "./ages";

const tags = (s: string) => ageTags(s)?.tags ?? null;

describe("age tags from printed ages", () => {
  it("maps the examples James gave", () => {
    expect(tags("Ages 5 and under")).toEqual(["Ages 0-3", "Ages 4-7"]);
    expect(tags("All ages")).toEqual(["All ages"]);
    expect(tags("All ages welcome")).toEqual(["All ages"]);
    const adults = ageTags("18+");
    expect(adults?.kids).toBe(false);
    expect(adults?.tags).toEqual([]);
  });
  it("maps ranges to every bracket they touch, never a vague label", () => {
    expect(tags("Ages 3-10")).toEqual(["Ages 0-3", "Ages 4-7", "Ages 8-12"]);
    expect(tags("Ages 3 – 10")).toEqual(["Ages 0-3", "Ages 4-7", "Ages 8-12"]);
    expect(tags("ages 4 to 7")).toEqual(["Ages 4-7"]);
    expect(tags("Ages 5-12")).toEqual(["Ages 4-7", "Ages 8-12"]);
    expect(tags("For kids 8 through 12")).toEqual(["Ages 8-12"]);
    expect(tags("Ages 0-18")).toEqual(["Ages 0-3", "Ages 4-7", "Ages 8-12"]);
    expect(tags("18 months to 3 years")).toEqual(["Ages 0-3"]);
    expect(tags("Babies 0-24 months")).toEqual(["Ages 0-3"]);
    for (const s of ["Ages 2-5", "ages 6-9", "Ages 0-12"])
      for (const t of tags(s)!) expect(t).toMatch(/^Ages (0-3|4-7|8-12)$/);
  });
  it("reads under, and up, plus and single ages", () => {
    expect(tags("Under 5")).toEqual(["Ages 0-3", "Ages 4-7"]);
    expect(tags("under 4")).toEqual(["Ages 0-3"]);
    expect(tags("Kids 6 and up")).toEqual(["Ages 4-7", "Ages 8-12"]);
    expect(tags("Ages 9+")).toEqual(["Ages 8-12"]);
    expect(tags("For 3 year olds")).toEqual(["Ages 0-3"]);
    expect(tags("age 4")).toEqual(["Ages 4-7"]);
    expect(tags("5 years old or younger")).toEqual(["Ages 0-3", "Ages 4-7"]);
  });
  it("reads school grades", () => {
    expect(tags("Grades K-5")).toEqual(["Ages 4-7", "Ages 8-12"]);
    expect(tags("Kindergarten")).toEqual(["Ages 4-7"]);
    expect(tags("3rd grade")).toEqual(["Ages 8-12"]);
  });
  it("keeps grown-up and teen events out of kids' listings", () => {
    for (const s of [
      "Adults only",
      "21+",
      "Ages 18 and up",
      "Ages 13-18",
      "Teens 14+",
    ])
      expect(ageTags(s)?.kids, s).toBe(false);
  });
  it("gives no tag without printed ages", () => {
    expect(ageTags("")).toBeNull();
    expect(ageTags(null)).toBeNull();
    expect(ageTags("Families welcome")).toBeNull();
    expect(ageTags("Toddlers")).toBeNull();
  });
  it("filters and marks up", () => {
    expect(matchesAge(["Ages 4-7"], "4-7")).toBe(true);
    expect(matchesAge(["Ages 4-7"], "0-3")).toBe(false);
    expect(matchesAge(["All ages"], "8-12")).toBe(true);
    expect(typicalAgeRange(ageTags("Ages 3-10"))).toBe("3-10");
    expect(typicalAgeRange(ageTags("All ages"))).toBeNull();
    expect(typicalAgeRange(ageTags("Ages 6 and up"))).toBe("6-");
  });
});

describe("the release 2 review's cases (when in doubt, no tag)", () => {
  const cases: [string, string[] | null, string?][] = [
    ["Ages 12 & under", ["Ages 0-3", "Ages 4-7", "Ages 8-12"]],
    ["Ages 5 & up", ["Ages 4-7", "Ages 8-12"]],
    ["Not recommended for children under 5", null],
    ["Children under 3 free", null],
    ["1-3 pm", null],
    ["Ages 2-4 with a grown-up 18+", ["Ages 0-3", "Ages 4-7"], "2-4"],
    ["under 18 must be accompanied", null],
    ["Must be at least 6 years old", ["Ages 4-7", "Ages 8-12"]],
    ["Ages 3 and 4", ["Ages 0-3", "Ages 4-7"]],
    ["1st-5th grade", ["Ages 4-7", "Ages 8-12"]],
    ["Ages 2½ to 5", ["Ages 0-3", "Ages 4-7"]],
  ];
  for (const [words, want, range] of cases)
    it(words, () => {
      const a = ageTags(words);
      if (want === null) expect(a?.tags ?? null, words).toBeNull();
      else expect(a?.tags, words).toEqual(want);
      if (range) expect(typicalAgeRange(a)).toBe(range);
    });
});

describe("the final review's cases (times, guards, bare ranges)", () => {
  const cases: [string, string[] | null, [number, number]?][] = [
    ["Ages 4-6, 3:30-4:15", ["Ages 4-7"], [4, 6]],
    ["Ages 8 to 12 (must be 8 by Sept 1)", ["Ages 8-12"], [8, 12]],
    ["Ages 6-12, Mon-Fri 9-3", ["Ages 4-7", "Ages 8-12"], [6, 12]],
    ["Ages 3-5, sessions 1-2", ["Ages 0-3", "Ages 4-7"], [3, 5]],
    [
      "Swim lessons ages 3-5; class size 4-6 kids",
      ["Ages 0-3", "Ages 4-7"],
      [3, 5],
    ],
    ["Kids under 12 must be supervised", null],
    ["Ages 10+, children under 10 need an adult", null],
    ["Ages 2-5. Room 101-102", ["Ages 0-3", "Ages 4-7"], [2, 5]],
    [
      "Preschool Storytime, ages 3-5, 10:30-11 am",
      ["Ages 0-3", "Ages 4-7"],
      [3, 5],
    ],
    ["Ages 3-5 and ages 9-12", null],
  ];
  for (const [words, want, range] of cases)
    it(words, () => {
      const a = ageTags(words);
      if (want === null) expect(a?.tags ?? null, words).toBeNull();
      else {
        expect(a?.tags, words).toEqual(want);
        expect(a?.range, words).toEqual(range);
      }
    });
});
