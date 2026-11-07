import { describe, expect, it } from "vitest";
import {
  computeBadges,
  computeStats,
  criticStyle,
  progressOf,
  seasonOf,
  weekendKey,
  type BadgeInput,
  type BadgePark,
} from "./badges";

const park = (
  id: number,
  city = "Bend",
  features: string[] = [],
  status = "active",
): BadgePark => ({ id, city, features, status });

function badges(input: Partial<BadgeInput>) {
  const list = computeBadges({
    parks: [],
    visits: [],
    reviews: [],
    photoCount: 0,
    ...input,
  });
  return Object.fromEntries(list.map((b) => [b.id, b]));
}

describe("dates", () => {
  it("finds seasons", () => {
    expect(seasonOf("2026-12-24")).toBe("winter");
    expect(seasonOf("2026-02-28")).toBe("winter");
    expect(seasonOf("2026-03-01")).toBe("spring");
    expect(seasonOf("2026-07-04")).toBe("summer");
    expect(seasonOf("2026-11-06")).toBe("fall");
  });
  it("keys a weekend by its Saturday", () => {
    expect(weekendKey("2026-11-07")).toBe("2026-11-07"); // Sat
    expect(weekendKey("2026-11-08")).toBe("2026-11-07"); // Sun
    expect(weekendKey("2026-11-06")).toBeNull(); // Fri
    expect(weekendKey("2026-11-01")).toBe("2026-10-31"); // Sun across months
  });
});

describe("progress", () => {
  it("counts visited plus crossed off as done", () => {
    const parks = [
      park(1),
      park(2),
      park(3, "Bend", [], "closed"),
      park(4, "Bend", [], "private"),
    ];
    // Visiting a park that was later crossed off does not double count.
    expect(progressOf(parks, new Set([1, 3]))).toEqual({
      total: 4,
      coloredIn: 1,
      crossedOff: 2,
      done: 3,
    });
  });
});

describe("badges", () => {
  it("starts with nothing earned", () => {
    const b = badges({ parks: [park(1), park(2)] });
    expect(Object.values(b).every((x) => !x.earned)).toBe(true);
  });

  it("hides milestones the map can't reach", () => {
    const parks = Array.from({ length: 12 }, (_, i) => park(i + 1));
    const b = badges({ parks });
    expect(b["parks-5"]).toBeDefined();
    // Only the next milestone shows as a locked sticker.
    expect(b["parks-10"]).toBeUndefined();
    expect(b["parks-25"]).toBeUndefined();
    const visits = [1, 2, 3, 4, 5].map((id) => ({
      parkId: id,
      visitedOn: "2026-06-01",
    }));
    expect(badges({ parks, visits })["parks-10"]).toBeDefined();
  });

  it("earns count milestones from colored-in parks", () => {
    const parks = Array.from({ length: 12 }, (_, i) => park(i + 1));
    const visits = [1, 2, 3, 4, 5, 5].map((id, i) => ({
      parkId: id,
      visitedOn: `2026-06-0${i + 1}`,
    }));
    const b = badges({ parks, visits });
    expect(b["first-stamp"].earned).toBe(true);
    expect(b["parks-5"].earned).toBe(true);
    expect(b["parks-10"].earned).toBe(false);
    expect(b["parks-10"].progress).toEqual({ have: 5, need: 10 });
    expect(b.encore.earned).toBe(true);
  });

  it("town hero needs every park in a 2+ playground town, crossed off counts", () => {
    const parks = [
      park(1, "Bend"),
      park(2, "Bend"),
      park(3, "Bend", [], "no_playground"),
      park(4, "Madras"),
    ];
    expect(
      badges({ parks, visits: [{ parkId: 4, visitedOn: "2026-06-01" }] })[
        "town-hero"
      ].earned,
    ).toBe(false);
    const b = badges({
      parks,
      visits: [
        { parkId: 1, visitedOn: "2026-06-01" },
        { parkId: 2, visitedOn: "2026-06-02" },
      ],
    });
    expect(b["town-hero"].earned).toBe(true);
  });

  it("road trip, park hopper, weekend warrior", () => {
    const parks = [park(1, "Bend"), park(2, "Redmond"), park(3, "Sisters")];
    const b = badges({
      parks,
      visits: [
        { parkId: 1, visitedOn: "2026-11-07" }, // Sat
        { parkId: 2, visitedOn: "2026-11-07" }, // Sat
        { parkId: 3, visitedOn: "2026-11-08" }, // Sun
      ],
    });
    expect(b["road-trip"].earned).toBe(true);
    expect(b["park-hopper"].earned).toBe(true);
    expect(b["weekend-warrior"].earned).toBe(true);

    const weekdays = badges({
      parks,
      visits: [
        { parkId: 1, visitedOn: "2026-11-06" }, // Fri
        { parkId: 2, visitedOn: "2026-11-07" },
        { parkId: 3, visitedOn: "2026-11-08" },
      ],
    });
    expect(weekdays["weekend-warrior"].earned).toBe(false);
    expect(weekdays["weekend-warrior"].progress).toEqual({ have: 2, need: 3 });
    expect(weekdays["park-hopper"].earned).toBe(false);
  });

  it("every season", () => {
    const parks = [park(1)];
    const dates = ["2026-01-10", "2026-04-10", "2026-07-10"];
    const visits = dates.map((visitedOn) => ({ parkId: 1, visitedOn }));
    expect(badges({ parks, visits })["every-season"].earned).toBe(false);
    visits.push({ parkId: 1, visitedOn: "2026-10-10" });
    expect(badges({ parks, visits })["every-season"].earned).toBe(true);
  });

  it("splash master only appears when there are splash pads", () => {
    expect(badges({ parks: [park(1)] })["splash-master"]).toBeUndefined();
    const parks = [
      park(1, "Bend", ["splash_pad"]),
      park(2, "Bend", ["splash_pad"]),
      park(3, "Bend", ["splash_pad"], "closed"),
    ];
    const one = badges({
      parks,
      visits: [{ parkId: 1, visitedOn: "2026-07-01" }],
    });
    expect(one["splash-master"].progress).toEqual({ have: 1, need: 2 });
    const both = badges({
      parks,
      visits: [
        { parkId: 1, visitedOn: "2026-07-01" },
        { parkId: 2, visitedOn: "2026-07-02" },
      ],
    });
    expect(both["splash-master"].earned).toBe(true);
  });

  it("review stickers", () => {
    const parks = [park(1), park(2)];
    const r = (tenths: number, tags: string[] = []) => ({
      parkId: 1,
      explorerId: 1,
      tenths,
      tags,
    });
    const b = badges({
      parks,
      reviews: [r(50, ["shade"]), r(15), r(40, ["windy"])],
      headsUpKeys: ["windy"],
      photoCount: 1,
    });
    expect(b.perfect.earned).toBe(true);
    expect(b["tough-crowd"].earned).toBe(true);
    expect(b["safety-scout"].earned).toBe(true);
    expect(b.shutterbug.earned).toBe(true);
    expect(b["report-card"].progress).toEqual({ have: 2, need: 5 });
  });

  it("myth buster and the whole shebang", () => {
    const parks = [park(1), park(2, "Bend", [], "no_playground")];
    const before = badges({
      parks,
      visits: [{ parkId: 1, visitedOn: "2026-06-01" }],
    });
    // Someone else crossing it off still finishes the bucket list...
    expect(before["whole-shebang"].earned).toBe(true);
    // ...but busting the myth means going there yourself.
    expect(before["myth-buster"].earned).toBe(false);
    const after = badges({
      parks,
      visits: [{ parkId: 2, visitedOn: "2026-06-01" }],
    });
    expect(after["myth-buster"].earned).toBe(true);
    expect(after["whole-shebang"].earned).toBe(false);
  });
});

describe("stats", () => {
  const parks = [
    { id: 1, slug: "a", name: "A Park", city: "Bend" },
    { id: 2, slug: "b", name: "B Park", city: "Bend" },
  ];
  const members = [
    { id: 1, name: "James" },
    { id: 2, name: "Sam" },
  ];

  it("counts this month and the month streak", () => {
    const s = computeStats({
      parks,
      members,
      reviews: [],
      today: "2026-11-06",
      visits: [
        { parkId: 1, visitedOn: "2026-11-02" },
        { parkId: 2, visitedOn: "2026-10-15" },
        { parkId: 2, visitedOn: "2026-09-15" },
        { parkId: 2, visitedOn: "2026-07-15" },
      ],
    });
    expect(s.thisMonth).toBe(1);
    expect(s.monthStreak).toBe(3);
    expect(s.streakAtRisk).toBe(false);
  });

  it("keeps last month's streak alive but at risk", () => {
    const s = computeStats({
      parks,
      members,
      reviews: [],
      today: "2027-01-03",
      visits: [
        { parkId: 1, visitedOn: "2026-12-20" },
        { parkId: 1, visitedOn: "2026-11-20" },
      ],
    });
    expect(s.monthStreak).toBe(2);
    expect(s.streakAtRisk).toBe(true);
  });

  it("finds the favorite and each critic's average", () => {
    const s = computeStats({
      parks,
      members,
      today: "2026-11-06",
      visits: [],
      reviews: [
        { parkId: 1, explorerId: 1, tenths: 30 },
        { parkId: 1, explorerId: 2, tenths: 40 },
        { parkId: 2, explorerId: 1, tenths: 36 },
      ],
    });
    expect(s.favorite?.slug).toBe("b");
    expect(s.critics).toEqual([
      { id: 1, name: "James", reviews: 2, avgTenths: 33 },
      { id: 2, name: "Sam", reviews: 1, avgTenths: 40 },
    ]);
    expect(criticStyle(33)).toBe("is a fair judge");
  });
});

describe("play types", () => {
  const pg = (
    id: number,
    city = "Bend",
    play = "playground",
    status = "active",
  ) => ({
    id,
    city,
    features: [],
    play,
    status,
  });

  it("the quest counts playgrounds; every park is the second count", () => {
    const parks = [pg(1), pg(2, "Bend", "nature"), pg(3, "Bend", "none")];
    const visited = new Set([1, 3]);
    expect(progressOf(parks, visited)).toMatchObject({ total: 2, done: 1 });
    expect(progressOf(parks, visited, "every")).toMatchObject({
      total: 3,
      done: 2,
    });
  });

  it("only closed and private cross a park off", () => {
    const parks = [
      pg(1),
      pg(2, "Bend", "playground", "closed"),
      pg(3, "Bend", "none"),
    ];
    expect(progressOf(parks, new Set())).toMatchObject({
      total: 2,
      crossedOff: 1,
      done: 1,
    });
  });

  it("park ranger needs every park, playground or not", () => {
    const parks = [pg(1), pg(2, "Bend", "none")];
    const some = badges({
      parks,
      visits: [{ parkId: 1, visitedOn: "2026-06-01" }],
    });
    expect(some["whole-shebang"].earned).toBe(true);
    expect(some["every-park"].earned).toBe(false);
    const all = badges({
      parks,
      visits: [
        { parkId: 1, visitedOn: "2026-06-01" },
        { parkId: 2, visitedOn: "2026-06-02" },
      ],
    });
    expect(all["every-park"].earned).toBe(true);
    expect(all["myth-buster"].earned).toBe(true);
    // No grassy parks, no Park Ranger sticker.
    expect(badges({ parks: [pg(1)] })["every-park"]).toBeUndefined();
  });
});
