import { describe, expect, it } from "vitest";
import type { EventRow, StoredEvent } from "@/lib/events/model";
import type { TextPeriod } from "@/lib/news/tiers";
import {
  ageChip,
  daySentence,
  excerpt,
  roughLine,
  scoopEvents,
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
