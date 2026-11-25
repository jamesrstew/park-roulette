import { describe, expect, it } from "vitest";
import {
  FRESH_DAYS,
  type GuidePair,
  guidePairs,
  guidesForPark,
  guideTextProblems,
  PAIRING_GUIDES,
  pairingGuideDef,
  pairingGuideJsonLd,
  pairingGuideView,
} from "./pairing-guides";
import { type Anchor, indoorAnchors, type Place } from "./social/mashup";

const NOW = new Date("2026-11-25T20:00:00Z");
const park = (
  slug: string,
  lat: number,
  lng: number,
  city = "Bend",
): Anchor => ({
  kind: "park",
  slug,
  name: `${slug.split("-")[0]} Park`,
  city,
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
const cafe = (
  id: string,
  at: { lat: number; lng: number },
  town = "Bend",
): Place => ({
  placeId: id,
  name: `Cafe ${id}`,
  town,
  lat: at.lat + 0.1 / 69,
  lng: at.lng,
  businessStatus: "OPERATIONAL",
  primaryType: "coffee_shop",
  goodForChildren: true,
  menuForChildren: true,
  outdoorSeating: true,
  dineIn: true,
  rating: 4.7,
  userRatingCount: 300,
  domain: null,
});
const pair = (i: number, over: Partial<GuidePair> = {}): GuidePair => ({
  placeId: `p${i}`,
  place: `Cafe ${i}`,
  apart: "3-minute walk",
  walk: true,
  anchorKind: "park",
  anchorSlug: `park-${i}`,
  anchorName: `Park ${i}`,
  anchorLabel: "At the park",
  anchorLine: "A two-tiered play area",
  anchorHref: `/parks/park-${i}`,
  site: null,
  ...over,
});
const coffee = pairingGuideDef("coffee-shops-near-playgrounds-bend")!;

describe("the pages", () => {
  it("have unique slugs that say the query", () => {
    const slugs = PAIRING_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "coffee-shops-near-playgrounds-bend",
        "breweries-near-playgrounds-bend",
        "food-truck-lots-near-playgrounds-bend",
        "bakeries-near-parks-bend",
        "rainy-day-cafes-indoor-play-bend",
      ]),
    );
  });

  it("pair the town's places with parks (or indoor places on the rainy page), never events", () => {
    const parks = [
      park("alpha-park-bend", 44.05, -121.31),
      park("beta-park-bend", 44.08, -121.28),
    ];
    const places = [
      cafe("a", parks[0]),
      cafe("b", parks[1]),
      cafe("r", parks[0], "Redmond"),
    ];
    const got = guidePairs(coffee, places, [...parks, ...indoorAnchors()], 12);
    expect(got.map((p) => p.placeId).sort()).toEqual(["a", "b"]);
    expect(got.every((p) => p.anchorKind === "park")).toBe(true);
    // Google's content is the name only: no rating or attribute kept.
    expect(JSON.stringify(got)).not.toMatch(
      /rating|goodForChildren|menu|lat|lng/i,
    );
    const lib = indoorAnchors().find((a) => a.city === "Bend")!;
    const rainy = pairingGuideDef("rainy-day-cafes-indoor-play-bend")!;
    const r = guidePairs(
      rainy,
      [cafe("c", { lat: lib.lat + 0.01, lng: lib.lng })],
      [...parks, lib],
      12,
    );
    expect(r.every((p) => p.anchorKind === "indoor")).toBe(true);
  });

  it("exist only with 3 fresh pairs or more; stale pairs (30 days) hide", () => {
    const three = [pair(1), pair(2), pair(3)];
    expect(
      pairingGuideView(
        coffee,
        { pairs: three.slice(0, 2), refreshedAt: NOW },
        NOW,
      ),
    ).toBeNull();
    expect(pairingGuideView(coffee, null, NOW)).toBeNull();
    const v = pairingGuideView(
      coffee,
      { pairs: three, refreshedAt: NOW },
      NOW,
    )!;
    expect(v.title).toBe("Coffee shops near playgrounds in Bend, Oregon");
    expect(v.updatedLabel).toBe("November 2026");
    expect(v.intro).toMatch(
      /^Three local coffee shops in Bend, each a short walk from a playground/,
    );
    expect(v.tips).toContainEqual(
      expect.stringMatching(/Every pair here is a short walk apart/),
    );
    expect(v.description.length).toBeLessThanOrEqual(160);
    const old = new Date(NOW.getTime() - (FRESH_DAYS + 1) * 86_400_000);
    expect(
      pairingGuideView(coffee, { pairs: three, refreshedAt: old }, NOW),
    ).toBeNull();
  });

  it("say no drinks word on the brewery page, and name no competitor", () => {
    const brew = pairingGuideDef("breweries-near-playgrounds-bend")!;
    const v = pairingGuideView(
      brew,
      { pairs: [pair(1), pair(2), pair(3)], refreshedAt: NOW },
      NOW,
    )!;
    expect(guideTextProblems(v)).toEqual([]);
    const bad = { ...v, tips: [...v.tips, "Grab a pint first."] };
    expect(guideTextProblems(bad)).toContainEqual(
      expect.stringMatching(/drinks/),
    );
  });

  it("mark up the pairs as an ItemList of place + anchor", () => {
    const v = pairingGuideView(
      coffee,
      { pairs: [pair(1), pair(2), pair(3)], refreshedAt: NOW },
      NOW,
    )!;
    // JSON's own shape (what a crawler reads).
    const [page, faq, crumbs] = JSON.parse(
      JSON.stringify(pairingGuideJsonLd(v, "https://parkroulette.quest")),
    );
    expect(page["@type"]).toBe("CollectionPage");
    expect(page.mainEntity.numberOfItems).toBe(3);
    expect(page.mainEntity.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Cafe 1 + Park 1",
      url: "https://parkroulette.quest/parks/park-1",
    });
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity[0].name).toBe(
      "Which of these are a short walk apart?",
    );
    expect(crumbs["@type"]).toBe("BreadcrumbList");
  });

  it("link from a park's page only when it's in a page that exists", () => {
    const rows = [
      {
        slug: "coffee-shops-near-playgrounds-bend",
        pairs: [pair(1), pair(2), pair(3)],
        refreshedAt: NOW,
      },
      {
        slug: "bakeries-near-parks-bend",
        pairs: [pair(1), pair(2)],
        refreshedAt: NOW,
      },
    ];
    expect(guidesForPark("park-1", rows, NOW)).toEqual([
      {
        slug: "coffee-shops-near-playgrounds-bend",
        label: "coffee",
        name: "Coffee shops near playgrounds in Bend",
      },
    ]);
    expect(guidesForPark("park-9", rows, NOW)).toEqual([]);
  });
});
