import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import type { SentIssue } from "./cooldowns";
import type { Issue } from "./issue";
import type { Plan } from "./plan-types";
import {
  type FetchResult,
  normalizeText,
  type ParkInfo,
  quoteHasDay,
  quoteHasPrice,
  quoteHasTime,
  blockedLink,
  siteOf,
  type ValidateContext,
  validateIssue,
  weatherNumberProblems,
  quoteHasHoursFor,
  styleProblems,
  outingEventEvidence,
  type StoredEventRef,
} from "./validate";

// --- Fixtures: one good issue for Thursday, Dec 3, 2026 --------------------

const DATE = "2026-12-03";
const SITE = "https://parkroulette.quest";

const catalog: Catalog = {
  version: 1,
  link_domains: [
    "bendparksandrec.org",
    "downtownbend.org",
    "deschuteslibrary.org",
  ],
  lead_domains: ["visitbend.com"],
  site_aliases: {},
  alias_pins: {},
  venue_aliases: [],
  walled_hosts: [],
  skip_dates: [{ date: "2026-12-24", reason: "Christmas Eve" }],
  breaks: [],
  parks: [],
  venues: [
    {
      id: "venue-pavilion",
      name: "The Pavilion",
      short_name: "The Pavilion",
      town: "Bend",
      address: "1001 SW Bradbury Way, Bend",
      kind: "skating",
      covered: true,
      enclosure: "covered",
      ages_label: "All ages",
      visit_minutes: 90,
      open_days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
      drive_minutes_from_downtown: 5,
      cost: "low",
      access_note: null,
      hours_url: null,

      fit: "both",
      what: "Skating under a roof.",
      weather: ["rain", "snow", "cold"],
      months: [11, 12, 1, 2],
      story_time: false,
      url: "https://www.bendparksandrec.org/facility/the-pavilion/",
      source: null,
      verified: true,
    },
    {
      id: "venue-library",
      name: "Central Library",
      short_name: "Central Library",
      town: "Bend",
      address: null,
      kind: "library",
      covered: true,
      enclosure: "indoor",
      ages_label: "All ages",
      visit_minutes: 90,
      open_days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
      drive_minutes_from_downtown: 5,
      cost: "free",
      access_note: null,
      hours_url: null,

      fit: "toddler",
      what: "Story time.",
      weather: ["rain"],
      months: [12],
      story_time: true,
      url: "https://www.deschuteslibrary.org/central",
      source: null,
      verified: true,
    },
    {
      id: "venue-unverified",
      name: "Mystery Gym",
      short_name: "Mystery Gym",
      town: "Bend",
      address: null,
      kind: "open_gym",
      covered: true,
      enclosure: "indoor",
      ages_label: "All ages",
      visit_minutes: 90,
      open_days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
      drive_minutes_from_downtown: 5,
      cost: "free",
      access_note: null,
      hours_url: null,

      fit: "both",
      what: "?",
      weather: ["rain"],
      months: [12],
      story_time: false,
      url: "https://www.bendparksandrec.org/mystery",
      source: null,
      verified: false,
    },
  ],
  event_series: [
    {
      id: "series-parade",
      name: "Christmas Parade",
      town: "Bend",
      what: "A parade.",
      months: [12],
      url: "https://www.downtownbend.org/parade",
      source: null,
      verified: true,
    },
  ],
  tips: [],
  challenges: [
    {
      id: "challenge-snow-stamp",
      title: "The snow stamp",
      text: "Snow stamp.",
      months: [12, 1, 2],
      verified: true,
    },
    {
      id: "challenge-first-critic",
      title: "First critic",
      text: "Be first.",
      months: [12],
      verified: true,
    },
  ],
  seasonal_defaults: [
    {
      id: "splash-pads-off",
      label: "Splash pads are off from October to May",
      match: ["splash pad"],
      with: ["off", "closed", "season"],
      months: [10, 11, 12, 1, 2, 3, 4, 5],
    },
  ],
  dress_tips: [
    {
      id: "dress-mittens",
      text: "Mittens beat gloves for kids under 5. Pack a spare pair for wet slides.",
      label: "Dress for it",
      triggers: ["cold", "snow"],
      months: [11, 12, 1, 2, 3],
      source: null,
      verified: true,
    },
  ],
  season_calendar: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    theme: "Theme",
    normal: [],
    tip: "Tip",
  })),
};

const park = (name: string, status = "active"): ParkInfo => ({
  name,
  city: "Bend",
  status,
  play: "playground",
  approved: true,
});
const parks = new Map<string, ParkInfo>([
  ["juniper-park-bend", park("Juniper Park")],
  ["harmon-park-bend", park("Harmon Park")],
  ["drake-park-bend", park("Drake Park")],
  ["pine-nursery-park-bend", park("Pine Nursery Park")],
]);

const plan: Plan = {
  issue_date: DATE,
  generated_at: "2026-12-03T12:30:00Z",
  calendar: { skip: null, holidays: [], breaks: [], dst: null, season: null },
  weather: {
    ok: true,
    source: "test",
    days: [],
    bad_days: ["2026-12-05"],
    labels: ["rain"],
    tiers: {
      counted: ["2026-12-05", "2026-12-06"],
      air: "nws_alerts",
      towns: {
        Bend: [
          {
            date: "2026-12-05",
            day: "Saturday",
            tier: "disruptive",
            disruptive: [{ hazard: "rain", why: "Rain (80%)", source: "text" }],
            plan_around: [],
            high: 44,
            pop: 80,
            short: "Rain",
            snow_in: 0,
            snow_text: null,
            gust_mph: null,
            aqi: null,
            aqi_observed: null,
            wind_mph: 10,
          },
          {
            date: "2026-12-06",
            day: "Sunday",
            tier: "fine",
            disruptive: [],
            plan_around: [],
            high: 45,
            pop: 10,
            short: "Partly Sunny",
            snow_in: 0,
            snow_text: null,
            gust_mph: 15,
            aqi: null,
            aqi_observed: null,
            wind_mph: 10,
          },
        ],
      },
    },
    best_slot: "Sunday, 11 am to 2 pm",
  },
  weather_mode: "indoor",
  indoor: {
    open: true,
    for_day: "2026-12-05",
    hazards: ["rain"],
    relaxed_to_weeks: 8,
    repeat: false,
    short: false,
    venues: [
      {
        id: "venue-library",
        name: "Central Library",
        town: "Bend",
        address: null,
        kind: "library",
        fit: "toddler",
        what: "Story time.",
        url: "https://www.deschuteslibrary.org/central",
        story_time: true,
        enclosure: "indoor",
        ages_label: "All ages",
        visit_minutes: 90,
        drive_minutes_from_downtown: 5,
        cost: "free",
        hours_url: null,
        access_note: null,
      },
    ],
    closer_to_home: [],
  },
  dress: null,
  forecast: {
    source: "test",
    days: [
      {
        date: "2026-12-04",
        label: "Friday",
        condition: "Sunny",
        icon: "sun",
        high: 42,
        low: 20,
        precip: 0,
      },
      {
        date: "2026-12-05",
        label: "Saturday",
        condition: "Rain",
        icon: "rain",
        high: 44,
        low: 30,
        precip: 80,
      },
      {
        date: "2026-12-06",
        label: "Sunday",
        condition: "Partly sunny",
        icon: "partly",
        high: 45,
        low: 28,
        precip: 10,
      },
    ],
  },
  wheel_pick: {
    slug: "juniper-park-bend",
    name: "Juniper Park",
    city: "Bend",
    url: `${SITE}/parks/juniper-park-bend`,
    features: [],
    reasons: [],
    eligible_count: 40,
    photo: null,
  },
  plan_b: { mode: "venue", relaxed_to_weeks: 4, venues: [], tips: [] },
  deltas: {
    since: null,
    changes: [
      {
        id: 7,
        park: "harmon-park-bend",
        park_name: "Harmon Park",
        city: "Bend",
        topic: "feature:swings",
        value: "yes",
        line: "It has: Swings",
        at: "2026-11-30T00:00:00Z",
      },
    ],
  },
  cooldowns: {
    wheel: [],
    featured: [],
    venue: [],
    tip: [],
    challenge: [],
    series: [],
    dress: [],
  },
  challenges: [],
  event_series: [],
  seasonal_defaults: [],
  rules: {},
};

const PARADE = "https://www.downtownbend.org/parade";
const SKATE = "https://www.bendparksandrec.org/facility/the-pavilion/";
const LIB = "https://www.deschuteslibrary.org/central";

const good = (): Issue => ({
  issue_date: DATE,
  subject: "Juniper Park before the rain",
  preview: "Plus a covered skate for Saturday and the Bend parade on Sunday.",
  hello: {
    text: "Hi there, James here. The first real cold snap of the season is coming, and Saturday looks wet across Bend, Redmond and Sisters. Friday and Sunday stay dry, so this week is about picking the right day and having a backup ready for the soggy one. Friday is dry and cool, and Sunday clears with sun and a light breeze.",
  },
  weekend_ahead: { note: "Best park window: Friday afternoon" },
  wheel_pick: {
    park: "juniper-park-bend",
    why_now:
      "The wheel landed on Juniper Park, and Friday is the dry window. The spinny things and swings are a good warmup before the weekend gets wet.",
    who_for:
      "Big kids who like to spin, and toddlers who are happy on the low swings near the restrooms.",
    bring: "Gloves for cold metal, a thermos, and dry socks in the car.",
  },
  plan_b: {
    kind: "venue",
    venue_id: "venue-library",
    for_day: "2026-12-05",
    why_kids:
      "Picture books, a play kitchen and Saturday stories, all warm and dry while the rain comes through.",
    hours: "10 am to 5 pm",
    cost: "Free",
    tip: "Park on the south side, and come at 10 for the stories.",
    evidence: [{ url: LIB, quote: "Saturday 10 am to 5 pm. Free." }],
  },
  heads_up: [
    {
      kind: "park_change",
      change_id: 7,
      park: "harmon-park-bend",
      text: "Families confirmed new swings at Harmon Park this week.",
    },
  ],
  weekend: [
    {
      name: "Bend Christmas Parade",
      series_id: "series-parade",
      day: "2026-12-06",
      time: "Noon",
      ages_text: "All ages",
      cost: "Free",
      place: "Harmon Blvd to Drake Park",
      town: "Bend",
      what: "Floats, music and candy along the route, with a playground at both ends for wiggly waiters.",
      url: PARADE,
      evidence: [
        {
          url: PARADE,
          quote:
            "Sunday, Dec. 6 at noon on Harmon Blvd. Free for everyone. All ages.",
        },
      ],
    },
    {
      name: "Family skate",
      day: "2026-12-05",
      time: "1 to 3 pm",
      cost: "$8 with skates",
      place: "The Pavilion",
      town: "Bend",
      what: "Open skate with walkers for little ones and plenty of room for big kids to race around.",
      url: SKATE,
      evidence: [
        { url: SKATE, quote: "Saturdays 1 to 3 p.m., $8 including skates" },
      ],
    },
  ],
  passport: {
    challenge_id: "challenge-snow-stamp",
    text: "If the snow sticks after Saturday's rain, stamp any playground with snow on the ground and add the snow stamp to your family passport.",
  },
  signoff: {
    text: "Spotted a closure or a new playground? Hit reply. Every note gets read.",
  },
});

const pages: Record<string, FetchResult> = {
  [PARADE]: {
    status: 200,
    finalUrl: PARADE,
    text: "Bend Christmas Parade. Sunday, Dec. 6 at noon on Harmon Blvd. Free for everyone. All ages.",
  },
  [SKATE]: {
    status: 200,
    finalUrl: SKATE,
    text: "Family skate: Saturdays 1 to 3 p.m., $8 including skates.",
  },
  [LIB]: {
    status: 200,
    finalUrl: LIB,
    text: "Central Library. Saturday 10 am to 5 pm. Free. Story time at 10.",
  },
};

function ctx(over: Partial<ValidateContext> = {}): ValidateContext {
  return {
    catalog,
    parks,
    history: [],
    plan,
    site: SITE,
    now: new Date("2026-12-03T15:00:00Z"),
    fetcher: async (url) =>
      pages[url] ?? { status: 404, finalUrl: url, text: "" },
    ...over,
  };
}

const rules = (r: { rule: string; path: string }[]) =>
  r.map((f) => `${f.path}:${f.rule}`);

// --- Tests ---------------------------------------------------------------

describe("validateIssue", () => {
  it("cuts an outing whose cost names no price (writer run 1)", async () => {
    const g = good();
    const r = await validateIssue(
      {
        ...g,
        weekend: [
          g.weekend![0],
          { ...g.weekend![1], cost: "Check the page for prices" },
        ],
      },
      ctx(),
    );
    expect(rules(r.dropped)).toContain("weekend.1:evidence");
    expect(r.dropped.some((d) => /names no price/.test(d.message ?? ""))).toBe(
      true,
    );
  });
  it("ages: only printed words (ages_text), mapped by code; never free text", async () => {
    const g = good();
    const w0 = g.weekend![0];
    const freeText = await validateIssue(
      {
        ...g,
        weekend: [{ ...w0, ages_text: undefined, ages: "Both" }, g.weekend![1]],
      },
      ctx(),
    );
    expect(rules(freeText.dropped)).toContain("weekend.0:schema");
    const notPrinted = await validateIssue(
      { ...g, weekend: [{ ...w0, ages_text: "Ages 4 to 7" }, g.weekend![1]] },
      ctx(),
    );
    expect(rules(notPrinted.dropped)).toContain("weekend.0:evidence");
    const unknownEvent = await validateIssue(
      { ...g, weekend: [{ ...w0, event: "no-such-event" }, g.weekend![1]] },
      ctx({ events: new Set(["fall-family-day-high-desert-museum"]) }),
    );
    expect(rules(unknownEvent.dropped)).toContain("weekend.0:catalog");
  });

  it("passes the good issue, with nothing cut", async () => {
    const r = await validateIssue(good(), ctx());
    expect(r.errors).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.words).toBeGreaterThanOrEqual(200);
    expect(r.words).toBeLessThanOrEqual(500);
  });

  it("red then green: an em dash fails the hello, a period fixes it", async () => {
    const bad = good();
    bad.hello.text = bad.hello.text.replace(
      "The first real",
      "Cold—the first real",
    );
    const red = await validateIssue(bad, ctx());
    expect(red.ok).toBe(false);
    expect(rules(red.errors)).toContain("hello:style");
    bad.hello.text = bad.hello.text.replace("Cold—the", "Cold. The");
    const green = await validateIssue(bad, ctx());
    expect(green.ok).toBe(true);
  });

  it("schema: rejects unknown keys and missing sections", async () => {
    const r = await validateIssue({ ...good(), sponsor: "x" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.errors[0].rule).toBe("schema");
    const noPassport: Partial<Issue> = good();
    delete noPassport.passport;
    expect((await validateIssue(noPassport, ctx())).ok).toBe(false);
  });

  it("length: a subject over 45 characters fails, and so does a bloated issue", async () => {
    const r = await validateIssue(
      { ...good(), subject: "A".repeat(10) + " " + "b".repeat(40) },
      ctx(),
    );
    expect(rules(r.errors)).toContain("subject:schema");
    const long = good();
    long.hello.text = "Plenty of words here. ".repeat(22).trim();
    long.wheel_pick.why_now = "Lots more words to say here. ".repeat(10).trim();
    long.wheel_pick.who_for = "Kids of every size and shape. ".repeat(6).trim();
    long.heads_up = Array.from({ length: 4 }, () => ({
      kind: "park_change" as const,
      change_id: 7,
      park: "harmon-park-bend",
      text: "Families confirmed new swings at Harmon Park this week. "
        .repeat(4)
        .trim(),
    }));
    long.bullets = Array.from(
      { length: 3 },
      () => "Plenty more words go right here, one line at a time for this.",
    );
    const big = await validateIssue(long, ctx());
    expect(rules(big.errors)).toContain("(issue):length");
  });

  it("subject: no emoji, no all-caps, no repeats, and it names the body", async () => {
    const emoji = await validateIssue(
      { ...good(), subject: "Juniper Park before the rain \u{1F327}" },
      ctx(),
    );
    expect(rules(emoji.errors)).toContain("subject:subject");
    const caps = await validateIssue(
      { ...good(), subject: "JUNIPER Park before the rain" },
      ctx(),
    );
    expect(rules(caps.errors)).toContain("subject:subject");
    const vague = await validateIssue(
      { ...good(), subject: "Lovely times ahead, friends" },
      ctx(),
    );
    expect(rules(vague.errors)).toContain("subject:subject");
    const old = good();
    old.issue_date = "2026-10-01";
    old.wheel_pick.park = "pine-nursery-park-bend";
    old.passport.challenge_id = "challenge-first-critic";
    old.weekend = undefined;
    old.plan_b = undefined;
    const repeat = await validateIssue(
      good(),
      ctx({
        history: [
          {
            issueDate: "2026-10-01",
            body: {
              ...old,
              hello: {
                text: "Different words entirely for this old one, nothing shared with the new hello at all.",
              },
              wheel_pick: {
                ...old.wheel_pick,
                why_now: "x y z",
                who_for: "a b c",
                bring: "q r s",
              },
            },
          },
        ],
      }),
    );
    expect(rules(repeat.errors)).toContain("subject:subject");
  });

  it("style: banned phrases, first-person claims and exclamation points", async () => {
    const banned = good();
    banned.plan_b!.why_kids += " A hidden gem.";
    const r1 = await validateIssue(banned, ctx());
    expect(rules(r1.dropped)).toContain("plan_b:style");
    expect(r1.issue?.plan_b).toBeUndefined();
    const claim = good();
    claim.hello.text += " Last weekend we went sledding there.";
    expect(rules((await validateIssue(claim, ctx())).errors)).toContain(
      "hello:style",
    );
    const bangs = good();
    bangs.hello.text += " So fun! Really!";
    const r3 = await validateIssue(bangs, ctx());
    expect(rules(r3.errors)).toContain("(issue):style");
    const one = good();
    one.hello.text += " So fun!";
    expect((await validateIssue(one, ctx())).ok).toBe(true);
  });

  it("links: off the allowlist or not 200 cuts the item", async () => {
    const off = good();
    off.weekend![0].url = "https://www.facebook.com/events/1";
    const r1 = await validateIssue(off, ctx());
    expect(rules(r1.dropped)).toContain("weekend.0:links");
    expect(r1.issue?.weekend).toHaveLength(1);
    const dead = await validateIssue(
      good(),
      ctx({
        fetcher: async (url) =>
          url === PARADE
            ? { status: 404, finalUrl: url, text: "" }
            : (pages[url] ?? { status: 404, finalUrl: url, text: "" }),
      }),
    );
    expect(rules(dead.dropped)).toContain("weekend.0:links");
    expect(dead.ok).toBe(true);
  });

  it("links: a listings site (visitbend.com) is discovery only, with its own reason", async () => {
    const i = good();
    i.weekend![0].url =
      "https://www.visitbend.com/event/bend-christmas-parade/";
    const r = await validateIssue(i, ctx());
    expect(rules(r.dropped)).toContain("weekend.0:links");
    expect(
      r.dropped.some((d) =>
        /visitbend\.com is a lead only: never a link or evidence\. Find the organizer's own page\./.test(
          d.message,
        ),
      ),
    ).toBe(true);
  });

  it("links: a site that resets the connection says so", async () => {
    const r = await validateIssue(
      good(),
      ctx({
        fetcher: async (url) =>
          url === PARADE
            ? {
                status: 0,
                finalUrl: url,
                text: "",
                unreachable: "connection reset",
                blockedKind: "reset",
              }
            : (pages[url] ?? { status: 404, finalUrl: url, text: "" }),
      }),
    );
    expect(
      r.dropped.some(
        (d) =>
          d.message ===
          "www.downtownbend.org didn't answer (connection reset).",
      ),
    ).toBe(true);
  });

  it("evidence: a quote no longer on the page cuts just that item", async () => {
    const r = await validateIssue(
      good(),
      ctx({
        fetcher: async (url) =>
          url === SKATE
            ? {
                status: 200,
                finalUrl: url,
                text: "Family skate: Saturdays 1 to 3 p.m., $10 including skates.",
              }
            : (pages[url] ?? { status: 404, finalUrl: url, text: "" }),
      }),
    );
    expect(rules(r.dropped)).toContain("weekend.1:evidence");
    expect(r.ok).toBe(true);
    expect(r.issue?.weekend?.map((w) => w.name)).toEqual([
      "Bend Christmas Parade",
    ]);
  });

  it("evidence: a price must be quoted", async () => {
    const i = good();
    i.weekend![1].evidence = [{ url: SKATE, quote: "Saturdays 1 to 3 p.m." }];
    const r = await validateIssue(i, ctx());
    expect(rules(r.dropped)).toContain("weekend.1:evidence");
  });

  it("dates: weekend outings must fall Friday to Sunday", async () => {
    const i = good();
    i.weekend![0].day = "2026-12-08";
    expect(rules((await validateIssue(i, ctx())).dropped)).toContain(
      "weekend.0:dates",
    );
  });

  it("catalog: unknown or unverified ids are cut (or fail a required part)", async () => {
    const venue = good();
    venue.plan_b!.venue_id = "venue-unverified";
    expect(rules((await validateIssue(venue, ctx())).dropped)).toContain(
      "plan_b:catalog",
    );
    const ch = good();
    ch.passport.challenge_id = "challenge-made-up";
    expect(rules((await validateIssue(ch, ctx())).errors)).toContain(
      "passport:catalog",
    );
  });

  it("plan: the Featured park must be the plan's pick", async () => {
    const i = good();
    i.wheel_pick.park = "drake-park-bend";
    const r = await validateIssue(i, ctx());
    expect(rules(r.errors)).toContain("wheel_pick:plan");
    const none = await validateIssue(good(), ctx({ plan: null }));
    expect(rules(none.errors)).toContain("issue_date:plan");
  });

  it("cooldowns: from sent history, per kind", async () => {
    const past = good();
    past.issue_date = "2026-11-19";
    past.hello.text =
      "Something else entirely, about frost and early sunsets in November.";
    past.weekend = undefined;
    past.plan_b = { ...past.plan_b!, text: "zz", title: "zz" };
    past.passport.text = "zz";
    past.wheel_pick = {
      park: "pine-nursery-park-bend",
      why_now: "a",
      who_for: "b",
      bring: "c",
    };
    const history: SentIssue[] = [{ issueDate: "2026-11-19", body: past }];
    const r = await validateIssue(good(), ctx({ history }));
    // The Indoor pick's cooldown is the plan's (plan.indoor.venues, built
    // by indoorVenues; see news.test.ts): a venue it left out is cut.
    const notOffered = await validateIssue(
      good(),
      ctx({
        history,
        plan: { ...plan, indoor: { ...plan.indoor!, venues: [] } },
      }),
    );
    expect(rules(notOffered.dropped)).toContain("plan_b:plan");
    // The snow stamp ran 2 weeks ago (12-week cooldown).
    expect(rules(r.errors)).toContain("passport:cooldown");
  });

  it("seasonal defaults: the usual seasonal state is cut from Heads up", async () => {
    const i = good();
    i.heads_up![0].text =
      "The splash pad at Harmon Park is off for the season.";
    expect(rules((await validateIssue(i, ctx())).dropped)).toContain(
      "heads_up.0:seasonal",
    );
  });

  it("heads up: a park change must be one of the plan's deltas", async () => {
    const i = good();
    i.heads_up![0].change_id = 99;
    expect(rules((await validateIssue(i, ctx())).dropped)).toContain(
      "heads_up.0:plan",
    );
  });

  it("similarity: a section that reads like a recent issue is cut", async () => {
    const past = good();
    past.issue_date = "2026-11-12";
    past.subject = "Totally different subject line";
    past.wheel_pick = {
      park: "pine-nursery-park-bend",
      why_now: "a",
      who_for: "b",
      bring: "c",
    };
    past.passport = {
      challenge_id: "challenge-first-critic",
      text: "Something else.",
    };
    past.hello = {
      text: "Other words for another week entirely, about leaves.",
    };
    past.plan_b = undefined;
    past.heads_up = undefined;
    past.weekend = [{ ...good().weekend![1], series_id: undefined }];
    const r = await validateIssue(
      good(),
      ctx({ history: [{ issueDate: "2026-11-12", body: past }] }),
    );
    expect(rules(r.dropped)).toContain("weekend.1:similarity");
  });

  it("photo: BPRD or Wikimedia only, and it must answer as an image", async () => {
    const i = good();
    i.wheel_pick.photo = {
      src: "https://www.bendparksandrec.org/wp-content/uploads/juniper.jpg",
      width: 1024,
      height: 685,
      alt: "Juniper Park in Bend",
      sourceUrl: "https://www.bendparksandrec.org/park/juniper-park/",
    };
    const img: FetchResult = {
      status: 200,
      finalUrl: i.wheel_pick.photo.src,
      text: "",
      contentType: "image/jpeg",
    };
    const withImg = (ok: boolean) =>
      ctx({
        fetcher: async (url) =>
          url === i.wheel_pick.photo!.src
            ? ok
              ? img
              : { ...img, contentType: "text/html" }
            : url === i.wheel_pick.photo!.sourceUrl
              ? { status: 200, finalUrl: url, text: "Juniper Park" }
              : (pages[url] ?? { status: 404, finalUrl: url, text: "" }),
      });
    expect((await validateIssue(i, withImg(true))).dropped).toEqual([]);
    const notImage = await validateIssue(i, withImg(false));
    expect(rules(notImage.dropped)).toContain("photo:links");
    expect(notImage.issue?.wheel_pick.photo).toBeUndefined();
    expect(notImage.ok).toBe(true);
    const flickr = good();
    flickr.wheel_pick.photo = {
      ...i.wheel_pick.photo,
      src: "https://live.staticflickr.com/x.jpg",
    };
    expect(
      rules((await validateIssue(flickr, withImg(true))).dropped),
    ).toContain("photo:links");
    const commons = good();
    commons.wheel_pick.photo = {
      src: "https://upload.wikimedia.org/a.jpg",
      width: 800,
      height: 600,
      alt: "A park",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
      author: "Someone",
      license: "All rights reserved",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    };
    expect(
      rules(
        (await validateIssue(commons, ctx({ fetcher: undefined }))).dropped,
      ),
    ).toContain("photo:catalog");
  });

  it("parents' corner: Instagram posts from the plan only, with their account, linked to the permalink", async () => {
    const permalink = "https://www.instagram.com/p/AbC123/";
    const snap = {
      kind: "instagram" as const,
      id: "17900000000000001",
      username: "thedumbdads",
      permalink,
      mediaType: "IMAGE" as const,
      productType: "FEED" as const,
      likes: 9000,
      timestamp: "2026-12-01T18:00:00+0000",
      carouselCount: null,
      avatar: null,
      image: {
        path: "news/ig/abc.jpg",
        width: 1080,
        height: 1080,
        type: "image/jpeg",
      },
    };
    const withIg = {
      ...plan,
      parents_corner: {
        candidates: [],
        instagram: [
          {
            kind: "instagram" as const,
            id: snap.id,
            username: "thedumbdads",
            avatar: null,
            permalink,
            mediaType: "IMAGE" as const,
            productType: "FEED" as const,
            imageUrl: "https://scontent.cdninstagram.com/x.jpg",
            carouselCount: null,
            likes: 9000,
            timestamp: snap.timestamp,
            caption: "",
            score: 4,
            baseline: 2000,
          },
        ],
        rules: "",
      },
    };
    const meme = {
      platform: "instagram" as const,
      url: permalink,
      postId: snap.id,
      account: "thedumbdads",
    };
    const wrongAccount = await validateIssue(
      { ...good(), meme: { ...meme, account: "kidsaretheworst" } },
      ctx({ plan: withIg, memeSource: async () => snap }),
    );
    expect(rules(wrongAccount.dropped)).toContain("meme:plan");
    const ok = await validateIssue(
      { ...good(), meme },
      ctx({ plan: withIg, memeSource: async () => snap }),
    );
    expect(ok.dropped).toEqual([]);
    expect(ok.issue?.meme?.url).toBe(permalink);
    // Gone by send time: the X stand-in drawn at draft time goes instead.
    const xStandIn = {
      kind: "x" as const,
      id: "1859000000000000009",
      authorId: "u1",
      text: "Bedtime went to a third round.",
      links: [],
      name: "Some Parent",
      username: "someparent",
      avatar: null,
      verified: false,
      verifiedType: null,
      createdAt: "2026-12-01T18:00:00Z",
      likes: 9000,
      replies: 0,
      reposts: 0,
      quotes: 0,
      media: [],
      possiblySensitive: false,
      standalone: true,
      card: { path: "news/cards/x.png", width: 1200, height: 900, alt: "a" },
    };
    const fellBack = await validateIssue(
      { ...good(), meme },
      ctx({
        plan: withIg,
        memeSource: async () => null,
        memeFallback: async () => xStandIn,
      }),
    );
    expect(fellBack.issue?.meme?.platform).toBe("x");
    expect(fellBack.issue?.meme?.url).toBe(
      "https://x.com/someparent/status/1859000000000000009",
    );
    const noStandIn = await validateIssue(
      { ...good(), meme },
      ctx({ plan: withIg, memeSource: async () => null }),
    );
    expect(rules(noStandIn.dropped)).toContain("meme:links");
    // Drafted with a stand-in kept for later.
    const drafted = await validateIssue(
      { ...good(), meme },
      ctx({
        plan: withIg,
        memeSource: async () => snap,
        memeFallback: async () => xStandIn,
      }),
    );
    expect(drafted.issue?.meme?.fallback?.id).toBe(xStandIn.id);
  });

  it("parents' corner: X posts from the plan only, fetched by code, snapshot never the writer's", async () => {
    const post = {
      kind: "x" as const,
      id: "1859000000000000001",
      text: "Bedtime negotiations went to a third round.",
      name: "Some Parent",
      username: "someparent",
      avatar: "https://pbs.twimg.com/profile_images/1/a_400x400.jpg",
      verified: false,
      createdAt: "2026-11-30T18:00:00Z",
      likes: 12_000,
      media: [],
      possiblySensitive: false,
      authorId: "u1",
      links: [],
      verifiedType: null,
      replies: 1,
      reposts: 2,
      quotes: 0,
      standalone: true,
    };
    const withCandidates = {
      ...plan,
      parents_corner: {
        candidates: [
          { ...post, score: 3, baseline: 4000, via: "universe" as const },
        ],
        rules: "",
      },
    };
    const meme = {
      platform: "x" as const,
      url: "https://twitter.com/whoever/status/1859000000000000001",
      postId: post.id,
      snapshot: { ...post, text: "Something the writer made up." },
    };
    // Not one of the plan's candidates: cut.
    const notPlanned = await validateIssue({ ...good(), meme }, ctx());
    expect(rules(notPlanned.dropped)).toContain("meme:plan");
    // A candidate: code's snapshot replaces the writer's, and the link is canonical.
    const r = await validateIssue(
      { ...good(), meme },
      ctx({ plan: withCandidates, memeSource: async () => post }),
    );
    expect(r.dropped).toEqual([]);
    expect(r.issue?.meme?.snapshot).toEqual(post);
    expect(r.issue?.meme?.url).toBe(
      "https://x.com/someparent/status/1859000000000000001",
    );
    // Gone (deleted, private, flagged) by send time: cut.
    const gone = await validateIssue(
      { ...good(), meme },
      ctx({ plan: withCandidates, memeSource: async () => null }),
    );
    expect(rules(gone.dropped)).toContain("meme:links");
    // A quick check (no network) keeps it, but drops the writer's snapshot.
    const quick = await validateIssue(
      { ...good(), meme },
      ctx({ plan: withCandidates, fetcher: undefined }),
    );
    expect(quick.issue?.meme?.snapshot).toBeUndefined();
    // The old text fields are gone from the schema.
    const old = await validateIssue(
      { ...good(), meme: { ...meme, quoteText: "hi", description: "x" } },
      ctx(),
    );
    expect(old.errors[0].rule).toBe("schema");
    // Instagram is in (v5), but only as one of the plan's candidates.
    expect(
      rules(
        (
          await validateIssue(
            { ...good(), meme: { ...meme, platform: "instagram" } },
            ctx(),
          )
        ).dropped,
      ),
    ).toContain("meme:plan");
  });

  it("never links or quotes another newsletter", async () => {
    for (const url of [
      "https://www.bendfamilyloop.com/p/week-of-dec-1",
      "https://bendfamilyloop.beehiiv.com/p/x",
      "https://bendbuzz.com/p/weekend",
      "https://someone.substack.com/p/x",
      "https://us12.campaign-archive.com/?u=1",
      "https://mailchi.mp/abc/x",
      "https://buttondown.email/x",
      "https://buttondown.com/x",
    ]) {
      expect(blockedLink(url), url).toBe(true);
      const i = good();
      i.weekend![0].url = url;
      const r = await validateIssue(
        i,
        ctx({
          catalog: {
            ...catalog,
            link_domains: [...catalog.link_domains, new URL(url).hostname],
          },
        }),
      );
      expect(
        r.dropped.some(
          (f) => f.path === "weekend.0" && /another newsletter/.test(f.message),
        ),
        url,
      ).toBe(true);
    }
    const ev = good();
    ev.weekend![1].evidence = [
      {
        url: "https://bendfamilyloop.beehiiv.com/p/x",
        quote: "Saturdays 1 to 3 p.m., $8 including skates",
      },
    ];
    expect(rules((await validateIssue(ev, ctx())).dropped)).toContain(
      "weekend.1:links",
    );
    expect(blockedLink("https://www.bendparksandrec.org/")).toBe(false);
    expect(blockedLink("https://notbendbuzz.com.example.org/")).toBe(false);
  });

  it("never names another newsletter, even as a credit", async () => {
    const hello = good();
    hello.hello.text += " Spotted via Bend Family Loop.";
    expect(rules((await validateIssue(hello, ctx())).errors)).toContain(
      "hello:style",
    );
    const pb = good();
    pb.plan_b!.why_kids += " Hat tip to the Bend Buzz.";
    expect(rules((await validateIssue(pb, ctx())).dropped)).toContain(
      "plan_b:style",
    );
  });

  it("links an outing to the page that proved it (same site as the evidence)", async () => {
    const i = good();
    i.weekend![1].url = "https://www.downtownbend.org/skate";
    const r = await validateIssue(
      i,
      ctx({
        fetcher: async (url) =>
          pages[url] ?? { status: 200, finalUrl: url, text: "" },
      }),
    );
    expect(
      r.dropped.some(
        (f) => f.path === "weekend.1" && /same site/.test(f.message),
      ),
    ).toBe(true);
    // Different pages on the same site are fine.
    expect(
      siteOf("https://www.bendparksandrec.org/a", catalog.link_domains),
    ).toBe(siteOf("https://bendparksandrec.org/b", catalog.link_domains));
    expect(siteOf("https://www.ci.sisters.or.us/x", [])).toBe(
      "ci.sisters.or.us",
    );
  });

  it("our own site is never evidence; other links on it must answer", async () => {
    const own = good();
    own.weekend![0].evidence = [
      {
        url: `${SITE}/towns/bend`,
        quote: "Sunday, Dec. 6 at noon on Harmon Blvd. Free for everyone.",
      },
    ];
    const r = await validateIssue(
      own,
      ctx({
        fetcher: async (url) => ({
          status: 200,
          finalUrl: url,
          text: "Sunday, Dec. 6 at noon on Harmon Blvd. Free for everyone.",
        }),
      }),
    );
    expect(rules(r.dropped)).toContain("weekend.0:evidence");
    const fetched: string[] = [];
    const link = good();
    link.weekend![0].url = `${SITE}/towns/bend`;
    const r2 = await validateIssue(
      link,
      ctx({
        fetcher: async (url) => {
          fetched.push(url);
          return url === `${SITE}/towns/bend`
            ? { status: 404, finalUrl: url, text: "" }
            : (pages[url] ?? { status: 404, finalUrl: url, text: "" });
        },
      }),
    );
    expect(fetched).toContain(`${SITE}/towns/bend`);
    expect(rules(r2.dropped)).toContain("weekend.0:links");
    // Links code makes (park pages, the passport) aren't fetched.
    const code = good();
    code.weekend![0].url = `${SITE}/parks/drake-park-bend`;
    fetched.length = 0;
    await validateIssue(
      code,
      ctx({
        fetcher: async (url) => (
          fetched.push(url),
          pages[url] ?? { status: 404, finalUrl: url, text: "" }
        ),
      }),
    );
    expect(fetched).not.toContain(`${SITE}/parks/drake-park-bend`);
  });

  it("evidence: one quote shows the day and the time; prices match whole; free is a claim", async () => {
    const noTime = good();
    noTime.weekend![1].evidence = [
      { url: SKATE, quote: "Family skate on Saturdays, $8 including skates" },
    ];
    expect(rules((await validateIssue(noTime, ctx())).dropped)).toContain(
      "weekend.1:evidence",
    );
    const wrongDay = good();
    wrongDay.weekend![1].evidence = [
      { url: SKATE, quote: "Tuesdays 1 to 3 p.m., $8 including skates" },
    ];
    expect(rules((await validateIssue(wrongDay, ctx())).dropped)).toContain(
      "weekend.1:evidence",
    );
    const free = good();
    free.weekend![0].evidence = [
      { url: PARADE, quote: "Sunday, Dec. 6 at noon on Harmon Blvd." },
    ];
    expect(rules((await validateIssue(free, ctx())).dropped)).toContain(
      "weekend.0:evidence",
    );
    expect(quoteHasPrice("only $8/person", "$8")).toBe(true);
    expect(quoteHasPrice("only $80/person", "$8")).toBe(false);
    expect(quoteHasPrice("$8.50 each", "$8")).toBe(false);
    expect(quoteHasPrice("$8.50 each", "$8.50")).toBe(true);
    expect(quoteHasDay("Sat. Dec 5, 10 a.m.", "2026-12-05")).toBe(true);
    expect(quoteHasDay("December 5 at 10", "2026-12-05")).toBe(true);
    expect(quoteHasDay("12/5 at 10", "2026-12-05")).toBe(true);
    expect(quoteHasDay("12/15 at 10", "2026-12-05")).toBe(false);
    expect(quoteHasTime("10:30 a.m. to noon", "10:30 am")).toBe(true);
    expect(quoteHasTime("11 a.m.", "1 pm")).toBe(false);
  });

  it("evidence quotes are at least 20 characters, or 8 with a price and a date or time", async () => {
    const i = good();
    i.weekend![0].evidence = [{ url: PARADE, quote: "Dec. 6, noon" }];
    const r = await validateIssue(i, ctx());
    expect(rules(r.dropped)).toContain("weekend.0:evidence");
    expect(r.dropped.some((d) => /is too short/.test(d.message))).toBe(true);
    const tiny = good();
    tiny.weekend![0].evidence = [{ url: PARADE, quote: "Free" }];
    expect((await validateIssue(tiny, ctx())).errors[0].rule).toBe("schema");
  });

  it("an outing from a stored event may leave evidence out (batch 6 item 5)", async () => {
    const quote = "Free · Dec 6";
    const noon = "Sunday, Dec. 6 at noon on Harmon Blvd.";
    const event = (over: Partial<StoredEventRef> = {}): StoredEventRef => ({
      status: "scheduled",
      confirm: "ok",
      ...over,
      data: {
        title: "Bend Christmas Parade",
        dates: [{ day: "2026-12-06", start: "12:00" }],
        venue: { name: "Downtown", town: "Bend" },
        what: "Floats and candy downtown.",
        url: PARADE,
        evidence: [
          { url: PARADE, quote: noon },
          { url: PARADE, quote },
          { url: PARADE, quote: "All ages." },
        ],
        ages: null,
        point: null,
        checkQuote: noon,
        targets: { "2026-12-06": { url: PARADE, quote: noon } },
        ...over.data,
      },
    });
    const fetcher = async (url: string) =>
      url === PARADE
        ? {
            status: 200,
            finalUrl: url,
            text: `Bend Christmas Parade. ${noon} ${quote}. All ages.`,
          }
        : (pages[url] ?? { status: 404, finalUrl: url, text: "" });
    const i = () => {
      const g = good();
      g.weekend![0] = { ...g.weekend![0], event: "bend-christmas-parade" };
      g.weekend![0].evidence = [];
      return g;
    };
    const run = (e: StoredEventRef) =>
      validateIssue(
        i(),
        ctx({
          fetcher,
          events: new Set(["bend-christmas-parade"]),
          eventData: new Map([["bend-christmas-parade", e]]),
        }),
      );
    const ok = await run(event());
    expect(ok.dropped).toEqual([]);
    expect(ok.issue?.weekend?.[0].evidence.map((e) => e.quote)).toEqual([
      noon,
      quote,
      "All ages.",
    ]);
    // Canceled that day, passed, or not confirmed: the outing goes.
    for (const bad of [
      event({ status: "canceled" }),
      event({ confirm: "unconfirmed" }),
      event({
        data: { dates: [{ day: "2026-11-29", start: "12:00" }] } as never,
      }),
    ]) {
      const r = await run(bad);
      expect(rules(r.dropped)).toContain("weekend.0:evidence");
    }
    // No event and no evidence: cut, with the reason.
    const g = good();
    g.weekend![0].evidence = [];
    const none = await validateIssue(g, ctx());
    expect(
      none.dropped.some((d) => /name a stored, upcoming event/.test(d.message)),
    ).toBe(true);
  });

  it("heads up: only changes on our map (closure pages are gone)", async () => {
    const closure = await validateIssue(
      {
        ...good(),
        heads_up: [
          {
            kind: "closure_page",
            park: "harmon-park-bend",
            text: "Closed for repairs this week at Harmon.",
          },
        ],
      },
      ctx(),
    );
    expect(closure.errors[0].rule).toBe("schema");
    // Parks new to the map are never news (James's rule).
    for (const [kind, text] of [
      ["new_park", "Drake Park is on the map now, with swings."],
      ["park_change", "Harmon Park is a new park on the map."],
      ["park_change", "Families added Harmon Park to the map this week."],
    ] as const) {
      const r = good();
      r.heads_up = [{ kind, change_id: 7, park: "harmon-park-bend", text }];
      expect(rules((await validateIssue(r, ctx())).dropped), text).toContain(
        "heads_up.0:plan",
      );
    }
  });

  it("the weekend ahead comes from the plan and is frozen into the issue", async () => {
    const r = await validateIssue(good(), ctx());
    expect(r.issue?.weekend_ahead?.days?.map((d) => d.label)).toEqual([
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(r.issue?.weekend_ahead?.note).toBe(
      "Best park window: Friday afternoon",
    );
    const forged = good();
    forged.weekend_ahead = {
      days: plan.forecast!.days.map((d) => ({ ...d, high: 99 })),
    };
    const f = await validateIssue(forged, ctx());
    expect(f.issue?.weekend_ahead?.days?.[0].high).toBe(42);
    expect(rules(f.warnings)).toContain("weekend_ahead.days:plan");
  });

  it("photos: https on the default port only", async () => {
    const i = good();
    i.wheel_pick.photo = {
      src: "https://www.bendparksandrec.org:8443/wp-content/uploads/juniper.jpg",
      width: 1024,
      height: 685,
      alt: "Juniper Park in Bend",
      sourceUrl: "https://www.bendparksandrec.org/park/juniper-park/",
    };
    expect(
      rules((await validateIssue(i, ctx({ fetcher: undefined }))).dropped),
    ).toContain("photo:links");
  });

  it("decodes entities safely (no crash on bad code points)", () => {
    expect(normalizeText("a&#1114112;b&#xD800;c&#x1F600;d&#65;")).toBe(
      "abc\u{1F600}dA",
    );
    // Too long to be a code point: left as written, never decoded.
    expect(normalizeText("&#99999999999;x")).toBe("&#99999999999;x");
  });

  it("skip dates fail the issue", async () => {
    const i = { ...good(), issue_date: "2026-12-24" };
    const r = await validateIssue(
      i,
      ctx({
        plan: {
          ...plan,
          issue_date: "2026-12-24",
          calendar: { ...plan.calendar, skip: "Christmas Eve" },
        },
      }),
    );
    expect(rules(r.errors)).toContain("issue_date:dates");
  });
});

describe("weather and season v1: the Indoor pick and its rules", () => {
  const closed: Plan = {
    ...plan,
    weather: { ...plan.weather, bad_days: [] },
    weather_mode: "fine",
    indoor: { ...plan.indoor!, open: false, for_day: null, venues: [] },
  };

  it("requires the Indoor pick when the gate is open, and refuses one when it's shut", async () => {
    const none = good();
    none.plan_b = undefined;
    expect(rules((await validateIssue(none, ctx())).errors)).toContain(
      "plan_b:plan",
    );
    const shut = await validateIssue(good(), ctx({ plan: closed }));
    expect(rules(shut.dropped)).toContain("plan_b:plan");
    expect(shut.issue?.plan_b).toBeUndefined();
  });

  it("needs a disruptive day and quoted hours for that day", async () => {
    const sunday = good();
    sunday.plan_b!.for_day = "2026-12-06";
    expect(rules((await validateIssue(sunday, ctx())).dropped)).toContain(
      "plan_b:plan",
    );
    const unquoted = good();
    unquoted.plan_b!.hours = "9 am to 8 pm";
    // A required pick that's cut fails the issue.
    const r = await validateIssue(unquoted, ctx());
    expect(rules(r.dropped)).toContain("plan_b:evidence");
    expect(rules(r.errors)).toContain("plan_b:plan");
  });

  it("freezes code's Closer to home and short line into the issue", async () => {
    const r = await validateIssue(
      good(),
      ctx({
        plan: {
          ...plan,
          indoor: {
            ...plan.indoor!,
            short: true,
            closer_to_home: ["Redmond Library", "Sisters Library"],
          },
        },
      }),
    );
    expect(r.issue?.plan_b).toMatchObject({
      closer_to_home: ["Redmond Library", "Sisters Library"],
      short: true,
    });
  });

  it("allows a dress line only on a plan-around weekend, with a tip the plan offers", async () => {
    const withDress = { ...good(), dress: { tip_id: "dress-mittens" } };
    expect(rules((await validateIssue(withDress, ctx())).dropped)).toContain(
      "dress:plan",
    );
    const aroundPlan: Plan = {
      ...plan,
      dress: {
        triggers: ["cold"],
        tips: [
          { id: "dress-mittens", text: "Mittens.", label: "Dress for it" },
        ],
      },
    };
    expect(
      (await validateIssue(withDress, ctx({ plan: aroundPlan }))).dropped,
    ).toEqual([]);
    const other = { ...good(), dress: { tip_id: "dress-made-up" } };
    expect(
      rules((await validateIssue(other, ctx({ plan: aroundPlan }))).dropped),
    ).toContain("dress:cooldown");
  });

  it("keeps forecast numbers to the plan's, never a certainty", async () => {
    expect(weatherNumberProblems("Up to 6 inches of snow.", plan)).toHaveLength(
      1,
    );
    expect(weatherNumberProblems("Gusts to 15 mph on Sunday.", plan)).toEqual(
      [],
    );
    expect(weatherNumberProblems("Gusts to 30 mph.", plan)).toHaveLength(1);
    expect(weatherNumberProblems("A high of 44 on Saturday.", plan)).toEqual(
      [],
    );
    expect(
      weatherNumberProblems("A high of 60 on Saturday.", plan),
    ).toHaveLength(1);
    expect(
      weatherNumberProblems("Stay warm while 6 inches fall outside.", {
        ...plan,
        weather: {
          ...plan.weather,
          tiers: {
            ...plan.weather.tiers!,
            towns: {
              Bend: [{ ...plan.weather.tiers!.towns.Bend[0], snow_in: 6 }],
            },
          },
        },
      }),
    ).toEqual([expect.stringMatching(/never a certainty/)]);
    const bad = good();
    bad.hello.text = bad.hello.text.replace(
      "Saturday looks wet",
      "Saturday brings 8 inches of snow",
    );
    expect(rules((await validateIssue(bad, ctx())).errors)).toContain(
      "hello:weather",
    );
  });

  it("names the disruptive day in the opener", async () => {
    const i = good();
    i.hello.text =
      "Hi there, James here. A wet one is coming across Bend, Redmond and Sisters, so this week is about picking the right day and having a backup ready for the soggy one.";
    expect(rules((await validateIssue(i, ctx())).errors)).toContain(
      "hello:weather",
    );
  });

  it("keeps cold words out of winter subjects unless a day is disruptive", async () => {
    const i = { ...good(), subject: "Bundle up for Juniper Park" };
    expect(
      rules((await validateIssue(i, ctx({ plan: closed }))).errors),
    ).toContain("subject:subject");
    expect(rules((await validateIssue(i, ctx())).errors)).not.toContain(
      "subject:subject",
    );
  });

  it("holds This weekend to one indoor outing (two with a pick), never the pick's venue", async () => {
    const i = good();
    i.weekend![0] = {
      ...i.weekend![0],
      name: "Lego club at Central Library",
      place: "Central Library",
    };
    const r = await validateIssue(i, ctx());
    expect(rules(r.dropped)).toContain("weekend.0:plan");
  });

  it("refuses doom words", async () => {
    const i = good();
    i.hello.text = i.hello.text.replace(
      "Saturday looks wet",
      "Saturday looks brutal and wet",
    );
    expect(rules((await validateIssue(i, ctx())).errors)).toContain(
      "hello:style",
    );
  });
});

describe("release 5 review: Indoor pick and wording rules", () => {
  it("M1: the pick is for the plan's day", async () => {
    const other: Plan = {
      ...plan,
      weather: { ...plan.weather, bad_days: ["2026-12-05", "2026-12-06"] },
    };
    const i = good();
    i.plan_b!.for_day = "2026-12-06";
    expect(
      rules((await validateIssue(i, ctx({ plan: other }))).dropped),
    ).toContain("plan_b:plan");
  });
  it("M2: the hours quote names the day and prints the open and close times", () => {
    expect(
      quoteHasHoursFor(
        "Saturday: Closed. Sunday 10 am - 5 pm",
        "10 am to 5 pm",
        "2026-12-05",
      ),
    ).toBe(false);
    expect(
      quoteHasHoursFor(
        "Saturday: Closed. Sunday 10 am - 5 pm",
        "10 am to 5 pm",
        "2026-12-06",
      ),
    ).toBe(true);
    expect(
      quoteHasHoursFor("Mon-Fri 10:00 to 6:00", "10 am to 4 pm", "2026-12-04"),
    ).toBe(false);
    expect(
      quoteHasHoursFor(
        "Tue–Sat 10:00 AM–6:00 PM; Sun–Mon Closed",
        "10 am to 6 pm",
        "2026-12-05",
      ),
    ).toBe(true);
    expect(
      quoteHasHoursFor(
        "Open daily, 10 am to 4 pm",
        "10 am to 4 pm",
        "2026-12-05",
      ),
    ).toBe(true);
    expect(
      quoteHasHoursFor("Weekends 9am-7pm", "9 am to 7 pm", "2026-12-06"),
    ).toBe(true);
  });
  it("M3: numbers that aren't forecasts pass; winds and observed AQI count", () => {
    const p: Plan = {
      ...plan,
      weather: {
        ...plan.weather,
        tiers: {
          ...plan.weather.tiers!,
          towns: {
            Bend: [
              {
                ...plan.weather.tiers!.towns.Bend[0],
                wind_mph: 30,
                aqi_observed: 74,
              },
            ],
          },
        },
      },
    };
    for (const ok of [
      "Saturday's forecast has a west wind of 20 to 30 mph.",
      "Kids must be 42 inches tall for the big trampolines.",
      "Mornings start below 32 degrees.",
      "Air quality was 74 this morning.",
    ])
      expect(weatherNumberProblems(ok, p), ok).toEqual([]);
    expect(
      weatherNumberProblems("The forecast calls for 3 inches of snow.", p),
    ).toHaveLength(1);
  });
  it("M4: doom words are whole words", () => {
    for (const ok of [
      "Embrace the snow: the sledding hill is right there.",
      "Non-toxic paints at the library craft table.",
      "Kids make friendship bracelets.",
      "The slide is not scary for toddlers.",
    ])
      expect(styleProblems(ok), ok).toEqual([]);
    expect(styleProblems("Brace for a brutal Saturday.")).toHaveLength(2);
  });
  it("H2: at send, a failing pick is dropped with a warning, never the issue", async () => {
    const i = good();
    i.plan_b!.hours = "9 am to 8 pm";
    const draft = await validateIssue(i, ctx());
    expect(rules(draft.errors)).toContain("plan_b:plan");
    const send = await validateIssue(i, ctx({ stage: "send" }));
    expect(send.ok).toBe(true);
    expect(send.issue?.plan_b).toBeUndefined();
    expect(rules(send.warnings)).toContain("plan_b:plan");
  });
  it("the short pick needs only its day", async () => {
    const i = good();
    i.plan_b = {
      kind: "venue",
      venue_id: "venue-library",
      for_day: "2026-12-05",
      evidence: [],
    };
    const r = await validateIssue(
      i,
      ctx({ plan: { ...plan, indoor: { ...plan.indoor!, short: true } } }),
    );
    expect(r.dropped).toEqual([]);
    expect(r.issue?.plan_b?.short).toBe(true);
  });
});

describe("guardrails end to end: validateIssue (review M6)", () => {
  const msgs = (r: { dropped: { message: string }[] }) =>
    r.dropped.map((d) => d.message);

  it("cuts a competitor link", async () => {
    const i = good();
    i.weekend![0].url = "https://bendfamilyloop.beehiiv.com/p/weekend";
    const r = await validateIssue(i, ctx());
    expect(msgs(r)).toContain(
      "bendfamilyloop.beehiiv.com is another newsletter. Link the primary source.",
    );
  });

  it("cuts a visitbend link and visitbend evidence", async () => {
    const want =
      "visitbend.com is a lead only: never a link or evidence. Find the organizer's own page.";
    const link = good();
    link.weekend![0].url = "https://www.visitbend.com/event/parade/";
    expect(msgs(await validateIssue(link, ctx()))).toContain(want);
    const ev = good();
    ev.weekend![0].evidence = [
      {
        url: "https://www.visitbend.com/event/parade/",
        quote: "Sunday, Dec. 6 at noon on Harmon Blvd. Free for everyone.",
      },
    ];
    expect(msgs(await validateIssue(ev, ctx()))).toContain(want);
  });

  it("refuses a 7-character outing quote outright", async () => {
    const i = good();
    i.weekend![0].evidence = [{ url: PARADE, quote: "Free $5" }];
    const r = await validateIssue(i, ctx());
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({
      rule: "schema",
      path: "weekend.0.evidence.0.quote",
    });
  });

  it("cuts evidence from a different host than the link", async () => {
    const i = good();
    i.weekend![0].evidence = [
      {
        url: SKATE,
        quote: "Sunday, Dec. 6 at noon on Harmon Blvd. Free for everyone.",
      },
    ];
    const r = await validateIssue(i, ctx());
    expect(msgs(r)).toContain(
      "The evidence (www.bendparksandrec.org) must come from the same site as the link (www.downtownbend.org).",
    );
  });
});

describe("an outing borrowing its event's evidence: edge cases", () => {
  const ev = (
    dates: { day: string; start?: string; end?: string }[],
    ages: { tags: never[]; kids: boolean; range: null } | null = null,
  ): StoredEventRef => ({
    status: "scheduled",
    confirm: "ok",
    data: {
      title: "Story Time",
      dates,
      venue: { name: "Library", town: "Bend" },
      what: "Songs and a picture book for little ones.",
      url: LIB,
      evidence: [
        { url: LIB, quote: "Saturday 10 am. Free. Story time at 10." },
      ],
      ages,
      point: null,
      checkQuote: "Saturday 10 am.",
    },
  });

  it("refuses an event that ended earlier today", () => {
    const e = ev([{ day: "2026-12-05", start: "10:00", end: "11:00" }]);
    const map = new Map([["story-time", e]]);
    const w = { event: "story-time", day: "2026-12-05" };
    // 11:30 am Pacific on Dec 5: over.
    expect(
      outingEventEvidence(w, map, new Date("2026-12-05T19:30:00Z")),
    ).toMatch(/has passed/);
    // 10:30 am: still on.
    expect(
      Array.isArray(
        outingEventEvidence(w, map, new Date("2026-12-05T18:30:00Z")),
      ),
    ).toBe(true);
  });

  it("refuses a grown-up event", () => {
    const e = ev([{ day: "2026-12-05", start: "10:00" }], {
      tags: [],
      kids: false,
      range: null,
    });
    expect(
      outingEventEvidence(
        { event: "story-time", day: "2026-12-05" },
        new Map([["story-time", e]]),
        new Date("2026-12-03T15:00:00Z"),
      ),
    ).toMatch(/isn't a kids' event/);
  });
});
