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

/**
 * What an at-a-glance line was written from: Google's summaries for the
 * place (an input only, never shown, quoted or credited), our own records
 * (traits and the park's features), or both.
 */
export const GLANCE_SOURCES = ["google_summary", "traits", "both"] as const;

export const ParkProfile = z
  .strictObject({
    /** Google place id (an id only; nothing of Google's text). */
    place_id: z.string().nullable().default(null),
    traits: z.array(Trait).max(5),
    /** 120 characters, our words, leading with the first (most distinctive) trait. */
    one_liner: z.string().trim().min(10).max(120).nullable(),
    /**
     * At a glance: one sentence, our words, what the park is like for a
     * family with young kids (glanceProblems lists the rules). Park
     * pages only, when there's no one_liner: never in posts, plans or
     * the newsletter. Null when it would only repeat the feature list.
     */
    glance: z.string().trim().min(10).max(120).nullable().default(null),
    glance_source: z.enum(GLANCE_SOURCES).nullable().default(null),
    /** When it was written (a Google-sourced glance stops showing after 12 months). */
    glance_on: Day.nullable().default(null),
    facts: ParkFacts.default({}),
  })
  .refine((p) => (p.one_liner === null) === (p.traits.length === 0), {
    message: "A one_liner exactly when there are traits",
  })
  .refine(
    (p) =>
      (p.glance === null) === (p.glance_source === null) &&
      (p.glance === null) === (p.glance_on === null),
    { message: "A glance needs glance_source and glance_on (and only then)" },
  );
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
 * A light stemmer, applied to both sides: plurals, -ing, -ed, -er and
 * -ers come together (climbers, climbing and climb meet; sledding meets
 * sled; sliding meets slide), and trees stays tree. "es" goes only after
 * s, x, z, ch or sh (boxes, benches); otherwise only the "s".
 */
export function stem(word: string): string {
  let w = word.replace(/'s$/, "").replace(/'$/, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("er")) w = w.slice(0, -2);
  // sledd -> sled, swimm -> swim (never ll, ss, zz).
  if (
    w.length > 3 &&
    /([b-df-hj-km-np-rtv-xz])\1$/.test(w) &&
    !/(ll|ss|zz)$/.test(w)
  )
    w = w.slice(0, -1);
  // slide and slid(ing) meet; short words (tree) keep their e.
  if (w.length > 4 && w.endsWith("e") && !w.endsWith("ee")) w = w.slice(0, -1);
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

function freshUntil(day: string, now: Date): boolean {
  const until = new Date(`${day}T00:00:00Z`);
  until.setUTCMonth(until.getUTCMonth() + GOOGLE_TRAIT_MONTHS);
  return now.getTime() < until.getTime();
}

function googleFresh(t: Trait, now: Date): boolean {
  return t.source !== "google_places" || freshUntil(t.verified_on, now);
}

/**
 * The profiles as they stand: traits whose evidence was last seen
 * missing are dropped, google_places traits go stale after 12 months.
 * A profile that lost any trait loses its one_liner (one-liners name
 * several traits).
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
    const dropped = p.traits.filter((t) => !traits.includes(t));
    const glanceLive =
      p.glance !== null &&
      !traitIn(p.glance, dropped) &&
      (p.glance_source === "traits" ||
        (p.glance_on !== null && freshUntil(p.glance_on, now)));
    out.set(slug, {
      ...p,
      traits,
      // One-liners name several traits: any dropped trait hides it.
      one_liner: traits.length === p.traits.length ? p.one_liner : null,
      // A glance goes with any trait it names, and Google-sourced ones age out.
      ...(glanceLive
        ? {}
        : { glance: null, glance_source: null, glance_on: null }),
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
  if (!p?.one_liner || !p.traits[0]) return null;
  // Hidden while any trait it names (the lead included) is out of season.
  const off = p.traits.filter((t) => !inSeason(t, month));
  if (!inSeason(p.traits[0], month) || traitIn(p.one_liner, off)) return null;
  return p.one_liner;
}

/** The glance to show this month (none while it names an out-of-season trait). */
export function glanceFor(
  p: ParkProfile | null | undefined,
  month: number,
): string | null {
  if (!p?.glance) return null;
  const off = p.traits.filter((t) => !inSeason(t, month));
  if (traitIn(p.glance, off) || SEASONAL_WORDS.test(p.glance)) return null;
  return p.glance;
}

// --- At-a-glance rules ---------------------------------------------------------

/**
 * Claims a glance never makes: it's a description, not a promise. Fences,
 * accessibility and safety need an official source and a careful sentence;
 * prices, hours, events and restrooms change; upkeep is an opinion.
 */
const GLANCE_BANNED: [RegExp, string][] = [
  [/\b(fenc(e|ed|es|ing)|enclosed|gated)\b/i, "a fence claim"],
  [
    /\b(accessib\w*|wheelchairs?|inclusive|all[- ]abilit\w*|ada|universal[- ]design|adaptive)\b/i,
    "an accessibility claim",
  ],
  [/\b(safe|safer|safety|secure)\b/i, "a safety claim"],
  [
    /\$|\b(free|fees?|prices?|priced|costs?|admission|tickets?|paid)\b/i,
    "a price claim",
  ],
  [
    /\b(hours?|open|opens|opening|closes|closed|daily|dawn|dusk|[ap]\.?m\.?)\b/i,
    "an hours claim",
  ],
  [
    /\b(events?|concerts?|festivals?|celebrations?|shows?|classes|camps?|fireworks|movies?)\b/i,
    "an events claim",
  ],
  [/\b(rest ?rooms?|bath ?rooms?|toilets?|potty)\b/i, "a restroom claim"],
  [
    /\b(clean|cleanest|spotless|tidy|well[- ]maintained|well[- ]kept)\b/i,
    "an upkeep opinion",
  ],
  [
    /\b(swim\w*|wad(e|ing)|lifeguards?|tub(e|es|ing)|float\w*|surf\w*|kayak\w*|paddl\w*|raft\w*|shallow|gentle)\b/i,
    "a water-activity claim",
  ],
  [
    /\b(sunrises?|sunsets?|year[- ]round|seasonal|weekends?|permits?|calm|quiet|pretty|modern)\b/i,
    "a timing, permit or opinion word",
  ],
];

/** "No" only as the lead of a park with no playground ("No playground: ..."). */
export const NO_PLAYGROUND = /^No playground: /;

/** Seasonal things a year-round glance never names (no splash pad in January). */
export const SEASONAL_WORDS =
  /\b(splash\w*|spray ?(park|ground)s?|sprinklers?|water play|sled\w*|ski|skiing|snow\w*)\b/i;

/**
 * Why a glance breaks the rules, or []: one sentence of 120 characters
 * at most, no banned claim, nothing generic, nothing seasonal (by word or
 * by naming a seasonal trait). Grounding in Google's text, the features
 * and the traits, and the 4-word overlap scan, are tested separately.
 */
export function glanceProblems(
  glance: string,
  traits: readonly Pick<Trait, "keys" | "season">[] = [],
): string[] {
  const out: string[] = [];
  const t = glance.replace(/[‘’]/g, "'").trim();
  if (t.length > 120) out.push("over 120 characters");
  if (/[.!?]\s+\S/.test(t) || t.includes(";"))
    out.push("more than one sentence");
  for (const [re, label] of GLANCE_BANNED) if (re.test(t)) out.push(label);
  if (/\bno\b/i.test(t.replace(NO_PLAYGROUND, "")))
    out.push('"no" (only a leading "No playground:")');
  for (const g of genericPhrases(t)) out.push(`generic: ${g}`);
  if (
    SEASONAL_WORDS.test(t) ||
    traitIn(
      t,
      traits.filter((x) => x.season),
    )
  )
    out.push("names something seasonal");
  return out;
}

// --- Generic copy -------------------------------------------------------------

/** Phrases that could describe any park on Earth. */
const GENERIC_PHRASES: [RegExp, string][] = [
  [/\bbuilt for\b[^.!?\n]{0,40}\bfans\b/i, '"built for ... fans"'],
  [/\bsomething for every(one|body)\b/i, '"something for everyone"'],
  [/\bfun for (all|every)\b/i, '"fun for all ages"'],
  // "of all ages and abilities" is a park's own all-abilities wording.
  [/\b(of|for) all ages\b(?! and abilities)/i, '"of all ages"'],
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

/**
 * Google-sourced traits and glances that age out within `days` (12
 * months after they were written), for the monthly re-check email.
 */
export function expiringSoon(
  profiles: ReadonlyMap<string, ParkProfile>,
  now: Date,
  days = 30,
): { slug: string; what: string; until: string }[] {
  const end = now.getTime() + days * 86_400_000;
  const until = (day: string) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + GOOGLE_TRAIT_MONTHS);
    return d;
  };
  const soon = (d: Date) => d.getTime() > now.getTime() && d.getTime() <= end;
  const out: { slug: string; what: string; until: string }[] = [];
  for (const [slug, p] of profiles) {
    for (const t of p.traits)
      if (t.source === "google_places" && soon(until(t.verified_on)))
        out.push({
          slug,
          what: `trait: ${t.text}`,
          until: until(t.verified_on).toISOString().slice(0, 10),
        });
    if (
      p.glance &&
      p.glance_on &&
      p.glance_source !== "traits" &&
      soon(until(p.glance_on))
    )
      out.push({
        slug,
        what: `glance: ${p.glance}`,
        until: until(p.glance_on).toISOString().slice(0, 10),
      });
  }
  return out;
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
