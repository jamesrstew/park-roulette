import { describe, expect, it } from "vitest";
import { composeMashup, mashupRows, rowsOf } from "./compose";
import { INDOOR, INDOOR_ERROR } from "./indoor";
import {
  type Anchor,
  chooseMix,
  copyFacts,
  eventAnchors,
  type EventAnchorInput,
  indoorAnchors,
  mashupCopy,
  NO_DRINKS,
  openAt,
  openDaytime,
  pairPlaces,
  type Pairing,
  type Place,
  placeProblem,
  weekendWeather,
} from "./mashup";
import { makeMashup } from "./mashup-make";
import { mashupPairs } from "./post-page";
import { mashupProblems, pairProblems } from "./validate";
import { siteDomain } from "./handles";

const WED = "2026-12-02";
const north = (p: { lat: number; lng: number }, mi: number) => ({
  lat: p.lat + mi / 69.05,
  lng: p.lng,
});

const park = (slug: string, lat: number, lng: number): Anchor => ({
  kind: "park",
  slug,
  name: `${slug.split("-")[0][0].toUpperCase()}${slug.split("-")[0].slice(1)} Park`,
  city: "Bend",
  lat,
  lng,
  kinds: 2,
  trait: "A two-tiered play area built into the hillside",
  traitKind: "signature_structure",
  cooling: false,
  label: "At the park",
  sheltered: false,
  href: `/parks/${slug}`,
  icon: "playground",
});

/** Open every day 7 am to 6 pm (Google's periods, Sunday is 0). */
const DAYTIME = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  open: { day, hour: 7, minute: 0 },
  close: { day, hour: 18, minute: 0 },
}));

const cafe = (
  id: string,
  at: { lat: number; lng: number },
  over: Partial<Place> = {},
): Place => ({
  placeId: id,
  name: `Cafe ${id}`,
  town: "Bend",
  ...at,
  businessStatus: "OPERATIONAL",
  primaryType: "coffee_shop",
  goodForChildren: true,
  menuForChildren: false,
  outdoorSeating: true,
  dineIn: true,
  rating: 4.7,
  userRatingCount: 300,
  domain: null,
  hours: DAYTIME,
  ...over,
});

const event = (over: Partial<EventAnchorInput> = {}): EventAnchorInput => ({
  slug: "train-show-central-library",
  title: "All Aboard! Michael the Train Man",
  day: "2026-12-05",
  start: "10:00",
  town: "Bend",
  lat: 44.06,
  lng: -121.3,
  regular: false,
  indoor: true,
  short: "Kids watch model trains chug through tiny towns",
  host: "deschuteslibrary.org",
  ...over,
});

describe("the indoor registry", () => {
  it("parses, and every line is grounded on the place's own site", () => {
    expect(INDOOR_ERROR).toBeNull();
    expect(INDOOR.length).toBeGreaterThanOrEqual(5);
    for (const x of INDOOR) {
      expect(siteDomain(x.url)).toBe(x.site);
      for (const e of x.evidence) expect(siteDomain(e.url)).toBe(x.site);
      expect(x.line.length).toBeLessThanOrEqual(60);
      expect(NO_DRINKS.test(x.line)).toBe(false);
    }
    // Ids only of Google's: no rating, address components or hours here.
    expect(JSON.stringify(INDOOR)).not.toMatch(
      /rating|regularOpeningHours|formatted/i,
    );
  });

  it("becomes anchors with their own labels", () => {
    const a = indoorAnchors();
    expect(a.every((x) => x.kind === "indoor" && x.sheltered)).toBe(true);
    expect(a.find((x) => x.indoorType === "library")?.label).toBe(
      "At the library",
    );
  });
});

describe("hours, for choosing only", () => {
  it("reads Google's periods, overnight and around the clock included", () => {
    expect(openAt(DAYTIME, 6, 10 * 60)).toBe(true);
    expect(openAt(DAYTIME, 6, 19 * 60)).toBe(false);
    expect(openAt([{ open: { day: 0, hour: 0, minute: 0 } }], 3, 100)).toBe(
      true,
    );
    // Friday 10 pm to Saturday 2 am.
    const late = [
      {
        open: { day: 5, hour: 22, minute: 0 },
        close: { day: 6, hour: 2, minute: 0 },
      },
    ];
    expect(openAt(late, 6, 60)).toBe(true);
    expect(openAt(null, 6, 600)).toBe(false);
    expect(openDaytime(DAYTIME, 0)).toBe(true);
    expect(
      openDaytime(
        [
          {
            open: { day: 1, hour: 9, minute: 0 },
            close: { day: 1, hour: 17, minute: 0 },
          },
        ],
        0,
      ),
    ).toBe(false);
  });
});

describe("the weekend's weather", () => {
  const day = (date: string, high: number, precip: number) => ({
    date,
    high,
    precip,
  });
  it("is bad at 50% rain or snow, or a high of 35 or less, on Saturday or Sunday", () => {
    expect(
      weekendWeather(
        [day("2026-12-05", 45, 20), day("2026-12-06", 44, 10)],
        WED,
      ),
    ).toEqual({ bad: false });
    expect(weekendWeather([day("2026-12-05", 45, 60)], WED)).toEqual({
      bad: true,
      kind: "wet",
    });
    expect(weekendWeather([day("2026-12-06", 33, 10)], WED)).toEqual({
      bad: true,
      kind: "cold",
    });
    // Friday doesn't count.
    expect(weekendWeather([day("2026-12-04", 30, 90)], WED)).toEqual({
      bad: false,
    });
  });
});

describe("events as anchors", () => {
  it("only Friday to Sunday after the post, with a time, in our towns", () => {
    const got = eventAnchors(
      [
        event(),
        event({ slug: "thu", day: "2026-12-03" }),
        event({ slug: "mon", day: "2026-12-07" }),
        event({ slug: "away", town: "Portland" }),
      ],
      WED,
    );
    expect(got.map((a) => a.slug)).toEqual([
      "train-show-central-library@2026-12-05",
    ]);
    expect(got[0]).toMatchObject({
      label: "This weekend",
      href: "/events/train-show-central-library",
      trait:
        "Saturday at 10 am. Kids watch model trains chug through tiny towns.",
    });
  });
});

describe("the mix", () => {
  const P1 = park("alpha-park-bend", 44.05, -121.31);
  const P2 = park("beta-park-bend", 44.08, -121.28);
  const P3 = park("gamma-park-bend", 44.02, -121.33);
  const lib = indoorAnchors().find((x) => x.indoorType === "library")!;
  const ev = eventAnchors([event()], WED)[0];
  const regular = (n: number) =>
    eventAnchors(
      [event({ slug: `story-${n}`, regular: true, lat: 44.1 + n / 100 })],
      WED,
    )[0];
  const cafes = (anchors: Anchor[]) =>
    anchors.map((a, i) => cafe(`c${i}`, north(a, 0.1)));

  it("good weather and 3 park pairs: parks only", () => {
    const anchors = [P1, P2, P3, lib, ev];
    const { pairs } = pairPlaces(cafes(anchors), anchors, "coffee", 12);
    const got = chooseMix(pairs, new Set(), { bad: false });
    expect(got.mix).toBe("parks");
    expect(got.pairs.every((p) => p.park.kind === "park")).toBe(true);
    const copy = mashupCopy(
      "coffee",
      copyFacts("coffee", got.pairs, { bad: false }, got.mix),
      12,
      0,
    );
    expect(copy.headline).toMatch(/playground$/);
  });

  it("too few parks: indoor places and events fill, and the cover says so", () => {
    const anchors = [P1, P2, lib, ev];
    const { pairs } = pairPlaces(cafes(anchors), anchors, "coffee", 12);
    const got = chooseMix(pairs, new Set(), { bad: false });
    expect(got.mix).toBe("thin");
    expect(got.pairs.slice(0, 2).every((p) => p.park.kind === "park")).toBe(
      true,
    );
    expect(got.pairs.length).toBe(4);
    const copy = mashupCopy(
      "coffee",
      copyFacts("coffee", got.pairs, { bad: false }, got.mix),
      12,
      0,
    );
    // An event isn't "somewhere to play".
    expect(copy.headline).toBe("4 cafes + something for the kids");
    expect(copy.headline).not.toMatch(/playground/);
  });

  it("a bad weekend: indoor anchors lead, and the cover says the weather", () => {
    const anchors = [P1, P2, P3, lib, ev];
    const { pairs } = pairPlaces(cafes(anchors), anchors, "coffee", 12);
    const wet = { bad: true as const, kind: "wet" as const };
    const got = chooseMix(pairs, new Set(), wet);
    expect(got.mix).toBe("weather");
    expect(got.pairs[0].park.sheltered).toBe(true);
    const copy = mashupCopy(
      "coffee",
      copyFacts("coffee", got.pairs, wet, got.mix),
      12,
      0,
    );
    expect(copy.headline).toBe("5 cafes + something for the kids");
    // Only 2 of 5 indoors: the weather doesn't frame it (a plain set).
    expect(copy.intro).not.toMatch(/forecast/);
    // All indoors: "indoor play".
    const only = got.pairs.filter((p) => p.park.sheltered);
    const c2 = mashupCopy(
      "coffee",
      copyFacts("coffee", only, wet, "weather"),
      12,
      0,
    );
    // Indoors lead and are at least half: now the weather frames it.
    expect(c2.intro).toMatch(
      /^Rain is in the forecast, so these are all indoors\./,
    );
    const snowy = mashupCopy(
      "coffee",
      copyFacts("coffee", only, { bad: true, kind: "snow" }, "weather"),
      12,
      0,
    );
    expect(snowy.intro).toMatch(/^Snow is in the forecast/);
    const indoorOnly = only.filter((p) => p.park.kind === "indoor");
    const c3 = mashupCopy(
      "coffee",
      copyFacts("coffee", indoorOnly, wet, "weather"),
      12,
      0,
    );
    expect(c3.headline).toBe(`${indoorOnly.length} cafes near indoor play`);
    // The weather is the cover's kicker and icon; parks say "If it clears up".
    const spec = composeMashup("coffee", mashupRows(got.pairs), c2, {
      month: 12,
      cycle: 1,
      dms: true,
      weather: "wet",
      slotDate: WED,
    });
    const head = spec.slides[0];
    expect(head.t === "headline" && head.kicker).toBe("Rainy-day pairings");
    expect(head.t === "headline" && head.pairIcon2).toBe("rain");
    expect(
      spec.slides.every(
        (x) =>
          x.t !== "pair" || x.kind !== "park" || x.label === "If it clears up",
      ),
    ).toBe(true);
  });

  it("2 libraries and 1 weekly regular at most; no anchor twice", () => {
    const libs = indoorAnchors()
      .filter((x) => x.indoorType === "library")
      .slice(0, 4);
    const regs = [regular(1), regular(2), regular(3)];
    const anchors = [...libs, ...regs];
    const { pairs } = pairPlaces(cafes(anchors), anchors, "coffee", 12);
    const got = chooseMix(pairs, new Set(), { bad: true, kind: "cold" }).pairs;
    expect(
      got.filter((p) => p.park.indoorType === "library").length,
    ).toBeLessThanOrEqual(2);
    expect(got.filter((p) => p.park.event?.regular).length).toBeLessThanOrEqual(
      1,
    );
    expect(new Set(got.map((p) => p.park.slug)).size).toBe(got.length);
  });

  it("never the same business or building, and a cafe must be open at the event", () => {
    const inside = cafe("thump-in-library", north(lib, 0.005));
    expect(pairPlaces([inside], [lib], "coffee", 12).pairs).toEqual([]);
    const same = cafe(lib.placeId!, north(lib, 0.2));
    expect(pairPlaces([same], [lib], "coffee", 12).pairs).toEqual([]);
    const closed = cafe("closed", north(ev, 0.1), {
      hours: [
        {
          open: { day: 6, hour: 12, minute: 0 },
          close: { day: 6, hour: 18, minute: 0 },
        },
      ],
    });
    expect(pairPlaces([closed], [ev], "coffee", 12).pairs).toEqual([]);
    expect(
      pairPlaces([cafe("open", north(ev, 0.1))], [ev], "coffee", 12).pairs,
    ).toHaveLength(1);
    // A brewery has no such rule.
    const brew = cafe("brew", north(ev, 0.1), {
      name: "Initiative Brewing",
      primaryType: "brewery",
      hours: null,
    });
    expect(pairPlaces([brew], [ev], "breweries", 12).pairs).toHaveLength(1);
    // An event at a brewery or a bar never anchors a pair.
    const atBrewery = eventAnchors(
      [event({ slug: "miler", venue: "Bend Brewing Co." })],
      WED,
    )[0];
    expect(
      pairProblems(
        {
          place: cafe("p", north(atBrewery, 0.1)),
          park: atBrewery,
          mi: 0.1,
          apart: { walk: true, minutes: 3 },
          score: 1,
        },
        12,
      ),
    ).toContainEqual(expect.stringMatching(/bar, brewery or winery/));
    // A play cafe is never the coffee theme's cafe.
    expect(
      placeProblem(
        cafe("x", north(P1, 0.1), { name: "Play Theory" }),
        "coffee",
        12,
      ),
    ).toBe("a play cafe");
  });
});

describe("the post", () => {
  const P1 = park("alpha-park-bend", 44.05, -121.31);
  const P2 = park("beta-park-bend", 44.08, -121.28);
  const lib = indoorAnchors().find((x) => x.indoorType === "library")!;
  const ev = eventAnchors(
    [event({ title: "Brews and Bluegrass for Kids" })],
    WED,
  )[0];

  it("labels each anchor, masks its name for the drinks rule, and links it", async () => {
    const anchors = [P1, P2, lib, ev];
    const made = await makeMashup({
      month: 12,
      slotDate: WED,
      parks: anchors,
      history: [],
      recent: [],
      dms: true,
      only: "coffee",
      places: async () => anchors.map((a, i) => cafe(`c${i}`, north(a, 0.1))),
      indoorHours: async () => DAYTIME,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.mix).toBe("thin");
    const labels = made.spec.slides.flatMap((s) =>
      s.t === "pair" ? [s.label] : [],
    );
    expect(labels).toEqual(
      expect.arrayContaining(["At the park", "At the library", "This weekend"]),
    );
    expect(made.spec.caption).toContain("This weekend: Saturday at 10 am.");
    expect(made.spec.caption).toContain("At the library: ");
    const pagePairs = mashupPairs(made.spec.slides, {
      park: () => ({ name: "x" }),
    });
    expect(pagePairs.map((p) => p.anchorLink?.href)).toEqual(
      expect.arrayContaining([
        "/events/train-show-central-library",
        lib.href,
        "/parks/alpha-park-bend",
      ]),
    );
    // Facts: parks re-checked as always; events per slide, by date.
    expect(made.spec.facts.parks).toEqual(
      expect.arrayContaining(["alpha-park-bend"]),
    );
    expect(
      made.spec.facts.mashup?.pairs.find((p) => p.kind === "event")?.event,
    ).toMatchObject({
      slug: "train-show-central-library",
      day: "2026-12-05",
      start: "10:00",
    });
    // Redrawn from the stored slides: the same post.
    const again = composeMashup(
      "coffee",
      rowsOf(made.spec),
      mashupCopy(
        "coffee",
        {
          count: 4,
          walks: 4,
          allParks: false,
          allSheltered: false,
          anyEvent: true,
          weather: null,
          shops: null,
        },
        12,
        0,
      ),
      {
        month: 12,
        cycle: 1,
        dms: true,
        tags: made.spec.tags,
        slotDate: WED,
        // As pruneMashup redraws it: the stored opener.
        opener: made.spec.opener,
      },
    );
    expect(made.spec.opener).toBeTruthy();
    expect(again.caption).toBe(made.spec.caption);
  });

  it("an indoor place not open this weekend drops out", async () => {
    const anchors = [P1, P2, lib];
    const made = await makeMashup({
      month: 12,
      slotDate: WED,
      parks: anchors,
      history: [],
      recent: [],
      dms: true,
      only: "coffee",
      places: async () => anchors.map((a, i) => cafe(`c${i}`, north(a, 0.1))),
      indoorHours: async () => [
        {
          open: { day: 2, hour: 9, minute: 0 },
          close: { day: 2, hour: 17, minute: 0 },
        },
      ],
    });
    expect(made.ok).toBe(false);
  });

  it("checks each slide against its anchor", () => {
    const anchors = [P1, P2, lib];
    const places = anchors.map((a, i) => cafe(`c${i}`, north(a, 0.1)));
    const pairs: Pairing[] = pairPlaces(
      places,
      anchors,
      "coffee",
      12,
    ).pairs.filter(
      (p, i, all) =>
        all.findIndex((q) => q.place.placeId === p.place.placeId) === i,
    );
    const facts = copyFacts("coffee", pairs, { bad: false }, "thin");
    const spec = composeMashup(
      "coffee",
      mashupRows(pairs),
      mashupCopy("coffee", facts, 12, 0),
      {
        month: 12,
        cycle: 1,
        dms: true,
        slotDate: WED,
      },
    );
    const o = { month: 12, recent: [], slotDate: WED };
    expect(mashupProblems(spec, pairs, o)).toEqual([]);
    const bad = structuredClone(spec);
    const s = bad.slides.find((x) => x.t === "pair" && x.kind === "indoor")!;
    if (s.t === "pair") s.label = "At the park";
    expect(mashupProblems(bad, pairs, o)).toContainEqual(
      expect.stringMatching(/isn't its own/),
    );
  });
});

describe("every copy variant reads true and clean", () => {
  it("for each theme, mix of anchors and weather", () => {
    const themes = ["coffee", "food_trucks", "breweries", "treats"] as const;
    const combos = [
      { allParks: true, allSheltered: false, anyEvent: false },
      { allParks: false, allSheltered: true, anyEvent: false },
      { allParks: false, allSheltered: false, anyEvent: true },
      { allParks: false, allSheltered: true, anyEvent: true },
    ];
    for (const theme of themes)
      for (const c of combos)
        for (const weather of [null, "wet", "snow", "cold"] as const)
          for (const v of [0, 1, 2]) {
            const copy = mashupCopy(
              theme,
              { count: 4, walks: 2, ...c, weather, shops: null },
              12,
              v,
            );
            const text = `${copy.headline} ${copy.intro}`;
            expect(text).not.toMatch(/for the kids for|for them for/);
            expect(NO_DRINKS.test(text)).toBe(false);
            expect(text).not.toMatch(/\blunch|breakfast|dinner\b/i);
            if (!c.allParks) expect(text).not.toMatch(/playground/);
            if (c.anyEvent)
              expect(text).not.toMatch(/somewhere to play|indoor play/);
            expect(copy.headline.split(/\s+/).length).toBeLessThanOrEqual(8);
            expect(copy.headline.toLowerCase()).toContain(copy.highlight);
          }
  });
});
