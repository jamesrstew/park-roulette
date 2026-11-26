import {
  type Catalog,
  isClosedPark,
  onList,
  type Venue,
} from "@/lib/news/catalog";
import { addDays, holidays } from "@/lib/news/time";
import { unsafeText } from "@/lib/news/safety";
import { blockedLink } from "@/lib/news/validate";
import {
  costChip,
  type EventRow,
  pacificAt,
  statusOn,
} from "@/lib/events/model";
import { listed } from "@/lib/events/state";
// A cycle (roundup uses eventTextProblem): both only call at run time.
import { eventDayChip, roundupAges, venueChip } from "./roundup";
import {
  CONTEXT_KINDS,
  genericPhrases,
  MIN_POST_TRAITS,
  type ParkProfile,
  postKinds,
  postTraits,
  type Trait,
  traitIn,
  type TraitKind,
} from "@/lib/park-profiles";
import {
  hazardsIn,
  ideaOverlap,
  NOT_HOUSEHOLD,
  ideaProblems,
  ideaText,
  postTextProblems,
  type RecentIdea,
  repeatOf,
  themesFor,
  titleSimilarity,
} from "./at-home";
import {
  hostDomain,
  mentionProblems,
  noAt,
  parkTag,
  postHandles,
  siteDomain,
  type Tag,
  tagFor,
} from "./handles";
import {
  atHomeCover,
  type BreakSpan,
  breakName,
  composeAtHome,
  composeParkPost,
  composeUnpack,
  fridayToSunday,
  hostOf,
  itemDays,
  type ParkInfo,
  placeLine,
  type ResolvedItem,
  sentencesOf,
  spanText,
} from "./compose";
import {
  apart,
  apartChip,
  holidayBreak,
  mashupParity,
  miles,
  NO_DRINKS,
  PAIRS_MAX,
  PAIRS_MIN,
  type Pairing,
  chainOf,
  cleanName,
} from "./mashup";
import {
  type AtHomeDraft,
  COPY,
  CAPTION_MAX,
  CREATE_LEAD_MIN,
  DATED_LEAD_HOURS,
  HASHTAGS,
  HEADLINE_MAX_WORDS,
  HEADLINE_MIN_WORDS,
  IDEA_SIMILAR,
  IDEA_TEXT_SIMILAR,
  type ItemIcon,
  MAX_HASHTAGS,
  mondayOf,
  OVERLAP_LIMIT,
  OVERLAP_POSTS,
  SENTENCE_MAX_WORDS,
  STORY_LIMITS,
  type ParkPostDraft,
  type PhotoRef,
  type PostDraft,
  type PostFacts,
  type PostKind,
  type PostSpec,
  type SlideSpec,
  slotFor,
  type UnpackDraft,
  wordCount,
} from "./model";

/**
 * The social validator. A post that breaks a rule comes back with errors
 * and isn't stored; an Unpack item whose facts don't hold (an event no
 * longer listed, a venue with no verified holiday hours) is cut, and the
 * carousel still goes with 3 or more. Pure: the database and the network
 * come in through the context.
 */

export type RecentPost = {
  kind: PostKind;
  slotDate: string;
  modelText: string;
};

export type SocialCtx = {
  now: Date;
  catalog: Catalog;
  parks: ReadonlyMap<string, ParkInfo>;
  /** Kids' events by slug. */
  events: ReadonlyMap<string, EventRow>;
  /** The last posts (newest first), for the overlap check. */
  recent: readonly RecentPost[];
  /** Signature-trait profiles by park slug (data/park-profiles.json). */
  profiles: ReadonlyMap<string, ParkProfile>;
  /** The plan's park-post candidates (code picked them, outside cooldowns). */
  planParks: readonly string[];
  /** Parks featured on Instagram in the cooldown (other slots). */
  cooling: ReadonlySet<string>;
  /** A park's photo that passed the vision check, or null (crayon card). */
  photoFor: (slug: string) => PhotoRef | null;
  /** The keyword DM call to action (else "Link in bio"). */
  dms: boolean;
  /** "At home" ideas in the 12-week cooldown (other slots). */
  recentIdeas?: readonly RecentIdea[];
  /**
   * Does this page print this quote? (Holiday hours, fetched live from the
   * venue's own site.) Missing: the evidence can't be checked, and the
   * item is cut.
   */
  evidence?: (url: string, quote: string) => Promise<boolean>;
};

export type PostReport = {
  type: PostKind;
  slotDate: string;
  publishAt: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Items cut, with why. */
  cut: string[];
  spec?: PostSpec;
};

// --- Text rules ------------------------------------------------------------

const norm = (s: string) => s.replace(/[‘’]/g, "'");

/** Other newsletters, by name or domain (the primary-source rule). */
// Any spacing or case, as the issue and events checkers.
const COMPETITORS = /bend[\s_.-]*(family[\s_.-]*loop|buzz)/i;
/**
 * No "I". "We" is Park Roulette, the publisher, and only in a few fixed
 * frames ("This week we're featuring ...", "we picked", "our pick"): any
 * other we, our or us reads as a family that went, or a plan to meet, and
 * is refused. Words that aren't ours (an event's own summary) take no
 * "we" at all ("we'll paint" is the host talking).
 */
const FIRST_PERSON = /\b(i|i'm|i've|i'd|i'll|me|my|mine|myself)\b/i;
const FIRST_PERSON_PLURAL =
  /\b(we|we're|we've|we'd|we'll|us|our|ours|ourselves)\b/i;
/** The only frames "we" and "our" may appear in (case-insensitive). */
export const PUBLISHER_FRAMES =
  /\b(?:this week we're featuring|we're featuring|we picked|our pick|this week's pick|we send|our free thursday email)\b/gi;
/** Text with the publisher frames taken out (what's left may not say we). */
const withoutFrames = (t: string) => t.replace(PUBLISHER_FRAMES, " ");
/**
 * "We" never claims a visit, a kid or an invitation: we don't go, we
 * don't host, and we don't have kids in the post ("we went", "our kids
 * loved it", "join us", "see you there").
 */
const EXPERIENCE =
  /\b(we|we've|we'd)\s+(just\s+|finally\s+|recently\s+|all\s+)?(went|visited|tried|tested|loved|spent|played|took|brought|stopped|hiked|walked|biked|had|did|found|discovered|checked)\b|\bour\s+(own\s+)?(kids?|family|families|little ones?|littles|toddlers?|daughters?|sons?|crew|girls?|boys?|baby|babies)\b|\bjoin us\b|\bsee you (there|soon)\b|\bwith us\b/i;

/**
 * Influencer and brochure words the voice guide bans (with the generic
 * park phrases): they could be about anywhere, and they read as an ad.
 */
const CLICHES: [RegExp, string][] = [
  [/\bmust[- ](see|visit|try|do|have)\b/i, '"must-see"'],
  // Promotional only: "it's a must", "a must for"; not "a must-have bowl".
  [/\b(is|are|it's|that's) a must\b(?!-)|\ba must for\b/i, '"a must"'],
  [/\bbucket[- ]list\b/i, '"bucket list"'],
  [/\blook no further\b/i, '"look no further"'],
  [/\bbest[- ]kept secrets?\b/i, '"best-kept secret"'],
  [/\bthe ultimate\b/i, '"the ultimate"'],
  [/\bunforgettable\b/i, '"unforgettable"'],
  [/\bmagical\b/i, '"magical"'],
  [
    /\b(make|making|create|creating) (lasting |special )?memories\b|\bmemories (that|to) last\b/i,
    '"make memories"',
  ],
  [/\bwill (absolutely |just )?love (it|this|these|them)\b/i, '"will love it"'],
  [/\badventure awaits\b/i, '"adventure awaits"'],
  [/\bfun[- ]filled\b/i, '"fun-filled"'],
  // "Don't miss this", "don't miss out"; not "don't miss a corner".
  [
    /\bdon'?t miss (this|it|out|the (fun|chance|show|event))\b|\bnot to be missed\b/i,
    '"don\'t miss"',
  ],
  [/\btag (a friend|someone|your)\b/i, '"tag a friend"'],
  [/\bepic\b/i, '"epic"'],
  [/\bvibes?\b/i, '"vibes"'],
  [/\bnestled\b/i, '"nestled"'],
  [/\bboasts?\b/i, '"boasts"'],
  [/\bamenities\b/i, '"amenities"'],
  [/\ba (wide )?variety of\b/i, '"a variety of"'],
  [/\bhave a blast\b/i, '"have a blast"'],
  [/\bamazing\b/i, '"amazing"'],
  [/\bunparalleled\b/i, '"unparalleled"'],
];

/**
 * Voice problems in words the model wrote: the generic park phrases and
 * the guide's clichés. (Sentence length and exclamation points are
 * checked per post.)
 */
export function voiceProblems(text: string, label: string): string[] {
  const t = norm(text);
  const found = [
    ...genericPhrases(t),
    ...CLICHES.filter(([re]) => re.test(t)).map(([, l]) => l),
  ];
  return found.length
    ? [
        `${label}: ${found.join(", ")} could be about anywhere. Say what makes this one different, in plain words.`,
      ]
    : [];
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sentences over SENTENCE_MAX_WORDS words (short sentences, always). */
export function longSentences(text: string, label: string): string[] {
  return sentencesOf(text)
    .filter((x) => wordCount(x) > SENTENCE_MAX_WORDS)
    .map(
      (x) =>
        `${label}: "${x.slice(0, 50)}..." runs ${wordCount(x)} words; keep each sentence to ${SENTENCE_MAX_WORDS} or fewer.`,
    );
}

/** At most one exclamation point across a post's own words. */
export function exclamationProblem(texts: readonly string[]): string | null {
  const n = texts.join(" ").split("!").length - 1;
  return n > 1
    ? `${n} exclamation points: one at most in a post (calm, not loud).`
    : null;
}
const LINKISH = /https?:|www\.|\.(com|org|net|gov|us|quest)\b|@\w|#\w/i;
const EMOJI = /\p{Extended_Pictographic}/u;
/** No restroom claims November to March (they close for the season). */
const RESTROOMS =
  /\b(rest ?rooms?|bath ?rooms?|toilets?|potty|porta[- ]?pott(y|ies)|loos?)\b/i;
const RESTROOM_MONTHS = new Set([11, 12, 1, 2, 3]);
/** "School's out" words: they need a catalog break that covers the post. */
export const SCHOOL_OUT =
  /\b(no[- ]school|school'?s (out|off|closed)|schools? (are |is )?(out|off|closed)|out of school|off (from )?school|school (break|holiday|vacation|day off)|(fall|winter|spring|thanksgiving|holiday|mid-?winter|november|break) (break|week)|break week|days? off|kids (are )?(off|home)|teacher (work|planning|in-service) days?|in-service days?|grading days?|vacation week)\b/i;

/** The towns each catalog district serves (a break only covers its own). */
const DISTRICT_TOWNS: [RegExp, string[]][] = [
  [/bend-la pine/i, ["Bend", "La Pine", "Sunriver"]],
  [/redmond/i, ["Redmond", "Terrebonne"]],
  [/sisters/i, ["Sisters"]],
  [/crook county/i, ["Prineville"]],
  [/jefferson county/i, ["Madras", "Culver", "Metolius"]],
];
const TOWNS = [
  "Bend",
  "La Pine",
  "Sunriver",
  "Redmond",
  "Terrebonne",
  "Sisters",
  "Prineville",
  "Madras",
  "Culver",
  "Metolius",
];

/** Problems with words the model wrote, or [] when they're fine. */
export function textProblems(
  text: string,
  {
    month,
    label,
    plural = true,
  }: {
    month: number;
    label: string;
    /** May "we" and "our" appear (Park Roulette speaking)? Default yes. */
    plural?: boolean;
  },
): string[] {
  const t = norm(text);
  const out: string[] = [];
  if (COMPETITORS.test(t)) out.push(`${label}: never name another newsletter.`);
  if (FIRST_PERSON.test(t))
    out.push(
      `${label}: no first person singular ("I", "me", "my"). "We" is Park Roulette.`,
    );
  if (!plural && FIRST_PERSON_PLURAL.test(t))
    out.push(
      `${label}: no first person ("we", "our", "us") in words that aren't ours.`,
    );
  else if (plural && FIRST_PERSON_PLURAL.test(withoutFrames(t)))
    out.push(
      `${label}: first person "we", "our" and "us" only as the publisher ("we're featuring", "we picked", "our pick", "this week's pick", "we send", "our free Thursday email"). Never a family, a visit or a plan to meet.`,
    );
  if (EXPERIENCE.test(t))
    out.push(
      `${label}: first person "we" never claims a visit, a kid or an invitation ("we went", "our kids", "join us"). Say what the place has.`,
    );
  if (LINKISH.test(t))
    out.push(
      `${label}: no links, handles or hashtags in the words (code adds them).`,
    );
  if (EMOJI.test(t)) out.push(`${label}: no emoji.`);
  if (RESTROOM_MONTHS.has(month) && RESTROOMS.test(t))
    out.push(`${label}: no restroom claims from November to March.`);
  const unsafe = unsafeText(t);
  if (unsafe) out.push(`${label}: ${unsafe} is out.`);
  if (ICE.test(t))
    out.push(
      `${label}: never send kids onto ice or frozen water ("${ICE.exec(t)![0]}").`,
    );
  return out;
}

/** Ice and frozen water: never a place to play ("skate on the pond"). */
const ICE =
  /\b(?:skat\w*|walk\w*|play\w*|slid\w*|stand\w*|run\w*|step\w*|go|get) (?:out )?on(?:to)? (?:the |a )?(?:frozen )?(?:pond|lake|river|creek|ice|reservoir|canal)\b|\bfrozen (?:pond|lake|river|creek|reservoir|canal)s?\b|\b(?:thin|pond|lake|river) ice\b|\bon the ice\b|\bice (?:skat\w*|fishing)\b/i;

// --- Grounding: the park post's own words ----------------------------------

const MONTH_NAMES =
  /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;

/**
 * Capitalized words that aren't a sentence's first word, and aren't in
 * `allowed` (lowercased) or a month: names the record doesn't back.
 */
export function strayNames(
  text: string,
  allowed: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const sent of sentencesOf(norm(text)))
    sent
      .split(/\s+/)
      .slice(1)
      .forEach((raw) => {
        const w = raw
          .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
          .replace(/'s$/, "");
        if (!/^[A-Z]/.test(w) || w === "I") return;
        if (MONTH_NAMES.test(w)) return;
        if (w.split(/[-']/).every((part) => allowed.has(part.toLowerCase())))
          return;
        out.add(w);
      });
  return [...out];
}

/** Words of a text, lowercased, for the allowed-names set. */
const wordsOf = (t: string) =>
  norm(t)
    .toLowerCase()
    .split(/[^a-z']+/)
    .flatMap((w) => [w, w.replace(/'s$/, "")])
    .filter(Boolean);

/**
 * Facts a park post's words may not state: code and the record own them,
 * and nothing in the record backs a day, a time, a price, hours, a
 * superlative, a safety promise or an event.
 */
const UNGROUNDED_FACTS: [RegExp, string][] = [
  [
    /\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?)\b/i,
    "a day of the week",
  ],
  [
    /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])|\b(noon|midnight|o'clock)\b/i,
    "a time",
  ],
  [
    /\$\s?\d|\b(dollars?|cents?|prices?|costs?|fees?|tickets?|admission|paid|pay)\b/i,
    "a price",
  ],
  [/\bfree\b/i, '"free"'],
  [/\b(open|opens|opened|opening|closed|closes|closing|hours)\b/i, "hours"],
  [
    /\b(only|first|best|biggest|largest|tallest|longest|oldest|newest)\b(?:\s+[\w'-]+){0,4}?\s+in\b/i,
    'a superlative ("the only ... in")',
  ],
  [/\b(safe|safer|safest|safety|safely|secure)\b/i, "a safety promise"],
  [
    /\b(santa|visits?|visiting|rink|sold|sells?|selling|festival|parade|concert|market|events?|registration|register|lights display|tree lighting)\b/i,
    "an event",
  ],
];

/**
 * The park post's grounding: no names but the park's own (its name, its
 * town, and the words of its traits and keys, which hold the
 * neighborhood), no other park or venue, and none of the facts above.
 */
export function parkGroundingProblems(
  text: string,
  label: string,
  park: Pick<ParkInfo, "name" | "city" | "address">,
  traits: readonly Pick<Trait, "text" | "keys">[],
  others: readonly string[],
): string[] {
  const t = norm(text);
  const out: string[] = [];
  const allowed = new Set([
    ...wordsOf(park.name),
    ...wordsOf(park.city),
    ...wordsOf(park.address ?? ""),
    ...traits.flatMap((x) => [...wordsOf(x.text), ...x.keys.flatMap(wordsOf)]),
  ]);
  const names = strayNames(t, allowed);
  if (names.length)
    out.push(
      `${label}: "${names.join(", ")}" isn't the park, its town or in its traits. Name nothing else.`,
    );
  const own = norm(park.name).toLowerCase();
  const other = others.filter(
    (n) =>
      norm(n).toLowerCase() !== own &&
      new RegExp(`\\b${escapeRe(norm(n))}\\b`, "i").test(t),
  );
  if (other.length)
    out.push(`${label}: names another place (${other.join(", ")}).`);
  const facts = UNGROUNDED_FACTS.filter(([re]) => re.test(t)).map(([, l]) => l);
  if (facts.length)
    out.push(
      `${label}: ${facts.join(", ")} isn't in the park's record. The scene is the weather and the season; code adds the facts.`,
    );
  return out;
}

/** Ages as parsed ("parsed:3-5", "parsed:all"), compared instead of the printed words. */
export function parsedAges(a: {
  tags: readonly string[];
  kids: boolean;
  range: readonly [number, number] | null;
}): string {
  const span = a.range ? `${a.range[0]}-${a.range[1]}` : "all";
  return `parsed:${span}${a.kids ? "" : ":not-kids"}`;
}

/**
 * Venues no family post names: bars, breweries, taprooms, wineries,
 * lounges and the like, even when they host a kids' event. One exemption:
 * a tea or art lounge ("TEAL Tea + Art Lounge" runs kids' classes) whose
 * only adult word is "lounge" or "wine". "Wine Bar" is a bar either way.
 */
export const ADULT_VENUE =
  /\b(bars?|brew(ery|eries|ing|pub|pubs|house)|taprooms?|tap ?house|pubs?|saloons?|winer(y|ies)|wines?|distiller(y|ies)|taverns?|lounges?|beer ?gardens?|cider ?house|ciderworks?)\b/i;
/**
 * The only lounge names exempt: a tea and art lounge, a tea lounge, an art
 * studio (TEAL Tea + Art Lounge runs kids' classes). Any other adult word
 * left in the name still blocks it ("Tea & Wine Bar", "Art Wine Lounge").
 */
const FAMILY_LOUNGES =
  /\btea\s*(?:\+|&|and)\s*art\s+lounge\b|\btea\s+lounge\b|\bart\s+studio\b/gi;

/** Bars named only "... Lounge" (whole words, any case). */
export const BAR_LOUNGES = [/\bastro lounge\b/i];

/** Why a venue or host name is out of every social post, or null. */
export function venueProblem(
  name: string,
  { month, label }: { month: number; label: string },
): string | null {
  const n = norm(name);
  const rest = n.replace(FAMILY_LOUNGES, " ");
  const exempt = rest !== n && !ADULT_VENUE.test(rest);
  if (BAR_LOUNGES.some((b) => b.test(n)) || (ADULT_VENUE.test(n) && !exempt))
    return `${label} "${name}" is a bar, brewery or winery: never in a family post.`;
  // A name is a proper name, not our words: first person ("Our Lady
  // of ...") is fine there; competitors, links and unsafe words are not.
  const bad = textProblems(name, { month, label }).filter(
    (p) => !/first person/.test(p),
  );
  return bad.length ? bad.join(" ") : null;
}

/**
 * The roundup's screen for one event: its title (the text rules), and its
 * venue and organizer names (the same rules, plus no bars or breweries).
 */
export function eventTextProblem(
  e: Pick<EventRow["data"], "title" | "venue" | "organizer">,
  month: number,
): string | null {
  const title = textProblems(e.title, { month, label: "title" })
    .filter((p) => !/first person/.test(p))
    .join(" ");
  return (
    title ||
    venueProblem(e.venue.name, { month, label: "venue" }) ||
    (e.organizer
      ? venueProblem(e.organizer.name, { month, label: "host" })
      : null)
  );
}

/**
 * Features a sentence claims, and the park record that must back each
 * one. Code fills facts; the model's lines may only say what's recorded.
 */
type Claim = {
  re: RegExp;
  words: string;
  /** Park features that back it. */
  features: string[];
  /** Trait kinds that may back it (never nearby or history). */
  kinds: TraitKind[];
  /** A safety claim: a google_places trait never backs it. */
  safety?: boolean;
  /** The trait must use the same word ("pond" needs a pond, not a river). */
  sameWord?: boolean;
  /** Months the claim can hold at all (a splash pad runs May to September). */
  months?: readonly number[];
};

const CLAIMS: Claim[] = [
  {
    re: /\bbaby swings?\b|\bbucket swings?\b/i,
    words: "baby swings",
    features: ["baby_swings"],
    kinds: ["toddler"],
  },
  {
    re: /\bswings?\b/i,
    words: "swings",
    features: ["swings", "baby_swings"],
    kinds: ["signature_structure", "toddler"],
  },
  {
    re: /\bslides?\b/i,
    words: "slides",
    features: ["slides", "great_slides", "hot_slides"],
    kinds: ["signature_structure"],
  },
  {
    re: /\bzip ?lines?\b/i,
    words: "a zipline",
    features: ["zipline"],
    kinds: ["signature_structure", "all_abilities"],
  },
  {
    re: /\bsplash\b|\bspray ?(park|ground)s?\b/i,
    words: "a splash pad",
    features: ["splash_pad"],
    kinds: ["splash_pad"],
    months: [5, 6, 7, 8, 9],
  },
  {
    re: /\bsand ?box(es)?\b/i,
    words: "a sandbox",
    features: ["sandbox"],
    kinds: ["nature_play"],
  },
  {
    re: /\btoddlers?\b/i,
    words: "a toddler area",
    features: ["toddler_area"],
    kinds: ["toddler"],
  },
  {
    re: /\bfenc(e|ed|es|ing)\b/i,
    words: "a fence",
    features: ["fenced"],
    kinds: ["fenced"],
    safety: true,
  },
  {
    re: /\bclimb\w*/i,
    words: "climbing",
    features: ["climbing"],
    kinds: ["signature_structure", "nature_play", "other"],
  },
  {
    re: /\bspinn(y|er|ers|ing)\b|merry-go-round/i,
    words: "spinning things",
    features: ["spinny"],
    kinds: ["signature_structure"],
  },
  {
    re: /\b(accessible|universal[- ]design|wheelchair|inclusive|all abilities)\b/i,
    words: "accessible play",
    features: ["accessible"],
    kinds: ["all_abilities"],
    safety: true,
  },
  {
    re: /\bshad(e|y|ed)\b/i,
    words: "shade",
    features: ["shade"],
    kinds: ["shade"],
  },
  {
    re: /\bpicnic\b/i,
    words: "picnic tables",
    features: ["picnic"],
    kinds: [],
  },
  {
    re: /\btrails?\b|\bloop\b/i,
    words: "a trail",
    features: ["trail"],
    kinds: ["trail", "paved_loop"],
  },
  {
    re: /\bdog park\b/i,
    words: "a dog park",
    features: ["dog_park"],
    kinds: ["other"],
  },
  {
    re: /\b(courts?|basketball|tennis|pickleball)\b/i,
    words: "courts",
    features: ["sports_courts"],
    kinds: ["other"],
  },
  {
    re: /\b(river|pond|lake|creek)\b/i,
    words: "water",
    features: ["water_view"],
    kinds: ["water"],
    sameWord: true,
  },
  {
    re: /\bstrollers?\b/i,
    words: "stroller-friendly paths",
    features: ["stroller_friendly"],
    kinds: ["paved_loop"],
  },
];

type BackingTrait = Pick<Trait, "text" | "kind" | "source">;

const matchedWords = (re: RegExp, text: string) =>
  new Set(
    [...text.matchAll(new RegExp(re.source, "gi"))].map((m) =>
      m[0].toLowerCase(),
    ),
  );

function traitBacks(c: Claim, t: BackingTrait, text: string): boolean {
  if (!c.kinds.includes(t.kind) || CONTEXT_KINDS.has(t.kind)) return false;
  if (c.safety && t.source === "google_places") return false;
  if (!c.re.test(t.text)) return false;
  if (!c.sameWord) return true;
  const have = matchedWords(c.re, t.text);
  return [...matchedWords(c.re, text)].every((w) => have.has(w));
}

/**
 * Claims in the text the park's record doesn't back. A verified,
 * in-season profile trait of the right kind backs a claim too ("creek"
 * when a water trait says creek); a Google-sourced trait never backs a
 * fence or accessibility claim.
 */
export function unbackedClaims(
  text: string,
  features: readonly string[],
  traits: readonly BackingTrait[] = [],
  /** The post's month: a seasonal claim out of season is never backed. */
  month?: number,
): string[] {
  const has = new Set(features);
  return CLAIMS.filter(
    (c) =>
      c.re.test(text) &&
      ((month != null && c.months && !c.months.includes(month)) ||
        (!c.features.some((f) => has.has(f)) &&
          !traits.some((t) => traitBacks(c, t, text)))),
  ).map((c) => c.words);
}

/** Park features as chips (never restrooms; splash pads May to September). */
const FEATURE_LABELS: [string, string][] = [
  ["toddler_area", "Toddler area"],
  ["baby_swings", "Baby swings"],
  ["swings", "Swings"],
  ["slides", "Slides"],
  ["climbing", "Climbing"],
  ["zipline", "Zipline"],
  ["spinny", "Spinners"],
  ["accessible", "Accessible play"],
  ["splash_pad", "Splash pad"],
  ["sandbox", "Sandbox"],
  ["fenced", "Fenced"],
  ["shade", "Shade"],
  ["picnic", "Picnic tables"],
  ["trail", "Walking trail"],
];

export function featureChips(
  features: readonly string[],
  month: number,
  max = 2,
): string[] {
  const has = new Set(features);
  return FEATURE_LABELS.filter(
    ([f]) => has.has(f) && !(f === "splash_pad" && (month < 5 || month > 9)),
  )
    .map(([, l]) => l)
    .slice(0, max);
}

// --- Grounding: an Unpack "what" line may only say what its source says ----

/** Words any line may use without a source (kid talk, not facts). */
const GENERIC = new Set(
  "kids kid little littles family families grown grownups grown-ups ups together play plays playing time fun easy warm cozy cold chilly frosty snowy rainy morning afternoon evening day days week weekend inside indoor indoors outside under with from that this there their they them then than while plus around every some more most lots big bigger biggest small smaller young younger older ages hour hours good great best perfect spot spots place room free open right just also near next each into about over when where what have your gets get lets make made makes try tries look looks find finds bring wear whole own even still long short quick first last other another many much very really pretty plenty lot slow fast happy busy quiet calm safe nice cool hands-on hands up down out all any can will tons time two three four five ages head heads run runs running spend space spaces".split(
    " ",
  ),
);

const stem = (w: string) =>
  w
    .replace(/'s$/, "")
    .replace(/(ies)$/, "y")
    .replace(/(ing|ed|es|s)$/, "");

function contentWords(text: string): string[] {
  return norm(text)
    .toLowerCase()
    .replace(/[^a-z' -]+/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !GENERIC.has(w));
}

/** Words in `what` that its source text doesn't back (stems compared). */
export function ungrounded(what: string, source: string): string[] {
  const vocab = new Set(
    norm(source)
      .toLowerCase()
      .replace(/[^a-z' -]+/g, " ")
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(stem),
  );
  return contentWords(what).filter((w) => !vocab.has(stem(w)));
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** The count a headline claims ("5 warm spots", "Five warm spots"), or null. */
export function headlineCount(headline: string): number | null {
  const m = headline
    .toLowerCase()
    .match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
}

// --- Holiday hours ------------------------------------------------------------

const TIME = String.raw`(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon)`;
const SPAN = new RegExp(
  String.raw`(${TIME}|\d{1,2}(?::\d{2})?)\s*(?:to|-|–|—|until)\s*(${TIME})`,
  "i",
);
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const LONG_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * Does a quote print holiday hours: the holiday's name or its date, and a
 * time? Returns the chip ("Holiday hours: 10 am to 4 pm", or "Holiday
 * hours vary, check before you go" when no clear span), "closed", or null
 * when it doesn't print holiday hours at all.
 */
export function holidayHours(
  quote: string,
  holiday: { name: string; date: string },
): string | null {
  const q = norm(quote).toLowerCase().replace(/\s+/g, " ");
  const [, m, d] = holiday.date.split("-").map(Number);
  const named =
    q.includes(holiday.name.toLowerCase().replace(/ day$/, "")) ||
    new RegExp(
      String.raw`\b(${MONTHS[m - 1]}\.?|${LONG_MONTHS[m - 1]}) ${d}\b|\b${m}/${d}\b`,
    ).test(q);
  if (!named) return null;
  const span = SPAN.exec(q);
  if (span) {
    const tidy = (t: string) =>
      t.replace(/\s*a\.?m\.?/, " am").replace(/\s*p\.?m\.?/, " pm");
    return `Holiday hours: ${tidy(span[1])} to ${tidy(span[2])}`;
  }
  if (/\bclosed\b/.test(q)) return "closed";
  return new RegExp(TIME, "i").test(q) ? COPY.holidayVaries : null;
}

/** Word trigrams, lowercased, punctuation out. */
export function trigrams(text: string): Set<string> {
  const w = norm(text)
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++)
    out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** Share of `text`'s trigrams that also appear in `other` (0 to 1). */
export function overlap(text: string, other: string): number {
  const a = trigrams(text);
  if (a.size < 3) return 0;
  const b = trigrams(other);
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / a.size;
}

function hashtagProblems(tags: readonly string[]): string[] {
  const out: string[] = [];
  if (tags.length > MAX_HASHTAGS) out.push(`At most ${MAX_HASHTAGS} hashtags.`);
  const allowed = new Set<string>(HASHTAGS);
  for (const t of tags)
    if (!allowed.has(t))
      out.push(`Hashtag ${t} isn't on the list (${HASHTAGS.join(" ")}).`);
  if (new Set(tags).size !== tags.length) out.push("A hashtag is repeated.");
  return out;
}

/** A verified catalog break that overlaps [from, to], or null. */
export function breakCovering(
  catalog: Catalog,
  id: string | undefined,
  from: string,
  to: string,
) {
  if (!id) return null;
  const b = catalog.breaks.find((x) => x.id === id);
  if (!b || !b.verified) return null;
  return b.from <= to && b.to >= from ? b : null;
}

/** The first US holiday from `from` for `days` days, or null. */
export function holidayIn(
  from: string,
  days: number,
): { name: string; date: string } | null {
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const h = holidays(Number(d.slice(0, 4)))[d];
    if (h) return { name: h, date: d };
  }
  return null;
}

/** A venue's own hosts (its page, hours page and source), without www. */
export function venueHosts(v: Venue): Set<string> {
  return new Set(
    [v.url, v.hours_url, v.source]
      .filter((u): u is string => !!u)
      .map((u) => new URL(u).hostname.replace(/^www\./, "")),
  );
}

// --- Facts from IDs --------------------------------------------------------

const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** "Open daily", "Open Tue to Sun", "Open Mon, Wed, Fri". */
export function openDaysLine(days: readonly string[]): string {
  const idx = [...new Set(days.map((d) => d.toLowerCase().slice(0, 3)))]
    .map((d) => WEEKDAY_ORDER.indexOf(d))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (idx.length === 7) return "Open daily";
  if (!idx.length) return "Check hours";
  const run = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (run && idx.length >= 3)
    return `Open ${DAY_NAMES[WEEKDAY_ORDER[idx[0]]]} to ${DAY_NAMES[WEEKDAY_ORDER[idx[idx.length - 1]]]}`;
  return `Open ${idx.map((i) => DAY_NAMES[WEEKDAY_ORDER[i]]).join(", ")}`;
}

const VENUE_COST = { free: "Free", low: "Under $10", paid: "Paid entry" };

const FEATURE_ICON: [string, ItemIcon][] = [
  ["splash_pad", "splash_pad"],
  ["zipline", "climbing"],
  ["climbing", "climbing"],
  ["slides", "slides"],
  ["swings", "swings"],
  ["toddler_area", "toddler_area"],
];

function venueIcon(v: Venue): ItemIcon {
  if (/library/i.test(v.kind)) return "book";
  if (/museum/i.test(v.kind)) return "mountains";
  if (/pool|swim|aquatic/i.test(`${v.kind} ${v.name}`)) return "splash_pad";
  if (/rink|skate/i.test(`${v.kind} ${v.name}`)) return "sparkles";
  return "home";
}

/**
 * An Unpack item's verified Instagram account: an event's host (its
 * organizer's domain), a park's operator, or a catalog venue's own site.
 */
function itemTag(ref: string, ctx: SocialCtx): Tag | null {
  const i = ref.indexOf(":");
  const [kind, rest] = [ref.slice(0, i), ref.slice(i + 1)];
  if (kind === "event") {
    const e = ctx.events.get(rest.split("@")[0]);
    return e ? tagFor(hostDomain(e.data), "host") : null;
  }
  if (kind === "park") return parkTag(rest);
  if (kind === "venue") {
    const v = ctx.catalog.venues.find((x) => x.id === rest);
    return tagFor(siteDomain(v?.url), "place");
  }
  return null;
}

type ItemOutcome =
  | { ok: true; item: ResolvedItem; fact: Partial<PostFacts> }
  | { ok: false; cut: string };

async function resolveItem(
  it: UnpackDraft["items"][number],
  ctx: SocialCtx,
  publishAt: Date,
  publishDay: string,
): Promise<ItemOutcome> {
  const [kind, rest] = [
    it.ref.slice(0, it.ref.indexOf(":")),
    it.ref.slice(it.ref.indexOf(":") + 1),
  ];
  const month = Number(publishDay.slice(5, 7));
  if (kind === "venue") {
    const v = ctx.catalog.venues.find((x) => x.id === rest);
    if (!v) return { ok: false, cut: `${it.ref}: not in the catalog.` };
    if (!v.verified)
      return { ok: false, cut: `${v.name}: not verified in the catalog.` };
    if (!v.months.includes(month))
      return { ok: false, cut: `${v.name}: not in season this month.` };
    const vbad = venueProblem(v.name, { month, label: "venue" });
    if (vbad) return { ok: false, cut: vbad };
    const grounded = ungrounded(it.what, `${v.name} ${v.kind} ${v.what}`);
    if (grounded.length)
      return {
        ok: false,
        cut: `${v.name}: "${grounded.join(", ")}" isn't in the catalog's words for it (say only what the catalog says).`,
      };
    let dayChip = openDaysLine(v.open_days);
    const holiday = holidayIn(publishDay, 7);
    if (holiday) {
      const ev = it.holiday_evidence;
      const host = (u: string) => {
        try {
          return new URL(u).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      };
      const hours = ev ? holidayHours(ev.quote, holiday) : null;
      const proven =
        ev &&
        hours &&
        hours !== "closed" &&
        !blockedLink(ev.url) &&
        !onList(ev.url, ctx.catalog.lead_domains ?? []) &&
        venueHosts(v).has(host(ev.url)) &&
        ctx.evidence &&
        (await ctx.evidence(ev.url, ev.quote));
      if (hours === "closed")
        return { ok: false, cut: `${v.name}: closed on ${holiday.name}.` };
      if (!proven)
        return {
          ok: false,
          cut: `${v.name}: ${holiday.name} week, and no verified holiday hours (holiday_evidence: a quote from the venue's own site naming the holiday or its date with the hours).`,
        };
      dayChip = hours!;
    }
    return {
      ok: true,
      item: {
        ref: it.ref,
        name: v.name,
        what: it.what,
        icon: it.icon ?? venueIcon(v),
        facts: [dayChip, v.ages_label, VENUE_COST[v.cost], v.town],
        open: v.open_days,
      },
      fact: { venues: [v.id] },
    };
  }
  if (kind === "event") {
    const [slug, day] = rest.split("@");
    const e = ctx.events.get(slug);
    if (!e || !listed(e, ctx.now))
      return { ok: false, cut: `${it.ref}: not on the events listing.` };
    const date = e.data.dates.find((d) => d.day === day);
    if (!date)
      return { ok: false, cut: `${it.ref}: the event has no date ${day}.` };
    if (statusOn(e.data, day, e.status) !== "scheduled")
      return { ok: false, cut: `${it.ref}: not going ahead on ${day}.` };
    const starts = pacificAt(day, date.start ?? "00:00");
    if (starts.getTime() < publishAt.getTime() + DATED_LEAD_HOURS * 3_600_000)
      return {
        ok: false,
        cut: `${it.ref}: starts less than ${DATED_LEAD_HOURS} hours after the post goes out.`,
      };
    if (starts.getTime() > publishAt.getTime() + 8 * 86_400_000)
      return {
        ok: false,
        cut: `${it.ref}: more than a week after the post (this week only).`,
      };
    if (e.data.ages?.kids === false)
      return { ok: false, cut: `${it.ref}: not a kids' event.` };
    const ebad = eventTextProblem(e.data, month);
    if (ebad) return { ok: false, cut: `${it.ref}: ${ebad}` };
    const off = ungrounded(
      it.what,
      `${e.data.title} ${e.data.what} ${e.data.venue.name} ${e.data.cost?.text ?? ""}`,
    );
    if (off.length)
      return {
        ok: false,
        cut: `${e.data.title}: "${off.join(", ")}" isn't in the event's own words (say only what the event page says).`,
      };
    return {
      ok: true,
      item: {
        ref: it.ref,
        name: e.data.title,
        what: it.what,
        icon: it.icon ?? "calendar",
        facts: [
          eventDayChip(e.data.dates, day),
          e.data.ages_text ?? null,
          costChip(e.data),
        ].filter((x): x is string => !!x),
        // Where and who, as the roundup prints them: the venue with its
        // town, and the organizer when it isn't the venue.
        place: placeLine(e.data.venue.name, e.data.venue.town),
        host: hostOf(e.data.venue.name, e.data.organizer),
        venueChip: venueChip(e.data.venue.name, e.data.venue.town),
      },
      fact: {
        events: [
          {
            slug,
            day,
            ...(date.start ? { start: date.start } : {}),
            ...(e.data.ages ? { ages: [parsedAges(e.data.ages)] } : {}),
            cost: costChip(e.data),
          },
        ],
      },
    };
  }
  const p = ctx.parks.get(rest);
  if (!p || !p.approved || p.status !== "active")
    return { ok: false, cut: `${it.ref}: not an open park on the map.` };
  if (isClosedPark(p.slug, ctx.catalog))
    return { ok: false, cut: `${p.name} is closed for now (catalog).` };
  const traits = postTraits(ctx.profiles.get(p.slug), month);
  const claims = unbackedClaims(it.what, p.features, traits, month);
  const off = ungrounded(
    it.what,
    `${p.name} ${featureChips(p.features, month, 99).join(" ")} ${traits.map((t) => `${t.text} ${t.keys.join(" ")}`).join(" ")} playground park`,
  );
  if (claims.length || off.length)
    return {
      ok: false,
      cut: `${p.name}: ${[...claims, ...off].join(", ")} isn't in the park's record.`,
    };
  const icon =
    it.icon ??
    FEATURE_ICON.find(([f]) => p.features.includes(f))?.[1] ??
    "playground";
  return {
    ok: true,
    item: {
      ref: it.ref,
      name: p.name,
      what: it.what,
      icon,
      facts: [...featureChips(p.features, month), p.city],
    },
    fact: { parks: [p.slug] },
  };
}

// --- The posts -------------------------------------------------------------

function base(type: PostKind, slotDate: string, publishAt: Date): PostReport {
  return {
    type,
    slotDate,
    publishAt: publishAt.toISOString(),
    ok: false,
    errors: [],
    warnings: [],
    cut: [],
  };
}

/** The slot's own checks: in the future, this week or next, a Monday. */
function slotProblems(
  weekOf: string,
  publishAt: Date,
  now: Date,
): string | null {
  if (mondayOf(weekOf) !== weekOf) return "week_of must be a Monday.";
  if (publishAt.getTime() < now.getTime() + CREATE_LEAD_MIN * 60_000)
    return "That slot is too soon (or past): posts are created 30 minutes ahead.";
  if (publishAt.getTime() > now.getTime() + 9 * 86_400_000)
    return "Too far ahead: one week at a time.";
  return null;
}

/**
 * The post with its tags, unless they push the caption over Instagram's
 * limit: then without them (as the roundup does), never a refused draft.
 */
function untaggedIfLong(
  r: PostReport,
  make: (tags: readonly Tag[]) => PostSpec,
  tags: readonly Tag[],
): PostSpec {
  const spec = make(tags);
  if (!tags.length || (spec.caption ?? "").length <= CAPTION_MAX) return spec;
  r.warnings.push("The host tags were left out: the caption ran long.");
  return make([]);
}

function common(
  r: PostReport,
  spec: PostSpec,
  ctx: SocialCtx,
  hashtags: readonly string[],
) {
  r.errors.push(...hashtagProblems(hashtags));
  // An @ only in the tag line code adds, with the post's own verified
  // handles: the same rule the publisher applies, so a model-written @
  // is refused here, at draft time, and never at publish.
  r.errors.push(...mentionProblems(spec.caption, postHandles(spec)));
  if ((spec.caption ?? "").length > CAPTION_MAX)
    r.errors.push(`The caption is over ${CAPTION_MAX} characters.`);
  for (const p of ctx.recent.slice(0, 8)) {
    if (p.kind === r.type && p.slotDate === r.slotDate) continue;
    const o = overlap(spec.modelText, p.modelText);
    if (o > OVERLAP_LIMIT)
      r.errors.push(
        `Too close to the ${p.kind} of ${p.slotDate} (${Math.round(o * 100)}% of its word runs repeat). Write it fresh.`,
      );
  }
}

/**
 * Saying school is out needs a verified catalog break that covers the
 * post's days (from its publish day to Friday), and, when the words name
 * a town, a break of that town's district.
 */
export function schoolOutProblem(
  text: string,
  breakId: string | undefined,
  ctx: Pick<SocialCtx, "catalog">,
  from: string,
  to: string,
): string | null {
  if (!SCHOOL_OUT.test(norm(text))) return null;
  const b = breakCovering(ctx.catalog, breakId, from, to);
  if (!b)
    return "Says school is out: give break_id, a verified catalog break covering the post's days.";
  const served =
    DISTRICT_TOWNS.find(([re]) => re.test(b.district ?? b.label))?.[1] ?? [];
  const named = TOWNS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(text));
  const outside = named.filter((t) => !served.includes(t));
  return outside.length
    ? `Says school is out in ${outside.join(", ")}, but ${b.label} doesn't cover it.`
    : null;
}

/** Number words an intro may use only as the count ("These four are warm"). */
const COUNTS =
  /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;

/** Facts an intro may not state: the items (and code) carry them. */
const INTRO_FACTS =
  /\b(free|prices?|costs?|fees?|tickets?|admission|open|opens|closed|closes|hours|holidays?|christmas|thanksgiving|hanukkah|kwanzaa|halloween|easter|new year'?s|indoors?|heated)\b|\$\s?\d/i;

/**
 * A carousel intro: 1 or 2 short sentences in our voice, setting the week
 * or the morning. It names no place but a town, states no price, hours,
 * holiday or indoor/heated claim, and any number is the count of items
 * (after cuts) or ideas. An Unpack intro claims no feature either (each
 * item says what its place has); an "at home" intro is held to the
 * hazard rules for the youngest idea and to household items.
 */
export function introProblems(
  intro: string | undefined,
  month: number,
  o:
    | { kind: "unpack"; count: number }
    | { kind: "at_home"; count: number; youngest: number },
): string[] {
  if (!intro) return [];
  const t = norm(intro);
  const out = [
    ...textProblems(intro, { month, label: "intro" }),
    ...voiceProblems(intro, "intro"),
    ...longSentences(intro, "intro"),
  ];
  if (sentencesOf(intro).length > 2) out.push("intro: 1 or 2 short sentences.");
  const towns = new Set(
    [...TOWNS, "Central Oregon", "Oregon"].flatMap((x) => wordsOf(x)),
  );
  const names = strayNames(t, towns);
  if (names.length)
    out.push(
      `intro: "${names.join(", ")}" names something; an intro names only a town.`,
    );
  const fact = INTRO_FACTS.exec(t);
  if (fact)
    out.push(
      `intro: "${fact[0]}" is a fact the items carry (no price, hours, holiday or indoor claims here).`,
    );
  for (const m of t.matchAll(COUNTS)) {
    const n = headlineCount(m[0]);
    if (n !== o.count)
      out.push(
        `intro: says ${m[0]}, but the post has ${o.count} ${o.kind === "unpack" ? "items after cuts" : "ideas"} (leave numbers out but the count).`,
      );
  }
  if (o.kind === "unpack") {
    const claims = unbackedClaims(intro, []);
    if (claims.length)
      out.push(
        `intro: no place claims here (${claims.join(", ")}); each item says what its place has.`,
      );
  } else {
    for (const h of hazardsIn(intro, o.youngest))
      out.push(`intro: not safe for these ages (${h}).`);
    if (NOT_HOUSEHOLD.test(intro))
      out.push(
        `intro: "${NOT_HOUSEHOLD.exec(intro)![0]}" is something to buy, print or watch. Household things only.`,
      );
  }
  return out;
}

/**
 * The cover's context line and date chip against what the post holds:
 * the chip prints its own span, the span is the items' own dates (an
 * Unpack: its events' first and last day; a holiday carousel: its break;
 * "at home": the Saturday and Sunday it goes out; park pairings: Friday to
 * Sunday after it, with every event anchor inside), and the line never
 * says "this weekend" for a day outside it. Pure: it reads only the spec.
 */
export function coverProblems(
  spec: PostSpec,
  o: { slotDate: string; brk?: BreakSpan | null },
): string[] {
  const head = spec.slides[0];
  if (!head || head.t !== "headline") return ["No cover slide."];
  const out: string[] = [];
  const { span, date } = head;
  const want = (k: string, from: string, to: string) => {
    if (head.kicker !== k)
      out.push(`cover: the context line says "${head.kicker}", not "${k}".`);
    if (!span || span.from !== from || span.to !== to)
      out.push(
        `cover: the date chip covers ${span ? `${span.from} to ${span.to}` : "nothing"}, not ${from} to ${to}.`,
      );
  };
  if (span && date !== spanText(span.from, span.to))
    out.push(
      `cover: the date chip prints "${date ?? ""}" for ${span.from} to ${span.to}.`,
    );
  if (!span && date) out.push("cover: a date chip with no days behind it.");
  const days = (
    spec.kind === "mashup"
      ? (spec.facts.mashup?.pairs ?? []).flatMap((p) =>
          p.event ? [p.event.day] : [],
        )
      : spec.facts.events.map((e) => e.day)
  ).sort();
  const outside =
    span && days.filter((d) => d < span.from || d > span.to).join(", ");
  if (outside)
    out.push(`cover: the dates ${outside} fall outside the cover's ${date}.`);
  if (spec.kind === "at_home") {
    const c = atHomeCover(o.slotDate);
    want(c.kicker, c.span!.from, c.span!.to);
  } else if (spec.kind === "mashup") {
    const w = fridayToSunday(o.slotDate);
    if (!span || span.from !== w.from || span.to !== w.to)
      out.push(
        `cover: park pairings name the weekend after the post (${w.from} to ${w.to}).`,
      );
  } else if (spec.kind === "unpack") {
    if (o.brk) want(breakName(o.brk.label), o.brk.from, o.brk.to);
    else if (!days.length) {
      if (head.kicker !== COPY.coverPlaces || span)
        out.push(
          `cover: with no dated items it says "${COPY.coverPlaces}", with no dates.`,
        );
    } else {
      const [from, to] = [days[0], days[days.length - 1]];
      const w = fridayToSunday(o.slotDate);
      if (!span || span.from !== from || span.to !== to)
        out.push(
          `cover: the date chip must span the items' own dates (${from} to ${to}).`,
        );
      const k = head.kicker;
      const weekendLine =
        k === COPY.coverWeekend || k === COPY.coverWeekendEvents;
      if (weekendLine && (from < w.from || to > w.to))
        out.push(
          `cover: says "${k}", but an item falls outside ${w.from} to ${w.to}.`,
        );
      else if (k === COPY.coverWeek && to > w.to)
        out.push(`cover: says "${k}", but an item falls after ${w.to}.`);
      else if (k === COPY.coverNextWeek && from <= w.to)
        out.push(`cover: says "${k}", but an item falls by ${w.to}.`);
      else if (
        k === COPY.coverWeekendEvents &&
        spec.facts.parks.length + spec.facts.venues.length > 0
      )
        out.push(`cover: says "${k}", but the list has places too.`);
      else if (
        !weekendLine &&
        ![COPY.coverWeek, COPY.coverNextWeek, COPY.coverWeekAndNext].includes(
          k as never,
        )
      )
        out.push(`cover: "${k}" isn't one of code's context lines.`);
    }
  }
  return out;
}

export async function validateParkPost(
  d: ParkPostDraft,
  weekOf: string,
  ctx: SocialCtx,
): Promise<PostReport> {
  const { date, publishAt } = slotFor("park_post", weekOf);
  const r = base("park_post", date, publishAt);
  const slot = slotProblems(weekOf, publishAt, ctx.now);
  if (slot) r.errors.push(slot);
  const month = Number(date.slice(5, 7));
  const park = ctx.parks.get(d.park);
  if (!ctx.planParks.includes(d.park))
    r.errors.push(
      `${d.park} isn't one of the plan's park candidates (code picks the park).`,
    );
  if (!park || !park.approved || park.status !== "active")
    r.errors.push(`${d.park} isn't an open park on the map.`);
  if (isClosedPark(d.park, ctx.catalog))
    r.errors.push(`${d.park} is closed for now (catalog).`);
  if (ctx.cooling.has(d.park))
    r.errors.push(`${d.park} was on Instagram in the last 8 weeks.`);
  const sentences = sentencesOf(d.story);
  const first = sentences[0] ?? "";
  if (
    sentences.length > STORY_LIMITS.sentences ||
    sentences.length < STORY_LIMITS.minSentences
  )
    r.errors.push(
      `story: ${sentences.length} sentence${sentences.length === 1 ? "" : "s"}; ${STORY_LIMITS.minSentences} to ${STORY_LIMITS.sentences} (a short paragraph).`,
    );
  if (first.length > STORY_LIMITS.first)
    r.errors.push(
      `story: the first sentence runs ${first.length} characters; ${STORY_LIMITS.first} at most (it shows before "more").`,
    );
  r.errors.push(...longSentences(d.story, "story"));
  const parts = [
    ["story", d.story],
    ["who", d.who],
    ["bring", d.bring],
  ] as const;
  for (const [label, text] of parts) {
    r.errors.push(...textProblems(text, { month, label }));
    r.errors.push(...voiceProblems(text, label));
  }
  const bang = exclamationProblem(parts.map(([, t]) => t));
  if (bang) r.errors.push(bang);
  const profile = ctx.profiles.get(d.park) ?? null;
  if (park) {
    if (
      !new RegExp(`\\b${escapeRe(norm(park.name))}\\b`, "i").test(norm(first))
    )
      r.errors.push(
        `story: the first sentence must name the park exactly as post_parks[].name has it (${park.name}), with its signature trait ("This week we're featuring ${park.name} ...").`,
      );
    // In-season traits only; nearby and history traits can't lead.
    const traits = postTraits(profile, month);
    // Every name and fact is the record's: the profile's own words (all
    // its traits, for the neighborhood) back names; nothing backs a day,
    // a time, a price, hours, a superlative, safety or an event.
    const others = [
      ...[...ctx.parks.values()].map((p) => p.name),
      ...ctx.catalog.venues.map((v) => v.name),
    ];
    for (const [label, text] of parts)
      r.errors.push(
        ...parkGroundingProblems(
          text,
          label,
          park,
          [...(profile?.traits ?? []), ...traits],
          others,
        ),
      );
    const leads = traits.filter((t) => !CONTEXT_KINDS.has(t.kind));
    const n = postKinds(profile, month);
    if (n < MIN_POST_TRAITS)
      r.errors.push(
        `${park.name} has signature traits of ${n} kind${n === 1 ? "" : "s"} this month; a park post needs ${MIN_POST_TRAITS}.`,
      );
    else if (!traitIn(first, leads))
      r.errors.push(
        "story: the first sentence opens the caption, so it must lead with one of the park's signature traits, using one of its keys (plan: post_parks[].profile.traits[].keys).",
      );
    const claims = unbackedClaims(
      [d.story, d.who, d.bring].join(" "),
      park.features,
      traits,
      month,
    );
    if (claims.length)
      r.errors.push(
        `The park's record doesn't list ${claims.join(", ")}. Only say what's recorded.`,
      );
  }
  const school = schoolOutProblem(
    [d.story, d.who, d.bring].join(" "),
    d.break_id,
    ctx,
    date,
    slotFor("story", weekOf).date,
  );
  if (school) r.errors.push(school);
  if (!park) return r;
  const spec = untaggedIfLong(
    r,
    (tags) => composeParkPost(d, park, ctx.photoFor(park.slug), ctx.dms, tags),
    [parkTag(park.slug)].filter((t): t is Tag => !!t),
  );
  common(r, spec, ctx, d.hashtags);
  if (!spec.slides.some((s) => s.t === "parkcard" && s.photo))
    r.warnings.push(
      "No checked photo for this park: the post uses the crayon park card.",
    );
  r.spec = spec;
  r.ok = r.errors.length === 0;
  return r;
}

export async function validateUnpack(
  d: UnpackDraft,
  weekOf: string,
  ctx: SocialCtx,
): Promise<PostReport> {
  const holiday = d.slot === "sun";
  const { date, publishAt } = slotFor("unpack", weekOf, holiday);
  const r = base("unpack", date, publishAt);
  const slot = slotProblems(weekOf, publishAt, ctx.now);
  if (slot) r.errors.push(slot);
  // Every other week the Wednesday carousel is code's park pairings.
  const alternate = unpackSlotProblem(weekOf, d.slot, ctx.catalog);
  if (alternate) r.errors.push(alternate);
  const month = Number(date.slice(5, 7));
  const words = wordCount(d.headline);
  if (words > HEADLINE_MAX_WORDS || words < HEADLINE_MIN_WORDS)
    r.errors.push(
      `The headline needs ${HEADLINE_MIN_WORDS} to ${HEADLINE_MAX_WORDS} words (it has ${words}).`,
    );
  const hl = d.highlight.trim().toLowerCase();
  if (
    /\s/.test(hl) ||
    !d.headline
      .toLowerCase()
      .split(/[^a-z0-9'-]+/)
      .includes(hl.replace(/[^a-z0-9'-]/g, ""))
  )
    r.errors.push("highlight must be one word of the headline.");
  r.errors.push(...textProblems(d.headline, { month, label: "headline" }));
  for (const [label, text] of [
    ["headline", d.headline],
    ...d.items.map((i) => [`item ${i.ref}`, i.what] as const),
  ] as const)
    r.errors.push(...voiceProblems(text, label));
  const bang = exclamationProblem([
    d.headline,
    d.intro ?? "",
    ...d.items.map((i) => i.what),
  ]);
  if (bang) r.errors.push(bang);
  if (!d.intro)
    r.warnings.push(
      "No intro: a line or two setting the week reads better than a bare list.",
    );
  const friday = slotFor("story", weekOf).date;
  const brk = holiday
    ? breakCovering(ctx.catalog, d.break_id, weekOf, friday)
    : null;
  if (holiday && !brk)
    r.errors.push(
      "A Sunday carousel is for school-break weeks: give break_id, a verified catalog break in that week.",
    );
  const school = schoolOutProblem(
    [d.headline, d.intro ?? "", ...d.items.map((i) => i.what)].join(" "),
    d.break_id,
    ctx,
    holiday ? weekOf : date,
    friday,
  );
  if (school) r.errors.push(school);
  const refs = d.items.map((i) => i.ref);
  if (new Set(refs).size !== refs.length) r.errors.push("An item is repeated.");

  const items: ResolvedItem[] = [];
  const tags: Tag[] = [];
  const facts: PostFacts = { parks: [], events: [], venues: [], issue: null };
  for (const it of d.items) {
    const label = `item ${it.ref}`;
    r.errors.push(...textProblems(it.what, { month, label }));
    const got = await resolveItem(it, ctx, publishAt, date);
    if (!got.ok) {
      r.cut.push(got.cut);
      continue;
    }
    // The cover names the break and its dates: an event outside it is cut.
    const day = itemDays([it])[0];
    if (brk && day && (day < brk.from || day > brk.to)) {
      r.cut.push(
        `${got.item.name}: ${day} is outside ${brk.label} (${brk.from} to ${brk.to}), which the cover names.`,
      );
      continue;
    }
    if (it.ref.startsWith("park:")) {
      const park = ctx.parks.get(it.ref.slice(5))!;
      if (ctx.cooling.has(park.slug))
        r.warnings.push(`${park.name} was on Instagram in the last 8 weeks.`);
    }
    items.push(got.item);
    const tag = itemTag(it.ref, ctx);
    if (tag) tags.push(tag);
    facts.parks.push(...(got.fact.parks ?? []));
    facts.events.push(...(got.fact.events ?? []));
    facts.venues.push(...(got.fact.venues ?? []));
  }
  if (items.length < 3)
    r.errors.push(
      `Only ${items.length} items hold up after cuts: a carousel needs 3 to 5.`,
    );
  r.errors.push(
    ...introProblems(d.intro, month, { kind: "unpack", count: items.length }),
  );
  const n = headlineCount(d.headline);
  if (n != null && n !== items.length)
    r.errors.push(
      `The headline says ${n}, but the carousel has ${items.length} items${r.cut.length ? " after cuts" : ""}.`,
    );
  const spec = untaggedIfLong(
    r,
    (t) =>
      composeUnpack(d, items, facts, {
        dms: ctx.dms,
        slotDate: date,
        brk,
        tags: t,
      }),
    tags,
  );
  r.errors.push(...coverProblems(spec, { slotDate: date, brk }));
  common(r, spec, ctx, d.hashtags);
  r.spec = spec;
  r.ok = r.errors.length === 0;
  return r;
}

/**
 * Saturday's "at home" carousel. Every idea is the model's own words, so
 * the rules are about safety (hazard words, by the idea's youngest age),
 * no brands or products, household items only, the season theme, and the
 * 12-week idea cooldown by title.
 */
export async function validateAtHome(
  d: AtHomeDraft,
  weekOf: string,
  ctx: SocialCtx,
): Promise<PostReport> {
  const { date, publishAt } = slotFor("at_home", weekOf);
  const r = base("at_home", date, publishAt);
  const slot = slotProblems(weekOf, publishAt, ctx.now);
  if (slot) r.errors.push(slot);
  const month = Number(date.slice(5, 7));
  const words = wordCount(d.headline);
  if (words > HEADLINE_MAX_WORDS || words < HEADLINE_MIN_WORDS)
    r.errors.push(
      `The headline needs ${HEADLINE_MIN_WORDS} to ${HEADLINE_MAX_WORDS} words (it has ${words}).`,
    );
  const hl = d.highlight.trim().toLowerCase();
  if (
    /\s/.test(hl) ||
    !d.headline
      .toLowerCase()
      .split(/[^a-z0-9'-]+/)
      .includes(hl.replace(/[^a-z0-9'-]/g, ""))
  )
    r.errors.push("highlight must be one word of the headline.");
  const n = headlineCount(d.headline);
  if (n != null && n !== d.ideas.length)
    r.errors.push(
      `The headline says ${n}, but there are ${d.ideas.length} ideas.`,
    );
  const themes = themesFor(date, ctx.catalog.season_themes);
  if (!themes.some((t) => t.id === d.theme))
    r.errors.push(
      `Theme "${d.theme}" isn't offered for ${date} (pick one of ${themes.map((t) => t.id).join(", ")}).`,
    );
  r.errors.push(...textProblems(d.headline, { month, label: "headline" }));
  r.errors.push(
    ...introProblems(d.intro, month, {
      kind: "at_home",
      count: d.ideas.length,
      youngest: Math.min(...d.ideas.map((i) => i.ages.from)),
    }),
  );
  for (const [label, text] of [
    ["headline", d.headline],
    ...d.ideas.flatMap((i) => [
      [`idea "${i.title}"`, [i.title, ...i.steps].join(" ")] as const,
      [`idea "${i.title}" payoff`, i.payoff] as const,
    ]),
  ] as const)
    r.errors.push(...voiceProblems(text, label));
  const bang = exclamationProblem([
    d.headline,
    d.intro ?? "",
    ...d.ideas.flatMap((i) => [i.title, ...i.steps, i.payoff]),
  ]);
  if (bang) r.errors.push(bang);
  if (!d.intro)
    r.warnings.push(
      "No intro: a line or two setting the morning reads better than a bare list.",
    );
  const school = schoolOutProblem(
    [
      d.headline,
      d.intro ?? "",
      ...d.ideas.flatMap((i) => [i.title, ...i.steps]),
    ].join(" "),
    d.break_id,
    ctx,
    date,
    date,
  );
  if (school) r.errors.push(school);
  d.ideas.forEach((idea, k) => {
    const label = `idea "${idea.title}"`;
    for (const [part, text] of [
      ["title", idea.title],
      ["need", idea.need.join(", ")],
      ...idea.steps.map((s, j) => [`step ${j + 1}`, s]),
    ])
      r.errors.push(
        ...textProblems(text, { month, label: `${label} ${part}` }),
      );
    r.errors.push(...ideaProblems(idea));
    const again = repeatOf(
      { title: idea.title, text: ideaText(idea) },
      ctx.recentIdeas ?? [],
    );
    if (again)
      r.errors.push(
        `${label} is too close to "${again}", posted in the last 12 weeks. Pick another idea.`,
      );
    for (const other of d.ideas.slice(0, k))
      if (
        titleSimilarity(idea.title, other.title) >= IDEA_SIMILAR ||
        ideaOverlap(ideaText(idea), ideaText(other)) >= IDEA_TEXT_SIMILAR
      )
        r.errors.push(`${label} repeats "${other.title}" in this post.`);
  });
  const spec = composeAtHome(d, { dms: ctx.dms, slotDate: date });
  r.errors.push(...coverProblems(spec, { slotDate: date }));
  r.errors.push(
    ...postTextProblems(
      d.headline,
      spec.caption ?? "",
      Math.min(...d.ideas.map((i) => i.ages.from)),
    ),
  );
  common(r, spec, ctx, d.hashtags);
  r.spec = spec;
  r.ok = r.errors.length === 0;
  return r;
}

// --- Park pairings (code only) -----------------------------------------------

/**
 * A park pairings carousel, as code composed it, checked like any other
 * post before it's stored: the text rules on every word code wrote (the
 * headline, intro, distances and the parks' traits), no drinks words
 * anywhere but our own park names (place names included), the headline's
 * shape and count, and each slide against the data it came from (the
 * distance from the two points, the park's own trait). Names are proper
 * names: first person ("Our Daily Bread") is fine there.
 */
export function mashupProblems(
  spec: PostSpec,
  /** The pairs it came from (null: a redraw from its own stored slides). */
  pairs: readonly Pairing[] | null,
  o: { month: number; recent: readonly RecentPost[]; slotDate: string },
): string[] {
  const out: string[] = [];
  const head = spec.slides[0];
  const slides = spec.slides.filter(
    (x): x is Extract<SlideSpec, { t: "pair" }> => x.t === "pair",
  );
  if (spec.kind !== "mashup") out.push("Not a park pairings post.");
  if (!head || head.t !== "headline") out.push("No cover slide.");
  else out.push(...coverProblems(spec, { slotDate: o.slotDate }));
  if (slides.length < PAIRS_MIN || slides.length > PAIRS_MAX)
    out.push(
      `${slides.length} pairs: a carousel needs ${PAIRS_MIN} to ${PAIRS_MAX}.`,
    );
  if (pairs && slides.length !== pairs.length)
    out.push("Slides and pairs differ.");
  const words = wordCount(spec.headline);
  if (words > HEADLINE_MAX_WORDS || words < HEADLINE_MIN_WORDS)
    out.push(
      `The headline needs ${HEADLINE_MIN_WORDS} to ${HEADLINE_MAX_WORDS} words (it has ${words}).`,
    );
  if (head?.t === "headline") {
    const hl = head.highlight.toLowerCase();
    if (
      !head.words
        .toLowerCase()
        .split(/[^a-z0-9'-]+/)
        .includes(hl)
    )
      out.push("highlight must be one word of the headline.");
  }
  const count = headlineCount(spec.headline);
  if (count != null && count !== slides.length)
    out.push(
      `The headline says ${count}, but there are ${slides.length} pairs.`,
    );
  // Our words: everything but the names (checked on their own below).
  const names = new Set(
    slides
      .flatMap((x) => [x.place, x.park, x.town])
      .map((x) => x.toLowerCase()),
  );
  const mask = (t: string) =>
    [...names]
      .sort((a, b) => b.length - a.length)
      .reduce((acc, nm) => acc.replace(new RegExp(escapeRe(nm), "gi"), " "), t);
  const ours = mask(
    [
      spec.headline,
      spec.modelText,
      ...slides.flatMap((x) => [x.apart, x.trait]),
    ].join("\n"),
  );
  out.push(
    ...textProblems(ours, { month: o.month, label: "pairings" }),
    ...voiceProblems(ours, "pairings"),
    ...spec.modelText
      .split("\n")
      .flatMap((line) => longSentences(line, "pairings")),
  );
  const bang = exclamationProblem([ours]);
  if (bang) out.push(bang);
  for (const p of pairs ?? []) out.push(...pairProblems(p, o.month));
  // Our parks' and towns' names are our records, not drinks talk
  // ("Diamond Bar Ranch Park"), and "monkey bars" are play equipment.
  const ownNames = [
    ...new Set(slides.flatMap((x) => [x.park, x.town]).concat(TOWNS)),
  ].sort((a, b) => b.length - a.length);
  const all = ownNames
    .reduce(
      (acc, nm) => acc.replace(new RegExp(`\\b${escapeRe(nm)}\\b`, "gi"), " "),
      [spec.caption ?? "", ...spec.alts, ...slides.map((x) => x.place)].join(
        "\n",
      ),
    )
    .replace(MONKEY_BARS, " ");
  const drinks = NO_DRINKS.exec(all);
  if (drinks)
    out.push(
      `"${drinks[0]}": no drinks words in a family post, names included.`,
    );
  slides.forEach((x, i) => {
    const p = pairs?.[i];
    if (!p) return;
    const a = apart(miles(p.place, p.park));
    if (!a || apartChip(a) !== x.apart || a.walk !== x.walk)
      out.push(`${x.place}: the distance doesn't match the two points.`);
    if (a?.walk && a.minutes > 10)
      out.push(`${x.place}: a walk over 10 minutes.`);
    if (
      x.trait !== p.park.trait ||
      x.parkSlug !== p.park.slug ||
      ((x.label ?? "At the park") !== p.park.label &&
        !(
          spec.facts.mashup?.weather &&
          p.park.kind === "park" &&
          x.label === "If it clears up"
        ))
    )
      out.push(`${x.park}: the anchor's line isn't its own.`);
    if (x.placeId !== p.place.placeId) out.push(`${x.place}: wrong place id.`);
    if (x.place !== noAt(cleanName(p.place.name)))
      out.push(`${x.place}: isn't the place's own name.`);
  });
  for (const r of o.recent.slice(0, OVERLAP_POSTS)) {
    if (r.kind === "mashup" && r.slotDate === o.slotDate) continue;
    const ov = overlap(spec.modelText, r.modelText);
    if (ov > OVERLAP_LIMIT)
      out.push(
        `Too close to the ${r.kind} of ${r.slotDate} (${Math.round(ov * 100)}% of its word runs repeat).`,
      );
  }
  out.push(...mentionProblems(spec.caption, postHandles(spec)));
  if ((spec.caption ?? "").length > CAPTION_MAX)
    out.push(`The caption is over ${CAPTION_MAX} characters.`);
  return out;
}

/** The brewery word in a name (allowed in park pairings, as the place type). */
const BREWERY_WORD = /\bbrew(ing|ery|eries|pub)\b/gi;
const MONKEY_BARS = /\bmonkey bars?\b/gi;

/**
 * One pair's own problems: the place's printed name (no bar, pub or
 * taproom, no drinks word, no competitor; a brewery is a family stop here,
 * James, Nov 25, 2026, so its brewery word is allowed) and the park's
 * trait (the text rules; "monkey bars" is play equipment). A pair with
 * any is dropped on its own: the rest of the carousel goes on.
 */
export function pairProblems(p: Pairing, month: number): string[] {
  const out: string[] = [];
  const name = cleanName(p.place.name);
  const bad = venueProblem(name.replace(BREWERY_WORD, " "), {
    month,
    label: "place",
  });
  if (bad) out.push(bad);
  if (NO_DRINKS.test(name))
    out.push(`${name}: no drinks words in a family post, names included.`);
  const trait = p.park.trait.replace(MONKEY_BARS, " ");
  out.push(...textProblems(trait, { month, label: `${p.park.name}'s line` }));
  // An event's title is its host's words (no "we" of ours there), but the
  // competitor, link, emoji and safety rules hold. Drinks words in an
  // anchor's own name are masked like a park's (lib/social/indoor.ts and
  // the events listing only hold places and events for kids).
  if (p.park.kind === "event") {
    out.push(
      ...textProblems(p.park.name, { month, label: "event" }).filter(
        (x) => !/first person/.test(x),
      ),
    );
    // A kids' event at a bar or a brewery never anchors a pair (as the
    // roundup: lib/social/roundup.ts), whatever the theme.
    const at = p.park.event?.venue;
    const bad = at ? venueProblem(at, { month, label: "venue" }) : null;
    if (bad) out.push(bad);
    // A pub chain by name (McMenamins) is a bar too.
    if (at && chainOf(at))
      out.push(`venue "${at}" is a chain, not a kids' spot.`);
  }
  if (NO_DRINKS.test(trait))
    out.push(`${p.park.name}'s line: no drinks words in a family post.`);
  return out;
}

/**
 * May the routine hand in an Unpack for this week? Not on a mashup week's
 * Wednesday (code makes the park pairings), unless it's the holiday
 * Unpack: Sunday, in a school-break week (3 or more weekdays off).
 */
export function unpackSlotProblem(
  weekOf: string,
  slot: "wed" | "sun",
  catalog: Pick<Catalog, "breaks">,
): string | null {
  if (!mashupParity(weekOf)) return null;
  if (slot === "sun" && holidayBreak(catalog, weekOf)) return null;
  return slot === "sun"
    ? "This is a park pairings week: a Sunday carousel is only for a school-break week (3 or more weekdays off)."
    : "This is a park pairings week: code makes Wednesday's carousel. Hand in no Unpack (a school-break week may use the Sunday slot).";
}

export async function validatePost(
  d: PostDraft,
  weekOf: string,
  ctx: SocialCtx,
): Promise<PostReport> {
  if (d.type === "park_post") return validateParkPost(d, weekOf, ctx);
  if (d.type === "at_home") return validateAtHome(d, weekOf, ctx);
  return validateUnpack(d, weekOf, ctx);
}

/**
 * Just before a post goes out: do its facts still hold? Events still
 * listed and going ahead, parks still open, venues still verified.
 * Returns why not, or null.
 */
export function stillTrue(
  facts: PostFacts,
  ctx: Pick<SocialCtx, "now" | "catalog" | "parks" | "events">,
): string | null {
  for (const slug of facts.parks) {
    const p = ctx.parks.get(slug);
    if (!p || !p.approved || p.status !== "active")
      return `${slug} isn't open on the map any more.`;
    if (isClosedPark(slug, ctx.catalog)) return `${slug} is closed for now.`;
  }
  for (const { slug, day, start, ages, cost } of facts.events) {
    const e = ctx.events.get(slug);
    if (!e || !listed(e, ctx.now)) return `${slug} is off the events listing.`;
    if (statusOn(e.data, day, e.status) !== "scheduled")
      return `${slug} isn't going ahead on ${day}.`;
    if (start !== undefined) {
      const now = e.data.dates.find((d) => d.day === day)?.start;
      if (now !== start)
        return `${slug} on ${day} now starts at ${now ?? "no stated time"}, not ${start}.`;
    }
    // The ages and price the post printed: the roundup's chips, or an
    // item's printed words.
    if (ages !== undefined) {
      const r = roundupAges(e.data.ages);
      const shown = [
        "chips" in r ? r.chips : null,
        // An Unpack item: the ages as parsed, so rewording isn't a change.
        e.data.ages ? [parsedAges(e.data.ages)] : null,
        // Posts stored before that: the printed words.
        e.data.ages_text ? [e.data.ages_text] : null,
      ];
      if (!shown.some((x) => x && x.join("|") === ages.join("|")))
        return `${slug}'s printed ages changed from ${ages.join(", ")}.`;
    }
    if (cost !== undefined && (costChip(e.data) ?? null) !== cost)
      return `${slug}'s printed cost changed from ${cost ?? "none"} to ${costChip(e.data) ?? "none"}.`;
  }
  for (const id of facts.venues) {
    const v = ctx.catalog.venues.find((x) => x.id === id);
    if (!v || !v.verified) return `${id} isn't a verified venue any more.`;
  }
  return null;
}
