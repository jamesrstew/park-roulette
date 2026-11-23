import { describe, expect, it } from "vitest";
import type { EventDate, EventRow, StoredEvent } from "./events/model";
import {
  buildGuide,
  GUIDES,
  type GuideInput,
  type GuidePark,
  guideJsonLd,
  guidesForEvents,
  holidayGuide,
  holidaySeason,
  indoorGuide,
  monthSpan,
  sleddingGuide,
  splashGuide,
} from "./guides";
import { CATALOG } from "./news/catalog";
import type { ParkProfile, Trait } from "./park-profiles";

// Monday, Nov 23, 2026, 8 am Pacific.
const NOV = new Date("2026-11-23T16:00:00Z");
// Wednesday, Jan 20, 2027 and Thursday, July 15, 2027.
const JAN = new Date("2027-01-20T16:00:00Z");
const JULY = new Date("2027-07-15T16:00:00Z");

let id = 1;
function park(
  over: Partial<GuidePark> & { slug: string; name: string },
): GuidePark {
  return {
    id: id++,
    city: "Bend",
    lat: 44.06,
    lng: -121.31,
    play: "playground",
    status: "active",
    features: [],
    reports: {},
    avgTenths: null,
    reviewCount: 0,
    updated: "2026-11-01",
    ...over,
  };
}

function trait(
  over: Partial<Trait> & { text: string; kind: Trait["kind"] },
): Trait {
  return {
    keys: ["thing"],
    source: "official",
    evidence: [
      {
        url: "https://www.bendparksandrec.org/x/",
        quote: "a quote that is long enough",
      },
    ],
    verified_on: "2026-11-21",
    ...over,
  };
}

function profile(traits: Trait[]): ParkProfile {
  return {
    place_id: null,
    traits,
    one_liner: null,
    glance: null,
    glance_source: null,
    glance_on: null,
  } as ParkProfile;
}

function event(
  kind: EventRow["kind"],
  over: Partial<StoredEvent> & { title: string; dates: EventDate[] },
): EventRow {
  const n = id++;
  return {
    id: n,
    slug: `e${n}`,
    kind,
    status: "scheduled",
    confirm: "ok",
    lastSeenAt: null,
    factsChangedAt: new Date("2026-11-20T18:00:00Z"),
    stateChangedAt: null,
    data: {
      venue: { name: "Tower Theatre", town: "Bend" },
      what: "Something fun for kids to do.",
      url: "https://www.towertheatre.org/",
      evidence: [{ url: "https://example.org", quote: "A quote here" }],
      ages: { tags: ["Ages 4-7"], kids: true, range: [4, 7] },
      point: null,
      checkQuote: "A quote here",
      setting: "indoor",
      ...over,
    },
  };
}

const PARKS = [
  park({ slug: "ponderosa", name: "Ponderosa Park", features: ["restrooms"] }),
  park({ slug: "al-moody", name: "Al Moody Park", lat: 44.072, lng: -121.278 }),
  park({ slug: "skyline", name: "Skyline Sports Complex" }),
  park({
    slug: "alpenglow",
    name: "Alpenglow Park",
    features: ["splash_pad", "restrooms"],
  }),
  park({
    slug: "centennial",
    name: "Centennial Park",
    city: "Redmond",
    lat: 44.27,
    lng: -121.17,
    features: ["splash_pad"],
  }),
  park({
    slug: "sahalee",
    name: "Sahalee Park",
    city: "Madras",
    lat: 44.63,
    lng: -121.13,
  }),
  park({ slug: "juniper", name: "Juniper Park", features: ["swings"] }),
];

const PROFILES = new Map<string, ParkProfile>([
  [
    "ponderosa",
    profile([
      trait({
        text: "A small sledding hill for little kids",
        kind: "sledding",
        season: [12, 1, 2, 3],
      }),
    ]),
  ],
  [
    "al-moody",
    profile([
      trait({
        text: "A winter sledding area",
        kind: "sledding",
        season: [12, 1, 2, 3],
      }),
    ]),
  ],
  [
    "skyline",
    profile([
      trait({
        text: "Groomed cross-country ski tracks on snowy days",
        kind: "other",
        season: [12, 1, 2, 3],
      }),
    ]),
  ],
  [
    "alpenglow",
    profile([
      trait({
        text: "A seasonal sprayground (summer only)",
        kind: "splash_pad",
        season: [5, 6, 7, 8, 9],
      }),
    ]),
  ],
  [
    "sahalee",
    profile([
      trait({
        text: "Water play features next to the playground",
        kind: "splash_pad",
        season: [5, 6, 7, 8, 9],
      }),
    ]),
  ],
]);

const EVENTS = [
  event("annual", {
    title: "Community Christmas Tree Lighting",
    dates: [{ day: "2026-12-05", start: "17:00" }],
    setting: "outdoor",
    cost: { text: "Free", prices: [], free: true },
  }),
  event("one_off", {
    title: "Pictures with Santa",
    dates: [{ day: "2026-12-16", start: "10:00" }],
  }),
  event("one_off", {
    title: "Lego Club",
    dates: [{ day: "2026-11-25", start: "15:00" }],
  }),
  event("one_off", {
    title: "Pumpkin Patch Party",
    dates: [{ day: "2026-12-02", start: "15:00" }],
  }),
  // A holiday event in January is outside the season.
  event("one_off", {
    title: "Holiday Leftovers Craft",
    dates: [{ day: "2027-01-09", start: "11:00" }],
  }),
  event("one_off", {
    title: "Madras Swim",
    dates: [{ day: "2026-11-24", start: "13:00" }],
    venue: { name: "Madras Aquatic Center", town: "Madras" },
  }),
];

function input(now: Date, over: Partial<GuideInput> = {}): GuideInput {
  return {
    parks: PARKS,
    profiles: PROFILES,
    events: EVENTS,
    venues: CATALOG.venues,
    now,
    townHref: (c) => `/towns/${c.toLowerCase()}`,
    ...over,
  };
}

describe("monthSpan", () => {
  it("names a wrapping run and a summer run", () => {
    expect(monthSpan([12, 1, 2, 3])).toBe("December to March");
    expect(monthSpan([5, 6, 7, 8, 9])).toBe("May to September");
    expect(monthSpan([7])).toBe("July");
  });
});

describe("sledding guide", () => {
  it("lists parks with a sledding trait, Bend nearest first, and other snow play apart", () => {
    const v = sleddingGuide(input(JAN));
    expect(v.inSeason).toBe(true);
    const hills = v.sections[0];
    expect(hills.kind === "parks" && hills.items.map((x) => x.slug)).toEqual([
      "ponderosa",
      "al-moody",
    ]);
    const snow = v.sections[1];
    expect(snow.kind === "parks" && snow.items.map((x) => x.slug)).toEqual([
      "skyline",
    ]);
    expect(v.count).toBe(2);
    expect(v.updated).toBe("2026-11-21");
    expect(v.faq.length).toBeGreaterThanOrEqual(3);
    expect(v.faq.length).toBeLessThanOrEqual(5);
  });

  it("stays useful out of season: the same hills, and when the season is", () => {
    const v = sleddingGuide(input(JULY));
    expect(v.inSeason).toBe(false);
    expect(v.count).toBe(2);
    expect(v.seasonNote).toContain("December to March");
  });

  it("says so plainly when there are none", () => {
    const v = sleddingGuide(input(JAN, { profiles: new Map() }));
    expect(v.count).toBe(0);
    expect(v.empty?.href).toBe("/towns/bend");
  });
});

describe("splash pad guide", () => {
  it("unions stickers and traits, nearest Bend first", () => {
    const v = splashGuide(input(JULY));
    const s = v.sections[0];
    expect(s.kind === "parks" && s.items.map((x) => x.slug)).toEqual([
      "alpenglow",
      "centennial",
      "sahalee",
    ]);
    expect(v.inSeason).toBe(true);
    // A sticker-only park says where its splash pad comes from.
    expect(s.kind === "parks" && s.items[1].lines[0]).toMatch(/splash pad/i);
  });

  it("off season says when they run, from the data", () => {
    const v = splashGuide(input(NOV));
    expect(v.inSeason).toBe(false);
    expect(v.seasonNote).toContain("off for the winter");
    expect(v.seasonNote).toContain("May to September");
    expect(v.count).toBe(3);
    expect(v.faq.find((x) => /open/.test(x.q))?.a).toContain(
      "Alpenglow Park and Sahalee Park run May to September",
    );
  });
});

describe("holiday guide", () => {
  it("lists only holiday events in this season, specials first", () => {
    const v = holidayGuide(input(NOV));
    expect(v.inSeason).toBe(true);
    expect(v.title).toContain("2026");
    expect(v.list.map((x) => x.name)).toEqual([
      "Community Christmas Tree Lighting",
      "Pictures with Santa",
    ]);
    expect(v.faq.some((x) => /Santa/.test(x.q))).toBe(true);
    expect(v.faq.some((x) => /free/i.test(x.q))).toBe(true);
    expect(v.updated).toBe("2026-11-20");
  });

  it("from January 2 looks ahead to this year's season, honestly empty", () => {
    const v = holidayGuide(input(JAN));
    expect(v.inSeason).toBe(false);
    expect(v.title).toContain("2027");
    expect(v.count).toBe(0);
    expect(v.empty?.href).toBe("/events");
    expect(v.faq.length).toBeGreaterThanOrEqual(1);
  });

  it("New Year's Day still belongs to the season before", () => {
    expect(holidaySeason("2027-01-01")).toMatchObject({
      year: 2026,
      inSeason: true,
    });
    expect(holidaySeason("2027-01-02")).toMatchObject({
      year: 2027,
      inSeason: false,
    });
    expect(holidaySeason("2026-10-31").inSeason).toBe(false);
  });
});

describe("indoor guide", () => {
  it("lists verified indoor snow-day venues, Bend first, and this week's indoor events nearby", () => {
    const v = indoorGuide(input(NOV));
    const bend = v.sections.find((s) => s.id === "bend");
    expect(
      bend?.kind === "venues" && bend.items.every((x) => x.town === "Bend"),
    ).toBe(true);
    const ids = v.sections.flatMap((s) =>
      s.kind === "venues" ? s.items.map((x) => x.id) : [],
    );
    // Covered (The Pavilion) and unverified venues never show.
    expect(ids).not.toContain("venue-the-pavilion");
    expect(ids).not.toContain("venue-little-bug-play-hub");
    const ev = v.sections.find((s) => s.kind === "programs");
    const titles =
      ev?.kind === "programs" ? ev.programs.map((p) => p.title) : [];
    expect(titles).toContain("Lego Club");
    // Madras is too far for the Bend list.
    expect(titles).not.toContain("Madras Swim");
    expect(v.inSeason).toBe(true);
  });

  it("out of snow season stays useful with an honest note", () => {
    const v = indoorGuide(input(JULY, { events: [] }));
    expect(v.inSeason).toBe(false);
    expect(v.count).toBeGreaterThan(0);
    expect(v.seasonNote).toMatch(/snow days/);
  });
});

describe("JSON-LD", () => {
  it("is valid JSON with a CollectionPage + ItemList, a FAQPage and breadcrumbs, absolute URLs", () => {
    for (const g of GUIDES) {
      const v = buildGuide(g.slug, input(NOV))!;
      const ld = JSON.parse(
        JSON.stringify(guideJsonLd(v, "https://parkroulette.quest")),
      );
      const [page, faq, crumbs] = ld;
      expect(page["@type"]).toBe("CollectionPage");
      expect(page.url).toBe(`https://parkroulette.quest/guides/${g.slug}`);
      expect(page.mainEntity["@type"]).toBe("ItemList");
      expect(page.mainEntity.numberOfItems).toBe(v.list.length);
      for (const item of page.mainEntity.itemListElement)
        expect(item.url).toMatch(/^https:\/\//);
      expect(faq["@type"]).toBe("FAQPage");
      expect(faq.mainEntity.length).toBe(v.faq.length);
      for (const q of faq.mainEntity) {
        expect(q["@type"]).toBe("Question");
        expect(q.acceptedAnswer["@type"]).toBe("Answer");
        expect(q.acceptedAnswer.text.length).toBeGreaterThan(0);
      }
      expect(crumbs["@type"]).toBe("BreadcrumbList");
    }
  });

  it("never names another newsletter", () => {
    for (const g of GUIDES) {
      const v = buildGuide(g.slug, input(NOV))!;
      expect(JSON.stringify(v)).not.toMatch(/bend buzz|family loop/i);
    }
  });
});

describe("guidesForEvents", () => {
  it("pings the holiday guide for holiday events and the indoor guide for indoor ones", () => {
    expect(
      guidesForEvents([
        { title: "Pictures with Santa", what: "x", setting: "outdoor" },
      ]),
    ).toEqual(["holiday-events-central-oregon"]);
    expect(
      guidesForEvents([{ title: "Lego Club", what: "x", setting: "indoor" }]),
    ).toEqual(["indoor-play-bend"]);
    expect(
      guidesForEvents([{ title: "Lego Club", what: "x", setting: "outdoor" }]),
    ).toEqual([]);
  });
});
