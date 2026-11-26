import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ageTags } from "@/lib/events/ages";
import type { EventRow } from "@/lib/events/model";
import { CATALOG } from "@/lib/news/catalog";
import { pacific } from "@/lib/news/time";
import {
  hazardsIn,
  ideaProblems,
  payoffProblems,
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
    "Color each finger as a feather, add a beak",
  ],
  payoff: "Hang the flock on the fridge for the whole week",
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
        "Tear paper into strips, one each",
        "Draw one thankful thing on each",
        "Loop and tape them into a chain",
      ],
      payoff: "Hang it over the table and read them out at dinner",
    }),
    idea({
      title: "Cardboard box fort",
      ages: { from: 2, to: 10 },
      need: ["big boxes", "blankets", "pillows"],
      steps: [
        "Stand the boxes up and drape blankets over the top",
        "Add pillows inside and read books in the fort",
      ],
      payoff: "Now it's a secret clubhouse: password to get in",
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
    profiles: new Map(),
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

  it("the latest kinds migration and the schema allow every kind", () => {
    const sql = readFileSync("drizzle/0028_social_mashup.sql", "utf8");
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
  it("an intro sits under the headline, in our voice; a cliche or a second exclamation is refused", async () => {
    const ok = await validateAtHome(
      atHome({
        intro: "A slow, gray morning. Paper and crayons suit it.",
      }),
      WEEK,
      ctx(),
    );
    expect(ok.errors).toEqual([]);
    // Thanksgiving weekend: code's greeting, then the headline and intro.
    expect(ok.spec!.caption!.split("\n").slice(0, 4)).toEqual([
      "We hope the long weekend is treating you well.",
      ok.spec!.headline,
      "",
      "A slow, gray morning. Paper and crayons suit it.",
    ]);
    const bad = await validateAtHome(
      atHome({ intro: "So magical! Your kids will love it!" }),
      WEEK,
      ctx(),
    );
    const all = bad.errors.join(" ");
    expect(all).toMatch(/"magical"/);
    expect(all).toMatch(/2 exclamation points/);
  });
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
    expect(r.spec!.caption).toContain("You need paper and crayons.");
    expect(r.spec!.caption).toContain(COPY.captionClose.at_home);
    // Facebook: the close as written, then the post's own link (pending
    // until the post is stored and has an id).
    expect(r.spec!.fbCaption).toContain(
      "When you're ready to get out, our free Thursday email has a plan.\nDetails and links: https://parkroulette.quest/social?from=fb",
    );
    expect(r.spec!.fbCaption).not.toContain("Sign up free");
    expect(r.warnings.join(" ")).toMatch(/No intro/);
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
    const spec = composeAtHome(atHome(), {
      dms: false,
      slotDate: "2026-11-28",
    });
    expect(spec.fbCaption).toContain(
      "https://parkroulette.quest/social?from=fb",
    );
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

describe("the roundup caption's own words", () => {
  const e = (
    venue: string,
    town: string,
    cost: string | null,
    ages = ["Ages 5 to 10"],
  ) => ({ venue, town, cost, ages });
  it("names one venue, one town or the towns (Bend first), the youngest age and the free ones", async () => {
    const { eventsIntro } = await import("./compose");
    const teal = e("TEAL Tea + Art Lounge", "Bend", "$5 to $20");
    expect(
      eventsIntro([teal, teal, teal, { ...teal, ages: ["Ages 6 and up"] }]),
    ).toBe(
      "Four events, all at TEAL Tea + Art Lounge in Bend, for ages 5 and up.",
    );
    expect(
      eventsIntro([
        e("Downtown Library", "Bend", "Free"),
        e("Pine Nursery Park", "Bend", null, ["Ages 2 to 5"]),
      ]),
    ).toBe("Two events, all in Bend, for ages 2 to 10. One is free.");
    expect(
      eventsIntro([
        e("Redmond Library", "Redmond", "Free"),
        e("Fir Street Park", "Sisters", "Free", ["All ages"]),
        e("Downtown Library", "Bend", "Free"),
      ]),
    ).toBe("Three events in Bend, Redmond and Sisters. All are free.");
    // A venue that names its town isn't doubled.
    expect(
      eventsIntro([
        e("Redmond Library", "Redmond", null),
        e("Redmond Library", "Redmond", null),
      ]),
    ).toBe("Two events, all at Redmond Library, for ages 5 to 10.");
    // "and up" only when some chip is open-ended; all ages: no age clause.
    expect(
      eventsIntro([
        e("Downtown Library", "Bend", null, ["Ages 3 to 5"]),
        e("Downtown Library", "Bend", null, ["Ages 6 and up"]),
      ]),
    ).toBe("Two events, all at Downtown Library in Bend, for ages 3 and up.");
    expect(
      eventsIntro([
        e("Downtown Library", "Bend", null, ["Age 4"]),
        e("Downtown Library", "Bend", null, ["Age 4"]),
      ]),
    ).toBe("Two events, all at Downtown Library in Bend, for age 4.");
    expect(
      eventsIntro([
        e("Downtown Library", "Bend", null, ["All ages"]),
        e("Downtown Library", "Bend", null, ["Ages 6 and up"]),
      ]),
    ).toBe("Two events, all at Downtown Library in Bend.");
    // A venue name with a comma keeps it: the town is added, not swapped in.
    expect(
      eventsIntro([
        e("Art, Tea and Play", "Bend", null),
        e("Art, Tea and Play", "Bend", null),
      ]),
    ).toBe("Two events, all at Art, Tea and Play in Bend, for ages 5 to 10.");
  });
  it("fits the caption to 2,200 characters: descriptors, then also lines, then the latest events", async () => {
    const { fitRoundup } = await import("./roundup");
    const { CAPTION_MAX } = await import("./model");
    const long = (i: number) => ({
      slug: `e${i}`,
      day: `2026-11-${String(24 + (i % 7)).padStart(2, "0")}`,
      start: "10:00",
      title: `A Very Long Family Event Title Number ${i} With Many Words In It`,
      weekday: "Wed",
      date: `Nov ${24 + (i % 7)}`,
      time: "10:30 am to 12:30 pm",
      venue: `The Longest Venue Name In Central Oregon ${i}`,
      town: ["Bend", "Redmond", "Sisters", "La Pine"][i % 4],
      ages: ["Ages 3 to 10"],
      desc: "Kids paint, glue, stack, build and sculpt a whole lot of things",
      cost: "$15 to $25 kids",
      host: `The Central Oregon Family Arts Collective Number ${i}`,
      also: "Also Thu, Fri, Sat, Sun",
    });
    const eight = Array.from({ length: 8 }, (_, i) => long(i));
    const win = {
      label: "Tue, Nov 24 to Mon, Nov 30",
      caption: "Nov 24 to 30",
      firstDay: "2026-11-24",
    };
    const full = await import("./compose").then((c) =>
      c.composeEventsWeek(eight, win, false),
    );
    expect(full.caption!.length).toBeGreaterThan(CAPTION_MAX);
    const fit = fitRoundup(eight, win, false);
    if ("skip" in fit) throw new Error(fit.skip);
    expect(fit.spec.caption!.length).toBeLessThanOrEqual(CAPTION_MAX);
    // Descriptors went first, from the latest event back.
    expect(fit.cut[0]).toBe("e7: descriptor cut for caption length");
    // Then also lines, then events: never an event before every descriptor.
    const rank = (c: string) =>
      /descriptor/.test(c) ? 0 : /also line/.test(c) ? 1 : 2;
    expect(fit.cut.map(rank)).toEqual([...fit.cut.map(rank)].sort());
    const firstOut = fit.cut.findIndex((c) => rank(c) === 2);
    if (firstOut >= 0)
      expect(fit.cut.filter((c) => rank(c) === 0)).toHaveLength(8);
    expect(fit.events.length).toBeGreaterThanOrEqual(4);
    // The slides lose the same words as the caption.
    const slides = fit.spec.slides.filter((x) => x.t === "event");
    expect(slides).toHaveLength(fit.events.length);
    fit.events.forEach((e, i) =>
      expect(slides[i]).toMatchObject({ desc: e.desc, also: e.also }),
    );
    // A tighter limit takes the also lines, then the latest events, down to 4.
    const tight = fitRoundup(eight, win, false, 1500);
    if ("skip" in tight) throw new Error(tight.skip);
    expect(tight.events.every((e) => !e.desc && !e.also)).toBe(true);
    expect(tight.events.length).toBeGreaterThanOrEqual(4);
    expect(tight.events.length).toBeLessThan(8);
    expect(tight.cut.at(-1)).toMatch(/left out for caption length/);
    expect(tight.spec.caption!.length).toBeLessThanOrEqual(1500);
    // The opener counts toward the limit, and the tags still close it.
    const greeted = fitRoundup(
      eight,
      win,
      false,
      1500,
      "We hope Thanksgiving week is off to an easy start.",
    );
    if ("skip" in greeted) throw new Error(greeted.skip);
    expect(greeted.spec.caption!.length).toBeLessThanOrEqual(1500);
    expect(greeted.spec.caption!.split("\n")[0]).toBe(
      "We hope Thanksgiving week is off to an easy start.",
    );
    expect(greeted.spec.caption!.split("\n").at(-1)).toMatch(/^#/);
    expect(greeted.spec.opener).toBe(
      "We hope Thanksgiving week is off to an easy start.",
    );
    expect(greeted.spec.fbCaption!.split("\n")[0]).toBe(
      "We hope Thanksgiving week is off to an easy start.",
    );
    // Too long even at 4 events with nothing extra: no roundup.
    expect(fitRoundup(eight, win, false, 400)).toMatchObject({
      skip: expect.stringMatching(/over 400 characters even with 4 events/),
    });
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

  it("leaves out a printed cost the chip can't show", () => {
    const odd = ev({ slug: "odd", day: "2026-11-25" });
    (odd.data as { cost: unknown }).cost = {
      text: "By donation",
      prices: [],
      free: false,
    };
    const r = pickWeekEvents([odd], w, now);
    expect(r.left).toContain("odd: printed cost we can't show");
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
    expect(spec.caption).toContain(COPY.eventsFineCaption);
    expect(spec.caption).toContain(COPY.captionClose.events_week);
    // "We" is Park Roulette's closing line only; never "I".
    expect(spec.caption).not.toMatch(/\b(i|me|my)\b/i);
    const lines = spec.caption!.split("\n");
    expect(lines[2]).toBe(
      "Four events in Bend, Redmond, Sisters and La Pine, for ages 3 to 6. All are free.",
    );
    // Day headings, then one line per event, with where (venues differ).
    expect(lines).toContain("Wednesday, Nov 25");
    expect(lines).toContain("Monday, Nov 30");
    const storytime = lines[lines.indexOf("Wednesday, Nov 25") + 1];
    expect(storytime).toMatch(
      /^Toddler Storytime, starts 10 am at Downtown Bend Library\. /,
    );
    expect(spec.facts.events).toEqual(
      pick.events.map((e) => ({
        slug: e.slug,
        day: e.day,
        start: e.start,
        ages: e.ages,
        cost: e.cost,
      })),
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
    // 11 to 14 is a teen range now (ageTags): off the kids' listing.
    expect(r.events.map((e) => e.slug)).not.toContain("middle");
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
      "Wine Lounge",
      "Hookah Lounge",
      "Cigar Lounge",
      "Sports Lounge",
      "Wine Room",
      "Wine Co.",
      "Wine Cellar",
      "Gastro Lounge",
      "Art Bar",
      "Tea Room and Wine Bar",
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

  it("keeps a tea or art lounge (TEAL), and only when no other adult word is there", () => {
    const r = pickWeekEvents(
      [
        ...base,
        ev({ slug: "teal", day: "2026-11-29", venue: "TEAL Tea + Art Lounge" }),
      ],
      w,
      now,
    );
    expect(r.events.map((e) => e.slug)).toEqual(
      expect.arrayContaining(["teal"]),
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

describe("stillTrue compares the printed ages and cost", () => {
  it("a changed age range or price breaks the post's facts", async () => {
    const { stillTrue } = await import("./validate");
    const e = ev({ slug: "x", day: "2026-11-25", cost: 8 });
    const c = {
      now: new Date("2026-11-24T15:00:00Z"),
      catalog: CATALOG,
      parks: new Map(),
      events: new Map([["x", e]]),
    };
    const fact = {
      slug: "x",
      day: "2026-11-25",
      start: "10:00",
      ages: ["Ages 3 to 6"],
      cost: "$8 kids" as string | null,
    };
    const facts = (f: typeof fact) => ({
      parks: [],
      events: [f],
      venues: [],
      issue: null,
    });
    expect(stillTrue(facts(fact), c)).toBeNull();
    expect(stillTrue(facts({ ...fact, ages: ["Ages 3 to 6"] }), c)).toBeNull();
    expect(stillTrue(facts({ ...fact, ages: ["Ages 2 to 5"] }), c)).toMatch(
      /printed ages changed/,
    );
    expect(stillTrue(facts({ ...fact, cost: "$5 kids" }), c)).toMatch(
      /printed cost changed from \$5 kids to \$8 kids/,
    );
    expect(stillTrue(facts({ ...fact, cost: null }), c)).toMatch(
      /printed cost changed from none/,
    );
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

// --- James's feedback on the live posts (November 21) ---------------------------

describe("at home: every idea ends on a payoff", () => {
  const steps = [
    "Fold foil into small boats, one for each racer",
    "Run a few inches of water in the bathtub",
  ];

  it("takes a real ending: what the kid gets, or the moment it pays off", () => {
    for (const payoff of [
      "Hang it in a sunny window and watch the colors glow",
      "Now race them down the hallway",
      "Blow and see whose boat sails to the far end first",
      "Keep it on the fridge until the snow melts",
      "Take turns knocking the tower down",
      "Give one to each grown-up at dinner",
    ])
      expect(payoffProblems({ steps, payoff }), payoff).toEqual([]);
  });

  it("refuses a generic sign-off", () => {
    for (const payoff of [
      "Have fun!",
      "Enjoy!",
      "Have a blast!",
      "That's it!",
      "Happy crafting!",
      "And have so much fun",
    ])
      expect(payoffProblems({ steps, payoff }).join(" "), payoff).toMatch(
        /generic/,
      );
  });

  it("refuses another step, or a step said again", () => {
    expect(
      payoffProblems({
        steps,
        payoff: "Fold the corners in to make a point",
      }).join(" "),
    ).toMatch(/another step/);
    expect(
      payoffProblems({
        steps,
        payoff: "Put the boats in a row on the table",
      }).join(" "),
    ).toMatch(/another step/);
    expect(
      payoffProblems({
        steps,
        payoff: "Then fold foil into small boats, one for each racer",
      }).join(" "),
    ).toMatch(/repeats a step/);
  });

  it("the payoff is required, drawn as the slide's ending, and in the caption", async () => {
    const noPayoff = WeekDraft.safeParse({
      week_of: WEEK,
      posts: [
        atHome({
          ideas: atHome().ideas.map(({ payoff: _p, ...rest }) => {
            void _p;
            return rest as AtHomeIdea;
          }),
        }),
      ],
    });
    expect(noPayoff.success).toBe(false);
    const r = await validateAtHome(atHome(), WEEK, ctx());
    expect(r.errors).toEqual([]);
    const slide = r.spec!.slides[1];
    expect(slide).toMatchObject({
      t: "idea",
      payoff: "Hang the flock on the fridge for the whole week.",
    });
    expect(r.spec!.caption).toContain(
      `${COPY.payoffLabel}: Hang the flock on the fridge for the whole week.`,
    );
    const bad = atHome();
    bad.ideas[0] = idea({ payoff: "Have fun!!" });
    const rb = await validateAtHome(bad, WEEK, ctx());
    expect(rb.errors.join(" ")).toMatch(/generic/);
    const hazard = atHome();
    hazard.ideas[0] = idea({ payoff: "Now light a candle and admire it" });
    expect(
      (await validateAtHome(hazard, WEEK, ctx())).errors.join(" "),
    ).toMatch(/fire and flames/);
  });
});

describe("nothing overflows: the longest allowed copy fits at the larger type", async () => {
  const { ideaFit, eventFit, IDEA, EVENT } =
    await import("@/components/social/fit");
  const { IDEA_LIMITS } = await import("./model");
  const words = (n: number, w = "wwww") =>
    Array.from({ length: Math.ceil(n / (w.length + 1)) }, () => w)
      .join(" ")
      .slice(0, n);
  /** Real words, cut to exactly n characters at a word boundary or less. */
  const prose = (n: number) => {
    const src =
      "Set the cups in a row on the floor and take turns tossing rolled socks into them for points, then line up the best shots and count up the scores together";
    let out = "";
    for (const w of src.split(" "))
      if ((out ? out.length + 1 : 0) + w.length <= n)
        out += (out ? " " : "") + w;
      else break;
    return out.padEnd(n, "m").slice(0, n);
  };

  it("an idea at every limit, with the safety line, still fits", () => {
    const title = "Thankful paper chain fun";
    expect(title.length).toBe(IDEA_LIMITS.title);
    const third = Math.floor(IDEA_LIMITS.steps / 3);
    for (const steps of [
      // Three steps sharing the total, and two at the per-step limit.
      [prose(third), prose(third), prose(third)],
      [prose(IDEA_LIMITS.step), prose(IDEA_LIMITS.steps - IDEA_LIMITS.step)],
    ]) {
      const fit = ideaFit({
        title,
        need: prose(IDEA_LIMITS.needLine),
        steps,
        payoff: prose(IDEA_LIMITS.payoff),
        safety: COPY.waterSafety,
      });
      expect(fit.fits).toBe(true);
      expect(fit.body).toBeGreaterThanOrEqual(IDEA.body[IDEA.body.length - 1]);
    }
  });

  it("the schema holds every idea to those limits", () => {
    const long = WeekDraft.safeParse({
      week_of: WEEK,
      posts: [
        atHome({
          ideas: [
            idea({
              steps: [
                "Set out paper and crayons on the table",
                "Draw a big turkey with a feather for each kid",
                "Color every feather a different color of the fall",
              ],
            }),
            idea(),
            idea(),
          ],
        }),
      ],
    });
    expect(long.success).toBe(false);
    expect(JSON.stringify(long.error)).toMatch(/all steps together/);
  });

  it("a typical idea gets the largest body type", () => {
    const fit = ideaFit({
      title: "Snow paint",
      need: "spray bottles, water, food coloring",
      steps: [
        "Fill each bottle with water and a few drops of color",
        "Spray stripes, letters and pictures on clean snow",
      ],
      payoff: "Watch the whole yard turn into a rainbow",
      safety: COPY.waterSafety,
    });
    expect(fit).toMatchObject({ body: 58, fits: true });
  });

  it("an event with long but real-length words fits; a pathological one is caught", () => {
    expect(
      eventFit({
        title: "Winter Wildlife Walk for Families with the Naturalists",
        desc: prose(70),
        place: "At Deschutes Public Library, Downtown Bend Branch, Bend",
        chips: ["Ages 10 to 18", "$12.50 to $20 kids"],
        host: "Bend Park & Recreation District Youth Programs",
        also: "Also Wed, Thu, Fri, Sat",
      }).fits,
    ).toBe(true);
    expect(
      eventFit({
        title: words(80, "Mmmmmmm"),
        desc: prose(70),
        place: `At ${words(100, "Mmmmmmm")}, La Pine`,
        chips: ["Ages 10 to 18", "$12.50 to $20 kids"],
        host: words(80, "Mmmmmmm"),
        also: "Also Wed, Thu, Fri, Sat",
      }).fits,
    ).toBe(false);
    expect(EVENT.body[0]).toBeGreaterThan(50);
  });

  it("a long title never shrinks to the body's size (the body steps down instead)", () => {
    const f = eventFit({
      title: "Hydro Dipping Ornaments and Cards Playshop",
      desc: "Kids and a grown-up dip ornaments and cards into floating paint",
      place: "At TEAL Tea + Art Lounge, Bend",
      chips: ["Ages 6 and up"],
      host: null,
      also: null,
    });
    expect(f.fits).toBe(true);
    expect(f.title).toBeGreaterThanOrEqual(f.body * 1.3);
  });

  it("the roundup drops the descriptor, then the event, rather than overflow", () => {
    const tue = slotFor("events_week", WEEK);
    const w = roundupWindow(tue.date, tue.publishAt);
    const now = new Date(tue.publishAt.getTime() - 30 * 60_000);
    const r = pickWeekEvents(
      [
        ev({ slug: "a", day: "2026-11-25" }),
        ev({ slug: "b", day: "2026-11-26" }),
        ev({ slug: "c", day: "2026-11-27" }),
        ev({ slug: "d", day: "2026-11-28" }),
        ev({
          slug: "huge",
          day: "2026-11-29",
          title: words(80, "Mmmmmmm"),
          venue: words(100, "Mmmmmmm"),
          host: words(80, "Mmmmmmm"),
        }),
      ],
      w,
      now,
    );
    expect(r.events.map((e) => e.slug)).not.toContain("huge");
    expect(r.left.join(" ")).toMatch(/huge: too many words for one slide/);
  });
});

describe("the roundup's descriptor: the event's short, else its whole first sentence", () => {
  it("appears under the title on the slide and in the caption", async () => {
    const { composeEventsWeek } = await import("./compose");
    const tue = slotFor("events_week", WEEK);
    const w = roundupWindow(tue.date, tue.publishAt);
    const now = new Date(tue.publishAt.getTime() - 30 * 60_000);
    const pick = pickWeekEvents(
      ["a", "b", "c", "d"].map((slug, i) =>
        ev({ slug, day: `2026-11-2${5 + i}` }),
      ),
      w,
      now,
    );
    expect(pick.events[0].desc).toBe(
      "A kids' event for the tests, with enough words in it",
    );
    const spec = composeEventsWeek(pick.events, w, false);
    expect(spec.slides[1]).toMatchObject({
      t: "event",
      desc: "A kids' event for the tests, with enough words in it",
    });
    expect(spec.caption).toContain(
      "A kids' event for the tests, with enough words in it.",
    );
  });

  it("a descriptor that breaks a text rule is dropped, and the log says why", () => {
    const tue = slotFor("events_week", WEEK);
    const w = roundupWindow(tue.date, tue.publishAt);
    const now = new Date(tue.publishAt.getTime() - 30 * 60_000);
    const rows = ["a", "b", "c", "d"].map((slug, i) =>
      ev({ slug, day: `2026-11-2${5 + i}` }),
    );
    // The fallback sentence passes the short's own rules, but the roundup's
    // text rules drop it ("vote" reads as politics), and the log says why.
    rows[0].data.what = "Kids vote for the best gingerbread house.";
    const r = pickWeekEvents(rows, w, now);
    expect(r.events.find((e) => e.slug === "a")!.desc).toBeNull();
    expect(r.left.join(" ")).toMatch(/a: descriptor dropped \(.*politics/);
  });
});

describe("the payoff rules after review", () => {
  const steps = ["Fold paper into a fan", "Draw a turkey head on top"];
  it("refuses these four", () => {
    for (const payoff of [
      "Then glue the eyes on the turkey",
      "Now cut out the feathers carefully",
      "Let it dry until after lunch",
      "Get everything ready for next time",
    ])
      expect(payoffProblems({ steps, payoff }), payoff).not.toEqual([]);
  });
  it("accepts these four", () => {
    for (const payoff of [
      "Frame it as a gift for grandma",
      "Use it as a bookmark all winter",
      "Hide them, then hunt for them after lunch",
      "Stick it on the fridge for the holidays",
    ])
      expect(payoffProblems({ steps, payoff }), payoff).toEqual([]);
  });
});

describe("the routine's limits come from IDEA_LIMITS", () => {
  it("the plan text and the command file print the schema's numbers", async () => {
    const { IDEA_LIMITS, ideaLimitsText } = await import("./model");
    const L = IDEA_LIMITS;
    const text = ideaLimitsText();
    for (const part of [
      `${L.title} characters at most`,
      `${L.needItem} characters each and ${L.needLine} together`,
      `8 to ${L.step} characters each, ${L.steps} all together`,
      `12 to ${L.payoff} characters`,
    ])
      expect(text).toContain(part);
    expect(readFileSync("src/lib/social/store.ts", "utf8")).toContain(
      "${ideaLimitsText()}",
    );
    const cmd = readFileSync(".claude/commands/social-week.md", "utf8");
    for (const part of [
      `a short name, ${L.title} characters at most`,
      `${L.needItem} characters each and ${L.needLine} at most all together`,
      `8 to ${L.step} characters each and ${L.steps} at most all together`,
      `the ending, 12 to ${L.payoff} characters`,
    ])
      expect(cmd).toContain(part);
  });
});

describe("venues, ages and the top row after review", () => {
  it("exempts only a tea and art lounge, a tea lounge or an art studio", async () => {
    const { venueProblem } = await import("./validate");
    const v = (n: string) => venueProblem(n, { month: 12, label: "venue" });
    expect(v("TEAL Tea + Art Lounge")).toBeNull();
    expect(v("Bend Art Studio")).toBeNull();
    expect(v("The Tea Lounge")).toBeNull();
    expect(v("Tea & Wine Bar")).toMatch(/bar, brewery/);
    expect(v("Art Wine Lounge")).toMatch(/bar, brewery/);
    expect(v("Tea + Art Lounge and Wine Bar")).toMatch(/bar, brewery/);
  });

  it("compares an item's ages as parsed, not the printed words", async () => {
    const { stillTrue, parsedAges } = await import("./validate");
    const e = ev({ slug: "item", day: "2026-11-25", ages: "Ages 3 to 6" });
    const facts = {
      parks: [],
      events: [
        {
          slug: "item",
          day: "2026-11-25",
          start: "10:00",
          ages: [parsedAges(e.data.ages!)],
        },
      ],
      venues: [],
      issue: null,
    };
    const ctx = {
      now: new Date("2026-11-24T15:00:00Z"),
      catalog: CATALOG,
      parks: new Map(),
      events: new Map([["item", e]]),
    };
    // Reworded, same ages: still true.
    e.data.ages_text = "3-6 year olds";
    e.data.ages = ageTags("3-6 year olds");
    expect(stillTrue(facts, ctx)).toBeNull();
    // Different ages: changed.
    e.data.ages = ageTags("Ages 5 to 8");
    expect(stillTrue(facts, ctx)).toMatch(/printed ages changed/);
  });

  it("the time and Also lines never wrap: they shrink to one line", async () => {
    const { oneLine, TOP_ROW, textWidth } =
      await import("@/components/social/fit");
    const also = "Also Wed, Thu, Fri, Sat, Sun";
    const size = oneLine(also, TOP_ROW.also, TOP_ROW.width);
    expect(size).toBeLessThan(TOP_ROW.also);
    expect(textWidth(also, size)).toBeLessThanOrEqual(TOP_ROW.width);
    expect(oneLine("1 to 3 pm", TOP_ROW.time, TOP_ROW.width)).toBe(
      TOP_ROW.time,
    );
  });
});

describe("roundup slide polish", () => {
  it("a spaced dash in a title never hangs at a line's end", async () => {
    const { slideTitle } = await import("./compose");
    expect(slideTitle("B.U.R.S.T. - Wonderful Winter!")).toBe(
      "B.U.R.S.T. Wonderful Winter!",
    );
    expect(slideTitle("Pop-Up Exhibits - Sisters")).toBe(
      "Pop-Up Exhibits: Sisters",
    );
    expect(slideTitle("Pop-Up Exhibits")).toBe("Pop-Up Exhibits");
  });

  it("the cover's towns break into even lines, never one town alone", async () => {
    const { townLines } = await import("@/components/social/Slides");
    expect(townLines(["Bend", "Sisters", "Sunriver", "Redmond"])).toEqual([
      "Bend · Sisters",
      "Sunriver · Redmond",
    ]);
    for (const l of townLines([
      "Bend",
      "Madras",
      "Sisters",
      "La Pine",
      "Redmond",
      "Prineville",
    ]))
      expect(l.split(" · ").length).toBeGreaterThan(1);
  });
});

describe("the descriptor stays within two lines", () => {
  it("a size counts as fitting only when the descriptor wraps to two lines at most", async () => {
    const { eventFit, lines, CONTENT } =
      await import("@/components/social/fit");
    const desc =
      "Babies and grown-ups share stories, songs and rhymes on a parachute";
    const f = eventFit({
      title: "Baby Story Time",
      desc,
      place: "At Central Library, Bend",
      chips: ["Ages 0 to 1"],
      host: "Deschutes Public Library",
      also: null,
    });
    expect(f.fits).toBe(true);
    expect(lines(desc, f.body, CONTENT.width)).toBeLessThanOrEqual(2);
  });
});
