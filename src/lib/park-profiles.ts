import { z } from "zod";
import raw from "../../data/park-profiles.json";

/**
 * Signature traits per park (data/park-profiles.json): the 2 to 5 things
 * that make a parent pick this playground over the one down the street
 * (a pirate ship, a creek, an all-abilities design, a sledding hill).
 * Social park posts and the newsletter lead with them instead of a
 * generic feature list. Pure: no server imports.
 *
 * Every trait is our own words. An official or news trait carries
 * {url, quote}, the quote verbatim from that page (re-checked monthly by
 * the events-check cron). A google_places trait was named by Google's
 * review summary for the place: only our paraphrase and the place id are
 * kept here, never Google's text (the repo is public).
 */

export const TRAIT_KINDS = [
  "signature_structure",
  "all_abilities",
  "water",
  "splash_pad",
  "shade",
  "paved_loop",
  "trail",
  "view",
  "history",
  "sledding",
  "toddler",
  "nature_play",
  "nature",
  "fenced",
  "nearby",
  "other",
] as const;
export type TraitKind = (typeof TRAIT_KINDS)[number];

export const TRAIT_SOURCES = [
  "official",
  "news",
  "osm",
  "google_places",
] as const;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Https = z.url({ protocol: /^https$/ });

/** Hosts that are never evidence: other newsletters, and Google itself. */
const NOT_EVIDENCE =
  /(^|\.)(bendbuzz\.com|thebendbuzz\.com|bendfamilyloop\.com|google\.[a-z.]+|googleapis\.com|goo\.gl|beehiiv\.com|substack\.com)$/i;

export const Evidence = z.strictObject({
  url: Https.refine(
    (u) => !NOT_EVIDENCE.test(new URL(u).hostname),
    "Never another newsletter or Google as evidence",
  ),
  /** Verbatim from the page (as its text reads after tags are stripped). */
  quote: z.string().trim().min(20).max(300),
});
export type Evidence = z.infer<typeof Evidence>;

export const Trait = z
  .strictObject({
    /** Our own words, 90 characters at most. */
    text: z.string().trim().min(6).max(90),
    kind: z.enum(TRAIT_KINDS),
    source: z.enum(TRAIT_SOURCES),
    evidence: z.array(Evidence).max(3),
    verified_on: Day,
  })
  .refine((t) => t.source === "google_places" || t.evidence.length > 0, {
    message: "An official, news or OSM trait needs {url, quote} evidence",
  });
export type Trait = z.infer<typeof Trait>;

/** Plain facts about the place, in our own terms (booleans only). */
export const ParkFacts = z.strictObject({
  restroom: z.boolean().optional(),
  allows_dogs: z.boolean().optional(),
  good_for_children: z.boolean().optional(),
  wheelchair_accessible_entrance: z.boolean().optional(),
  wheelchair_accessible_parking: z.boolean().optional(),
  wheelchair_accessible_restroom: z.boolean().optional(),
  free_parking_lot: z.boolean().optional(),
  free_street_parking: z.boolean().optional(),
});
export type ParkFacts = z.infer<typeof ParkFacts>;

export const ParkProfile = z
  .strictObject({
    /** Google place id (an id only; nothing of Google's text). */
    place_id: z.string().nullable().default(null),
    traits: z.array(Trait).max(5),
    /** 120 characters, our words, leading with the most distinctive trait. */
    one_liner: z.string().trim().min(10).max(120).nullable(),
    facts: ParkFacts.default({}),
  })
  .refine((p) => (p.one_liner === null) === (p.traits.length === 0), {
    message: "A one_liner exactly when there are traits",
  });
export type ParkProfile = z.infer<typeof ParkProfile>;

export const ProfilesFile = z.record(
  z.string().regex(/^[a-z0-9-]+$/),
  ParkProfile,
);

export const PROFILES: ReadonlyMap<string, ParkProfile> = new Map(
  Object.entries(ProfilesFile.parse(raw)),
);

/** A park post needs this many traits (code only picks such parks). */
export const MIN_POST_TRAITS = 2;

export function profileFor(
  slug: string,
  profiles: ReadonlyMap<string, ParkProfile> = PROFILES,
): ParkProfile | null {
  return profiles.get(slug) ?? null;
}

export function traitCount(
  slug: string,
  profiles: ReadonlyMap<string, ParkProfile> = PROFILES,
): number {
  return profiles.get(slug)?.traits.length ?? 0;
}

// --- Key terms ----------------------------------------------------------------

/** Words that say nothing distinctive on their own. */
const STOP = new Set(
  "a an and the of for to in on at by with from near next along into onto its it's it is are has have one two three four five six seven eight nine ten park parks playground playgrounds play plays area areas spot spots structure structures feature features kids kid children child family families little littles young big bigger biggest small new newer older built lots plenty fun great good best nice place places space spaces around right just also all every each some more most whole loads tons equipment amenity amenities piece pieces section sections side sides corner corners part parts bend redmond sisters prineville madras culver sunriver terrebonne oregon central city town neighborhood local".split(
    " ",
  ),
);

const stem = (w: string) =>
  w
    .replace(/'s$/, "")
    .replace(/(ies)$/, "y")
    .replace(/(ing|ed|es|s)$/, "");

function words(text: string): string[] {
  return text
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, " ")
    .split(/[\s-]+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/**
 * A trait's key terms: its distinctive words, stemmed (a park's own name
 * words never count, so "Pine Nursery" can't pass for a trait).
 */
export function traitTerms(
  trait: Pick<Trait, "text">,
  parkName = "",
): string[] {
  const own = new Set(words(parkName).map(stem));
  return [
    ...new Set(
      words(trait.text)
        .filter((w) => w.length >= 3 && !STOP.has(w))
        .map(stem)
        .filter((w) => w.length >= 3 && !own.has(w)),
    ),
  ];
}

/** The first trait a piece of text names (by key term), or null. */
export function traitIn(
  text: string,
  profile: Pick<ParkProfile, "traits"> | null,
  parkName = "",
): Trait | null {
  if (!profile) return null;
  const got = new Set(words(text).map(stem));
  return (
    profile.traits.find((t) =>
      traitTerms(t, parkName).some((term) => got.has(term)),
    ) ?? null
  );
}

// --- Generic copy -------------------------------------------------------------

/** Phrases that could describe any park on Earth. */
const GENERIC_PHRASES: [RegExp, string][] = [
  [/\bbuilt for\b[^.!?\n]{0,40}\bfans\b/i, '"built for ... fans"'],
  [/\bsomething for every(one|body)\b/i, '"something for everyone"'],
  [
    /\bfun for (all ages|every age|the whole family|everyone)\b/i,
    '"fun for all ages"',
  ],
  [/\b(a |the )?great (place|spot)\b/i, '"great place"'],
  [/\bhidden gem\b/i, '"hidden gem"'],
];

/** The generic phrases a text uses (labels), or []. */
export function genericPhrases(text: string): string[] {
  const t = text.replace(/[‘’]/g, "'");
  return GENERIC_PHRASES.filter(([re]) => re.test(t)).map(([, l]) => l);
}

/** Every evidence item in the profiles, for the monthly re-check. */
export function allEvidence(
  profiles: ReadonlyMap<string, ParkProfile> = PROFILES,
): { slug: string; trait: string; url: string; quote: string }[] {
  return [...profiles].flatMap(([slug, p]) =>
    p.traits.flatMap((t) =>
      t.evidence.map((e) => ({ slug, trait: t.text, ...e })),
    ),
  );
}

/**
 * A profile as the routines' plans show it: our words, the evidence
 * links and the facts (never Google's text: there is none to show).
 */
export function planProfile(p: ParkProfile | undefined | null) {
  if (!p) return null;
  return {
    one_liner: p.one_liner,
    traits: p.traits.map((t) => ({
      text: t.text,
      kind: t.kind,
      source: t.source,
      evidence: t.evidence.map((e) => e.url),
    })),
    facts: p.facts,
  };
}
