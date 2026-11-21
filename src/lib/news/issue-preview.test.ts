import { describe, expect, it } from "vitest";
import type { Issue } from "./issue";
import {
  indoorWeek,
  photoCreditLine,
  planTiers,
  weekendCardDays,
} from "./issue-preview";
import { previewDate, previewInput } from "./preview-image";

const day = (date: string, label: string, over = {}) => ({
  date,
  label,
  condition: "Smoky",
  icon: "smoke" as const,
  high: 81,
  low: 60,
  precip: 0,
  ...over,
});
const issue = (over: Partial<Issue> = {}): Issue =>
  ({
    issue_date: "2027-09-09",
    weekend_ahead: {
      days: [
        day("2027-09-10", "Friday"),
        day("2027-09-11", "Saturday"),
        day("2027-09-12", "Sunday", { missing: true, high: null }),
      ],
    },
    wheel_pick: {
      park: "wildflower-park-bend",
      photo: {
        src: "https://www.bendparksandrec.org/x.jpg",
        width: 800,
        height: 600,
        alt: "a",
        sourceUrl: "https://www.bendparksandrec.org/park/x/",
      },
    },
    plan_b: {
      kind: "venue",
      venue_id: "venue-high-desert-museum",
      evidence: [],
    },
    ...over,
  }) as unknown as Issue;
const plan = (sat: string, sun: string) =>
  ({
    weather: {
      tiers: {
        counted: [],
        air: "nws_alerts",
        towns: {
          Bend: [
            { date: "2027-09-11", tier: sat },
            { date: "2027-09-12", tier: sun },
          ],
        },
      },
    },
  }) as never;

describe("the issue's link preview", () => {
  it("is an Indoor week only with both days disruptive and an Indoor pick", () => {
    expect(planTiers(null)).toBeNull();
    expect(indoorWeek(issue(), plan("disruptive", "disruptive"))?.name).toBe(
      "High Desert Museum",
    );
    expect(indoorWeek(issue(), plan("disruptive", "fine"))).toBeNull();
    expect(indoorWeek(issue(), null)).toBeNull();
    expect(
      indoorWeek(
        issue({ plan_b: undefined }),
        plan("disruptive", "disruptive"),
      ),
    ).toBeNull();
  });
  it("draws Saturday and Sunday only, skipping a missing day", () => {
    expect(weekendCardDays(issue()).map((d) => d.label)).toEqual(["Saturday"]);
  });
  it("credits the photo, and leads an Indoor week with the venue, not the photo", () => {
    const p = issue().wheel_pick.photo!;
    expect(photoCreditLine(p)).toBe("Photo: Bend Park & Recreation District");
    expect(
      photoCreditLine({
        ...p,
        src: "https://upload.wikimedia.org/a.jpg",
        author: "Jane Doe",
        license: "CC BY-SA 4.0",
      }),
    ).toBe("Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons");
    const indoor = previewInput(
      issue(),
      plan("disruptive", "disruptive"),
      "Wildflower Park",
      "data:x",
    );
    expect(indoor.photo).toBeNull();
    expect(indoor.title).toBe("Indoor pick: High Desert Museum");
    const park = previewInput(
      issue(),
      plan("fine", "fine"),
      "Wildflower Park",
      "data:x",
    );
    expect(park.photo?.credit).toBe("Photo: Bend Park & Recreation District");
    expect(park.title).toBe("Wildflower Park");
    expect(previewDate("2026-12-10")).toBe("Dec 10, 2026");
  });
});
