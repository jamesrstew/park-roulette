import { z } from "zod";
import raw from "../../data/park-profiles.json";

/**
 * Signature traits per park (data/park-profiles.json): the 2 to 5 things
 * that make a parent pick this playground over the one down the street
 * (a pirate ship, a creek, an all-abilities design, a sledding hill).
 * Social park posts and the newsletter lead with them instead of a
 * generic feature list. Pure: no server imports.
 *
 * Every trait is our own words, with 1 to 4 curated `keys`: the
 * distinctive words a post must use to name it ("zip line", "zipline").
 * An official or news trait carries {url, quote}, the quote verbatim from
 * that page (re-checked monthly; lib/park-profiles-check.ts). A
 * google_places trait was named by Google's review summary for the place:
 * only our paraphrase and the place id are kept here, never Google's text
 * (the repo is public), and it stops counting 12 months after verified_on.
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

/** Kinds that never count toward a park post, and never back a claim. */
export const CONTEXT_KINDS: ReadonlySet<TraitKind> = new Set([
  "nearby",
  "history",
]);

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Https = z.url({ protocol: /^https$/ });
const Month = z.number().int().min(1).max(12);

/** Hosts that are never evidence: other newsletters, and Google itself. */
const NOT_EVIDENCE =
  /(^|\.)(bendbuzz\.com|thebendbuzz\.com|bendfamilyloop\.com|google\.[a-z.]+|googleapis\.com|googleusercontent\.com|gstatic\.com|ggpht\.com|goo\.gl|g\.co|beehiiv\.com|substack\.com)$/i;

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
    /** 1 to 4 distinctive words or phrases a post uses to name it. */
    keys: z.array(z.string().trim().min(3).max(30)).min(1).max(4),
    kind: z.enum(TRAIT_KINDS),
    source: z.enum(TRAIT_SOURCES),
    evidence: z.array(Evidence).max(3),
    verified_on: Day,
    /** Months it's there (a summer sprayground, a sledding hill); omit: all year. */
    season: z.array(Month).min(1).max(11).optional(),
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
    /** 120 characters, our words, leading with the first (most distinctive) trait. */
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

const parsed = ProfilesFile.safeParse(raw);
/**
 * Why the bundled profiles didn't parse, or null. At runtime a bad file
 * means no profiles (no park posts) and an alert, never a crash; CI's
 * strict parse test is the real gate.
 */
export const PROFILES_ERROR: string | null = parsed.success
  ? null
  : parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");

export const PROFILES: ReadonlyMap<string, ParkProfile> = new Map(
  parsed.success ? Object.entries(parsed.data) : [],
);

/** A park post needs traits of this many distinct kinds (context kinds aside). */
export const MIN_POST_TRAITS = 2;
/** A google_places trait counts this long after it was verified. */
export const GOOGLE_TRAIT_MONTHS = 12;

// --- Words ----------------------------------------------------------------

/**
 * Words that may never be a key: filler, towns, and what every park is.
 * Possessives are stripped before this check ("Bend's" is "bend").
 */
export const NOT_KEYS = new Set(
  "a an and the of for to in on at by with from near next along into onto its it is are has have one two three four five six seven eight nine ten their own where that this over under through both only open who can down up first old new summer winter day days known unique popular easy fully all every each some more most lots big bigger biggest small little young older built fun great good best nice place places space spaces spot spots around right just also whole park parks playground playgrounds play kids kid children child family families area areas structure structures feature features equipment town city neighborhood local bend redmond sisters prineville madras culver la pine sunriver terrebonne metolius oregon central crooked river ranch".split(
    " ",
  ),
);

/** Towns (for the "no key is a town" test). */
export const TOWN_WORDS = [
  "bend",
  "redmond",
  "sisters",
  "prineville",
  "madras",
  "culver",
  "la pine",
  "sunriver",
  "terrebonne",
  "metolius",
];

/**
 * A light stemmer: plurals and -er/-ers/-ing come together, so climbers,
 * climbing and climb meet, and trees stays tree. "es" goes only after s,
 * x, z, ch or sh (boxes, benches); otherwise only the "s".
 */
export function stem(word: string): string {
  let w = word.replace(/'s$/, "").replace(/'$/, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("er")) w = w.slice(0, -2);
  return w;
}

/** Lowercase words, possessives stripped, punctuation out. */
export function words(text: string): string[] {
  return text
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter(Boolean);
}

const stems = (text: string) => words(text).map(stem);

/** Does the text use this key (a word or a phrase), on word boundaries? */
export function hasKey(text: string, key: string): boolean {
  const t = stems(text);
  const k = stems(key);
  if (!k.length) return false;
  for (let i = 0; i + k.length <= t.length; i++)
    if (k.every((w, j) => t[i + j] === w)) return true;
  return false;
}

/** The first trait a piece of text names (by its keys), or null. */
export function traitIn(
  text: string,
  traits: readonly Pick<Trait, "keys">[] | null | undefined,
): Pick<Trait, "keys"> | null {
  return traits?.find((t) => t.keys.some((k) => hasKey(text, k))) ?? null;
}

// --- Which traits count ------------------------------------------------------

export const evidenceKey = (e: Evidence) => `${e.url}\n${e.quote}`;

/** Is a trait there this month? */
export const inSeason = (t: Pick<Trait, "season">, month: number) =>
  !t.season || t.season.includes(month);

function googleFresh(t: Trait, now: Date): boolean {
  if (t.source !== "google_places") return true;
  const until = new Date(`${t.verified_on}T00:00:00Z`);
  until.setUTCMonth(until.getUTCMonth() + GOOGLE_TRAIT_MONTHS);
  return now.getTime() < until.getTime();
}

/**
 * The profiles as they stand: traits whose evidence was last seen
 * missing are dropped, google_places traits go stale after 12 months.
 * A profile whose lead trait dropped loses its one_liner (it leads with
 * that trait).
 */
export function liveProfiles(
  base: ReadonlyMap<string, ParkProfile>,
  { missing, now }: { missing: ReadonlySet<string>; now: Date },
): Map<string, ParkProfile> {
  const out = new Map<string, ParkProfile>();
  for (const [slug, p] of base) {
    const traits = p.traits.filter(
      (t) =>
        googleFresh(t, now) &&
        !t.evidence.some((e) => missing.has(evidenceKey(e))),
    );
    out.set(slug, {
      ...p,
      traits,
      one_liner: traits[0] && traits[0] === p.traits[0] ? p.one_liner : null,
    });
  }
  return out;
}

/** Traits a post may lead with this month (in season). */
export function postTraits(
  p: ParkProfile | null | undefined,
  month: number,
): Trait[] {
  return (p?.traits ?? []).filter((t) => inSeason(t, month));
}

/** Distinct kinds of in-season traits, nearby and history aside. */
export function postKinds(
  p: ParkProfile | null | undefined,
  month: number,
): number {
  return new Set(
    postTraits(p, month)
      .filter((t) => !CONTEXT_KINDS.has(t.kind))
      .map((t) => t.kind),
  ).size;
}

/** The one_liner to show this month (none while its lead trait is out of season). */
export function oneLinerFor(
  p: ParkProfile | null | undefined,
  month: number,
): string | null {
  if (!p?.one_liner || !p.traits[0] || !inSeason(p.traits[0], month))
    return null;
  return p.one_liner;
}

// --- Generic copy -------------------------------------------------------------

/** Phrases that could describe any park on Earth. */
const GENERIC_PHRASES: [RegExp, string][] = [
  [/\bbuilt for\b[^.!?\n]{0,40}\bfans\b/i, '"built for ... fans"'],
  [/\bsomething for every(one|body)\b/i, '"something for everyone"'],
  [/\bfun for (all|every)\b/i, '"fun for all ages"'],
  [/\b(of|for) all ages\b/i, '"of all ages"'],
  [/\bfor the whole family\b/i, '"for the whole family"'],
  [/\bgreat (place|spot)s?\b/i, '"great place"'],
  [/\bhidden gems?\b/i, '"hidden gem"'],
  [/\bperfect for\b/i, '"perfect for"'],
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
 * A profile as the routines' plans show it, for a month: in-season traits,
 * our words, the keys a post must use and the evidence links, plus the
 * facts (never Google's text: there is none to show).
 */
export function planProfile(p: ParkProfile | undefined | null, month: number) {
  if (!p) return null;
  return {
    one_liner: oneLinerFor(p, month),
    traits: postTraits(p, month).map((t) => ({
      text: t.text,
      keys: t.keys,
      kind: t.kind,
      source: t.source,
      evidence: t.evidence.map((e) => e.url),
    })),
    post_ready: postKinds(p, month) >= MIN_POST_TRAITS,
    facts: p.facts,
  };
}
