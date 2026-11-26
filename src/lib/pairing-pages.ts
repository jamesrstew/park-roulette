import { createHash } from "node:crypto";
import { NO_DRINKS, chainOf, cleanName } from "@/lib/social/mashup";
import type { MashupTheme } from "@/lib/social/model";
import type { SlideSpec } from "@/lib/social/model";
import { noAt } from "@/lib/social/handles";
import {
  type GuidePair,
  PAIRING_GUIDES,
  type PairingGuideDef,
} from "./pairing-guides";

/**
 * Pairing pages (/guides/pairings/<slug>): every park pairings post that
 * goes out on Instagram is kept as its own evergreen page, born the moment
 * the post publishes (lib/pairing-pages-data.ts). The theme-and-town guides
 * (lib/pairing-guides.ts) answer "coffee shops near playgrounds in Bend";
 * a pairing page answers "coffee near Pine Nursery Park": one fixed set of
 * places and the parks (or indoor places) beside them, named in its title.
 *
 *   - The set is fixed at birth and only ever shrinks: a pair hides when
 *     its business closes, its name is older than 30 days (Google's terms;
 *     names live in pairing_places, refreshed by place id), or its park
 *     leaves the map. Under 3 pairs, the page is gone (404, off the
 *     sitemap) until they come back. It never takes new pairs, so it never
 *     changes its topic.
 *   - Weekend events never make the page: they're over by Monday, and even
 *     a weekly regular ends without telling us. Only parks and indoor
 *     places from our registry stay.
 *   - Of Google's content only each business's name is printed. No
 *     ratings, attributes or hours. Pure.
 */

/** Fewer visible pairs than this: no page. */
export const PAGE_MIN = 3;
/** A name shows at most this long after it was read from Google. */
export const NAME_DAYS = 30;

/** One pair as the page keeps it for good: an id and our own data. */
export type PagePairDef = {
  placeId: string;
  anchorKind: "park" | "indoor";
  /** A park's slug, or an indoor place's (data/indoor-places.json). */
  anchorSlug: string;
  /** As the post printed them (the page reads today's from our data). */
  anchorName: string;
  anchorLine: string;
  /** "6-minute walk" or "Short drive" (our own measure). */
  apart: string;
  walk: boolean;
  /** The place's own site from our verified registry, or null. */
  site: string | null;
};

const SITE_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/$/i;

type PairSlide = Extract<SlideSpec, { t: "pair" }>;

/** A post's pairs as its page keeps them: no events, each place and anchor once. */
export function pagePairsFromSlides(
  slides: readonly SlideSpec[],
): PagePairDef[] {
  const out: PagePairDef[] = [];
  for (const s of slides) {
    if (s.t !== "pair") continue;
    const p = s as PairSlide;
    const kind = p.kind ?? "park";
    if (kind === "event") continue;
    if (!p.placeId || !p.parkSlug) continue;
    if (out.some((o) => o.placeId === p.placeId || o.anchorSlug === p.parkSlug))
      continue;
    out.push({
      placeId: p.placeId,
      anchorKind: kind,
      anchorSlug: p.parkSlug,
      anchorName: p.park,
      anchorLine: p.trait,
      apart: p.apart,
      walk: p.walk,
      site: p.site && SITE_RE.test(p.site) ? p.site : null,
    });
  }
  return out;
}

/** The theme's words. */
export const PAGE_THEME: Record<
  MashupTheme,
  { slug: string; word: string; places: string; one: string }
> = {
  coffee: {
    slug: "coffee",
    word: "Coffee",
    places: "coffee shops",
    one: "coffee shop",
  },
  food_trucks: {
    slug: "food-trucks",
    word: "Food trucks",
    places: "food truck lots",
    one: "food truck lot",
  },
  breweries: {
    slug: "breweries",
    word: "Breweries",
    places: "breweries",
    one: "brewery",
  },
  treats: {
    slug: "treats",
    word: "Treats",
    places: "bakeries and treat shops",
    one: "treat shop",
  },
};

export const isPageTheme = (t: unknown): t is MashupTheme =>
  typeof t === "string" && Object.hasOwn(PAGE_THEME, t);

export const pairingPagePath = (slug: string) => `/guides/pairings/${slug}`;
export const PAIRINGS_HUB = "/guides/pairings";

const kebab = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** An anchor's name as a slug part: "Pine Nursery Park" is "pine-nursery". */
function slugPart(name: string): string {
  return kebab(name.replace(/^the\s+/i, "").replace(/\s+park$/i, ""));
}

/** The longest a slug runs (it's cut at a word). */
export const SLUG_MAX = 80;

/**
 * A page's slug, fixed at birth: the theme and its first three anchors
 * ("coffee-near-pine-nursery-larkspur-hollinshead"), never a business
 * name (those are Google's and may not be kept). "-2" and on when taken.
 */
export function pairingPageSlug(
  theme: MashupTheme,
  pairs: readonly Pick<PagePairDef, "anchorName">[],
  taken: ReadonlySet<string>,
): string {
  let base = `${PAGE_THEME[theme].slug}-near`;
  for (const p of pairs.slice(0, 3)) {
    const part = slugPart(p.anchorName);
    if (!part) continue;
    if (`${base}-${part}`.length > SLUG_MAX) break;
    base = `${base}-${part}`;
  }
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** "Pine Nursery, Larkspur and Hollinshead parks"; "A, B, C and more". */
export function anchorsPhrase(names: readonly string[]): string {
  const list = (xs: readonly string[]) =>
    xs.length <= 1
      ? (xs[0] ?? "")
      : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  const three = names.slice(0, 3);
  if (names.length <= 3 && three.every((n) => /\sPark$/.test(n)))
    return `${list(three.map((n) => n.replace(/\sPark$/, "")))} parks`;
  return names.length > 3 ? `${three.join(", ")} and more` : list(three);
}

/** "Bend", "Bend and Redmond", or "Central Oregon" (3 towns or more). */
export function townsPhrase(towns: readonly string[]): string {
  if (towns.length >= 3) return "Central Oregon";
  return towns.join(" and ");
}

/** Today's facts about an anchor (our map and registry), or null: gone. */
export type AnchorNow = {
  name: string;
  city: string;
  /** "At the park", "At the library"... */
  label: string;
  /** Our line for it this month, or null (the page keeps the post's). */
  line: string | null;
  href: string;
  /** A park's features in words ("toddler area", "fenced"). */
  has?: string[];
};

/** A business's name as pairing_places keeps it. */
export type PlaceNow = {
  name: string | null;
  status: string;
  refreshedAt: Date | null;
};

export type PairingPageRow = {
  slug: string;
  postId: number;
  theme: string;
  pairs: unknown;
  bornAt: Date;
  changedAt: Date | null;
  /** The post's headline, our words ("" when it had none). */
  angle?: string;
};

export type PairingPageView = {
  slug: string;
  postId: number;
  theme: MashupTheme;
  /** The link name and the H1 ("Coffee near Harmon and Larkspur parks"). */
  name: string;
  h1: { accent: string; trail: string };
  /** The search title, about 60 characters: theme, two anchors, town. */
  title: string;
  description: string;
  /** The post's own angle, as a line (null: none). */
  angle: string | null;
  /** Every anchor on the page, in a sentence. */
  anchorsLine: string;
  intro: string;
  tips: string[];
  faq: { q: string; a: string }[];
  pairs: GuidePair[];
  /** The towns of its anchors, Bend first. */
  towns: string[];
  /** The post's day ("2026-12-02"), "December 2, 2026" and "Dec 2". */
  bornDay: string;
  bornLabel: string;
  bornShort: string;
  /**
   * When what it shows last changed (ISO): the one date the page gives,
   * as "Updated", in its structured data and as its sitemap lastmod.
   */
  changed: string;
  changedLabel: string;
  /** Most of its pairs show on a newer page: noindex,follow (data layer). */
  superseded?: boolean;
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
const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const word = (n: number) => WORDS[n] ?? String(n);
const Cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The Pacific day of an instant ("2026-12-02"). */
export const pacificDay = (d: Date) =>
  d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const dayLabel = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const shortLabel = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
};

/** A name read within the last 30 days, of a business still open. */
export function nameShown(p: PlaceNow | undefined, now: Date): string | null {
  if (!p || p.status !== "ok" || !p.name || !p.refreshedAt) return null;
  if (now.getTime() - p.refreshedAt.getTime() > NAME_DAYS * 86_400_000)
    return null;
  return p.name;
}

/**
 * The printed name for a business Google calls `raw` today, or null when
 * it no longer fits our rules (a chain, a drinks word, too long). A
 * brewery page may name a brewery; no other page prints a drinks word.
 */
export function printableName(
  raw: string,
  breweryOnly: boolean,
): string | null {
  const n = noAt(cleanName(raw));
  if (!n || n.length > 40) return null;
  if (chainOf(raw)) return null;
  if (NO_DRINKS.test(n) || (!breweryOnly && NO_DRINKS.test(raw))) return null;
  if (COMPETITOR.test(n)) return null;
  return n;
}

const COMPETITOR = /bend[\s_.-]*(family[\s_.-]*loop|buzz)/i;

/** "A, B and C". */
const andList = (xs: readonly string[]) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** The longest search title we write (Google shows about 60). */
export const TITLE_MAX = 60;

/** "Bend, OR", "Bend & Redmond, OR", or "Central Oregon". */
function townsShort(towns: readonly string[]): string {
  if (towns.length >= 3) return "Central Oregon";
  return `${towns.join(" & ")}, OR`;
}

/**
 * The search title: the theme, two anchors (one, or none, when two run
 * long) and the town, about 60 characters ("Coffee near Harmon and
 * Larkspur parks, Bend, OR").
 */
export function searchTitle(
  word: string,
  anchors: readonly string[],
  towns: readonly string[],
): string {
  const where = townsShort(towns);
  for (const n of [2, 1]) {
    const t = `${word} near ${anchorsPhrase(anchors.slice(0, n))}, ${where}`;
    if (t.length <= TITLE_MAX) return t;
  }
  return `${word} near a playground, ${where}`;
}

/** A post's headline as the page's angle line, or null when it won't do. */
export function angleLine(headline: string | null | undefined): string | null {
  const h = noAt((headline ?? "").replace(/\s+/g, " ").trim());
  if (!h || h.length > 90) return null;
  if (NO_DRINKS.test(h) || COMPETITOR.test(h)) return null;
  return /[.!?]$/.test(h) ? h : `${h}.`;
}

/** "a 4-minute walk" / "a short drive", from the chip. */
const apartWords = (apart: string) =>
  /walk/i.test(apart) ? `a ${apart.toLowerCase()}` : "a short drive";

/**
 * A page as it stands now: the pairs whose business is open with a name
 * read in the last 30 days and whose anchor is still ours, or null when
 * fewer than 3 are left (no page). Every line comes from the pairs.
 */
export function pairingPageView(
  row: PairingPageRow,
  place: (id: string) => PlaceNow | undefined,
  anchor: (kind: "park" | "indoor", slug: string) => AnchorNow | null,
  now: Date,
): PairingPageView | null {
  if (!isPageTheme(row.theme)) return null;
  const theme = row.theme;
  const T = PAGE_THEME[theme];
  const defs = (Array.isArray(row.pairs) ? row.pairs : []) as PagePairDef[];
  const shown: { pair: GuidePair; city: string }[] = [];
  for (const d of defs) {
    const name = nameShown(place(d.placeId), now);
    const a = anchor(d.anchorKind, d.anchorSlug);
    if (!name || !a) continue;
    shown.push({
      city: a.city,
      pair: {
        placeId: d.placeId,
        place: name,
        apart: d.apart,
        walk: d.walk,
        anchorKind: d.anchorKind,
        anchorSlug: d.anchorSlug,
        anchorName: noAt(a.name),
        anchorLabel: a.label,
        anchorLine: noAt(a.line ?? d.anchorLine),
        anchorHref: a.href,
        site: d.site,
        ...(d.anchorKind === "park" ? { anchorHas: a.has ?? [] } : {}),
      },
    });
  }
  if (shown.length < PAGE_MIN) return null;
  const pairs = shown.map((s) => s.pair);
  const k = pairs.length;
  const towns = [...new Set(shown.map((s) => s.city))].sort(
    (a, b) => Number(b === "Bend") - Number(a === "Bend") || a.localeCompare(b),
  );
  const where = townsPhrase(towns);
  const names = pairs.map((p) => p.anchorName);
  const two = anchorsPhrase(names.slice(0, 2));
  const name = `${T.word} near ${two}${k > 2 ? " and more" : ""}`;
  const walks = pairs.filter((p) => p.walk).length;
  const near =
    walks === k
      ? "a short walk"
      : walks === 0
        ? "a short drive"
        : "a short walk or drive";
  const parks = pairs.filter((p) => p.anchorKind === "park");
  const indoor = pairs.filter((p) => p.anchorKind === "indoor");
  const KINDS: Record<string, string> = {
    "At the library": "a library",
    "At the pool": "a pool",
    "At the play gym": "a play gym",
    "At the museum": "a museum",
  };
  const kinds = [
    ...new Set(indoor.map((p) => KINDS[p.anchorLabel]).filter(Boolean)),
  ];
  const indoorWords =
    kinds.length <= 1
      ? (kinds[0] ?? "somewhere indoors")
      : `${kinds.slice(0, -1).join(", ")} or ${kinds.at(-1)}`;
  const forKids = !indoor.length
    ? "a playground"
    : !parks.length
      ? indoorWords
      : `a playground or ${indoorWords}`;
  const bornDay = pacificDay(row.bornAt);
  const intro = `${Cap(word(k))} local ${T.places} in ${where}, each ${near} from ${forKids}. Grab yours, then let them play.`;
  const anchorsLine = `The kids' stops: ${andList(names)}.`;
  const description = `${Cap(word(k))} ${T.places} near ${anchorsPhrase(names)} in ${where}: what's there for the kids and how far apart they are.`;
  // Our own words, not the theme guide's: one line on hours, one on walks.
  const walkNums = pairs.flatMap((p, i) => (p.walk ? [String(i + 1)] : []));
  const tips = [
    ...(walkNums.length && walkNums.length < k
      ? [
          `Short on time? Try ${walkNums.length === 1 ? "pair" : "pairs"} ${andList(walkNums)}: you can leave the car in one spot.`,
        ]
      : []),
    `Hours aren't here on purpose: shops${indoor.length ? ", libraries and pools" : ""} change theirs with the seasons, so check before you head out.`,
  ];
  const sentence = (ps: GuidePair[]) =>
    andList(
      ps.map(
        (p) => `${p.place} is ${apartWords(p.apart)} from ${p.anchorName}`,
      ),
    );
  const walkers = pairs.filter((p) => p.walk);
  const with_ = (w: string) =>
    parks.filter((p) => p.anchorHas?.includes(w)).map((p) => p.anchorName);
  const are = (xs: string[]) => (xs.length === 1 ? "is" : "are");
  const faq = [
    {
      q: "Which of these are a short walk apart?",
      a: walkers.length
        ? `${Cap(sentence(walkers))}.`
        : "None of them. Each pair is a short drive apart.",
    },
    ...(indoor.length && parks.length
      ? [
          {
            q: "Is there one for a cold or wet day?",
            a: `Yes. ${andList(indoor.map((p) => `${p.place} pairs with ${p.anchorName}`))}, where the kids play indoors.`,
          },
        ]
      : []),
    ...(with_("fenced").length
      ? [
          {
            q: "Which of these parks are fenced?",
            a: `${andList(with_("fenced"))} ${are(with_("fenced"))} fenced, as our park pages list ${with_("fenced").length === 1 ? "it" : "them"}.`,
          },
        ]
      : []),
    ...(with_("toddler area").length
      ? [
          {
            q: "Which have a toddler area?",
            a: `${andList(with_("toddler area"))} ${with_("toddler area").length === 1 ? "has" : "have"} one, as our park pages list it.`,
          },
        ]
      : []),
  ];
  const changed = (row.changedAt ?? row.bornAt).toISOString();
  const cd = pacificDay(new Date(changed));
  return {
    slug: row.slug,
    postId: row.postId,
    theme,
    name,
    h1: { accent: T.word, trail: name.slice(T.word.length) },
    title: searchTitle(T.word, names, towns),
    description,
    angle: angleLine(row.angle),
    anchorsLine,
    intro,
    tips,
    faq,
    pairs,
    towns,
    bornDay,
    bornLabel: dayLabel(bornDay),
    bornShort: shortLabel(bornDay),
    changed,
    changedLabel: `${MONTHS[Number(cd.slice(5, 7)) - 1]} ${cd.slice(0, 4)}`,
  };
}

/**
 * What a page shows, as a stable key ("" when it doesn't show): a hash,
 * so the business names in it are never kept past their 30 days.
 */
export function shownKey(v: PairingPageView | null): string {
  if (!v) return "";
  const text = v.pairs
    .map((p) =>
      [p.placeId, p.place, p.anchorSlug, p.anchorName, p.anchorLine].join("|"),
    )
    .join("\n");
  return createHash("sha256").update(text).digest("hex");
}

/** Words on a page that must never be there (drinks, competitors). */
export function pageTextProblems(v: PairingPageView): string[] {
  const out: string[] = [];
  const all = [
    v.title,
    v.name,
    v.description,
    v.angle ?? "",
    v.anchorsLine,
    v.intro,
    ...v.tips,
    ...v.faq.flatMap((f) => [f.q, f.a]),
    ...v.pairs.map((p) => p.anchorLine),
  ].join("\n");
  // A brewery page may name a brewery; nothing else says a drinks word.
  const names = v.pairs.map((p) => p.place).join("\n");
  const masked = (v.theme === "breweries" ? all : `${all}\n${names}`).replace(
    /\bmonkey bars?\b/gi,
    " ",
  );
  if (NO_DRINKS.test(masked))
    out.push(`drinks word: ${NO_DRINKS.exec(masked)![0]}`);
  if (COMPETITOR.test(`${masked}\n${names}`)) out.push("a competitor");
  return out;
}

/**
 * Pages whose pairs mostly (more than half, by place) already show on a
 * newer page: they stay up and linked, but noindex,follow, so the newest
 * page is the one that's found.
 */
export function supersededSlugs(
  pages: readonly PairingPageView[],
): Set<string> {
  const sorted = [...pages].sort(newestFirst);
  const out = new Set<string>();
  const newer = new Set<string>();
  for (const v of sorted) {
    const again = v.pairs.filter((p) => newer.has(p.placeId)).length;
    if (again * 2 > v.pairs.length) out.add(v.slug);
    for (const p of v.pairs) newer.add(p.placeId);
  }
  return out;
}

/**
 * The theme-and-town guides a page leads to: its theme in each of its
 * towns (and, for coffee with an indoor anchor, the town's rainy-day page).
 * Which of them exist now is for the caller.
 */
export function guidesForPage(
  v: Pick<PairingPageView, "theme" | "towns" | "pairs">,
): PairingGuideDef[] {
  const indoor = v.pairs.some((p) => p.anchorKind === "indoor");
  return PAIRING_GUIDES.filter(
    (g) =>
      g.theme === v.theme && v.towns.includes(g.town) && (!g.rainy || indoor),
  );
}

/** The pages a theme-and-town guide links to: its theme, a pair in its town. */
export function pagesForGuide(
  g: PairingGuideDef,
  pages: readonly PairingPageView[],
): PairingPageView[] {
  return pages.filter(
    (p) =>
      p.theme === g.theme &&
      p.towns.includes(g.town) &&
      (!g.rainy || p.pairs.some((x) => x.anchorKind === "indoor")),
  );
}

/** Newest born first (the hub's order). */
export const newestFirst = (a: PairingPageView, b: PairingPageView) =>
  b.bornDay.localeCompare(a.bornDay) || b.postId - a.postId;

/** A pair's place on its page (each card's id). */
export const pairAnchorId = (i: number) => `pair-${i + 1}`;

/** The page's structured data: the pairs and breadcrumbs. */
export function pairingPageJsonLd(v: PairingPageView, site: string): object[] {
  const url = `${site}${pairingPagePath(v.slug)}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: v.title,
      description: v.description,
      inLanguage: "en-US",
      datePublished: v.bornDay,
      dateModified: v.changed.slice(0, 10),
      isPartOf: { "@id": `${site}${PAIRINGS_HUB}` },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: v.pairs.length,
        // Every item points at its own card on this page.
        itemListElement: v.pairs.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: `${p.place} + ${p.anchorName}`,
          url: `${url}#${pairAnchorId(i)}`,
        })),
      },
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
        {
          "@type": "ListItem",
          position: 3,
          name: "Park pairings",
          item: `${site}${PAIRINGS_HUB}`,
        },
        { "@type": "ListItem", position: 4, name: v.name, item: url },
      ],
    },
  ];
}
