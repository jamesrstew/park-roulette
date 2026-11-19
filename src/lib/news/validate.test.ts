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
  skip_dates: [{ date: "2026-12-24", reason: "Christmas Eve" }],
  breaks: [],
  parks: [],
  venues: [
    {
      id: "venue-pavilion",
      name: "The Pavilion",
      town: "Bend",
      address: "1001 SW Bradbury Way, Bend",
      kind: "skating",
      covered: true,
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
      town: "Bend",
      address: null,
      kind: "library",
      covered: true,
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
      town: "Bend",
      address: null,
      kind: "open_gym",
      covered: true,
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
  },
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
    new_parks: [
      {
        slug: "drake-park-bend",
        name: "Drake Park",
        city: "Bend",
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
  },
  challenges: [],
  event_series: [],
  seasonal_defaults: [],
  rules: {},
};

const PARADE = "https://www.downtownbend.org/parade";
const SKATE = "https://www.bendparksandrec.org/facility/the-pavilion/";

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
    venue_id: "venue-pavilion",
    title: "Skate under a roof on Saturday",
    text: "When the rain comes in, The Pavilion keeps the ice dry and covered. Little skaters can hold the walkers along the boards, and big kids can lap the rink until lunch.",
    evidence: [],
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
      ages: "All ages",
      cost: "Free",
      place: "Harmon Blvd to Drake Park",
      town: "Bend",
      what: "Floats, music and candy along the route, with a playground at both ends for wiggly waiters.",
      url: PARADE,
      evidence: [
        {
          url: PARADE,
          quote: "Sunday, Dec. 6 at noon on Harmon Blvd. Free for everyone.",
        },
      ],
    },
    {
      name: "Family skate",
      day: "2026-12-05",
      time: "1 to 3 pm",
      ages: "All ages",
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
    text: "Bend Christmas Parade. Sunday, Dec. 6 at noon on Harmon Blvd. Free for everyone.",
  },
  [SKATE]: {
    status: 200,
    finalUrl: SKATE,
    text: "Family skate: Saturdays 1 to 3 p.m., $8 including skates.",
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
    banned.plan_b!.text += " A hidden gem.";
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
    // The Pavilion ran 2 weeks ago: the 4-week cooldown only relaxes when
    // nothing else fits, and the library still fits the rain.
    expect(rules(r.dropped)).toContain("plan_b:cooldown");
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
    // Instagram stays out.
    expect(
      (
        await validateIssue(
          { ...good(), meme: { ...meme, platform: "instagram" } },
          ctx(),
        )
      ).errors[0].rule,
    ).toBe("schema");
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
    pb.plan_b!.text += " Hat tip to the Bend Buzz.";
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

  it("evidence quotes are at least 20 characters", async () => {
    const i = good();
    i.weekend![0].evidence = [{ url: PARADE, quote: "Dec. 6, noon" }];
    expect((await validateIssue(i, ctx())).errors[0].rule).toBe("schema");
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
    const fresh = good();
    fresh.heads_up = [
      {
        kind: "new_park",
        park: "drake-park-bend",
        text: "Drake Park just joined the map this week.",
      },
    ];
    expect((await validateIssue(fresh, ctx())).dropped).toEqual([]);
    const notNew = good();
    notNew.heads_up = [
      {
        kind: "new_park",
        park: "harmon-park-bend",
        text: "Harmon Park just joined the map this week.",
      },
    ];
    expect(rules((await validateIssue(notNew, ctx())).dropped)).toContain(
      "heads_up.0:plan",
    );
    const wrongPark = good();
    wrongPark.heads_up![0].park = "drake-park-bend";
    expect(rules((await validateIssue(wrongPark, ctx())).dropped)).toContain(
      "heads_up.0:plan",
    );
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
