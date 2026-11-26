import { apartChip, cleanName, type MashupTheme } from "@/lib/social/mashup";
import type { Anchor, Pairing } from "@/lib/social/mashup";
import { noAt } from "@/lib/social/handles";
import { pairProblems } from "@/lib/social/validate";
import {
  NO_DRINKS,
  pairPlaces,
  pickPairs,
  type Place,
} from "@/lib/social/mashup";

/**
 * Park pairings guides (/guides/<slug>): evergreen pages for what parents
 * search ("coffee shops near playgrounds in Bend"), one per theme and town
 * where the supply is real (3 pairs or more; fewer and the page doesn't
 * exist). Each pair is a well-loved local spot for the grown-ups and a
 * vetted park (or, on the rainy-day page, an indoor place from our
 * registry) near it, with our own distance and our own line about the
 * anchor. No events: the pages are evergreen.
 *
 * Google finds and chooses the places (lib/social/mashup.ts): of its
 * content only each business's own name is printed, and it is kept at most
 * 30 days (store: pairing_guides). No ratings, attributes or hours. Pure.
 */

export type PairingGuideDef = {
  slug: string;
  theme: MashupTheme;
  town: string;
  /** Indoor anchors only (the rainy-day page); else parks. */
  rainy?: boolean;
  /** The link name ("Coffee shops near playgrounds in Bend"). */
  name: string;
  /** The H1 in three parts, as the seasonal guides. */
  h1: { lead?: string; accent: string; trail?: string };
  /** The places in a sentence ("coffee shops", "breweries"). */
  places: string;
  /** One line for the index, llms.txt and the share card. */
  blurb: string;
};

const def = (
  theme: MashupTheme,
  town: string,
  o: Omit<PairingGuideDef, "theme" | "town" | "slug">,
): PairingGuideDef => ({
  theme,
  town,
  slug: `${o.rainy ? "rainy-day-cafes-indoor-play" : SLUG[theme]}-${town.toLowerCase().replace(/\s+/g, "-")}`,
  ...o,
});

const SLUG: Record<MashupTheme, string> = {
  coffee: "coffee-shops-near-playgrounds",
  food_trucks: "food-truck-lots-near-playgrounds",
  breweries: "breweries-near-playgrounds",
  treats: "bakeries-near-parks",
};

/** Every candidate page; one shows only with 3 or more fresh pairs. */
export const PAIRING_GUIDES: readonly PairingGuideDef[] = [
  ...["Bend", "Redmond", "Sisters", "Prineville"].map((town) =>
    def("coffee", town, {
      name: `Coffee shops near playgrounds in ${town}`,
      h1: {
        lead: "Coffee shops near",
        accent: "playgrounds",
        trail: ` in ${town}`,
      },
      places: "coffee shops",
      blurb: `Local coffee shops in ${town}, each paired with a playground close by.`,
    }),
  ),
  ...["Bend", "Redmond"].map((town) =>
    def("breweries", town, {
      name: `Breweries with a playground nearby in ${town}`,
      h1: {
        lead: "Breweries with a",
        accent: "playground",
        trail: ` nearby in ${town}`,
      },
      places: "breweries",
      blurb: `${town} breweries with a playground close by, for a family outing.`,
    }),
  ),
  ...["Bend", "Redmond"].map((town) =>
    def("food_trucks", town, {
      name: `Food truck lots near playgrounds in ${town}`,
      h1: {
        lead: "Food truck lots near",
        accent: "playgrounds",
        trail: ` in ${town}`,
      },
      places: "food truck lots",
      blurb: `${town} food truck lots with a playground close by.`,
    }),
  ),
  ...["Bend", "Redmond"].map((town) =>
    def("treats", town, {
      name: `Bakeries near parks in ${town}`,
      h1: { lead: "Bakeries near", accent: "parks", trail: ` in ${town}` },
      places: "bakeries",
      blurb: `${town} bakeries with a park close by.`,
    }),
  ),
  ...["Bend", "Redmond"].map((town) =>
    def("coffee", town, {
      rainy: true,
      name: `Rainy day with kids in ${town}: cafes near indoor play`,
      h1: {
        lead: `Rainy day with kids in ${town}: cafes near`,
        accent: "indoor play",
      },
      places: "cafes",
      blurb: `For a wet day in ${town}: cafes close to a library, a pool or a play gym.`,
    }),
  ),
];

export const pairingGuideDef = (slug: string) =>
  PAIRING_GUIDES.find((g) => g.slug === slug) ?? null;
export const pairingGuidePath = (slug: string) => `/guides/${slug}`;

/** Fewer pairs than this: the page doesn't exist. */
export const GUIDE_MIN = 3;
/** At most this many pairs on a page. */
export const GUIDE_MAX = 8;
/** Pairs show at most this long after their refresh (Google's 30 days). */
export const FRESH_DAYS = 30;

/** One pair as a page keeps it: a business name, our words and links. */
export type GuidePair = {
  placeId: string;
  place: string;
  /** "6-minute walk" or "Short drive" (our own measure). */
  apart: string;
  walk: boolean;
  anchorKind: "park" | "indoor";
  anchorSlug: string;
  anchorName: string;
  /** "At the park", "At the library"... */
  anchorLabel: string;
  /** Our own line about the anchor (a park's trait, an indoor place's line). */
  anchorLine: string;
  /** Our park page, or the indoor place's own page. */
  anchorHref: string;
  /** The place's own site from our verified registry, or null. */
  site: string | null;
  /** A park's features from our map, in words ("toddler area", "fenced"). */
  anchorHas?: string[];
};

/** Park features worth a parent's pick, in words (never restrooms or shade: seasonal). */
const HAS: [string, string][] = [
  ["toddler_area", "toddler area"],
  ["fenced", "fenced"],
  ["baby_swings", "baby swings"],
  ["swings", "swings"],
  ["climbing", "climbing"],
  ["accessible", "accessible play"],
];

/** A park's features as the page lists them (3 at most). */
export function parkHas(features: readonly string[] | undefined): string[] {
  const f = new Set(features ?? []);
  return HAS.filter(([k]) => f.has(k))
    .map(([, w]) => w)
    .filter((w, _i, all) => !(w === "swings" && all.includes("baby swings")))
    .slice(0, 3);
}

/**
 * A page's pairs from one Places search and our anchors: the town's places
 * only, parks (or indoor places on the rainy page) within 3 miles, each
 * place and anchor once, best first. Events never.
 */
export function guidePairs(
  g: PairingGuideDef,
  places: readonly Place[],
  anchors: readonly Anchor[],
  month: number,
  sites: ReadonlyMap<string, string> = new Map(),
  /** Each park's features (our map), for the cards. */
  features: ReadonlyMap<string, readonly string[]> = new Map(),
  /** Places another page already lists: used last (the rainy page). */
  avoid: ReadonlySet<string> = new Set(),
): GuidePair[] {
  const mine = anchors.filter((a) => a.kind === (g.rainy ? "indoor" : "park"));
  const town = places.filter((p) => p.town === g.town);
  const pairs = pairPlaces(town, mine, g.theme, month).pairs.filter(
    (p) => !pairProblems(p, month).length,
  );
  const fresh = pairs.filter((p) => !avoid.has(p.place.placeId));
  const again = pairs.filter((p) => avoid.has(p.place.placeId));
  return pickPairs([fresh, again], new Set(), GUIDE_MAX).map((p) =>
    guidePair(p, sites, features),
  );
}

function guidePair(
  p: Pairing,
  sites: ReadonlyMap<string, string>,
  features: ReadonlyMap<string, readonly string[]>,
): GuidePair {
  return {
    placeId: p.place.placeId,
    place: noAt(cleanName(p.place.name)),
    apart: apartChip(p.apart),
    walk: p.apart.walk,
    anchorKind: p.park.kind === "indoor" ? "indoor" : "park",
    anchorSlug: p.park.slug,
    anchorName: noAt(p.park.name),
    anchorLabel: p.park.label,
    anchorLine: noAt(p.park.trait),
    anchorHref: p.park.href,
    site: sites.get(p.place.placeId) ?? null,
    ...(p.park.kind === "park"
      ? { anchorHas: parkHas(features.get(p.park.slug)) }
      : {}),
  };
}

/** Google Maps for a place by its id alone. */
export const mapsHref = (placeId: string) =>
  `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;

export type PairingGuideView = {
  def: PairingGuideDef;
  title: string;
  description: string;
  intro: string;
  tips: string[];
  /** Questions answered from the pairs themselves (walks, fenced parks). */
  faq: { q: string; a: string }[];
  pairs: GuidePair[];
  /** The refresh the pairs come from (ISO). */
  updated: string;
  /** When what it shows last changed (ISO): its lastmod. */
  changed: string;
  /** "November 2026". */
  updatedLabel: string;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
];
const word = (n: number) => WORDS[n] ?? String(n);
const Cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * A page from its stored pairs: only when they were refreshed within 30
 * days and there are 3 or more; else null (no page). Every line is from
 * the pairs: counts, walks, the anchors' kinds. No hours, no ratings.
 */
export function pairingGuideView(
  g: PairingGuideDef,
  row: {
    pairs: unknown;
    refreshedAt: Date | null;
    changedAt?: Date | null;
  } | null,
  now: Date,
): PairingGuideView | null {
  if (!row?.refreshedAt) return null;
  if (now.getTime() - row.refreshedAt.getTime() > FRESH_DAYS * 86_400_000)
    return null;
  const pairs = (Array.isArray(row.pairs) ? row.pairs : []) as GuidePair[];
  if (pairs.length < GUIDE_MIN) return null;
  const k = pairs.length;
  const walks = pairs.filter((p) => p.walk).length;
  const near =
    walks === k
      ? "a short walk"
      : walks === 0
        ? "a short drive"
        : "a short walk or drive";
  const anchor = g.rainy ? "somewhere indoors for the kids" : "a playground";
  // What the indoor anchors are, as listed ("a library or a pool").
  const KINDS: Record<string, string> = {
    "At the library": "a library",
    "At the pool": "a pool",
    "At the play gym": "a play gym",
    "At the museum": "a museum",
  };
  const kinds = [
    ...new Set(pairs.map((p) => KINDS[p.anchorLabel]).filter(Boolean)),
  ];
  const indoorWords =
    kinds.length <= 1
      ? (kinds[0] ?? "somewhere indoors")
      : `${kinds.slice(0, -1).join(", ")} or ${kinds.at(-1)}`;
  const intro = g.rainy
    ? `${Cap(word(k))} ${g.town} cafes, each ${near} from ${indoorWords}. A warm cup for you, a dry place to play for them.`
    : `${Cap(word(k))} local ${g.places} in ${g.town}, each ${near} from ${anchor}. Your stop first, then theirs.`;
  const tips = [
    ...(walks > 0 && walks < k
      ? [
          `${Cap(word(walks))} ${walks === 1 ? "pair is" : "pairs are"} a short walk apart: park once and walk over.`,
        ]
      : walks === k
        ? ["Every pair here is a short walk apart: park once and walk over."]
        : []),
    g.rainy
      ? "Pools and play gyms run their own open swim and play times: check their sites before you go."
      : "Each park's page has what local families report there, like restrooms, shade and fences.",
    "We don't list hours: they change with the seasons, so check before you go.",
  ];
  const updated = row.refreshedAt.toISOString();
  const d = new Date(updated);
  // The search title says the state (Redmond and Sisters exist elsewhere),
  // right after the town: "...in Bend, Oregon: cafes near indoor play".
  const title = pairingGuideTitle(g.name, g.town);
  const description = g.rainy
    ? `${Cap(word(k))} ${g.town} cafes near ${indoorWords} for a rainy day with kids, with how far apart each pair is.`
    : `${Cap(word(k))} ${g.places} in ${g.town} with a playground ${walks === k ? "a short walk away" : "close by"}: what's at each park and how far apart they are.`;
  const list = (ps: GuidePair[]) =>
    ps.map((p) => `${p.place} and ${p.anchorName}`).join("; ");
  const walkers = pairs.filter((p) => p.walk);
  const with_ = (w: string) => pairs.filter((p) => p.anchorHas?.includes(w));
  const faq = [
    {
      q: "Which of these are a short walk apart?",
      a: walkers.length
        ? `${list(walkers)}.`
        : "None: each is a short drive apart.",
    },
    ...(with_("fenced").length
      ? [
          {
            q: "Which of these parks are fenced?",
            a: `${with_("fenced")
              .map((p) => p.anchorName)
              .join(", ")}, as our park pages list them.`,
          },
        ]
      : []),
    ...(with_("toddler area").length
      ? [
          {
            q: "Which have a toddler area?",
            a: `${with_("toddler area")
              .map((p) => p.anchorName)
              .join(", ")}, as our park pages list them.`,
          },
        ]
      : []),
  ];
  return {
    def: g,
    title,
    description,
    intro,
    tips,
    faq,
    pairs,
    updated,
    changed: (row.changedAt ?? row.refreshedAt).toISOString(),
    updatedLabel: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
  };
}

/** Words on a page that must never be there (drinks, competitors). */
export function guideTextProblems(v: PairingGuideView): string[] {
  const out: string[] = [];
  const masked = [
    v.title,
    v.description,
    v.intro,
    ...v.tips,
    ...v.pairs.map((p) => p.anchorLine),
  ]
    .join("\n")
    .replace(/\bmonkey bars?\b/gi, " ");
  if (NO_DRINKS.test(masked))
    out.push(`drinks word: ${NO_DRINKS.exec(masked)![0]}`);
  if (/bend[\s_.-]*(family[\s_.-]*loop|buzz)/i.test(masked))
    out.push("a competitor");
  return out;
}

/** The page's structured data: an ItemList of the pairs, and breadcrumbs. */
export function pairingGuideJsonLd(
  v: PairingGuideView,
  site: string,
): object[] {
  const url = `${site}${pairingGuidePath(v.def.slug)}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: v.title,
      description: v.description,
      inLanguage: "en-US",
      dateModified: v.changed.slice(0, 10),
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: v.pairs.length,
        // Every item points at its own card on this page.
        itemListElement: v.pairs.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: `${p.place} + ${p.anchorName}`,
          url: `${url}#pair-${i + 1}`,
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: v.faq.map((x) => ({
        "@type": "Question",
        name: x.q,
        acceptedAnswer: { "@type": "Answer", text: x.a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Park Roulette", item: site },
        {
          "@type": "ListItem",
          position: 2,
          name: "Guides",
          item: `${site}/guides`,
        },
        { "@type": "ListItem", position: 3, name: v.def.name, item: url },
      ],
    },
  ];
}

/** The guides a park anchors (its page's "Nearby" block), by theme. */
export function guidesForPark(
  slug: string,
  rows: readonly { slug: string; pairs: unknown; refreshedAt: Date | null }[],
  now: Date,
): { slug: string; label: string; name: string }[] {
  const LABEL: Record<MashupTheme, string> = {
    coffee: "coffee",
    food_trucks: "food trucks",
    breweries: "breweries",
    treats: "bakeries",
  };
  return rows.flatMap((r) => {
    const g = pairingGuideDef(r.slug);
    if (!g || g.rainy) return [];
    const v = pairingGuideView(g, r, now);
    return v &&
      v.pairs.some((p) => p.anchorKind === "park" && p.anchorSlug === slug)
      ? [{ slug: g.slug, label: LABEL[g.theme], name: g.name }]
      : [];
  });
}

/** A guide's search title: ", Oregon" right after "in <town>". Pure. */
export function pairingGuideTitle(name: string, town: string): string {
  const at = `in ${town}`;
  const i = name.indexOf(at);
  return i < 0
    ? `${name}, Oregon`
    : `${name.slice(0, i + at.length)}, Oregon${name.slice(i + at.length)}`;
}
