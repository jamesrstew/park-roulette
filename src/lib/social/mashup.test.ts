import { describe, expect, it, vi } from "vitest";
import { CATALOG } from "@/lib/news/catalog";
import { PROFILES } from "@/lib/park-profiles";
import { composeMashup as composeRows, mashupRows } from "./compose";
import { destinationOf, tileLabel } from "./links";
import {
  apart,
  apartChip,
  chainOf,
  cleanName,
  copyFacts,
  cycleFor,
  holidayBreak,
  MASHUP_THEMES,
  type MashupHistory,
  type MashupPark,
  type MashupTheme,
  mashupCopy,
  mashupParity,
  miles,
  NO_DRINKS,
  pairPlaces,
  type Pairing,
  pickPairs,
  type Place,
  placeProblem,
  postableParks,
  themeOrder,
  traitClause,
} from "./mashup";
import { makeMashup, mashupTags } from "./mashup-make";
import { ctaLine } from "./model";
import { mapsLink, mashupPairs } from "./post-page";
import { PlacesError, searchTown, themePlaces, toPlace } from "./places";
import { mashupProblems, unpackSlotProblem } from "./validate";

/** The carousel from pairs, as the make does it (parks only, good weather). */
const composeMashup = (
  theme: MashupTheme,
  pairs: Pairing[],
  copy: ReturnType<typeof mashupCopy>,
  o: Parameters<typeof composeRows>[3] & { sites?: Map<string, string> },
) => composeRows(theme, mashupRows(pairs, o.sites), copy, o);
const copyFor = (
  theme: MashupTheme,
  pairs: Pairing[],
  month: number,
  v: number,
) =>
  mashupCopy(theme, copyFacts(theme, pairs, { bad: false }, "parks"), month, v);

const park = (over: Partial<MashupPark> = {}): MashupPark => ({
  kind: "park",
  label: "At the park",
  sheltered: false,
  href: "/parks/empire-crossing-park-bend",
  icon: "playground",
  slug: "empire-crossing-park-bend",
  name: "Empire Crossing Park",
  city: "Bend",
  lat: 44.09267,
  lng: -121.29746,
  kinds: 2,
  trait: "A two-tiered play area built into the hillside",
  traitKind: "signature_structure",
  cooling: false,
  ...over,
});

/** A point this many miles north of a park. */
const north = (p: { lat: number; lng: number }, mi: number) => ({
  lat: p.lat + mi / 69.05,
  lng: p.lng,
});

const place = (over: Partial<Place> = {}): Place => ({
  placeId: "ChIJ-cafe-1",
  name: "WildRoots Coffeehouse",
  town: "Bend",
  ...north(park(), 0.1),
  businessStatus: "OPERATIONAL",
  primaryType: "coffee_shop",
  goodForChildren: true,
  menuForChildren: true,
  outdoorSeating: true,
  dineIn: true,
  rating: 4.7,
  userRatingCount: 423,
  domain: null,
  ...over,
});

describe("the alternation", () => {
  it("mashups every other week from Nov 30, 2026, never two in a row at the year's end", () => {
    expect(mashupParity("2026-11-23")).toBe(false);
    expect(mashupParity("2026-11-30")).toBe(true);
    expect(mashupParity("2026-12-07")).toBe(false);
    expect(mashupParity("2026-12-14")).toBe(true);
    // 2026 is a 53-week ISO year: week 53 and week 1 must still alternate.
    expect(mashupParity("2026-12-28")).toBe(true);
    expect(mashupParity("2027-01-04")).toBe(false);
    expect(mashupParity("2027-01-11")).toBe(true);
    // Only Mondays name a week.
    expect(mashupParity("2026-12-01")).toBe(false);
    let prev = mashupParity("2026-11-30");
    for (let d = new Date("2026-12-07"); d < new Date("2028-12-31");) {
      const day = d.toISOString().slice(0, 10);
      expect(mashupParity(day)).toBe(!prev);
      prev = !prev;
      d = new Date(d.getTime() + 7 * 86_400_000);
    }
  });

  it("a school-break week is 3+ weekdays off, never one day or the summer", () => {
    // Dec 4 (Redmond) is one day off: the mashup week stands.
    expect(holidayBreak(CATALOG, "2026-11-30")).toBeNull();
    expect(holidayBreak(CATALOG, "2026-12-21")?.id).toMatch(/winter/);
    expect(holidayBreak(CATALOG, "2026-12-28")?.id).toMatch(/winter/);
    // Sisters' summer runs June to August: not a holiday week.
    expect(
      holidayBreak(
        {
          breaks: [
            {
              id: "summer",
              label: "Summer",
              from: "2027-06-17",
              to: "2027-08-27",
              verified: true,
            } as (typeof CATALOG.breaks)[number],
          ],
        },
        "2027-07-12",
      ),
    ).toBeNull();
  });

  it("the routine's Unpack: refused on a mashup Wednesday, allowed on Sunday in a break week", () => {
    expect(unpackSlotProblem("2026-11-30", "wed", CATALOG)).toMatch(
      /park pairings week/,
    );
    expect(unpackSlotProblem("2026-11-30", "sun", CATALOG)).toMatch(
      /school-break week/,
    );
    expect(unpackSlotProblem("2026-12-07", "wed", CATALOG)).toBeNull();
    expect(unpackSlotProblem("2026-12-28", "sun", CATALOG)).toBeNull();
    expect(unpackSlotProblem("2026-12-28", "wed", CATALOG)).toMatch(
      /park pairings week/,
    );
  });

  it("Comment PARK goes on the Wednesday carousel either way", () => {
    expect(ctaLine(true, "mashup")).toMatch(/Comment PARK/);
    expect(ctaLine(false, "mashup")).toBe("Link in bio.");
  });
});

describe("distance", () => {
  it("walks only up to 0.3 mi (never over 10 minutes), drives up to 3 mi", () => {
    expect(apart(0.094)).toEqual({ walk: true, minutes: 3 });
    expect(apart(0.3)).toEqual({ walk: true, minutes: 8 });
    expect(apart(0.31)).toEqual({ walk: false });
    expect(apart(3)).toEqual({ walk: false });
    expect(apart(3.01)).toBeNull();
    expect(apart(Number.NaN)).toBeNull();
    for (let mi = 0; mi <= 0.3; mi += 0.01) {
      const a = apart(mi)!;
      expect(a.walk && a.minutes <= 10).toBe(true);
    }
    expect(apartChip({ walk: true, minutes: 4 })).toBe("4-minute walk");
    expect(apartChip({ walk: false })).toBe("Short drive");
  });

  it("measures straight-line miles", () => {
    expect(miles(park(), north(park(), 0.25))).toBeCloseTo(0.25, 2);
  });
});

describe("which places", () => {
  const m = 12;
  it("keeps an open, local, well-loved cafe in our towns", () => {
    expect(placeProblem(place(), "coffee", m)).toBeNull();
  });

  it.each([
    [{ businessStatus: "CLOSED_TEMPORARILY" }, "not operational"],
    [{ town: "Crooked River Ranch" }, "not in our towns"],
    [{ town: null }, "not in our towns"],
    [{ rating: 4.4 }, "below the rating bar"],
    [{ userRatingCount: 99 }, "below the rating bar"],
    [{ name: "Starbucks Coffee Company" }, "a chain"],
    [{ name: "Dutch Bros Coffee" }, "a chain"],
    [{ name: "The Human Bean" }, "a chain"],
    [{ primaryType: "bar" }, "a bar"],
    [{ primaryType: "bakery" }, "not this theme's kind of place"],
    [{ name: "The Commons Cafe and Taproom" }, "a drinks word in its name"],
    [{ goodForChildren: false }, "not good for children"],
    [{ dineIn: false, outdoorSeating: false }, "takeout only"],
  ] as [Partial<Place>, string][])("%o: %s", (over, why) => {
    expect(placeProblem(place(over), "coffee", m)).toBe(why);
  });

  it("a brewery must be marked good for children and named as one", () => {
    const brew = place({
      name: "Initiative Brewing (the Hub)",
      primaryType: "brewery",
    });
    expect(placeProblem(brew, "breweries", m)).toBeNull();
    expect(
      placeProblem({ ...brew, goodForChildren: null }, "breweries", m),
    ).toBe("not marked good for children");
    // A brewpub Google types as a pub, or as a restaurant, still counts.
    expect(
      placeProblem(
        {
          ...brew,
          name: "Deschutes Brewery Bend Public House",
          primaryType: "pub",
        },
        "breweries",
        m,
      ),
    ).toBeNull();
    expect(
      placeProblem(
        {
          ...brew,
          name: "Sunriver Brewing Co- Eastside Pub",
          primaryType: "restaurant",
        },
        "breweries",
        m,
      ),
    ).toBeNull();
    // Drinks words in the name, a pub that isn't a brewery, a beer garden.
    for (const name of [
      "Boneyard Beer",
      "Monkless Belgian Ales",
      "Bangers & Brews",
    ])
      expect(placeProblem({ ...brew, name }, "breweries", m)).toBe(
        "a drinks word in its name",
      );
    expect(
      placeProblem(
        { ...brew, name: "Brother Jon's", primaryType: "pub" },
        "breweries",
        m,
      ),
    ).toBe("not named as a brewery");
    expect(
      placeProblem({ ...brew, primaryType: "beer_garden" }, "breweries", m),
    ).toBe("a bar");
    // The pub type is a brewery's only: never a cafe's.
    expect(placeProblem(place({ primaryType: "pub" }), "coffee", m)).toBe(
      "a bar",
    );
  });

  it("a food truck lot must be marked good for children; one cart isn't a lot", () => {
    const lot = place({
      name: "The Podski Food Cart Lot",
      primaryType: "food_court",
    });
    expect(placeProblem(lot, "food_trucks", m)).toBeNull();
    expect(
      placeProblem({ ...lot, goodForChildren: null }, "food_trucks", m),
    ).toBe("not marked good for children");
    expect(
      placeProblem(
        { ...lot, name: "Redmond Food Park", primaryType: "restaurant" },
        "food_trucks",
        m,
      ),
    ).toBeNull();
    expect(
      placeProblem(
        { ...lot, name: "The Dominican Food Cart", primaryType: "restaurant" },
        "food_trucks",
        m,
      ),
    ).toBe("not this theme's kind of place");
  });

  it("ice cream only in warm months", () => {
    const shop = place({ name: "Bonta Gelato", primaryType: "ice_cream_shop" });
    expect(placeProblem(shop, "treats", 12)).toBe(
      "not this theme's kind of place",
    );
    expect(placeProblem(shop, "treats", 7)).toBeNull();
  });

  it("prints a clean name", () => {
    expect(
      cleanName("Watershed Coffee Roasters (formerly Looney Bean Bend)"),
    ).toBe("Watershed Coffee Roasters");
    expect(cleanName("Thump Coffee - Downtown")).toBe("Thump Coffee");
    expect(cleanName("Sunriver Brewing Co- Eastside Pub & Coffee Bar")).toBe(
      "Sunriver Brewing Co",
    );
    expect(cleanName("Brother Jon's | Public House")).toBe("Brother Jon's");
    expect(cleanName("Deschutes Brewery Bend Public House")).toBe(
      "Deschutes Brewery",
    );
    expect(cleanName("Terranaut Brewery & Taproom")).toBe("Terranaut Brewery");
    expect(cleanName("THE CELLAR PORTER BREWING CO")).toBe(
      "The Cellar Porter Brewing Co",
    );
    expect(cleanName("Dry Canyon Club + EV Charging Station")).toBe(
      "Dry Canyon Club",
    );
    expect(cleanName("Tea @ Noon")).toBe("Tea at Noon");
    expect(chainOf("Black Rock Coffee Bar")).toBe("black rock coffee");
    expect(chainOf("Lone Pine Coffee Roasters")).toBeNull();
  });

  it("catches chains behind a leading 'the' and the ones the review named", () => {
    for (const n of [
      "The Coffee Bean & Tea Leaf",
      "Cinnabon",
      "Auntie Anne's",
      "Bruegger's Bagels",
      "Wendy's",
      "The Human Bean",
    ])
      expect(chainOf(n)).not.toBeNull();
  });
});

describe("parks", () => {
  it("only postable parks with an in-season line, open and pickable", () => {
    const base = {
      slug: "empire-crossing-park-bend",
      name: "Empire Crossing Park",
      city: "Bend",
      lat: 44.09,
      lng: -121.29,
      approved: true,
      status: "active",
      play: "playground",
    };
    const got = postableParks(
      [
        base,
        { ...base, slug: "no-profile-park-bend" },
        { ...base, approved: false, slug: "farewell-bend-park-bend" },
      ],
      PROFILES,
      CATALOG,
      12,
      new Set(["empire-crossing-park-bend"]),
    );
    expect(got.map((p) => p.slug)).toEqual(["empire-crossing-park-bend"]);
    expect(got[0].cooling).toBe(true);
    expect(got[0].trait.length).toBeLessThanOrEqual(72);
  });

  it("lowercases a trait's plain first word only", () => {
    expect(traitClause("A juniper log forest")).toBe("a juniper log forest");
    expect(traitClause("On the Crooked River")).toBe("on the Crooked River");
    expect(traitClause("Bend's first park bouldering area")).toBe(
      "Bend's first park bouldering area",
    );
    expect(traitClause("Hope Playground: Oregon's largest")).toBe(
      "Hope Playground: Oregon's largest",
    );
  });
});

describe("pairing and rotation", () => {
  const p2 = park({
    slug: "farewell-bend-park-bend",
    name: "Farewell Bend Park",
    lat: 44.04112,
    lng: -121.32568,
    trait: "A lumber mill playground on the Deschutes",
  });
  const p3 = park({
    slug: "sam-johnson-park-redmond",
    name: "Sam Johnson Park",
    city: "Redmond",
    lat: 44.27362,
    lng: -121.18474,
    trait: "Hope Playground, Oregon's largest inclusive playground",
  });
  const parks = [park(), p2, p3];
  const cafes = [
    place(),
    place({
      placeId: "c2",
      name: "Dilly Dally Coffee Co.",
      ...north(p2, 0.22),
      menuForChildren: false,
    }),
    place({
      placeId: "c3",
      name: "Coffee Depot",
      town: "Redmond",
      ...north(p3, 0.15),
    }),
    place({ placeId: "c4", name: "Far Away Coffee", ...north(park(), 5) }),
    place({
      placeId: "c5",
      name: "Lone Pine Coffee Roasters",
      ...north(p2, 1.2),
    }),
    // The same brand twice: one carousel names it once.
    place({
      placeId: "c6",
      name: "Lone Pine Coffee Roasters - Westside",
      ...north(p2, 1.3),
    }),
    place({ placeId: "c7", name: "Starbucks", ...north(p3, 0.05) }),
  ];

  it("pairs each place with its best close park, and says why others are out", () => {
    const { pairs, out } = pairPlaces(cafes, parks, "coffee", 12);
    expect([...new Set(pairs.map((p) => p.place.placeId))].sort()).toEqual(
      ["ChIJ-cafe-1", "c2", "c3", "c5", "c6"].sort(),
    );
    expect(out).toEqual(
      expect.arrayContaining([
        {
          name: "Far Away Coffee (c4)",
          why: "no anchor within 3 miles it may pair with",
        },
        { name: "Starbucks (c7)", why: "a chain" },
      ]),
    );
    // Walks rank over drives in winter.
    expect(pairs[0].apart.walk).toBe(true);
  });

  it("picks one per park and brand, none used in the cycle, Bend first", () => {
    const { pairs } = pairPlaces(cafes, parks, "coffee", 12);
    const got = pickPairs(pairs, new Set(["c3"]));
    const slugs = got.map((p) => p.park.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(got.map((p) => p.place.placeId)).not.toContain("c3");
    expect(
      got.filter((p) => /Lone Pine/.test(p.place.name)).length,
    ).toBeLessThanOrEqual(1);
    expect(got[0].place.town).toBe("Bend");
  });

  it("the first four themes go in James's order, then the least recent in season", () => {
    const h = (theme: MashupTheme, slotDate: string): MashupHistory => ({
      theme,
      slotDate,
      cycle: 1,
      placeIds: [],
    });
    expect(themeOrder([], 12)[0]).toBe("coffee");
    expect(themeOrder([h("coffee", "2026-12-02")], 12)[0]).toBe("food_trucks");
    // A fallback week that ran treats first: coffee is still owed, and
    // treats never comes round twice in the first four.
    expect(themeOrder([h("treats", "2026-12-02")], 12)[0]).toBe("coffee");
    expect(
      themeOrder([h("treats", "2026-12-02"), h("coffee", "2026-12-16")], 12)[0],
    ).toBe("food_trucks");
    expect(
      themeOrder(
        [h("coffee", "2026-12-02"), h("food_trucks", "2026-12-16")],
        12,
      )[0],
    ).toBe("breweries");
    const four = [
      h("coffee", "2026-12-02"),
      h("food_trucks", "2026-12-16"),
      h("breweries", "2026-12-30"),
      h("treats", "2027-01-13"),
    ];
    // January: the least recent that suits winter (coffee), not food trucks.
    expect(themeOrder(four, 1)[0]).toBe("coffee");
    expect(themeOrder([...four, h("coffee", "2027-01-27")], 2)[0]).toBe(
      "treats",
    );
    // July: food trucks are in season again, and least recent.
    expect(themeOrder([...four, h("coffee", "2027-01-27")], 7)[0]).toBe(
      "food_trucks",
    );
    // Every theme is always there to fall back on.
    expect(new Set(themeOrder(four, 1))).toEqual(new Set(MASHUP_THEMES));
  });

  it("a pairing never repeats until the theme's set is used up", () => {
    const { pairs } = pairPlaces(cafes, parks, "coffee", 12);
    const ids = pairs.map((p) => p.place.placeId);
    const one: MashupHistory = {
      theme: "coffee",
      slotDate: "2026-12-02",
      cycle: 1,
      placeIds: ["c5"],
    };
    expect(cycleFor([one], "coffee", pairs)).toEqual({
      cycle: 1,
      used: new Set(["c5"]),
    });
    // Used up (fewer than 3 fresh): a new cycle, without the last carousel's.
    const most: MashupHistory = { ...one, placeIds: ids.slice(0, 3) };
    const next = cycleFor([most], "coffee", pairs);
    expect(next.cycle).toBe(2);
    expect([...next.used]).toEqual(ids.slice(0, 3));
    // Another theme's history doesn't count.
    expect(
      cycleFor([{ ...most, theme: "treats" }], "coffee", pairs).used.size,
    ).toBe(0);
  });
});

describe("the post", () => {
  const p2 = park({
    slug: "farewell-bend-park-bend",
    name: "Farewell Bend Park",
    lat: 44.04112,
    lng: -121.32568,
    trait: "A lumber mill playground on the Deschutes",
  });
  const p3 = park({
    slug: "sam-johnson-park-redmond",
    name: "Sam Johnson Park",
    city: "Redmond",
    lat: 44.27362,
    lng: -121.18474,
    trait: "Hope Playground, Oregon's largest inclusive playground",
  });
  const pairsFor = (theme: MashupTheme, type: string, names: string[]) =>
    pairPlaces(
      [park(), p2, p3].map((pk, i) =>
        place({
          placeId: `${theme}-${i}`,
          name: names[i],
          town: pk.city,
          primaryType: type,
          ...north(pk, i === 0 ? 0.1 : 0.8),
        }),
      ),
      [park(), p2, p3],
      theme,
      12,
    ).pairs;
  const THEMES: [MashupTheme, string, string[]][] = [
    [
      "coffee",
      "coffee_shop",
      ["WildRoots Coffeehouse", "Dilly Dally Coffee Co.", "Coffee Depot"],
    ],
    [
      "food_trucks",
      "food_court",
      ["The Lot", "The Podski Food Cart Lot", "Dry Canyon Club"],
    ],
    [
      "breweries",
      "brewery",
      ["Initiative Brewing", "Bend Brewing Company", "Wild Ride Brewing"],
    ],
    [
      "treats",
      "bakery",
      ["The Sparrow Bakery", "Nancy P's Cafe & Bakery", "La Frontera Bakery"],
    ],
  ];

  it.each(THEMES)(
    "%s: every copy variant passes the checks, with no drinks words",
    (theme, type, names) => {
      const pairs = pairsFor(theme, type, names);
      expect(pairs).toHaveLength(3);
      for (const variant of [0, 1, 2, 3]) {
        const copy = copyFor(theme, pairs, 12, variant);
        const spec = composeMashup(theme, pairs, copy, {
          month: 12,
          cycle: 1,
          dms: true,
          slotDate: "2026-12-02",
        });
        expect(
          mashupProblems(spec, pairs, {
            month: 12,
            recent: [],
            slotDate: "2026-12-02",
          }),
        ).toEqual([]);
        expect(NO_DRINKS.test(spec.caption!)).toBe(false);
        expect(NO_DRINKS.test(spec.alts.join(" "))).toBe(false);
        expect(spec.slides.map((s) => s.t)).toEqual([
          "headline",
          "pair",
          "pair",
          "pair",
          "cta",
        ]);
        // No rating, no hours, ever.
        expect(spec.caption).not.toMatch(
          /\b\d\.\d\b|stars?\b|\b(open|opens|closes|[ap]m)\b/i,
        );
      }
    },
  );

  it("the caption grounds each line, and the Facebook copy links the post's page", () => {
    const pairs = pairsFor("coffee", "coffee_shop", THEMES[0][2]);
    const spec = composeMashup(
      "coffee",
      pairs,
      copyFor("coffee", pairs, 12, 0),
      {
        month: 12,
        cycle: 1,
        dms: false,
        slotDate: "2026-12-02",
      },
    );
    expect(spec.caption).toMatch(
      /1\. WildRoots Coffeehouse \+ Empire Crossing Park, Bend \(\d-minute walk\)\nAt the park: /,
    );
    expect(spec.caption).toContain("(short drive)");
    // Google's attributes only choose places: none is printed or kept.
    expect(JSON.stringify(spec)).not.toMatch(
      /kids' menu|patio|good for kids|rating|4\.7|lat|lng|formatted/i,
    );
    expect(spec.headline).toBe("3 cafes near a playground");
    expect(spec.caption).toContain(
      "At the park: a two-tiered play area built into the hillside.",
    );
    expect(spec.caption).toContain("Link in bio.");
    expect(spec.fbCaption).toContain(
      "Details and links: https://parkroulette.quest/social?from=fb",
    );
    expect(spec.facts.mashup).toMatchObject({
      theme: "coffee",
      cycle: 1,
      pairs: pairs.map((p) => ({
        placeId: p.place.placeId,
        park: p.park.slug,
      })),
    });
    expect(spec.facts.parks).toEqual(pairs.map((p) => p.park.slug));
  });

  it("refuses a slide that says more than the data", () => {
    const pairs = pairsFor("coffee", "coffee_shop", THEMES[0][2]);
    const spec = composeMashup(
      "coffee",
      pairs,
      copyFor("coffee", pairs, 12, 0),
      {
        month: 12,
        cycle: 1,
        dms: true,
        slotDate: "2026-12-02",
      },
    );
    const o = { month: 12, recent: [], slotDate: "2026-12-02" };
    const tamper = (
      f: (s: Extract<(typeof spec.slides)[number], { t: "pair" }>) => void,
    ) => {
      const copy = structuredClone(spec);
      const s = copy.slides.find((x) => x.t === "pair")!;
      f(s as Extract<typeof s, { t: "pair" }>);
      return mashupProblems(copy, pairs, o);
    };
    expect(tamper((s) => (s.apart = "2-minute walk"))).toEqual([
      expect.stringMatching(/the distance doesn't match/),
    ]);
    expect(tamper((s) => (s.trait = "A splash pad"))).toEqual([
      expect.stringMatching(/isn't its own/),
    ]);
    expect(tamper((s) => (s.place = "Boneyard Beer"))).toContainEqual(
      expect.stringMatching(/no drinks words/),
    );
    expect(tamper((s) => (s.place = "The Bend Buzz Cafe"))).toContainEqual(
      expect.stringMatching(/isn't the place's own name/),
    );
    // A recent post with the same words: write it fresh.
    expect(
      mashupProblems(spec, pairs, {
        ...o,
        recent: [
          { kind: "unpack", slotDate: "2026-11-25", modelText: spec.modelText },
        ],
      }),
    ).toContainEqual(expect.stringMatching(/Too close/));
  });

  it("tags only verified accounts, and the page links the park and the place", () => {
    const pairs: Pairing[] = pairsFor(
      "coffee",
      "coffee_shop",
      THEMES[0][2],
    ).map((p) => ({
      ...p,
      place: { ...p.place, domain: "example-not-in-registry.com" },
    }));
    // The parks' operator (Bend Park & Recreation) is in the registry.
    expect(mashupTags(pairs).every((t) => t.role === "park")).toBe(true);
    const spec = composeMashup(
      "coffee",
      pairs,
      copyFor("coffee", pairs, 12, 0),
      {
        month: 12,
        cycle: 1,
        dms: true,
        slotDate: "2026-12-02",
        sites: new Map([[pairs[0].place.placeId, "https://example.com/"]]),
      },
    );
    const got = mashupPairs(spec.slides, {
      park: (slug) =>
        slug === "farewell-bend-park-bend" ? null : { name: slug },
    });
    expect(got[0].placeLink).toEqual({
      href: "https://example.com/",
      label: "Their website",
      to: "venue",
    });
    expect(got[1].placeLink.href).toBe(mapsLink(pairs[1].place.placeId));
    expect(got[1].placeLink.href).toBe(
      `https://www.google.com/maps/place/?q=place_id:${pairs[1].place.placeId}`,
    );
    expect(
      got.find((p) => p.park === "Farewell Bend Park")?.parkHref,
    ).toBeNull();
    expect(
      destinationOf({ id: 42, kind: "mashup", slotDate: "2026-12-02", spec }),
    ).toEqual({ href: "/social/42", to: "post" });
    expect(tileLabel("mashup", spec)).toBe("Coffee + park");
  });
});

describe("our own names never trip the drinks rule", () => {
  it("Diamond Bar Ranch Park pairs fine; a bad place drops alone", async () => {
    const diamond = park({
      slug: "diamond-bar-ranch-park-redmond",
      name: "Diamond Bar Ranch Park",
      city: "Redmond",
      lat: 44.25,
      lng: -121.17,
      trait: "Monkey bars and a big climbing net",
    });
    const others = [
      park(),
      park({
        slug: "farewell-bend-park-bend",
        name: "Farewell Bend Park",
        lat: 44.04112,
        lng: -121.32568,
      }),
      park({
        slug: "sam-johnson-park-redmond",
        name: "Sam Johnson Park",
        city: "Redmond",
        lat: 44.27362,
        lng: -121.18474,
      }),
    ];
    const parks = [diamond, ...others];
    const spots = [
      place({
        placeId: "d",
        name: "Redmond Roasters",
        town: "Redmond",
        ...north(diamond, 0.1),
      }),
      place({ placeId: "e", name: "Empire Cafe", ...north(others[0], 0.1) }),
      place({ placeId: "f", name: "Farewell Cafe", ...north(others[1], 0.1) }),
      // A name that passes the place screen but trips a pair rule: it
      // drops alone (a competitor's name).
      place({
        placeId: "g",
        name: "Bend Buzz Coffee",
        town: "Redmond",
        ...north(others[2], 0.1),
      }),
    ];
    const made = await makeMashup({
      month: 12,
      slotDate: "2026-12-02",
      parks,
      history: [],
      recent: [],
      dms: true,
      places: async () => spots,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.theme).toBe("coffee");
    expect(made.pairs.map((p) => p.place.placeId).sort()).toEqual([
      "d",
      "e",
      "f",
    ]);
    expect(made.spec.caption).toContain("Diamond Bar Ranch Park");
    expect(made.out.some((o) => o.name === "g")).toBe(true);
  });

  it("a fatal Places refusal skips the week without trying more themes", async () => {
    let n = 0;
    const made = await makeMashup({
      month: 12,
      slotDate: "2026-12-02",
      parks: [park()],
      history: [],
      recent: [],
      dms: true,
      places: async () => {
        n++;
        throw new PlacesError(
          "Places: today's 60 requests are used",
          false,
          true,
        );
      },
    });
    expect(made).toMatchObject({
      ok: false,
      fatal: expect.stringMatching(/60/),
    });
    expect(n).toBe(1);
  });

  it("a 403 or the day's quota is fatal; a budget stops requests before they go", async () => {
    const forbidden = (async () =>
      Response.json(
        { error: { status: "PERMISSION_DENIED" } },
        { status: 403 },
      )) as unknown as typeof fetch;
    await expect(
      searchTown("coffee shop", "Bend", 1, { key: "k", fetchImpl: forbidden }),
    ).rejects.toMatchObject({ fatal: true });
    const never = vi.fn(async () =>
      Response.json({ places: [] }),
    ) as unknown as typeof fetch;
    await expect(
      searchTown("coffee shop", "Bend", 1, {
        key: "k",
        fetchImpl: never,
        spend: async () => {
          throw new PlacesError("spent", false, true);
        },
      }),
    ).rejects.toMatchObject({ fatal: true });
    expect(never).not.toHaveBeenCalled();
    await expect(
      searchTown("coffee shop", "Bend", 1, {
        key: "k",
        fetchImpl: never,
        deadline: Date.now() - 1,
      }),
    ).rejects.toMatchObject({ fatal: true });
  });
});

describe("Places", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    id: "ChIJ1",
    displayName: { text: "Thump Coffee - Downtown" },
    location: { latitude: 44.058, longitude: -121.315 },
    addressComponents: [
      { shortText: "Bend", types: ["locality", "political"] },
      { shortText: "OR" },
    ],
    businessStatus: "OPERATIONAL",
    primaryType: "coffee_shop",
    goodForChildren: true,
    menuForChildren: false,
    outdoorSeating: true,
    dineIn: true,
    rating: 4.7,
    userRatingCount: 832,
    websiteUri: "http://thumpcoffee.com/",
    ...over,
  });

  it("reads only the fields the rules need", () => {
    expect(toPlace(raw())).toMatchObject({
      placeId: "ChIJ1",
      town: "Bend",
      menuForChildren: false,
      domain: "thumpcoffee.com",
    });
    expect(toPlace(raw({ id: undefined }))).toBeNull();
    expect(
      toPlace(raw({ addressComponents: [{ shortText: "x" }] }))?.town,
    ).toBeNull();
  });

  it("pages through Bend, retries a per-minute 429, and never retries the day's quota", async () => {
    let n = 0;
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      n++;
      bodies.push(JSON.parse(String(init?.body)));
      if (n === 1)
        return Response.json(
          { error: { status: "RESOURCE_EXHAUSTED" } },
          { status: 429 },
        );
      if (n === 2)
        return Response.json({ places: [raw()], nextPageToken: "p2" });
      return Response.json({ places: [raw({ id: "ChIJ2" })] });
    }) as unknown as typeof fetch;
    const got = await searchTown("coffee shop", "Bend", 2, {
      key: "k",
      fetchImpl,
      backoffMs: 1,
    });
    expect(got.map((p) => p.placeId)).toEqual(["ChIJ1", "ChIJ2"]);
    expect(bodies[0]).toMatchObject({
      textQuery: "coffee shop in Bend, Oregon",
    });
    expect(bodies[2]).toMatchObject({ pageToken: "p2" });
    const daily = vi.fn(async () =>
      Response.json(
        {
          error: {
            status: "RESOURCE_EXHAUSTED",
            details: [
              {
                metadata: { quota_limit: "SearchTextRequestPerDayPerProject" },
              },
            ],
          },
        },
        { status: 429 },
      ),
    ) as unknown as typeof fetch;
    await expect(
      searchTown("coffee shop", "Bend", 1, {
        key: "k",
        fetchImpl: daily,
        backoffMs: 1,
      }),
    ).rejects.toBeInstanceOf(PlacesError);
    expect(daily).toHaveBeenCalledTimes(1);
  });

  it("searches only the towns with a vetted park, deduplicating places", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)).textQuery);
      return Response.json({ places: [raw()] });
    }) as unknown as typeof fetch;
    const got = await themePlaces(
      "food_trucks",
      [park(), park({ slug: "x", city: "Redmond" })],
      12,
      { key: "k", fetchImpl },
    );
    expect(got).toHaveLength(1);
    expect(seen).toEqual([
      "food truck lot in Bend, Oregon",
      "food truck lot in Redmond, Oregon",
      // The second query only where most places are.
      "food cart pod in Bend, Oregon",
    ]);
  });
});

describe("making one", () => {
  it("falls through to the next theme when one has too few pairs", async () => {
    const calls: MashupTheme[] = [];
    const made = await makeMashup({
      month: 12,
      slotDate: "2026-12-02",
      parks: [park()],
      history: [],
      recent: [],
      dms: true,
      places: async (t) => {
        calls.push(t);
        return [];
      },
    });
    expect(made.ok).toBe(false);
    expect(calls[0]).toBe("coffee");
    expect(new Set(calls)).toEqual(new Set(MASHUP_THEMES));
  });
});
