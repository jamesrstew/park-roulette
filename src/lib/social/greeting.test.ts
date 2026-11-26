import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/news/catalog";
import { addDays, weekdayOf } from "@/lib/news/time";
import {
  calmOpener,
  EVERYDAY,
  occasionOn,
  openerFor,
  previousOpener,
  withOpener,
} from "./greeting";
import { NO_DRINKS } from "./mashup";
import type { PostKind } from "./model";
import { textProblems, voiceProblems } from "./validate";

const breaks = CATALOG.breaks;
const at = (kind: PostKind, day: string, previous?: string | null) =>
  openerFor(kind, day, { breaks, previous });

describe("the caption's opener", () => {
  it("greets Thanksgiving week on every kind, by its day", () => {
    // Sunday's school-break Unpack, then Monday to Saturday.
    expect(at("unpack", "2026-11-22")).toBe(
      "Thanksgiving week starts tomorrow.",
    );
    expect(at("park_post", "2026-11-23")).toBe("Thanksgiving is almost here.");
    expect(at("events_week", "2026-11-24")).toBe(
      "We hope Thanksgiving week is off to an easy start.",
    );
    expect(at("unpack", "2026-11-25")).toBe(
      "Thanksgiving is tomorrow. We hope the kitchen stays calm.",
    );
    expect(at("mashup", "2026-11-25")).toBe(at("unpack", "2026-11-25"));
    expect(at("teaser", "2026-11-26")).toBe(
      "Happy Thanksgiving! The weekend plan is ready when you are.",
    );
    expect(at("at_home", "2026-11-28")).toBe(
      "We hope the long weekend is treating you well.",
    );
    // Friday's Story has no caption.
    expect(at("story", "2026-11-27")).toBeNull();
  });

  it("greets the other holidays, long weekends and the big school breaks", () => {
    expect(at("at_home", "2026-12-19")).toBe("Winter break starts Monday.");
    expect(at("unpack", "2026-12-20")).toBe("Winter break starts tomorrow.");
    expect(at("park_post", "2026-12-21")).toBe("Happy winter break.");
    expect(at("events_week", "2026-12-22")).toBe("Christmas is almost here.");
    expect(at("teaser", "2026-12-24")).toBe(
      "Merry Christmas Eve, Central Oregon.",
    );
    expect(at("unpack", "2026-12-25")).toMatch(/^Merry Christmas! /);
    expect(at("at_home", "2026-12-26")).toBe(
      "We hope Christmas was a good one.",
    );
    expect(at("park_post", "2026-12-28")).toBe(
      "Wishing you a slow end to the year.",
    );
    expect(at("teaser", "2026-12-31")).toBe(
      "Here's to more park days in 2027.",
    );
    expect(at("events_week", "2027-01-01")).toBe(
      "Happy New Year! Here's to more park days in 2027.",
    );
    expect(at("park_post", "2027-01-04")).toMatch(/year/i);
    // MLK Day (Jan 18, 2027): the days before, then the weekend.
    expect(at("teaser", "2027-01-14")).toBe("A long weekend is almost here.");
    expect(at("at_home", "2027-01-16")).toBe("Happy long weekend.");
    expect(at("park_post", "2027-01-18")).toBe(
      "We hope the long weekend is a slow one.",
    );
    // Spring break: Bend-La Pine, March 22 to 26, 2027.
    expect(at("at_home", "2027-03-20")).toBe("Spring break starts Monday.");
    expect(at("park_post", "2027-03-22")).toBe("Happy spring break.");
    expect(at("at_home", "2027-03-27")).toMatch(/weekend of spring break/);
    expect(at("teaser", "2027-05-27")).toMatch(/Memorial Day weekend|long/);
    expect(at("teaser", "2027-10-28")).toMatch(/Halloween/);
    expect(at("events_week", "2027-07-01")).toMatch(/Fourth/);
  });

  it("leaves a one-day school closure and an unverified break alone", () => {
    // Feb 5, 2027 is a Bend-La Pine day off: not a greeting.
    expect(occasionOn("2027-02-05", breaks)).toBeNull();
    // A break we couldn't verify is never greeted.
    const unverified = [
      {
        label: "Bend-La Pine winter break",
        from: "2027-02-08",
        to: "2027-02-12",
        verified: false,
      },
    ];
    expect(occasionOn("2027-02-09", unverified)).toBeNull();
    // Only Bend-La Pine's big breaks (another district's alone: none).
    expect(
      occasionOn("2027-02-09", [
        {
          label: "Redmond winter break",
          from: "2027-02-08",
          to: "2027-02-12",
        },
      ]),
    ).toBeNull();
  });

  it("an ordinary week: code's own posts open warmly, the writer's posts with its own words", () => {
    const week = "2027-01-25";
    expect(at("park_post", week)).toBeNull();
    expect(at("unpack", addDays(week, 2))).toBeNull();
    expect(at("at_home", addDays(week, 5))).toBeNull();
    expect(EVERYDAY.events_week).toContain(at("events_week", addDays(week, 1)));
    expect(EVERYDAY.mashup).toContain(at("mashup", addDays(week, 2)));
    expect(EVERYDAY.teaser).toContain(at("teaser", addDays(week, 3)));
    // They rotate week to week.
    const tuesdays = Array.from({ length: 4 }, (_, i) =>
      at("events_week", addDays(week, 1 + 7 * i)),
    );
    expect(new Set(tuesdays).size).toBe(4);
  });

  it("never opens two posts in a row alike, all year", () => {
    // Every slot from Nov 2026 through 2027: Sunday's break Unpack, Monday
    // park, Tuesday roundup, Wednesday carousel, Thursday teaser, Saturday
    // at home.
    const KIND: Record<number, PostKind> = {
      0: "unpack",
      1: "park_post",
      2: "events_week",
      3: "mashup",
      4: "teaser",
      6: "at_home",
    };
    let day = "2026-11-01";
    let last: string | null = null;
    let lastBare: string | null = null;
    let seen = 0;
    while (day <= "2027-12-31") {
      const kind = KIND[weekdayOf(day)];
      if (kind) {
        // With the history...
        const o = at(kind, day, last);
        if (o && last) expect(o, day).not.toBe(last);
        // ...and without it (the calendar alone keeps them apart).
        const bare = at(kind, day);
        if (bare && lastBare) expect(bare, day).not.toBe(lastBare);
        if (o) seen++;
        last = o;
        lastBare = bare;
      }
      day = addDays(day, 1);
    }
    expect(seen).toBeGreaterThan(150);
  });

  it("steps past the post just before's opener, from the history", () => {
    // An ordinary week: the next line.
    const day = "2027-01-26";
    const usual = at("events_week", day)!;
    const other = at("events_week", day, usual);
    expect(other).not.toBe(usual);
    expect(EVERYDAY.events_week).toContain(other);
    // A holiday line belongs to its day: never another day's ("Thanksgiving
    // is tomorrow" on a Tuesday), so a repeat gives no opener at all.
    const tue = at("events_week", "2026-11-24")!;
    expect(at("events_week", "2026-11-24", tue)).toBeNull();
    expect(
      previousOpener(
        [
          { slotDate: "2026-11-23", opener: "A" },
          { slotDate: "2026-11-21", opener: "B" },
          { slotDate: "2026-11-24", opener: "C" },
        ],
        "2026-11-24",
      ),
    ).toBe("A");
    expect(previousOpener([], "2026-11-24")).toBeNull();
  });

  it("every line is short, plain, calm and clean for every post type", () => {
    const lines = new Set<string>();
    let day = "2026-10-01";
    while (day <= "2027-12-31") {
      const hit = occasionOn(day, breaks);
      hit?.lines.forEach((l) => lines.add(l));
      day = addDays(day, 1);
    }
    for (const xs of Object.values(EVERYDAY)) xs.forEach((l) => lines.add(l));
    expect(lines.size).toBeGreaterThan(40);
    for (const l of lines) {
      expect(l.length, l).toBeLessThanOrEqual(60);
      expect(l.split("!").length - 1, l).toBeLessThanOrEqual(1);
      expect(l, l).not.toMatch(/[—–]| -- /);
      expect(l, l).toMatch(/[.?!]$/);
      // Our voice rules (a "we hope" wish is ours), no drinks words (the
      // park pairings), no cliches.
      expect(textProblems(l, { month: 11, label: "opener" }), l).toEqual([]);
      expect(
        voiceProblems(l, "opener").filter((p) => !/greeting/.test(p)),
        l,
      ).toEqual([]);
      expect(NO_DRINKS.test(l), l).toBe(false);
      // No claims code can't back: counts, prices, weather, places.
      expect(l, l).not.toMatch(
        /\b(free|\d+ (events?|ideas?)|snow|rain|sun)\b/i,
      );
    }
  });

  it("keeps a post to one exclamation point", () => {
    expect(calmOpener("Happy Thanksgiving! We hope.", "Hello! Storytime")).toBe(
      "Happy Thanksgiving. We hope.",
    );
    expect(calmOpener("Happy Halloween!", "no bangs here")).toBe(
      "Happy Halloween!",
    );
  });

  it("puts the opener on its own line, or in the park post's paragraph", () => {
    expect(
      withOpener("Happy Thanksgiving week.", ["Headline", "", "x"]),
    ).toEqual(["Happy Thanksgiving week.", "Headline", "", "x"]);
    expect(
      withOpener("Happy Thanksgiving week.", ["Story.", "", "Best for: x"], {
        inline: true,
      }),
    ).toEqual(["Happy Thanksgiving week. Story.", "", "Best for: x"]);
    expect(withOpener(null, ["a"])).toEqual(["a"]);
    // A sent issue that already greets gets no second greeting.
    expect(
      withOpener("Happy Thanksgiving! We hope.", ["Happy Thanksgiving! Pie."]),
    ).toEqual(["Happy Thanksgiving! Pie."]);
  });
});

describe("school breaks that don't run Monday to Friday", () => {
  const brk = (from: string, to: string) => [
    {
      label: "Bend-La Pine spring break",
      district: "Bend-La Pine Schools",
      from,
      to,
      verified: true,
    },
  ];
  it("greets the weekend after only when the break ends on a Friday", () => {
    // Ends Friday, March 24, 2028: that weekend is still off.
    expect(
      occasionOn("2028-03-25", brk("2028-03-20", "2028-03-24"))?.lines,
    ).toEqual([
      "One more weekend of spring break.",
      "The last weekend of spring break is here.",
    ]);
    // Ends Sunday: Monday is a school day, no greeting.
    expect(
      occasionOn("2028-03-27", brk("2028-03-20", "2028-03-26")),
    ).toBeNull();
    // Ends Wednesday: Thursday and Friday are school days.
    expect(
      occasionOn("2028-03-23", brk("2028-03-20", "2028-03-22")),
    ).toBeNull();
    expect(
      occasionOn("2028-03-24", brk("2028-03-20", "2028-03-22")),
    ).toBeNull();
  });
  it("names the real first day before a break that starts mid-week", () => {
    // Starts Wednesday, March 22, 2028.
    const b = brk("2028-03-22", "2028-03-31");
    expect(openerFor("at_home", "2028-03-19", { breaks: b })).toBe(
      "Spring break is almost here.",
    );
    expect(openerFor("park_post", "2028-03-20", { breaks: b })).toBe(
      "Spring break starts Wednesday.",
    );
    expect(openerFor("events_week", "2028-03-21", { breaks: b })).toBe(
      "Spring break starts tomorrow.",
    );
  });
  it("never greets a break with no verified flag", () => {
    const b = [
      {
        label: "Bend-La Pine spring break",
        from: "2028-03-20",
        to: "2028-03-24",
      },
    ];
    expect(occasionOn("2028-03-21", b)).toBeNull();
  });
});

describe("the writer's words in a greeting week", () => {
  it("may wish, but never greets a holiday itself or claims a visit", () => {
    expect(
      textProblems("We hope the sun holds for Saturday.", {
        month: 11,
        label: "intro",
      }),
    ).toEqual([]);
    expect(
      textProblems("We hope to see you at the fort.", {
        month: 11,
        label: "intro",
      }).join(" "),
    ).toMatch(/first person/);
    expect(
      textProblems("We hope you join us there.", {
        month: 11,
        label: "intro",
      }).join(" "),
    ).toMatch(/invitation/);
    expect(voiceProblems("Happy Thanksgiving, everyone.", "story")[0]).toMatch(
      /greeting/,
    );
    expect(voiceProblems("Merry Christmas from the hill.", "story")[0]).toMatch(
      /greeting/,
    );
    // A birthday or a grade is not the Fourth.
    expect(
      voiceProblems("Cake for a happy fourth birthday party.", "what"),
    ).toEqual([]);
    // A happy kid is not a greeting.
    expect(voiceProblems("A happy kid on a cold morning.", "story")).toEqual(
      [],
    );
  });
});
