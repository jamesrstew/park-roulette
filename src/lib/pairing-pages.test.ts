import { describe, expect, it } from "vitest";
import type { SlideSpec } from "@/lib/social/model";
import {
  anchorsPhrase,
  angleLine,
  searchTitle,
  supersededSlugs,
  type AnchorNow,
  guidesForPage,
  NAME_DAYS,
  pageTextProblems,
  pagePairsFromSlides,
  pagesForGuide,
  pairingPageJsonLd,
  pairingPageSlug,
  pairingPageView,
  type PairingPageRow,
  type PlaceNow,
  printableName,
  shownKey,
  SLUG_MAX,
} from "./pairing-pages";
import { pairingGuideDef } from "./pairing-guides";

const pair = (
  n: number,
  o: Partial<Extract<SlideSpec, { t: "pair" }>> = {},
): SlideSpec => ({
  t: "pair",
  n,
  of: 4,
  icon: "cup",
  place: `Cafe ${n}`,
  park: `Park ${n}`,
  town: "Bend",
  apart: "6-minute walk",
  walk: true,
  trait: "A big climbing net",
  placeId: `place-${n}`,
  parkSlug: `park-${n}-bend`,
  kind: "park",
  label: "At the park",
  site: null,
  ...o,
});

describe("pagePairsFromSlides", () => {
  it("keeps parks and indoor places, never a weekend event", () => {
    const got = pagePairsFromSlides([
      { t: "headline", words: "x", highlight: "x", kicker: "k" } as SlideSpec,
      pair(1),
      pair(2, { kind: "event", parkSlug: "storytime@2026-12-05" }),
      pair(3, { kind: "indoor", parkSlug: "central-library-bend" }),
      pair(4, { site: "https://thump.example/" }),
    ]);
    expect(got.map((p) => p.anchorSlug)).toEqual([
      "park-1-bend",
      "central-library-bend",
      "park-4-bend",
    ]);
    expect(got[2].site).toBe("https://thump.example/");
    // No business name is kept with the pair (only its id).
    expect(JSON.stringify(got)).not.toContain("Cafe");
  });

  it("drops a second pair for the same place or anchor, and odd sites", () => {
    const got = pagePairsFromSlides([
      pair(1),
      pair(2, { placeId: "place-1" }),
      pair(3, { parkSlug: "park-1-bend" }),
      pair(4, { site: "http://plain.example/" }),
    ]);
    expect(got.map((p) => p.placeId)).toEqual(["place-1", "place-4"]);
    expect(got[1].site).toBeNull();
  });
});

describe("pairingPageSlug", () => {
  const names = (...xs: string[]) => xs.map((anchorName) => ({ anchorName }));
  it("is the theme and its first three anchors, without 'park'", () => {
    expect(
      pairingPageSlug(
        "coffee",
        names(
          "Pine Nursery Park",
          "Larkspur Park",
          "The Hollinshead Park",
          "Juniper Park",
        ),
        new Set(),
      ),
    ).toBe("coffee-near-pine-nursery-larkspur-hollinshead");
    expect(
      pairingPageSlug("food_trucks", names("Downtown Bend Library"), new Set()),
    ).toBe("food-trucks-near-downtown-bend-library");
  });

  it("takes the next number when the slug is taken, and stays short", () => {
    const taken = new Set(["treats-near-a-b-c", "treats-near-a-b-c-2"]);
    expect(pairingPageSlug("treats", names("A", "B", "C"), taken)).toBe(
      "treats-near-a-b-c-3",
    );
    const long = names(
      "Sawyer Park Reservoir Overlook And Natural Area",
      "Old Mill District Riverbend Community Commons",
      "Hollinshead Barn And Community Garden",
    );
    const s = pairingPageSlug("breweries", long, new Set());
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(s).toMatch(/^breweries-near-[a-z0-9-]+[a-z0-9]$/);
  });
});

describe("anchorsPhrase", () => {
  it("folds three parks into one 'parks'", () => {
    expect(
      anchorsPhrase(["Pine Nursery Park", "Larkspur Park", "Juniper Park"]),
    ).toBe("Pine Nursery, Larkspur and Juniper parks");
  });
  it("names a mix in full, and says 'and more' past three", () => {
    expect(anchorsPhrase(["Larkspur Park", "Downtown Bend Library"])).toBe(
      "Larkspur Park and Downtown Bend Library",
    );
    expect(anchorsPhrase(["A Park", "B Park", "C Park", "D Park"])).toBe(
      "A Park, B Park, C Park and more",
    );
  });
});

describe("printableName", () => {
  it("cleans the name and refuses chains, drinks words and competitors", () => {
    expect(printableName("Thump Coffee - Downtown", false)).toBe(
      "Thump Coffee",
    );
    expect(printableName("Starbucks", false)).toBeNull();
    expect(printableName("Cafe and Taproom", false)).toBeNull();
    expect(printableName("Bend Family Loop Cafe", false)).toBeNull();
    // A brewery page may name a brewery (its pub is only where it is).
    expect(printableName("Crux Fermentation Project", true)).toBe(
      "Crux Fermentation Project",
    );
    expect(printableName("Deschutes Brewery Bend Public House", true)).toBe(
      "Deschutes Brewery",
    );
  });
});

const NOW = new Date("2026-12-10T18:00:00Z");
const BORN = new Date("2026-12-03T03:45:00Z");
const day = 86_400_000;

function row(n = 4, o: Partial<PairingPageRow> = {}): PairingPageRow {
  return {
    slug: "coffee-near-park-1-park-2-park-3",
    postId: 42,
    theme: "coffee",
    bornAt: BORN,
    changedAt: null,
    pairs: Array.from({ length: n }, (_, i) => ({
      placeId: `place-${i + 1}`,
      anchorKind: i === 3 ? "indoor" : "park",
      anchorSlug: i === 3 ? "central-library-bend" : `park-${i + 1}-bend`,
      anchorName: `Park ${i + 1}`,
      anchorLine: "As the post said",
      apart: i === 1 ? "Short drive" : "6-minute walk",
      walk: i !== 1,
      site: null,
    })),
    ...o,
  };
}

const places =
  (over: Record<string, Partial<PlaceNow>> = {}) =>
  (id: string): PlaceNow | undefined => ({
    name: `Cafe ${id.split("-")[1]}`,
    status: "ok",
    refreshedAt: new Date(NOW.getTime() - (Number(id.split("-")[1]) + 1) * day),
    ...over[id],
  });

const anchors =
  (gone: string[] = []) =>
  (kind: "park" | "indoor", slug: string): AnchorNow | null => {
    if (gone.includes(slug)) return null;
    if (kind === "indoor")
      return {
        name: "Downtown Bend Library",
        city: "Bend",
        label: "At the library",
        line: "Storytime and a kids' corner",
        href: "https://library.example/downtown",
      };
    const n = slug.split("-")[1];
    return {
      name: ["", "Harmon Park", "Larkspur Park", "Juniper Park"][Number(n)],
      city: n === "3" ? "Redmond" : "Bend",
      label: "At the park",
      line: n === "1" ? "A big climbing net" : null,
      href: `/parks/${slug}`,
      has: n === "1" ? ["toddler area", "fenced"] : [],
    };
  };

describe("pairingPageView", () => {
  it("shows the pairs with today's anchor data and the post's day", () => {
    const v = pairingPageView(row(), places(), anchors(), NOW)!;
    expect(v.pairs.map((p) => p.place)).toEqual([
      "Cafe 1",
      "Cafe 2",
      "Cafe 3",
      "Cafe 4",
    ]);
    expect(v.name).toBe("Coffee near Harmon and Larkspur parks and more");
    expect(v.h1).toEqual({
      accent: "Coffee",
      trail: " near Harmon and Larkspur parks and more",
    });
    // The search title stays about 60 characters.
    expect(v.title).toBe(
      "Coffee near Harmon and Larkspur parks, Bend & Redmond, OR",
    );
    expect(v.title.length).toBeLessThanOrEqual(60);
    // Every anchor is still named in the body.
    expect(v.anchorsLine).toBe(
      "The kids' stops: Harmon Park, Larkspur Park, Juniper Park and Downtown Bend Library.",
    );
    expect(v.towns).toEqual(["Bend", "Redmond"]);
    expect(v.bornLabel).toBe("December 2, 2026");
    expect(v.bornShort).toBe("Dec 2");
    // Our line for the park this month, else the post's.
    expect(v.pairs[0].anchorLine).toBe("A big climbing net");
    expect(v.pairs[1].anchorLine).toBe("As the post said");
    expect(v.pairs[3].anchorLabel).toBe("At the library");
    // One date: when what it shows changed (born, until a change).
    expect(v.changed).toBe(BORN.toISOString());
    expect(v.changedLabel).toBe("December 2026");
    expect(v.angle).toBeNull();
    expect(v.intro).toMatch(/^Four local coffee shops in Bend and Redmond/);
    // Answers are sentences, with our distances.
    expect(v.faq[0].a).toBe(
      "Cafe 1 is a 6-minute walk from Harmon Park, Cafe 3 is a 6-minute walk from Juniper Park and Cafe 4 is a 6-minute walk from Downtown Bend Library.",
    );
    expect(v.faq[2].a).toBe(
      "Harmon Park is fenced, as our park pages list it.",
    );
    // No tip repeats the theme guide's word for word.
    expect(v.tips).toEqual([
      "Short on time? Try pairs 1, 3 and 4: you can leave the car in one spot.",
      "Hours aren't here on purpose: shops, libraries and pools change theirs with the seasons, so check before you head out.",
    ]);
    expect(v.faq.map((f) => f.q)).toEqual([
      "Which of these are a short walk apart?",
      "Is there one for a cold or wet day?",
      "Which of these parks are fenced?",
      "Which have a toddler area?",
    ]);
    expect(pageTextProblems(v)).toEqual([]);
  });

  it("hides a pair whose name is over 30 days old, closed, or whose park left", () => {
    const v = pairingPageView(
      row(4),
      places({
        "place-2": {
          refreshedAt: new Date(NOW.getTime() - (NAME_DAYS + 1) * day),
        },
      }),
      anchors(),
      NOW,
    )!;
    expect(v.pairs.map((p) => p.placeId)).toEqual([
      "place-1",
      "place-3",
      "place-4",
    ]);
    // Two gone of four: under 3, no page.
    expect(
      pairingPageView(
        row(4),
        places({ "place-1": { status: "gone", name: null } }),
        anchors(["park-2-bend"]),
        NOW,
      ),
    ).toBeNull();
    expect(
      pairingPageView(
        row(4),
        places({ "place-3": { name: null } }),
        anchors(["central-library-bend"]),
        NOW,
      ),
    ).toBeNull();
  });

  it("is null for an unknown theme or fewer than 3 pairs", () => {
    expect(
      pairingPageView(row(4, { theme: "x" }), places(), anchors(), NOW),
    ).toBeNull();
    expect(pairingPageView(row(2), places(), anchors(), NOW)).toBeNull();
  });

  it("keys what it shows, so a change is seen", () => {
    const a = pairingPageView(row(), places(), anchors(), NOW);
    const b = pairingPageView(
      row(),
      places({ "place-1": { name: "Cafe Renamed" } }),
      anchors(),
      NOW,
    );
    expect(shownKey(a)).not.toBe(shownKey(b));
    expect(shownKey(null)).toBe("");
  });
});

describe("links between pages and guides", () => {
  it("leads to its theme's guides in its towns, and they back to it", () => {
    const v = pairingPageView(row(), places(), anchors(), NOW)!;
    expect(guidesForPage(v).map((g) => g.slug)).toEqual([
      "coffee-shops-near-playgrounds-bend",
      "coffee-shops-near-playgrounds-redmond",
      "rainy-day-cafes-indoor-play-bend",
      "rainy-day-cafes-indoor-play-redmond",
    ]);
    const bend = pairingGuideDef("coffee-shops-near-playgrounds-bend")!;
    const sisters = pairingGuideDef("coffee-shops-near-playgrounds-sisters")!;
    const brew = pairingGuideDef("breweries-near-playgrounds-bend")!;
    expect(pagesForGuide(bend, [v])).toEqual([v]);
    expect(pagesForGuide(sisters, [v])).toEqual([]);
    expect(pagesForGuide(brew, [v])).toEqual([]);
  });
});

describe("pairingPageJsonLd", () => {
  it("has the list and four breadcrumbs, no FAQPage", () => {
    const v = pairingPageView(row(), places(), anchors(), NOW)!;
    const [page, crumbs, ...rest] = pairingPageJsonLd(
      v,
      "https://parkroulette.quest",
    ) as Record<string, unknown>[];
    expect(page["@type"]).toBe("CollectionPage");
    expect(page.url).toBe(
      "https://parkroulette.quest/guides/pairings/coffee-near-park-1-park-2-park-3",
    );
    expect(page.datePublished).toBe("2026-12-02");
    const list = page.mainEntity as { itemListElement: { url?: string }[] };
    // Every item points at its own card on the page.
    expect(list.itemListElement.map((x) => x.url)).toEqual(
      [1, 2, 3, 4].map((n) => `${page.url}#pair-${n}`),
    );
    // No FAQPage: Google shows no rich result for it here.
    expect(rest).toEqual([]);
    expect(
      (crumbs.itemListElement as { item: string }[]).map((c) => c.item),
    ).toEqual([
      "https://parkroulette.quest",
      "https://parkroulette.quest/guides",
      "https://parkroulette.quest/guides/pairings",
      page.url,
    ]);
  });
});

describe("angle, titles and superseded pages", () => {
  it("keeps the post's headline as the angle, never a drinks word", () => {
    expect(angleLine("Coffee first, then the slide")).toBe(
      "Coffee first, then the slide.",
    );
    expect(angleLine("Pints and a playground")).toBeNull();
    expect(angleLine("")).toBeNull();
  });

  it("drops to one anchor, then none, to stay about 60 characters", () => {
    expect(
      searchTitle(
        "Food trucks",
        ["Sam Johnson Park", "Big Sky Park"],
        ["Redmond"],
      ),
    ).toBe("Food trucks near Sam Johnson and Big Sky parks, Redmond, OR");
    expect(
      searchTitle(
        "Treats",
        ["Hollinshead Community Park and Barn", "Old Mill District Commons"],
        ["Bend", "Redmond"],
      ),
    ).toBe("Treats near a playground, Bend & Redmond, OR");
  });

  it("marks a page superseded when most of its places are on a newer one", () => {
    const old = pairingPageView(row(), places(), anchors(), NOW)!;
    const newer = pairingPageView(
      {
        ...row(),
        slug: "newer",
        postId: 43,
        bornAt: new Date(BORN.getTime() + 14 * day),
      },
      places(),
      anchors(),
      NOW,
    )!;
    expect([...supersededSlugs([old, newer])]).toEqual([old.slug]);
    expect([...supersededSlugs([old])]).toEqual([]);
  });

  it("hashes what it shows: no business name is kept in the key", () => {
    const v = pairingPageView(row(), places(), anchors(), NOW)!;
    expect(shownKey(v)).toMatch(/^[0-9a-f]{64}$/);
    expect(shownKey(v)).not.toContain("Cafe");
  });
});
