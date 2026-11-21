import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/news/time";
import { scoopEvents } from "@/lib/scoop";
import type { EventDate, EventRow, StoredEvent } from "./model";
import {
  bigFirst,
  buildPrograms,
  groupSpan,
  patternLine,
  placesLabel,
  programKind,
  specialGroupOf,
} from "./programs";

// Saturday, Nov 21, 2026, 8 am Pacific.
const NOW = new Date("2026-11-21T16:00:00Z");
const TODAY = "2026-11-21";

let next = 1;
function row(
  kind: EventRow["kind"],
  over: Partial<StoredEvent> & { title: string; dates: EventDate[] },
): EventRow {
  const id = next++;
  return {
    id,
    slug: `e${id}`,
    kind,
    status: "scheduled",
    confirm: "ok",
    lastSeenAt: null,
    factsChangedAt: NOW,
    stateChangedAt: null,
    data: {
      venue: { name: "Central Library", town: "Bend" },
      what: "Something fun for kids to do.",
      url: "https://www.deschuteslibrary.org/calendar/",
      evidence: [{ url: "https://example.org", quote: "A quote here" }],
      ages: { tags: ["Ages 0-3"], kids: true, range: [0, 3] },
      point: null,
      checkQuote: "A quote here",
      setting: "indoor",
      ...over,
    },
  };
}

/** n dates on one weekday, a week apart, from a first day. */
function weekly(first: string, n: number, start = "10:30"): EventDate[] {
  return Array.from({ length: n }, (_, i) => ({
    day: addDays(first, 7 * i),
    start,
  }));
}

const BRANCHES = [
  ["Central Library", "Bend"],
  ["Redmond Library", "Redmond"],
  ["Sisters Library", "Sisters"],
  ["Sunriver Library", "Sunriver"],
  ["La Pine Library", "La Pine"],
  ["East Bend Library", "Bend"],
] as const;
const PROGRAMS = [
  "Family Story Time",
  "Toddler Story Time",
  "Baby Story Time",
  "Crafternoon",
  "Pokémon Club",
  "LEGO Club",
  "Cuentacuentos en español",
  "Preschool Story Time",
  "Teen Book Club",
  "Music & Movement",
  "Kids' Silent Book Club",
];

/** Today's shape: 66 library series rows (11 programs at 6 branches). */
function librarySet(): EventRow[] {
  return PROGRAMS.flatMap((title, p) =>
    BRANCHES.map(([name, town], b) =>
      row("series", {
        title,
        venue: { name, town },
        // Every branch has something today (the wall James saw).
        dates: weekly(addDays(TODAY, (p + b) % 7), 8),
      }),
    ),
  );
}

const SPECIALS = () => [
  row("annual", {
    title: "Sunriver Winter Fest",
    venue: { name: "The Village at Sunriver", town: "Sunriver" },
    url: "https://sunriver.example.org/winter",
    setting: "outdoor",
    ages: { tags: ["All ages"], kids: true, range: null },
    dates: [{ day: TODAY, start: "11:00" }],
  }),
  row("one_off", {
    title: "Pop-Up Exhibits",
    dates: [{ day: TODAY, start: "10:00" }],
  }),
  row("one_off", {
    title: "Pop-Up Exhibits",
    venue: { name: "Sisters Library", town: "Sisters" },
    dates: [{ day: "2026-12-02", start: "10:00" }],
  }),
  row("annual", {
    title: "Community Christmas Tree Lighting",
    venue: { name: "Brandis Square", town: "Bend" },
    url: "https://www.downtownbend.org/christmas",
    setting: "outdoor",
    dates: [{ day: "2026-12-05", start: "17:00" }],
  }),
  row("series", {
    title: "The Nutcracker: A Child's Tale",
    venue: { name: "Tower Theatre", town: "Bend" },
    url: "https://www.towertheatre.org/event/nutcracker",
    dates: [
      { day: TODAY, start: "13:30" },
      { day: TODAY, start: "18:00" },
      { day: "2026-11-22", start: "12:00" },
    ],
  }),
];

describe("programKind", () => {
  it("annual events and one-offs are special, even many branches of one", () => {
    expect(programKind(SPECIALS().slice(0, 1))).toBe("special");
    expect(programKind(SPECIALS().slice(1, 3))).toBe("special");
  });
  it("a short run of shows is special", () => {
    expect(programKind([SPECIALS()[4]])).toBe("special");
  });
  it("a library series is regular; elsewhere it needs three weeks", () => {
    const lib = row("series", {
      title: "Book Club",
      dates: [{ day: "2026-11-23" }, { day: "2026-12-28" }],
    });
    expect(programKind([lib])).toBe("regular");
    const twoShows = row("series", {
      title: "Symphony of Lights",
      venue: { name: "Tower Theatre", town: "Bend" },
      dates: [{ day: "2026-12-14" }, { day: "2026-12-21" }],
    });
    expect(programKind([twoShows])).toBe("special");
    const art = row("series", {
      title: "Art with Sarah",
      venue: { name: "TEAL Tea + Art Lounge", town: "Bend" },
      dates: weekly("2026-12-02", 3),
    });
    expect(programKind([art])).toBe("regular");
  });
  it("a holiday run at a library (back-to-back days) stays special", () => {
    const train = row("series", {
      title: "Michael the Train Man",
      dates: Array.from({ length: 8 }, (_, i) => ({
        day: addDays("2026-12-19", i),
      })),
    });
    expect(programKind([train])).toBe("special");
  });
});

describe("buildPrograms", () => {
  const rows = [...librarySet(), ...SPECIALS()];

  it("shows 66 library rows as 11 regulars, one per program", () => {
    const ps = buildPrograms(rows, NOW);
    const regulars = ps.filter((p) => p.kind === "regular");
    expect(regulars).toHaveLength(11);
    expect(regulars.every((p) => p.branches.length === 6)).toBe(true);
    expect(placesLabel(regulars[0].branches)).toBe("6 libraries");
    const specials = ps.filter((p) => p.kind === "special");
    expect(specials.map((p) => p.title)).toEqual([
      "Pop-Up Exhibits",
      "Sunriver Winter Fest",
      "The Nutcracker: A Child's Tale",
      "Community Christmas Tree Lighting",
    ]);
    // Two Pop-Up rows, one program.
    expect(specials[0].branches).toHaveLength(2);
  });

  it("filters rows, never moving a program between sections", () => {
    const sisters = buildPrograms(
      rows,
      NOW,
      (r) => r.data.venue.town === "Sisters",
    );
    const story = sisters.find((p) => p.title === "Family Story Time")!;
    expect(story.kind).toBe("regular");
    expect(story.branches.map((b) => b.row.data.venue.name)).toEqual([
      "Sisters Library",
    ]);
    // Only Sisters' Pop-Up branch is left: still a special.
    const pop = sisters.find((p) => p.title === "Pop-Up Exhibits")!;
    expect(pop.kind).toBe("special");
    expect(pop.day).toBe("2026-12-02");
  });

  it("ages filter across both sections", () => {
    const all = buildPrograms(rows, NOW, (r) =>
      (r.data.ages?.tags ?? []).includes("All ages"),
    );
    expect(all.map((p) => p.title)).toEqual(["Sunriver Winter Fest"]);
  });

  it("drops unconfirmed and grown-up rows like the listing always has", () => {
    const ps = buildPrograms(
      [
        { ...SPECIALS()[0], confirm: "unconfirmed" },
        row("one_off", {
          title: "Wine walk",
          dates: [{ day: TODAY }],
          ages: { tags: [], kids: false, range: [21, 99] },
        }),
      ],
      NOW,
    );
    expect(ps).toEqual([]);
  });

  it("puts big specials first within a day", () => {
    const today = buildPrograms(rows, NOW)
      .filter((p) => p.kind === "special" && p.day === TODAY)
      .sort(bigFirst)
      .map((p) => p.title);
    expect(today).toEqual([
      "Sunriver Winter Fest",
      "The Nutcracker: A Child's Tale",
      "Pop-Up Exhibits",
    ]);
  });
});

describe("groups", () => {
  it("Saturday: today, Sunday as this weekend, then coming up", () => {
    expect(specialGroupOf(TODAY, TODAY)).toBe("today");
    expect(specialGroupOf("2026-11-22", TODAY)).toBe("weekend");
    expect(specialGroupOf("2026-11-23", TODAY)).toBe("later");
    expect(groupSpan("weekend", TODAY)).toEqual({
      from: "2026-11-22",
      to: "2026-11-22",
    });
  });
  it("Sunday has no this weekend; Tuesday's weekend is Friday to Sunday", () => {
    expect(groupSpan("weekend", "2026-11-22")).toBeNull();
    expect(groupSpan("weekend", "2026-11-24")).toEqual({
      from: "2026-11-27",
      to: "2026-11-29",
    });
    expect(specialGroupOf("2026-11-25", "2026-11-24")).toBe("later");
  });
});

describe("patternLine", () => {
  it("one weekday and one time", () => {
    expect(patternLine(weekly("2026-11-21", 6), TODAY)).toBe(
      "Saturdays, 10:30 am",
    );
  });
  it("a run of weekdays, all mornings", () => {
    const d = ["2026-11-24", "2026-11-25", "2026-11-26"].flatMap((x) =>
      weekly(x, 4, "09:30"),
    );
    expect(patternLine(d, TODAY)).toBe("Tue–Thu mornings");
  });
  it("every other week, and monthly", () => {
    expect(
      patternLine(
        [0, 14, 28].map((n) => ({
          day: addDays("2026-12-01", n),
          start: "13:00",
        })),
        TODAY,
      ),
    ).toBe("Every other Tuesday, 1 pm");
    expect(
      patternLine(
        [
          { day: "2026-11-23", start: "15:00" },
          { day: "2026-12-28", start: "15:00" },
        ],
        TODAY,
      ),
    ).toBe("One Monday a month, 3 pm");
  });
  it("ignores a one-off odd day (a holiday shuffle)", () => {
    const d = [...weekly("2026-11-24", 5), { day: "2026-11-27" }];
    expect(patternLine(d, TODAY)).toBe("Tuesdays, 10:30 am");
  });
});

describe("patternLine across branches", () => {
  it("keeps a branch's days even when it has one date", () => {
    const main = weekly("2026-11-23", 6, "13:00"); // Mondays
    const laPine = [{ day: "2026-11-26", start: "13:00" }]; // a Thursday
    expect(patternLine([...main, ...laPine], TODAY)).toBe("Mondays, 1 pm");
    expect(patternLine([...main, ...laPine], TODAY, [main, laPine])).toBe(
      "Mon, Thu afternoons",
    );
  });
});

describe("scoopEvents, by program", () => {
  it("leads with specials and adds at most two regulars, once each", () => {
    const cards = scoopEvents([...librarySet(), ...SPECIALS()], NOW);
    // Big specials lead the day: annual, then another organizer, then the library.
    expect(cards.filter((c) => !c.regular).map((c) => c.title)).toEqual([
      "Sunriver Winter Fest",
      "The Nutcracker: A Child's Tale",
      "Pop-Up Exhibits",
    ]);
    const regulars = cards.filter((c) => c.regular);
    expect(regulars).toHaveLength(2);
    expect(new Set(cards.map((c) => c.title)).size).toBe(cards.length);
    expect(regulars[0]).toMatchObject({
      town: "6 libraries",
      href: "/events#regulars",
    });
    expect(cards[2].town).toBe("2 libraries");
  });
});
