import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScoopWeather } from "@/components/news/scoop/ScoopWeather";
import type { EventRow, StoredEvent } from "@/lib/events/model";
import type { TextPeriod } from "@/lib/news/tiers";
import {
  ageChip,
  dayLabel,
  daySentence,
  excerpt,
  issueRow,
  nightOf,
  roughDay,
  roughLine,
  scoopEvents,
  scoopLine,
  scoopWeather,
  scoopWhen,
  shortCondition,
} from "./scoop";

// Saturday, Nov 21, 2026, 8 am Pacific.
const NOW = new Date("2026-11-21T16:00:00Z");

const period = (
  start: string,
  isDaytime: boolean,
  temperature: number,
  shortForecast: string,
  pop: number | null = null,
): TextPeriod => ({
  startTime: `${start}T${isDaytime ? "06" : "18"}:00:00-08:00`,
  isDaytime,
  temperature,
  shortForecast,
  probabilityOfPrecipitation: { value: pop },
});

describe("scoopWeather", () => {
  const periods = [
    period("2026-11-21", true, 42, "Mostly Sunny", 5),
    period("2026-11-21", false, 22, "Clear"),
    period("2026-11-22", true, 31, "Snow Showers", 80),
    period("2026-11-22", false, 18, "Snow"),
    period("2026-11-23", true, 44, "Partly Sunny"),
    period("2026-11-24", true, 46, "Sunny"),
  ];

  it("gives today and the next two days, with tiers and icons", () => {
    const d = scoopWeather(periods, NOW)!;
    expect(d.map((x) => x.label)).toEqual(["Today", "Sun", "Mon"]);
    expect(d[0]).toMatchObject({
      high: 42,
      low: 22,
      icon: "sun",
      tier: "fine",
    });
    expect(d[1]).toMatchObject({ condition: "Snow showers", pop: 80 });
    expect(d[2].low).toBeNull();
  });

  it("starts tomorrow once today's daytime period is gone (evening)", () => {
    const d = scoopWeather(periods.slice(1), NOW)!;
    expect(d.map((x) => x.date)).toEqual([
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
    ]);
  });

  it("hides when NWS gave nothing or too little", () => {
    expect(scoopWeather(null, NOW)).toBeNull();
    expect(scoopWeather([], NOW)).toBeNull();
    expect(scoopWeather(periods.slice(0, 3), NOW)).toBeNull();
  });

  it("says each day in words, and a rough day by its icon", () => {
    const d = scoopWeather(periods, NOW)!;
    expect(daySentence(d[1])).toBe(
      "Sunday: snow showers, high 31°, low 18°, 80% chance of snow.",
    );
    expect(roughLine(d[1])).toBe("Sunday looks snowy.");
    expect(shortCondition("Snow showers")).toBe("Snow");
    expect(shortCondition("Sunny")).toBe("Sunny");
  });
});

let id = 0;
function row(
  over: Partial<StoredEvent> & { dates: StoredEvent["dates"] },
  extra: Partial<EventRow> = {},
): EventRow {
  id++;
  return {
    id,
    slug: `e${id}`,
    kind: "one_off",
    status: "scheduled",
    confirm: "ok",
    lastSeenAt: null,
    factsChangedAt: NOW,
    stateChangedAt: null,
    ...extra,
    data: {
      title: `Event ${id}`,
      venue: { name: "Library", town: "Bend" },
      what: "Something fun for kids to do.",
      url: "https://example.org",
      evidence: [{ url: "https://example.org", quote: "A quote here" }],
      ages: { tags: ["Ages 4-7"], kids: true, range: [4, 7] },
      point: null,
      checkQuote: "A quote here",
      ...over,
    },
  };
}

describe("scoopEvents", () => {
  it("keeps listed, scheduled events, soonest first by day and time", () => {
    const rows = [
      row({ title: "Late", dates: [{ day: "2026-11-21", start: "13:00" }] }),
      row({ title: "Early", dates: [{ day: "2026-11-21", start: "10:00" }] }),
      row({ title: "Sunday", dates: [{ day: "2026-11-22" }] }),
      row({
        title: "Lights",
        dates: [{ day: "2026-11-15", end_day: "2027-01-03" }],
      }),
      row(
        { title: "Off", dates: [{ day: "2026-11-21" }] },
        { status: "canceled" },
      ),
      row(
        { title: "Maybe", dates: [{ day: "2026-11-21" }] },
        { confirm: "unconfirmed" },
      ),
      row({
        title: "Grown-ups",
        dates: [{ day: "2026-11-21" }],
        ages: { tags: [], kids: false, range: [18, 99] },
      }),
      row({
        title: "Postponed",
        dates: [{ day: "2026-11-22" }],
        statusByDay: { "2026-11-22": "postponed" },
      }),
      row({
        title: "Over",
        dates: [{ day: "2026-11-21", start: "06:00", end: "07:00" }],
      }),
    ];
    expect(scoopEvents(rows, NOW).map((e) => e.title)).toEqual([
      "Early",
      "Late",
      "Lights",
      "Sunday",
    ]);
  });

  it("skips an off date and shows the series' next scheduled one", () => {
    const rows = [
      row({
        title: "Story time",
        dates: [
          { day: "2026-11-22", start: "10:30" },
          { day: "2026-11-25", start: "10:30" },
        ],
        statusByDay: { "2026-11-22": "canceled" },
      }),
      row({
        title: "All off",
        dates: [{ day: "2026-11-22" }, { day: "2026-11-25" }],
        statusByDay: { "2026-11-22": "postponed", "2026-11-25": "canceled" },
      }),
      row(
        { title: "Canceled event", dates: [{ day: "2026-11-23" }] },
        { status: "canceled" },
      ),
    ];
    expect(scoopEvents(rows, NOW).map((e) => [e.title, e.when])).toEqual([
      ["Story time", "Wed, Nov 25 · 10:30 am"],
    ]);
  });

  it("looks two weeks out when the week is thin, and caps at 8", () => {
    const thin = [
      row({ title: "Soon", dates: [{ day: "2026-11-23" }] }),
      row({ title: "Ten days", dates: [{ day: "2026-12-01" }] }),
      row({ title: "Too far", dates: [{ day: "2026-12-10" }] }),
    ];
    expect(scoopEvents(thin, NOW).map((e) => e.title)).toEqual([
      "Soon",
      "Ten days",
    ]);
    const many = Array.from({ length: 12 }, () =>
      row({ dates: [{ day: "2026-11-22" }] }),
    );
    expect(scoopEvents(many, NOW)).toHaveLength(8);
  });

  it("labels the card: when, town, one age chip, free", () => {
    const [e] = scoopEvents(
      [
        row({
          title: "Lego",
          dates: [{ day: "2026-11-21", start: "13:00" }],
          venue: { name: "Library", town: "Redmond" },
          cost: { text: "Free", prices: [], free: true },
          ages: { tags: ["Ages 4-7", "Ages 8-12"], kids: true, range: [5, 12] },
        }),
      ],
      NOW,
    );
    expect(e).toEqual({
      slug: expect.any(String),
      title: "Lego",
      when: "Today · 1 pm",
      town: "Redmond",
      age: "Ages 4-12",
      free: true,
      href: expect.stringMatching(/^\/events\//),
      regular: false,
      annual: false,
      line: { kind: "what", text: "Something fun for kids to do" },
      place: "Library, Redmond",
      price: "Free",
      setting: null,
    });
  });
});

describe("card labels", () => {
  it("names the day close in, and a running event's end", () => {
    const today = "2026-11-21";
    expect(scoopWhen({ day: today, start: "10:30" }, today)).toBe(
      "Today · 10:30 am",
    );
    expect(scoopWhen({ day: "2026-11-22" }, today)).toBe("Tomorrow");
    expect(scoopWhen({ day: "2026-11-25", start: "12:00" }, today)).toBe(
      "Wed, Nov 25 · noon",
    );
    expect(scoopWhen({ day: "2026-11-15", end_day: "2027-01-03" }, today)).toBe(
      "Through Jan 3",
    );
    expect(scoopWhen({ day: "2026-11-27", end_day: "2026-11-29" }, today)).toBe(
      "Fri, Nov 27 to Nov 29",
    );
  });

  it("joins age tags, and drops a chip that says nothing", () => {
    expect(ageChip(["Ages 0-3"])).toBe("Ages 0-3");
    expect(ageChip(["Ages 0-3", "Ages 4-7"])).toBe("Ages 0-7");
    expect(ageChip(["All ages"])).toBe("All ages");
    expect(ageChip(["Ages 0-3", "Ages 4-7", "Ages 8-12"])).toBeNull();
    expect(ageChip([])).toBeNull();
    expect(ageChip(undefined)).toBeNull();
  });

  it("cuts long words at a word break", () => {
    expect(excerpt("Short and sweet.")).toBe("Short and sweet.");
    const long = "The new zip line is a hit. ".repeat(10);
    const e = excerpt(long);
    expect(e.length).toBeLessThanOrEqual(121);
    expect(e.endsWith("…")).toBe(true);
    expect(excerpt("a\n\nb")).toBe("a b");
  });
});

describe("evenings and night lows", () => {
  const at = (date: string, hh: string, isDaytime: boolean, t: number) => ({
    startTime: `${date}T${hh}:00:00-08:00`,
    isDaytime,
    temperature: t,
    shortForecast: "Clear",
    probabilityOfPrecipitation: { value: null },
  });

  it("takes the night from noon on, never the early overnight period", () => {
    const periods = [
      at("2026-11-21", "00", false, 30), // last night's, after midnight
      at("2026-11-21", "06", true, 42),
      at("2026-11-21", "18", false, 22),
    ];
    expect(nightOf(periods, "2026-11-21")?.temperature).toBe(22);
    // No evening period: the last night period dated that day.
    expect(nightOf(periods.slice(0, 2), "2026-11-21")?.temperature).toBe(30);
    expect(nightOf([], "2026-11-21")).toBeUndefined();
    const d = scoopWeather(
      [
        ...periods,
        at("2026-11-22", "06", true, 40),
        at("2026-11-23", "06", true, 41),
      ],
      new Date("2026-11-21T16:00:00Z"),
    )!;
    expect(d[0].low).toBe(22);
  });

  it("skips today's daytime period from 6 pm Pacific", () => {
    const periods = [
      at("2026-11-21", "06", true, 42), // still in a cached forecast
      at("2026-11-21", "18", false, 22),
      at("2026-11-22", "06", true, 40),
      at("2026-11-23", "06", true, 41),
      at("2026-11-24", "06", true, 43),
    ];
    const before = scoopWeather(periods, new Date("2026-11-22T01:59:00Z"))!; // 5:59 pm
    expect(before[0].label).toBe("Today");
    const after = scoopWeather(periods, new Date("2026-11-22T02:00:00Z"))!; // 6 pm
    expect(after.map((x) => x.date)).toEqual([
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
    ]);
    expect(after[0].label).toBe("Sun");
  });
});

describe("the rough-day row", () => {
  const snowy: TextPeriod = {
    ...period("2026-11-22", true, 30, "Snow", 90),
    detailedForecast:
      "Snow. High near 30. New snow accumulation of 5 to 7 inches possible.",
  };
  const periods = [
    period("2026-11-21", true, 42, "Sunny"),
    snowy,
    period("2026-11-23", true, 40, "Sunny"),
  ];
  const html = (p: TextPeriod[]) =>
    renderToStaticMarkup(
      createElement(ScoopWeather, { days: scoopWeather(p, NOW)! }),
    );

  it("shows for a disruptive day, with an indoor events link", () => {
    const days = scoopWeather(periods, NOW)!;
    expect(days.map((d) => d.tier)).toEqual(["fine", "disruptive", "fine"]);
    expect(roughDay(days)?.long).toBe("Sunday");
    const out = html(periods);
    expect(out).toContain("Sunday looks snowy.");
    expect(out).toContain('href="/events?setting=indoor"');
    expect(out).toContain('data-scoop="indoor"');
    expect(out).toContain("border-dashed");
  });

  it("stays away on fine days", () => {
    const calm = [
      periods[0],
      period("2026-11-22", true, 40, "Sunny"),
      periods[2],
    ];
    expect(roughDay(scoopWeather(calm, NOW)!)).toBeNull();
    const out = html(calm);
    expect(out).not.toContain("looks");
    expect(out).not.toContain("/events?setting=indoor");
  });
});

describe("dayLabel", () => {
  const now = NOW.getTime(); // Saturday, Nov 21, 8 am Pacific
  it("says today, yesterday, a weekday this week, else the date", () => {
    expect(dayLabel("2026-11-21T15:30:00Z", now)).toBe("Today");
    expect(dayLabel("2026-11-21T08:30:00Z", now)).toBe("Today"); // 12:30 am Pacific
    expect(dayLabel("2026-11-21T07:30:00Z", now)).toBe("Yesterday"); // 11:30 pm Friday
    expect(dayLabel("2026-11-19T20:00:00Z", now)).toBe("Thursday");
    expect(dayLabel("2026-11-14T20:00:00Z", now)).toBe("Nov 14");
  });
});

describe("issueRow", () => {
  const issue = {
    issueDate: "2026-11-19", // a Thursday
    subject: "Farewell Bend before the snow",
    pick: { slug: "farewell-bend-park-bend", name: "Farewell Bend Park" },
  };
  const at = (iso: string) => new Date(iso);

  it("shows the pick Thursday to Sunday of the issue's week", () => {
    for (const t of [
      "2026-11-19T17:00:00Z", // Thu 9 am
      "2026-11-21T16:00:00Z", // Sat
      "2026-11-23T07:00:00Z", // Sun 11 pm
    ])
      expect(issueRow(issue, at(t))).toEqual({
        kind: "pick",
        pick: issue.pick,
        issueDate: "2026-11-19",
      });
  });

  it("shows the latest issue the rest of the week, or with no pick", () => {
    for (const t of [
      "2026-11-23T08:30:00Z", // Mon 12:30 am
      "2026-11-25T20:00:00Z", // Wed
    ])
      expect(issueRow(issue, at(t)).kind).toBe("issue");
    expect(
      issueRow({ ...issue, pick: null }, at("2026-11-21T16:00:00Z")),
    ).toEqual({
      kind: "issue",
      subject: "Farewell Bend before the snow",
      issueDate: "2026-11-19",
    });
  });
});

describe("the card's one-liner", () => {
  it("is the whole first sentence of what kids do", () => {
    expect(
      scoopLine(
        "Kids roll dice, invent their own heroes and team up for a silly one-sitting tabletop adventure led by a librarian.",
        "Sunriver Library",
      ),
    ).toEqual({
      kind: "what",
      text: "Kids roll dice, invent their own heroes and team up for a silly one-sitting tabletop adventure led by a librarian",
    });
  });

  it("drops logistics and rules for the venue (Gingerbread House Day)", () => {
    for (const what of [
      "No registration needed; families must bring their own candy and frosting to share.",
      "Registration is required for this class.",
      "Bring your own mat and water bottle.",
      "Kids can't bring food into the gallery.",
    ])
      expect(scoopLine(what, "Sunriver Nature Center"), what).toEqual({
        kind: "where",
        text: "Sunriver Nature Center",
      });
    // Ordinary sentences stay (no false hits on "know", "not" inside words).
    expect(scoopLine("Kids learn knots and make a keychain.", "X").kind).toBe(
      "what",
    );
  });

  it("falls back to where it is: nothing printed, or a sentence too long", () => {
    for (const what of [
      undefined,
      "",
      `Kids ${"build and paint and glue ".repeat(6)}all afternoon long at the big table.`,
    ])
      expect(scoopLine(what, "Sunriver Nature Center")).toEqual({
        kind: "where",
        text: "Sunriver Nature Center",
      });
  });

  it("every carousel card carries a line, a place and its tapes", () => {
    const [card] = scoopEvents(
      [
        row(
          {
            title: "Winter Fest",
            dates: [{ day: "2026-11-21", start: "11:00" }],
            what: "Snow games, cocoa and carolers on the Village green.",
            venue: { name: "The Village at Sunriver", town: "Sunriver" },
          },
          { kind: "annual" },
        ),
      ],
      NOW,
    );
    expect(card).toMatchObject({
      annual: true,
      regular: false,
      line: {
        kind: "what",
        text: "Snow games, cocoa and carolers on the Village green",
      },
      place: "The Village at Sunriver",
    });
  });
});
