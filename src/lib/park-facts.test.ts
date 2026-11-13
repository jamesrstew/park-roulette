import { describe, expect, it } from "vitest";
import { listWords, parkFacts } from "./park-facts";

describe("park facts", () => {
  it("says what and where, what it has, heads-ups and stars", () => {
    const f = parkFacts({
      name: "Drake Park",
      city: "Bend",
      play: "playground",
      status: "active",
      features: ["swings", "restrooms"],
      reports: { busy_road: 2, splash_pad: 1 },
      avgTenths: 42,
      reviewCount: 3,
    });
    expect(f.summary).toContain("Drake Park is a playground in Bend, Oregon.");
    expect(f.summary).toMatch(/It has .*swings/);
    expect(f.summary).toContain("Heads up: a busy road close by.");
    expect(f.summary).toContain("a splash pad");
    expect(f.summary).toContain("Rated 4.2 out of 5 stars from 3 reviews");
  });
  it("is honest about parks without playgrounds and closed parks", () => {
    const base = {
      name: "X",
      city: "Redmond",
      features: [],
      reports: {},
      avgTenths: null,
      reviewCount: 0,
    };
    expect(parkFacts({ ...base, play: "none", status: "active" }).summary).toBe(
      "X is a park without a playground in Redmond, Oregon.",
    );
    expect(
      parkFacts({ ...base, play: "playground", status: "closed" }).summary,
    ).toContain("a closed park");
  });
  it("joins lists like a person", () => {
    expect(listWords(["a"])).toBe("a");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
  });
});
