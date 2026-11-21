import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/news/time";
import { scoopEvents } from "@/lib/scoop";
import {
  type EventDate,
  type EventRow,
  listingEnds,
  pacificAt,
  pacificToday,
  type StoredEvent,
  upcomingDates,
} from "./model";
import {
  bigFirst,
  buildPrograms,
  narrowPrograms,
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
    // Central and East Bend are two venues in one town: still 6.
    expect(placesLabel(regulars[0].branches)).toBe("6 libraries");
    const specials = ps.filter((p) => p.kind === "special");
    // Specials merge only on the same title at the same venue.
    expect(specials.map((p) => p.title)).toEqual([
      "Pop-Up Exhibits",
      "Sunriver Winter Fest",
      "The Nutcracker: A Child's Tale",
      "Pop-Up Exhibits",
      "Community Christmas Tree Lighting",
    ]);
  });

  it("never merges different one-offs that share a stem", () => {
    const ps = buildPrograms(
      [
        row("one_off", {
          title: "Family Movie: Elf",
          dates: [{ day: "2026-12-04", start: "18:00" }],
        }),
        row("one_off", {
          title: "Family Movie: Frozen",
          dates: [{ day: "2026-12-11", start: "18:00" }],
        }),
      ],
      NOW,
    );
    expect(ps.map((p) => p.title)).toEqual([
      "Family Movie: Elf",
      "Family Movie: Frozen",
    ]);
  });

  it("keeps two productions at one theater apart", () => {
    const theater = { name: "Tower Theatre", town: "Bend" };
    const url = "https://www.towertheatre.org/event/x";
    const ps = buildPrograms(
      [
        row("series", {
          title: "The Nutcracker: A Child's Tale",
          venue: theater,
          url,
          dates: [{ day: "2026-11-28" }, { day: "2026-11-29" }],
        }),
        row("series", {
          title: "The Nutcracker: Central Oregon Ballet",
          venue: theater,
          url,
          dates: [{ day: "2026-12-12" }, { day: "2026-12-13" }],
        }),
      ],
      NOW,
    );
    expect(ps.map((p) => [p.kind, p.title])).toEqual([
      ["special", "The Nutcracker: A Child's Tale"],
      ["special", "The Nutcracker: Central Oregon Ballet"],
    ]);
  });

  it("one venue with a series and a one-off is one branch, both linked", () => {
    const ps = buildPrograms(
      [
        row("series", {
          title: "Crafternoon",
          dates: weekly("2026-11-23", 5, "13:00"),
        }),
        row("one_off", {
          title: "Crafternoon",
          dates: [{ day: "2026-11-26", start: "13:00" }],
        }),
      ],
      NOW,
    );
    expect(ps).toHaveLength(1);
    expect(ps[0].branches).toHaveLength(1);
    expect(ps[0].branches[0].rows).toHaveLength(2);
    expect(ps[0].branches[0].row.kind).toBe("series");
    expect(placesLabel(ps[0].branches)).toBe("Central Library, Bend");
  });

  it("filters rows without moving a program between sections", () => {
    const all = buildPrograms(rows, NOW);
    const sisters = narrowPrograms(
      all,
      (r) => r.data.venue.town === "Sisters",
      TODAY,
    );
    const story = sisters.find((p) => p.title === "Family Story Time")!;
    expect(story.kind).toBe("regular");
    expect(story.branches.map((b) => b.row.data.venue.name)).toEqual([
      "Sisters Library",
    ]);
    const pop = sisters.find((p) => p.title === "Pop-Up Exhibits")!;
    expect(pop.kind).toBe("special");
    expect(pop.day).toBe("2026-12-02");
    // Every filtered program is the unfiltered one with fewer branches.
    for (const p of sisters) {
      const whole = all.find((x) => x.key === p.key)!;
      expect(whole.kind).toBe(p.kind);
      expect(p.branches.length).toBeLessThanOrEqual(whole.branches.length);
    }
    // A filter that keeps everything changes nothing.
    expect(narrowPrograms(all, () => true, TODAY)).toEqual(all);
  });

  it("a filtered regular keeps its kind even when one branch is left", () => {
    // Alone, a 2-date row elsewhere would be special; filtered, it stays regular.
    const art = (town: string, first: string) =>
      row("series", {
        title: "Art Club",
        venue: { name: `${town} Studio`, town },
        url: "https://art.example.org",
        dates: weekly(first, town === "Bend" ? 6 : 2),
      });
    const all = buildPrograms(
      [art("Bend", "2026-11-23"), art("Sisters", "2026-11-24")],
      NOW,
    );
    expect(all[0].kind).toBe("regular");
    const sisters = narrowPrograms(
      all,
      (r) => r.data.venue.town === "Sisters",
      TODAY,
    );
    expect(sisters[0].kind).toBe("regular");
    expect(programKind(sisters[0].branches.map((b) => b.row))).toBe("special");
  });

  it("ages filter across both sections", () => {
    const all = narrowPrograms(
      buildPrograms(rows, NOW),
      (r) => (r.data.ages?.tags ?? []).includes("All ages"),
      TODAY,
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

  it("a start with no end leaves the listing 2 hours later", () => {
    const story = row("one_off", {
      title: "Story Walk",
      dates: [{ day: TODAY, start: "10:00" }],
    });
    const at = (hhmm: string) => pacificAt(TODAY, hhmm);
    expect(buildPrograms([story], at("11:59"))).toHaveLength(1);
    expect(buildPrograms([story], at("12:01"))).toHaveLength(0);
    // With a printed end, it stays until then.
    const fair = row("one_off", {
      title: "Fair",
      dates: [{ day: TODAY, start: "10:00", end: "16:00" }],
    });
    expect(buildPrograms([fair], at("15:00"))).toHaveLength(1);
    expect(listingEnds({ day: TODAY })).toEqual(pacificAt("2026-11-22"));
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

describe("seasonal runs", () => {
  const away = { name: "Old Mill District", town: "Bend" };
  it("a 5-week nightly lights show is special", () => {
    const lights = row("series", {
      title: "Holiday Lights",
      venue: away,
      dates: Array.from({ length: 35 }, (_, i) => ({
        day: addDays("2026-11-27", i),
        start: "17:00",
      })),
    });
    expect(programKind([lights])).toBe("special");
  });
  it("a train ride on four weekends is special", () => {
    const train = row("series", {
      title: "Polar Express Train",
      venue: away,
      dates: [0, 7, 14, 21].flatMap((w) => [
        { day: addDays("2026-11-28", w) },
        { day: addDays("2026-11-29", w) },
      ]),
    });
    expect(programKind([train])).toBe("special");
  });
  it("a weekly class away from a library stays regular", () => {
    const art = row("series", {
      title: "Advanced Art",
      venue: { name: "TEAL Tea + Art Lounge", town: "Bend" },
      dates: [0, 7, 14].flatMap((w) => [
        { day: addDays("2026-12-02", w) },
        { day: addDays("2026-12-04", w) },
      ]),
    });
    expect(programKind([art])).toBe("regular");
  });
  it("a library's weekend story times stay regular", () => {
    const story = row("series", {
      title: "Weekend Story Time",
      dates: [0, 7, 14, 21].flatMap((w) => [
        { day: addDays("2026-11-28", w) },
        { day: addDays("2026-11-29", w) },
      ]),
    });
    expect(programKind([story])).toBe("regular");
  });
});

describe("time", () => {
  it("lists dates by day, then start", () => {
    const e = row("series", {
      title: "Two shows",
      dates: [
        { day: "2026-11-28", start: "18:00" },
        { day: "2026-11-28", start: "13:30" },
        { day: "2026-11-27", start: "19:00" },
      ],
    });
    expect(upcomingDates(e.data, NOW).map((d) => d.start)).toEqual([
      "19:00",
      "13:30",
      "18:00",
    ]);
  });
  it("reads Pacific wall time across DST and late at night", () => {
    expect(pacificAt("2026-03-08", "10:00").toISOString()).toBe(
      "2026-03-08T17:00:00.000Z",
    );
    expect(pacificAt("2026-11-01", "10:00").toISOString()).toBe(
      "2026-11-01T18:00:00.000Z",
    );
    // 11:30 pm Saturday Pacific is Sunday in UTC; today is still Saturday.
    const late = new Date("2026-11-22T07:30:00Z");
    expect(pacificToday(late)).toBe(TODAY);
    const sat = row("one_off", {
      title: "Late show",
      dates: [{ day: TODAY, start: "22:30", end: "23:45" }],
    });
    const ps = buildPrograms([sat], late);
    expect(ps[0].day).toBe(TODAY);
    expect(specialGroupOf(ps[0].day, pacificToday(late))).toBe("today");
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

describe("patternLine honesty", () => {
  it("one date left is a date, not a pattern", () => {
    expect(patternLine([{ day: "2026-12-03", start: "10:30" }], TODAY)).toBe(
      "",
    );
    expect(
      patternLine(
        [
          { day: "2027-01-09", start: "09:30" },
          { day: "2027-01-09", start: "10:45" },
        ],
        TODAY,
      ),
    ).toBe("");
  });
  it("two times a day on one weekday", () => {
    const d = [
      ...weekly("2026-11-23", 4, "09:30"),
      ...weekly("2026-11-23", 4, "10:30"),
    ];
    expect(patternLine(d, TODAY)).toBe("Mondays, 9:30 and 10:30 am");
    const e = [
      ...weekly("2026-11-23", 4, "10:00"),
      ...weekly("2026-11-23", 4, "16:00"),
    ];
    expect(patternLine(e, TODAY)).toBe("Mondays, 10 am and 4 pm");
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
      "Pop-Up Exhibits",
    ]);
    const regulars = cards.filter((c) => c.regular);
    expect(regulars).toHaveLength(2);
    expect(new Set(regulars.map((c) => c.title)).size).toBe(2);
    expect(regulars[0]).toMatchObject({
      town: "6 libraries",
      href: "/events#regulars",
    });
    expect(cards[2].town).toBe("Bend");
  });

  it("has no room for regulars when specials fill the row", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      row("one_off", {
        title: `Holiday thing ${String.fromCharCode(65 + i)}`,
        venue: { name: "Old Mill District", town: "Bend" },
        url: "https://oldmill.example.org",
        dates: [{ day: addDays(TODAY, i % 6), start: "12:00" }],
      }),
    );
    const cards = scoopEvents([...librarySet(), ...many], NOW);
    expect(cards).toHaveLength(8);
    expect(cards.some((c) => c.regular)).toBe(false);
  });

  it("skips a canceled first branch; title, link and time agree", () => {
    const off = row("series", {
      title: "Toddler Time: Snow",
      dates: weekly(TODAY, 4, "11:00"),
      statusByDay: { [TODAY]: "canceled" },
    });
    const other = row("series", {
      title: "Toddler Time: Bubbles",
      venue: { name: "Redmond Library", town: "Redmond" },
      dates: weekly("2026-11-22", 4, "10:00"),
    });
    const [card] = scoopEvents([off, other], NOW);
    expect(card).toMatchObject({
      slug: other.slug,
      href: "/events#regulars",
      when: "Next: Tomorrow · 10 am",
      regular: true,
    });
  });
});

describe("speed", () => {
  // Benchmark (Nov 21, 2026, M-series laptop): 300 rows, 12 dates each,
  // build + narrow + carousel in about 20 ms. The bound is loose for CI.
  it("builds 300 rows' programs well under a frame budget", () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      row(i % 3 ? "series" : "one_off", {
        title: `Program ${i % 40}`,
        venue: { name: `Library ${i % 7}`, town: "Bend" },
        dates: Array.from({ length: i % 3 ? 12 : 1 }, (_, k) => ({
          day: addDays("2026-11-20", k * 4 + (i % 5)),
          start: "10:30",
        })),
      }),
    );
    const t = performance.now();
    const ps = buildPrograms(rows, NOW);
    narrowPrograms(ps, (r) => r.id % 2 === 0, TODAY);
    scoopEvents(rows, NOW);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
