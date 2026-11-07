import { describe, expect, it } from "vitest";
import { stampMilestone } from "./milestones";

const p = (
  id: number,
  city: string,
  lastVisit: string | null = null,
  play = "playground",
) => ({ id, city, play, status: "active", lastVisit });

describe("stamp milestones", () => {
  it("celebrates the first stamp", () => {
    expect(stampMilestone([p(1, "Bend"), p(2, "Bend")], 1)?.title).toMatch(
      /first/i,
    );
  });
  it("celebrates finishing a town", () => {
    const parks = [p(1, "Bend", "2026-01-01"), p(2, "Sisters"), p(3, "Bend")];
    expect(stampMilestone(parks, 3)?.title).toBe("Bend: all done!");
    expect(stampMilestone(parks, 2)?.title).toBe("Sisters: all done!");
  });
  it("celebrates the whole list, ignoring parks without playgrounds", () => {
    const parks = [
      p(1, "Bend", "2026-01-01"),
      p(2, "Bend"),
      p(3, "Bend", null, "none"),
    ];
    expect(stampMilestone(parks, 2)?.emoji).toBe("🏆");
    expect(stampMilestone(parks, 3)).toBeNull();
  });
  it("stays quiet on a repeat visit", () => {
    expect(stampMilestone([p(1, "Bend", "2026-01-01")], 1)).toBeNull();
  });
});
