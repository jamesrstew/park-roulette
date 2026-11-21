import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ageTags } from "@/lib/events/ages";
import type { EventRow } from "@/lib/events/model";
import { CATALOG } from "@/lib/news/catalog";
import { pacific } from "@/lib/news/time";
import {
  hazardsIn,
  ideaProblems,
  repeatOf,
  themesFor,
  titleSimilarity,
} from "./at-home";
import { agesLabel, composeAtHome, ideaSafety } from "./compose";
import {
  type AtHomeDraft,
  type AtHomeIdea,
  COPY,
  EVENTS_MAKE_LEAD_MIN,
  LATE_LIMIT_MIN,
  POST_KINDS,
  slotFor,
  WeekDraft,
} from "./model";
import { ageChips, pickWeekEvents, roundupWindow, timeLine } from "./roundup";
import type { SocialCtx } from "./validate";
import { validateAtHome } from "./validate";

/**
 * Batch 7: Saturday's "at home" carousel and Tuesday's family events
 * roundup. Pure tests (the database side is in social.db.test.ts).
 */

const WEEK = "2026-11-23";
/** Sunday, November 22, 2026, 6 pm Pacific: the routine plans this week. */
const SUNDAY = new Date("2026-11-23T02:00:00Z");

const idea = (over: Partial<AtHomeIdea> = {}): AtHomeIdea => ({
  title: "Hand turkeys",
  ages: { from: 2, to: 6 },
  need: ["paper", "crayons"],
  steps: [
    "Trace a hand on paper with the fingers spread wide",
    "Color each finger as a feather, then add a beak and feet",
  ],
  ...over,
});

const atHome = (over: Partial<AtHomeDraft> = {}): AtHomeDraft => ({
  type: "at_home",
  headline: "Thanksgiving weekend: 3 cozy ideas",
  highlight: "cozy",
  theme: "thanksgiving",
  ideas: [
    idea(),
    idea({
      title: "Thankful paper chain",
      ages: { from: 3, to: 9 },
      need: ["paper", "crayons", "tape"],
      steps: [
        "Tear paper into long strips, one for each person",
        "Draw one thing to be thankful for on each strip",
        "Loop and tape the strips into a chain for the table",
      ],
    }),
    idea({
      title: "Cardboard box fort",
      ages: { from: 2, to: 10 },
      need: ["big boxes", "blankets", "pillows"],
      steps: [
        "Stand the boxes up and drape blankets over the top",
        "Add pillows inside and read books in the fort",
      ],
    }),
  ],
  hashtags: ["#BendKids", "#CentralOregon", "#BendOregon"],
  ...over,
});

function ctx(over: Partial<SocialCtx> = {}): SocialCtx {
  return {
    now: SUNDAY,
    catalog: CATALOG,
    parks: new Map(),
    events: new Map(),
    recent: [],
    planParks: [],
    cooling: new Set(),
    photoFor: () => null,
    dms: false,
    recentIdeas: [],
    ...over,
  };
}

describe("post kinds and slots", () => {
  it("adds events_week on Tuesday 7:30 am and at_home on Saturday 7:45 am", () => {
    expect(POST_KINDS).toEqual(
      expect.arrayContaining(["events_week", "at_home"]),
    );
    const tue = slotFor("events_week", WEEK);
    expect(tue.date).toBe("2026-11-24");
    expect(tue.publishAt.toISOString()).toBe("2026-11-24T15:30:00.000Z");
    const sat = slotFor("at_home", WEEK);
    expect(sat.date).toBe("2026-11-28");
    expect(sat.publishAt.toISOString()).toBe("2026-11-28T15:45:00.000Z");
  });

  it("the migration and the schema allow both new kinds", () => {
    const sql = readFileSync("drizzle/0022_social_kinds.sql", "utf8");
    for (const k of POST_KINDS) expect(sql).toContain(`'${k}'`);
  });

  it("a week draft carries up to 3 posts", () => {
    const ok = WeekDraft.safeParse({ week_of: WEEK, posts: [atHome()] });
    expect(ok.success).toBe(true);
  });
});

describe("vercel.json covers both new windows in PDT and PST", () => {
  const crons = (
    JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons.filter((c) => c.path === "/api/cron/social");

  /** Does any social cron fire at this UTC instant (to the minute)? */
  const fires = (t: Date) =>
    crons.some((c) => {
      const [min, hour, , , dow] = c.schedule.split(" ");
      const inList = (field: string, v: number) =>
        field.split(",").some((part) => {
          if (part === "*") return true;
          const step = part.match(/^\*\/(\d+)$/);
          if (step) return v % Number(step[1]) === 0;
          const range = part.match(/^(\d+)-(\d+)$/);
          if (range) return v >= Number(range[1]) && v <= Number(range[2]);
          return Number(part) === v;
        });
      return (
        inList(min, t.getUTCMinutes()) &&
        inList(hour, t.getUTCHours()) &&
        inList(dow, t.getUTCDay())
      );
    });

  for (const [kind, week] of [
    ["events_week", "2026-11-23"], // PST
    ["events_week", "2027-06-07"], // PDT
    ["at_home", "2026-11-23"],
    ["at_home", "2027-06-07"],
  ] as const)
    it(`${kind}, week of ${week}: runs from its lead to its late limit`, () => {
      const { publishAt } = slotFor(kind, week);
      const lead = kind === "events_week" ? EVENTS_MAKE_LEAD_MIN : 30;
      for (
        let t = publishAt.getTime() - lead * 60_000;
        t <= publishAt.getTime() + LATE_LIMIT_MIN * 60_000;
        t += 15 * 60_000
      ) {
        const at = new Date(Math.floor(t / 900_000) * 900_000);
        expect(fires(at), at.toISOString()).toBe(true);
      }
    });
});

describe("season themes", () => {
  it("the catalog has 12 months of themes", () => {
    expect(CATALOG.season_themes.months).toHaveLength(12);
  });

  it("the Saturday after Thanksgiving: Thanksgiving first, then November's themes", () => {
    const t = themesFor("2026-11-28", CATALOG.season_themes);
    expect(t[0]).toMatchObject({
      id: "thanksgiving",
      kind: "holiday",
      date: "2026-11-26",
    });
    expect(t.map((x) => x.id)).toEqual(
      expect.arrayContaining(["first-snow", "fall-leaves"]),
    );
  });

  it("October has pumpkins and Halloween near the end; July has water play", () => {
    expect(
      themesFor("2026-10-24", CATALOG.season_themes).map((t) => t.id),
    ).toEqual(expect.arrayContaining(["halloween", "pumpkins"]));
    expect(
      themesFor("2027-07-17", CATALOG.season_themes).map((t) => t.id),
    ).toContain("backyard-water");
    expect(
      themesFor("2027-03-06", CATALOG.season_themes).map((t) => t.id),
    ).not.toContain("halloween");
  });
});

describe("at home: safety, brands, household", () => {
  it("bans knives, glue guns, stoves and heat at any age", () => {
    for (const words of [
      "Cut the apple with a knife",
      "Stick it on with a glue gun",
      "Warm it on the stove",
      "Bake the dough for ten minutes",
      "Pour in hot water",
      "Light a candle on the table",
      "Wipe it with bleach",
    ])
      expect(hazardsIn(words, 8), words).not.toEqual([]);
  });

  it("scissors only from 4, small parts and string from 3, balloons from 8", () => {
    expect(hazardsIn("Cut out the shapes with scissors", 2)).toEqual([
      "scissors for toddlers",
    ]);
    expect(hazardsIn("Cut out the shapes with scissors", 5)).toEqual([]);
    expect(hazardsIn("Sort the buttons and beads by color", 2)).toHaveLength(1);
    expect(hazardsIn("Sort the buttons and beads by color", 4)).toEqual([]);
    expect(hazardsIn("Tie yarn to the stick", 1)).toHaveLength(1);
    expect(hazardsIn("Keep the balloon in the air", 5)).toHaveLength(1);
    expect(hazardsIn("Keep the balloon in the air", 8)).toEqual([]);
  });

  it("refuses prep the night before (it goes out Saturday morning)", () => {
    expect(hazardsIn("Freeze toys in water overnight", 4)).toHaveLength(1);
    expect(hazardsIn("Let the paint dry for a few hours", 4)).toHaveLength(1);
    expect(hazardsIn("Kids can play this for ages", 4)).toEqual([]);
  });

  it("refuses brands, capitalized product names and things to buy or print", () => {
    expect(
      ideaProblems(idea({ need: ["play-doh", "a rolling pin"] })).join(" "),
    ).toMatch(/no brands/);
    expect(
      ideaProblems(
        idea({
          steps: [
            "Build a tower out of Magnablocks pieces",
            "Knock it down and build again",
          ],
        }),
      ).join(" "),
    ).toMatch(/reads like a brand/);
    expect(
      ideaProblems(idea({ need: ["Paper", "crayons"] })).join(" "),
    ).toMatch(/lowercase/);
    expect(
      ideaProblems(
        idea({
          steps: [
            "Download the coloring page and print it out",
            "Color it in with crayons",
          ],
        }),
      ).join(" "),
    ).toMatch(/buy, print or watch/);
  });

  it("lets plain, safe ideas through (holidays and towns may be capitalized)", () => {
    expect(ideaProblems(idea())).toEqual([]);
    expect(
      ideaProblems(
        idea({
          title: "Thankful paper chain",
          steps: [
            "Tear paper into strips before Thanksgiving dinner",
            "Loop the links into a chain to hang in Bend style",
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("adds the water-safety line for water ideas under 6 only", () => {
    const tub = idea({
      title: "Bathtub boat race",
      need: ["foil", "a bathtub", "a little water"],
      steps: [
        "Fold foil into small boats, one for each racer",
        "Blow the boats across the bathtub",
      ],
    });
    expect(ideaSafety(tub)).toBe(COPY.waterSafety);
    expect(ideaSafety({ ...tub, ages: { from: 6, to: 10 } })).toBeNull();
    expect(ideaSafety(idea())).toBeNull();
  });
});

describe("at home: the 12-week idea cooldown by title", () => {
  it("matches reworded titles and not merely related ones", () => {
    expect(
      titleSimilarity("Ice painting", "Painting ice cubes"),
    ).toBeGreaterThanOrEqual(0.6);
    expect(titleSimilarity("Paper plate turkeys", "Paper plate turkey")).toBe(
      1,
    );
    expect(titleSimilarity("Pumpkin bowling", "Pumpkin painting")).toBeLessThan(
      0.6,
    );
    expect(repeatOf("Snow paint", ["Leaf rubbings", "Painting the snow"])).toBe(
      "Painting the snow",
    );
    expect(repeatOf("Hallway bowling", ["Leaf rubbings"])).toBeNull();
  });
});

describe("validateAtHome", () => {
  it("a good post: headline, one slide per idea, the sign-up close", async () => {
    const r = await validateAtHome(atHome(), WEEK, ctx());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.slotDate).toBe("2026-11-28");
    const kinds = r.spec!.slides.map((s) => s.t);
    expect(kinds).toEqual(["headline", "idea", "idea", "idea", "cta"]);
    const first = r.spec!.slides[1];
    expect(first).toMatchObject({
      t: "idea",
      title: "Hand turkeys",
      ages: "Ages 2 to 6",
      need: "paper, crayons",
    });
    expect(r.spec!.caption).toContain("1. Hand turkeys (ages 2 to 6)");
    expect(r.spec!.caption).toContain("You need: paper, crayons.");
    expect(r.spec!.caption).toContain(COPY.save);
    expect(r.spec!.caption).toContain("Link in bio.");
    expect(r.spec!.caption).not.toMatch(/https?:/);
    expect(r.spec!.facts.ideas).toEqual([
      "Hand turkeys",
      "Thankful paper chain",
      "Cardboard box fort",
    ]);
  });

  it("refuses a theme that isn't offered for that Saturday", async () => {
    const r = await validateAtHome(atHome({ theme: "pumpkins" }), WEEK, ctx());
    expect(r.errors.join(" ")).toMatch(/isn't offered/);
  });

  it("refuses a hazard, a repeat in the cooldown, a repeat in the post, and a wrong count", async () => {
    const d = atHome();
    d.ideas[0] = idea({
      steps: [
        "Cut the turkey shapes out with scissors",
        "Glue on feathers with a glue gun",
      ],
    });
    d.ideas[2] = idea({ title: "Hand turkey" });
    d.headline = "Thanksgiving weekend: 5 cozy ideas";
    const r = await validateAtHome(
      d,
      WEEK,
      ctx({ recentIdeas: ["Paper chain of thanks", "Thankful chain"] }),
    );
    const all = r.errors.join(" ");
    expect(all).toMatch(/scissors for toddlers/);
    expect(all).toMatch(/glue guns/);
    expect(all).toMatch(/too close to "Thankful chain"/);
    expect(all).toMatch(/repeats "Hand turkeys"/);
    expect(all).toMatch(/says 5, but there are 3/);
    expect(r.ok).toBe(false);
  });

  it("refuses links, first person and competitors in the words", async () => {
    const d = atHome();
    d.ideas[0] = idea({
      steps: [
        "We loved this one from bendfamilyloop.com",
        "Color each finger as a feather, then add a beak",
      ],
    });
    const r = await validateAtHome(d, WEEK, ctx());
    const all = r.errors.join(" ");
    expect(all).toMatch(/another newsletter/);
    expect(all).toMatch(/first person/);
    expect(all).toMatch(/no links/);
  });

  it("ages run whole years, to above from", () => {
    expect(agesLabel({ from: 0, to: 3 })).toBe("Under 4");
    const bad = WeekDraft.safeParse({
      week_of: WEEK,
      posts: [
        atHome({ ideas: [idea({ ages: { from: 5, to: 3 } }), idea(), idea()] }),
      ],
    });
    expect(bad.success).toBe(false);
  });

  it("composeAtHome writes the Facebook caption with the live link", () => {
    const spec = composeAtHome(atHome(), false);
    expect(spec.fbCaption).toContain("https://parkroulette.quest/ig?from=fb");
    expect(spec.alts).toHaveLength(spec.slides.length);
  });
});

// --- Tuesday's roundup --------------------------------------------------------

let nextId = 1;
function ev(e: {
  slug: string;
  day: string;
  start?: string;
  end?: string;
  more?: string[];
  town?: string;
  ages?: string | null;
  cost?: "free" | number | null;
  host?: string;
  venue?: string;
  title?: string;
  confirm?: "ok" | "unconfirmed";
  canceled?: string;
}): EventRow {
  const printed = e.ages === undefined ? "Ages 3 to 6" : e.ages;
  return {
    id: nextId++,
    slug: e.slug,
    kind: "series",
    status: "scheduled",
    confirm: e.confirm ?? "ok",
    lastSeenAt: null,
    factsChangedAt: new Date(),
    stateChangedAt: null,
    data: {
      title: e.title ?? `Event ${e.slug}`,
      dates: [e.day, ...(e.more ?? [])].map((day) => ({
        day,
        ...(e.start === undefined
          ? { start: "10:00" }
          : e.start
            ? { start: e.start }
            : {}),
        ...(e.end ? { end: e.end } : {}),
      })),
      venue: {
        name: e.venue ?? "Downtown Bend Library",
        town: e.town ?? "Bend",
      },
      ...(e.cost === null
        ? {}
        : {
            cost:
              e.cost === undefined || e.cost === "free"
                ? { text: "Free", prices: [], free: true }
                : {
                    text: `$${e.cost} kids`,
                    prices: [{ label: "kids", amount: e.cost }],
                    free: false,
                  },
          }),
      ...(printed ? { ages_text: printed } : {}),
      ages: ageTags(printed),
      what: "A kids' event for the tests, with enough words in it.",
      url: "https://www.deschuteslibrary.org/event",
      ...(e.host ? { organizer: { name: e.host, url: "https://x.org" } } : {}),
      evidence: [
        { url: "https://www.deschuteslibrary.org/event", quote: "quote quote" },
      ],
      point: null,
      checkQuote: "quote",
      ...(e.canceled ? { statusByDay: { [e.canceled]: "canceled" } } : {}),
    } as EventRow["data"],
  };
}

describe("the roundup's window and wording", () => {
  const tue = slotFor("events_week", WEEK);
  const w = roundupWindow(tue.date, tue.publishAt);

  it("runs from 12 hours after the post to the end of Monday", () => {
    expect(w.label).toBe("Tue, Nov 24 to Mon, Nov 30");
    expect(w.caption).toBe("Nov 24 to 30");
    expect(w.from.toISOString()).toBe("2026-11-25T03:30:00.000Z");
    expect(pacific(new Date(w.to.getTime() - 1)).date).toBe("2026-11-30");
    const dec = slotFor("events_week", "2026-12-28");
    expect(roundupWindow(dec.date, dec.publishAt).caption).toBe(
      "Dec 29 to Jan 4",
    );
  });

  it("short times and merged age chips", () => {
    expect(timeLine({ start: "13:00", end: "15:00" })).toBe("1 to 3 pm");
    expect(timeLine({ start: "11:00", end: "12:00" })).toBe("11 am to noon");
    expect(timeLine({ start: "18:00" })).toBe("Starts 6 pm");
    expect(ageChips(["Ages 0-3", "Ages 4-7", "Ages 8-12"])).toEqual([
      "Ages 0 to 12",
    ]);
    expect(ageChips(["Ages 0-3", "Ages 8-12"])).toEqual([
      "Ages 0 to 3",
      "Ages 8 to 12",
    ]);
    expect(ageChips(["All ages"])).toEqual(["All ages"]);
    // The printed range wins: a chip is never wider than the page says.
    expect(ageChips(["Ages 0-3", "Ages 4-7", "Ages 8-12"], [3, 8])).toEqual([
      "Ages 3 to 8",
    ]);
    expect(ageChips(["Ages 4-7", "Ages 8-12"], [6, 99])).toEqual([
      "Ages 6 and up",
    ]);
  });
});

describe("pickWeekEvents", () => {
  const tue = slotFor("events_week", WEEK);
  const w = roundupWindow(tue.date, tue.publishAt);
  const now = new Date(tue.publishAt.getTime() - 30 * 60_000);

  it("skips the week with fewer than 4 events", () => {
    const r = pickWeekEvents(
      [
        ev({ slug: "a", day: "2026-11-25" }),
        ev({ slug: "b", day: "2026-11-26" }),
        ev({ slug: "c", day: "2026-11-27" }),
      ],
      w,
      now,
    );
    expect(r.skip).toMatch(/Only 3/);
    expect(r.events).toEqual([]);
  });

  it("only confirmed, scheduled kids' events with printed ages, a time and a cost, inside the window", () => {
    const r = pickWeekEvents(
      [
        ev({ slug: "ok-1", day: "2026-11-25" }),
        ev({ slug: "ok-2", day: "2026-11-26", town: "Redmond" }),
        ev({ slug: "ok-3", day: "2026-11-28", town: "Sisters" }),
        ev({ slug: "ok-4", day: "2026-11-30", town: "La Pine" }),
        ev({ slug: "no-ages", day: "2026-11-25", ages: null }),
        ev({ slug: "teens", day: "2026-11-25", ages: "Ages 13 to 18" }),
        ev({ slug: "no-cost", day: "2026-11-25", cost: null }),
        ev({ slug: "no-time", day: "2026-11-25", start: "" }),
        ev({ slug: "unconfirmed", day: "2026-11-25", confirm: "unconfirmed" }),
        ev({ slug: "canceled", day: "2026-11-27", canceled: "2026-11-27" }),
        ev({ slug: "too-soon", day: "2026-11-24", start: "14:00" }),
        ev({ slug: "next-week", day: "2026-12-01" }),
      ],
      w,
      now,
    );
    expect(r.skip).toBeNull();
    expect(r.events.map((e) => e.slug)).toEqual([
      "ok-1",
      "ok-2",
      "ok-3",
      "ok-4",
    ]);
  });

  it("at most 8, spread across towns and days, then ordered by date; no event is singled out", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) =>
        ev({ slug: `bend-wed-${i}`, day: "2026-11-25", start: `1${i}:00` }),
      ),
      ev({ slug: "redmond-fri", day: "2026-11-27", town: "Redmond" }),
      ev({ slug: "sisters-sat", day: "2026-11-28", town: "Sisters" }),
      ev({ slug: "madras-sun", day: "2026-11-29", town: "Madras" }),
      ev({ slug: "bend-mon", day: "2026-11-30" }),
    ];
    const r = pickWeekEvents(rows, w, now);
    expect(r.events).toHaveLength(8);
    const towns = r.events.map((e) => e.town);
    expect(new Set(towns)).toEqual(
      new Set(["Bend", "Redmond", "Sisters", "Madras"]),
    );
    expect(towns.filter((t) => t === "Bend").length).toBeGreaterThanOrEqual(4);
    const order = r.events.map((e) => `${e.day} ${e.start}`);
    expect(order).toEqual([...order].sort());
    expect(r.left).toHaveLength(4);
  });

  it("credits the host, and lists the other days it repeats", () => {
    const rows = [
      ev({
        slug: "skate",
        day: "2026-11-27",
        start: "13:00",
        end: "15:00",
        more: ["2026-11-28", "2026-11-29"],
        host: "Bend Park & Recreation District",
        venue: "The Pavilion",
        ages: "All ages",
        cost: 8,
      }),
      ev({ slug: "b", day: "2026-11-25", host: "Downtown Bend Library" }),
      ev({ slug: "c", day: "2026-11-26" }),
      ev({ slug: "d", day: "2026-11-28" }),
    ];
    const r = pickWeekEvents(rows, w, now);
    const skate = r.events.find((e) => e.slug === "skate")!;
    expect(skate).toMatchObject({
      weekday: "Fri",
      date: "Nov 27",
      time: "1 to 3 pm",
      ages: ["All ages"],
      cost: "$8 kids",
      host: "Bend Park & Recreation District",
      also: "Also Sat, Sun",
    });
    // The organizer is the venue itself: no "Hosted by" line.
    expect(r.events.find((e) => e.slug === "b")!.host).toBeNull();
  });

  it("drops a title that fails the text rules", () => {
    const rows = ["a", "b", "c", "d", "e"].map((s, i) =>
      ev({ slug: s, day: `2026-11-2${5 + (i % 3)}` }),
    );
    const r = pickWeekEvents(rows, w, now, (t) =>
      t.endsWith(" e") ? "profanity" : null,
    );
    expect(r.events.map((e) => e.slug)).not.toContain("e");
    expect(r.left.join(" ")).toMatch(/e: profanity/);
  });
});

describe("composeEventsWeek", () => {
  const tue = slotFor("events_week", WEEK);
  const w = roundupWindow(tue.date, tue.publishAt);
  const now = new Date(tue.publishAt.getTime() - 30 * 60_000);
  const rows = [
    ev({
      slug: "a",
      day: "2026-11-25",
      title: "Toddler Storytime",
      host: "Deschutes Public Library",
    }),
    ev({
      slug: "b",
      day: "2026-11-26",
      town: "Redmond",
      title: "Build It Club",
    }),
    ev({
      slug: "c",
      day: "2026-11-28",
      town: "Sisters",
      title: "Tree Lighting",
    }),
    ev({ slug: "d", day: "2026-11-30", town: "La Pine", title: "Kids Craft" }),
  ];

  it("a fixed headline naming no event, one equal slide per event, the details close", async () => {
    const { composeEventsWeek } = await import("./compose");
    const pick = pickWeekEvents(rows, w, now);
    const spec = composeEventsWeek(pick.events, w, false);
    expect(spec.kind).toBe("events_week");
    expect(spec.slides.map((s) => s.t)).toEqual([
      "headline",
      "event",
      "event",
      "event",
      "event",
      "cta",
    ]);
    const head = spec.slides[0];
    expect(head).toMatchObject({
      t: "headline",
      words: "Family events this week in Central Oregon",
      kicker: "Tue, Nov 24 to Mon, Nov 30",
      sub: ["Bend", "Redmond", "Sisters", "La Pine"],
    });
    for (const e of pick.events)
      expect(JSON.stringify(head)).not.toContain(e.title);
    expect(spec.slides.at(-1)).toMatchObject({
      t: "cta",
      line: "Details and more at",
      url: "parkroulette.quest/events",
      fine: COPY.eventsFine,
    });
    expect(spec.caption).toContain("Hosted by Deschutes Public Library.");
    expect(spec.caption).toContain(COPY.eventsDetails);
    expect(spec.caption).toContain(COPY.eventsFine);
    expect(spec.caption).not.toMatch(/\b(we|our|us)\b/i);
    expect(spec.facts.events).toEqual(
      pick.events.map((e) => ({ slug: e.slug, day: e.day })),
    );
  });
});
