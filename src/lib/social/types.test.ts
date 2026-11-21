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
    expect(
      repeatOf({ title: "Snow paint" }, ["Leaf rubbings", "Painting the snow"]),
    ).toBe("Painting the snow");
    expect(
      repeatOf({ title: "Hallway bowling" }, ["Leaf rubbings"]),
    ).toBeNull();
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
      ctx({
        recentIdeas: [
          { title: "Paper chain of thanks", text: "Paper chain of thanks" },
          { title: "Thankful chain", text: "Thankful chain" },
        ],
      }),
    );
    const all = r.errors.join(" ");
    expect(all).toMatch(/scissors for toddlers/);
    expect(all).toMatch(/glue guns/);
    expect(all).toMatch(
      /too close to "(Paper chain of thanks|Thankful chain)"/,
    );
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

  it("short times and exact age chips", () => {
    expect(timeLine({ start: "13:00", end: "15:00" })).toBe("1 to 3 pm");
    expect(timeLine({ start: "11:00", end: "12:00" })).toBe("11 am to noon");
    expect(timeLine({ start: "18:00" })).toBe("Starts 6 pm");
    // No printed range: no chip (never a bracket guess wider than the page).
    expect(ageChips(["Ages 0-3", "Ages 4-7", "Ages 8-12"])).toBeNull();
    expect(ageChips(["All ages"])).toEqual(["All ages"]);
    expect(ageChips(["Ages 8-12"], [10, 18])).toEqual(["Ages 10 to 18"]);
    expect(ageChips(["Ages 0-3"], [2, 2])).toEqual(["Age 2"]);
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

  it("only confirmed, scheduled kids' events with printed ages and a time, inside the window", () => {
    const r = pickWeekEvents(
      [
        ev({ slug: "ok-1", day: "2026-11-25" }),
        ev({ slug: "ok-2", day: "2026-11-26", town: "Redmond" }),
        ev({ slug: "ok-3", day: "2026-11-28", town: "Sisters" }),
        ev({ slug: "ok-4", day: "2026-11-30", town: "La Pine" }),
        ev({ slug: "no-ages", day: "2026-11-25", ages: null }),
        ev({ slug: "teens", day: "2026-11-25", ages: "Ages 13 to 18" }),
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
    const r = pickWeekEvents(rows, w, now, (e) =>
      e.title.endsWith(" e") ? "profanity" : null,
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

  it("takes events with no printed cost, and shows no price for them, never free", async () => {
    const { composeEventsWeek, slideAlt } = await import("./compose");
    const mixed = [
      ev({ slug: "free", day: "2026-11-25", title: "Free Story Time" }),
      ev({ slug: "paid", day: "2026-11-26", cost: 8, title: "Clay Class" }),
      ev({ slug: "np-1", day: "2026-11-27", cost: null, title: "Lego Club" }),
      ev({ slug: "np-2", day: "2026-11-28", cost: null, title: "Baby Songs" }),
    ];
    const pick = pickWeekEvents(mixed, w, now);
    expect(pick.skip).toBeNull();
    expect(pick.events.map((e) => [e.slug, e.cost])).toEqual([
      ["free", "Free"],
      ["paid", "$8 kids"],
      ["np-1", null],
      ["np-2", null],
    ]);
    const spec = composeEventsWeek(pick.events, w, false);
    const lines = (spec.caption ?? "").split("\n");
    for (const t of ["Lego Club", "Baby Songs"]) {
      const line = lines.find((l) => l.includes(t))!;
      expect(line).toMatch(/Ages 3 to 6\.$/);
      expect(line).not.toMatch(/free|check|\$|null|undefined|\.\s*\./i);
    }
    expect(lines.find((l) => l.includes("Clay Class"))).toContain("$8 kids.");
    const alts = spec.slides
      .filter((x) => x.t === "event")
      .map((x) => slideAlt(x));
    expect(alts[2]).not.toMatch(/free|null|undefined|\.\s*\./i);
    expect(alts[2]).toMatch(/Ages 3 to 6\.$/);
  });

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
      pick.events.map((e) => ({ slug: e.slug, day: e.day, start: e.start })),
    );
  });
});

// --- Review fixes (after 3ad7000) ---------------------------------------------

describe("at home: the widened hazard list (one case per review example)", () => {
  const out = (text: string, youngest = 8) =>
    expect(hazardsIn(text, youngest), text).not.toEqual([]);
  const fine = (text: string, youngest = 2) =>
    expect(hazardsIn(text, youngest), text).toEqual([]);

  it("snow tunnels, and snow forts dug or crawled into", () => {
    out("Dig a snow tunnel through the drift");
    out("Build a snow cave in the yard");
    out("Make a snow fort and crawl inside");
    out("Dig into the snow bank to make a cave");
    fine("Pat snow into a low wall for a snowball target", 4);
  });

  it("frozen ponds, lakes, ice and thin ice", () => {
    out("Slide across the frozen pond");
    out("Look for animal tracks by the lake");
    out("Test the thin ice with a stick");
    out("Walk on the ice in boots");
    fine("Paint on the ice cubes with watercolors", 3);
  });

  it("trampolines", () => out("Bounce on the trampoline in socks"));

  it("standing on chairs, counters or tables", () => {
    out("Stand on a chair to reach the window");
    out("Climb onto the counter to help");
    out("Jump off the table into pillows");
    fine("Sit at the table and draw", 2);
  });

  it("street and driveway play", () => {
    out("Draw a hopscotch in the driveway");
    out("Race the boxes down the street");
    fine("Draw a hopscotch on the patio", 3);
  });

  it("kettles and anything heated, warm or cooked", () => {
    out("Fill a mug from the kettle");
    out("Use heated water for the paint");
    out("Warm the milk for cocoa");
    out("Use cooked pasta for the art");
    fine("Beat the heat with a cool towel race", 3);
    fine("Set up a pretend cooking station with pots", 3);
  });

  it("hydrogen peroxide, alcohol, glow sticks and sanitizer", () => {
    out("Mix hydrogen peroxide and soap for foam");
    out("Dab rubbing alcohol on the paper");
    out("Snap glow sticks for a dance party");
    out("Squirt hand sanitizer for slime");
  });

  it("pipe cleaners are not a chemical", () => {
    fine("Twist pipe cleaners into stars", 4);
    fine("Bend the pipe-cleaners into rings", 4);
  });

  it("glass and jars under 8", () => {
    out("Fill a jar with water", 5);
    out("Look through a glass of water", 5);
    fine("Fill a jar with water", 8);
  });

  it("toothpicks, skewers, needles, pins and tacks under 6", () => {
    for (const t of [
      "Poke holes with a toothpick",
      "Thread fruit on a skewer",
      "Sew with a needle and thread",
      "Hold the paper with pins",
      "Tack it up with a thumbtack",
    ])
      out(t, 5);
    fine("Thread pasta-free shapes with a toothpick", 6);
    fine("Glue pine needles onto paper", 4);
    fine("Set up bowling pins in the hall", 3);
  });

  it("choking items under 3", () => {
    for (const t of [
      "Count pennies into a cup",
      "Sort the coins by size",
      "Pour lentils into the bowl",
      "Fill the shaker with beans",
      "Roll chickpeas down the ramp",
      "Plant seeds in a cup",
      "Shake the bells to the music",
      "Stretch rubber bands over the box",
      "Clip paper clips into a chain",
      "Glue dry pasta onto the card",
      "Thread beads onto the string",
    ]) {
      out(t, 2);
      expect(
        hazardsIn(t, 3).filter((h) => /under 3/.test(h)),
        t,
      ).toEqual([]);
    }
  });

  it("freeze and freezer count as overnight prep, not freeze dance", () => {
    out("Freeze the toys in a muffin tin", 4);
    out("Take the ice tray out of the freezer", 4);
    fine("Play freeze dance in the kitchen", 2);
  });
});

describe("at home: the headline and caption are checked too", () => {
  it("a hazard or brand in the headline is refused", async () => {
    const r = await validateAtHome(
      atHome({ headline: "Jenga and glue gun fun: 3 ideas", highlight: "fun" }),
      WEEK,
      ctx(),
    );
    const all = r.errors.join(" ");
    expect(all).toMatch(/headline: not safe for these ages \(glue guns\)/);
    expect(all).toMatch(/headline: no brands or products \("Jenga"\)/);
  });

  it("brands as the first word of a sentence and the wider not-household list", () => {
    for (const first of [
      "Jenga blocks make a tall tower",
      "Twister dots go on the floor",
      "LEGO bricks build a bridge",
      "Play-Doh shapes make snowmen",
      "Crayola markers color the card",
      "Disney songs play while you dance",
    ])
      expect(
        ideaProblems(idea({ steps: [first, "Take turns and try again"] })).join(
          " ",
        ),
        first,
      ).toMatch(/no brands/);
    for (const step of [
      "Watch a short movie together",
      "Put a show on the tv",
      "Open the app on a screen",
      "Order a craft set to arrive",
      "Pick up paper at the store",
      "Visit the shop for supplies",
    ])
      expect(
        ideaProblems(idea({ steps: [step, "Take turns and try again"] })).join(
          " ",
        ),
        step,
      ).toMatch(/buy, print or watch/);
    expect(
      ideaProblems(
        idea({
          steps: ["Line the crayons up in order", "Count them out loud"],
        }),
      ),
    ).toEqual([]);
  });
});

describe("at home: the cooldown catches rephrased repeats", () => {
  it("title containment and the whole idea's words", () => {
    expect(titleSimilarity("Snow paint", "Painting the snow with colors")).toBe(
      1,
    );
    expect(
      repeatOf(
        {
          title: "Colored snow spray",
          text: "Colored snow spray. spray bottles. food coloring. Mix food coloring into the spray bottles. Spray colorful designs onto the snow",
        },
        [
          {
            title: "Snow paint",
            text: "Snow paint. spray bottles. water. food coloring. Fill each bottle with water and food coloring. Spray stripes and designs on clean snow",
          },
        ],
      ),
    ).toBe("Snow paint");
    // Two different ideas that share paper and crayons are not repeats.
    expect(
      repeatOf(
        {
          title: "Hand turkeys",
          text: "Hand turkeys. paper. crayons. Trace a hand with fingers spread. Color each finger as a feather",
        },
        [
          {
            title: "Thankful chain",
            text: "Thankful chain. paper. crayons. tape. Tear strips and draw something thankful. Loop the strips into a chain",
          },
        ],
      ),
    ).toBeNull();
  });
});

describe("the roundup: ages, venues and hosts", () => {
  const tue = slotFor("events_week", WEEK);
  const w = roundupWindow(tue.date, tue.publishAt);
  const now = new Date(tue.publishAt.getTime() - 30 * 60_000);
  const base = [
    ev({ slug: "a", day: "2026-11-25" }),
    ev({ slug: "b", day: "2026-11-26" }),
    ev({ slug: "c", day: "2026-11-27" }),
    ev({ slug: "d", day: "2026-11-28" }),
  ];

  it("needs the youngest printed age 10 or under, never teen-only, and prints the exact range", () => {
    const r = pickWeekEvents(
      [
        ...base,
        ev({ slug: "tweens", day: "2026-11-29", ages: "Ages 10 to 18" }),
        ev({ slug: "middle", day: "2026-11-29", ages: "Ages 11 to 14" }),
        ev({ slug: "grades", day: "2026-11-29", ages: "Grades 6-12" }),
        ev({ slug: "teens", day: "2026-11-29", ages: "Teens 13 to 17" }),
      ],
      w,
      now,
    );
    const slugs = r.events.map((e) => e.slug);
    expect(slugs).toContain("tweens");
    expect(slugs).not.toContain("middle");
    expect(slugs).not.toContain("grades");
    expect(slugs).not.toContain("teens");
    expect(r.events.find((e) => e.slug === "tweens")!.ages).toEqual([
      "Ages 10 to 18",
    ]);
    expect(r.events.find((e) => e.slug === "a")!.ages).toEqual(["Ages 3 to 6"]);
    expect(r.left.join(" ")).toMatch(/middle: youngest age 11/);
  });

  it("leaves out bars, breweries, taprooms, wineries and the like, as venue or host", () => {
    const adult = [
      "Bend Brewing Company",
      "Crux Fermentation Project Taproom",
      "The Tap House",
      "Silver Moon Brewery",
      "Pine Tavern",
      "Volcanic Wine Bar",
      "Faith Hope and Charity Winery",
      "Oregon Spirit Distillery",
      "Astro Lounge",
      "The Velvet Cocktail Lounge",
      "Old Mill Pub",
      "Sisters Saloon",
    ];
    const rows = [
      ...base,
      ...adult.map((venue, i) =>
        ev({ slug: `adult-${i}`, day: "2026-11-29", venue }),
      ),
      ev({
        slug: "hosted",
        day: "2026-11-29",
        venue: "Fir Street Park",
        host: "Deschutes Brewery",
      }),
    ];
    const r = pickWeekEvents(rows, w, now);
    expect(r.events.map((e) => e.slug).sort()).toEqual(["a", "b", "c", "d"]);
    expect(r.left.filter((l) => /bar, brewery or winery/.test(l))).toHaveLength(
      adult.length + 1,
    );
  });

  it("keeps a tea and art lounge: a bare lounge or wine isn't a bar", () => {
    const r = pickWeekEvents(
      [
        ...base,
        ev({ slug: "teal", day: "2026-11-29", venue: "TEAL Tea + Art Lounge" }),
        ev({ slug: "wine", day: "2026-11-29", venue: "Wine Country Farm" }),
      ],
      w,
      now,
    );
    expect(r.events.map((e) => e.slug)).toEqual(
      expect.arrayContaining(["teal", "wine"]),
    );
    expect(r.left.filter((l) => /bar, brewery or winery/.test(l))).toEqual([]);
  });

  it("runs the competitor, link and unsafe rules on venue and host names", () => {
    const r = pickWeekEvents(
      [
        ...base,
        ev({ slug: "comp", day: "2026-11-29", host: "Bend Family Loop" }),
        ev({ slug: "link", day: "2026-11-29", venue: "kidsfun.com hall" }),
        ev({ slug: "pol", day: "2026-11-29", host: "Vote Yes Campaign" }),
      ],
      w,
      now,
    );
    expect(r.events.map((e) => e.slug).sort()).toEqual(["a", "b", "c", "d"]);
    expect(r.left.join(" ")).toMatch(/comp: .*another newsletter/);
    expect(r.left.join(" ")).toMatch(/link: .*no links/);
    expect(r.left.join(" ")).toMatch(/pol: .*politics/);
  });

  it("an Unpack item at a brewery is cut too", async () => {
    const { venueProblem } = await import("./validate");
    expect(venueProblem("Bend Brewing", { month: 11, label: "venue" })).toMatch(
      /brewery/,
    );
    expect(
      venueProblem("Downtown Bend Library", { month: 11, label: "venue" }),
    ).toBeNull();
  });
});

describe("stillTrue compares the start time", () => {
  it("a moved start time breaks the post's facts", async () => {
    const { stillTrue } = await import("./validate");
    const e = ev({ slug: "moved", day: "2026-11-25", start: "11:00" });
    const facts = {
      parks: [],
      events: [{ slug: "moved", day: "2026-11-25", start: "10:00" }],
      venues: [],
      issue: null,
    };
    const c = {
      now: new Date("2026-11-24T15:00:00Z"),
      catalog: CATALOG,
      parks: new Map(),
      events: new Map([["moved", e]]),
    };
    expect(stillTrue(facts, c)).toMatch(/now starts at 11:00, not 10:00/);
    expect(
      stillTrue(
        { ...facts, events: [{ ...facts.events[0], start: "11:00" }] },
        c,
      ),
    ).toBeNull();
  });
});

describe("the towns line never starts or ends on a dot", () => {
  it("breaks between towns, joining with dots inside a line only", async () => {
    const { townLines } = await import("@/components/social/Slides");
    const lines = townLines([
      "Bend",
      "Madras",
      "Sisters",
      "La Pine",
      "Redmond",
      "Prineville",
    ]);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(l.startsWith("·")).toBe(false);
      expect(l.endsWith("·")).toBe(false);
      expect(l.length).toBeLessThanOrEqual(30);
    }
    expect(lines.join(" · ")).toBe(
      "Bend · Madras · Sisters · La Pine · Redmond · Prineville",
    );
  });
});
