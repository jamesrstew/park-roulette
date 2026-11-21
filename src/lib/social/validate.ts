import { type Catalog, onList, type Venue } from "@/lib/news/catalog";
import { addDays, holidays } from "@/lib/news/time";
import { unsafeText } from "@/lib/news/safety";
import { blockedLink } from "@/lib/news/validate";
import {
  costChip,
  type EventRow,
  pacificAt,
  statusOn,
  whenLine,
} from "@/lib/events/model";
import { listed } from "@/lib/events/state";
// A cycle (roundup uses eventTextProblem): both only call at run time.
import { roundupAges } from "./roundup";
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
  ideaOverlap,
  ideaProblems,
  ideaText,
  postTextProblems,
  type RecentIdea,
  repeatOf,
  themesFor,
  titleSimilarity,
} from "./at-home";
import {
  composeAtHome,
  composeParkPost,
  composeUnpack,
  type ParkInfo,
  type ResolvedItem,
} from "./compose";
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
  type ParkPostDraft,
  type PhotoRef,
  type PostDraft,
  type PostFacts,
  type PostKind,
  type PostSpec,
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
/** We never claim to have done anything ("we went", "my kids loved"). */
const FIRST_PERSON =
  /\b(i|i'm|i've|i'd|i'll|me|my|mine|we|we're|we've|we'd|we'll|us|our|ours)\b/i;
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
  { month, label }: { month: number; label: string },
): string[] {
  const t = norm(text);
  const out: string[] = [];
  if (COMPETITORS.test(t)) out.push(`${label}: never name another newsletter.`);
  if (FIRST_PERSON.test(t))
    out.push(
      `${label}: no first person ("I", "we", "my", "our"). Say what the place has, not what anyone did.`,
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
): string[] {
  const has = new Set(features);
  return CLAIMS.filter(
    (c) =>
      c.re.test(text) &&
      !c.features.some((f) => has.has(f)) &&
      !traits.some((t) => traitBacks(c, t, text)),
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
          whenLine(date),
          e.data.ages_text ?? null,
          costChip(e.data),
          e.data.venue.town,
        ].filter((x): x is string => !!x),
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
  const traits = postTraits(ctx.profiles.get(p.slug), month);
  const claims = unbackedClaims(it.what, p.features, traits);
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

function common(
  r: PostReport,
  spec: PostSpec,
  ctx: SocialCtx,
  hashtags: readonly string[],
) {
  r.errors.push(...hashtagProblems(hashtags));
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
  if (ctx.cooling.has(d.park))
    r.errors.push(`${d.park} was on Instagram in the last 8 weeks.`);
  if (wordCount(d.hook) > HEADLINE_MAX_WORDS)
    r.errors.push(`The hook is over ${HEADLINE_MAX_WORDS} words.`);
  for (const [label, text] of [
    ["hook", d.hook],
    ["who", d.who],
    ["what", d.what],
    ["bring", d.bring],
  ] as const)
    r.errors.push(...textProblems(text, { month, label }));
  for (const [label, text] of [
    ["hook", d.hook],
    ["who", d.who],
    ["what", d.what],
    ["bring", d.bring],
  ] as const) {
    const generic = genericPhrases(text);
    if (generic.length)
      r.errors.push(
        `${label}: ${generic.join(", ")} could be any park. Say what makes this one different.`,
      );
  }
  const profile = ctx.profiles.get(d.park) ?? null;
  if (park) {
    // In-season traits only; nearby and history traits can't lead.
    const traits = postTraits(profile, month);
    const leads = traits.filter((t) => !CONTEXT_KINDS.has(t.kind));
    const n = postKinds(profile, month);
    if (n < MIN_POST_TRAITS)
      r.errors.push(
        `${park.name} has signature traits of ${n} kind${n === 1 ? "" : "s"} this month; a park post needs ${MIN_POST_TRAITS}.`,
      );
    else {
      if (!traitIn(d.hook, leads))
        r.errors.push(
          "The hook must lead with one of the park's signature traits, using one of its keys (plan: post_parks[].profile.traits[].keys).",
        );
      if (!traitIn(d.what, leads))
        r.errors.push(
          "The what line opens the caption: it must name one of the park's signature traits, using one of its keys.",
        );
    }
    const claims = unbackedClaims(
      [d.hook, d.who, d.what, d.bring].join(" "),
      park.features,
      traits,
    );
    if (claims.length)
      r.errors.push(
        `The park's record doesn't list ${claims.join(", ")}. Only say what's recorded.`,
      );
  }
  const school = schoolOutProblem(
    [d.hook, d.who, d.what, d.bring].join(" "),
    d.break_id,
    ctx,
    date,
    slotFor("story", weekOf).date,
  );
  if (school) r.errors.push(school);
  if (!park) return r;
  const spec = composeParkPost(d, park, ctx.photoFor(park.slug), ctx.dms);
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
  const friday = slotFor("story", weekOf).date;
  if (holiday && !breakCovering(ctx.catalog, d.break_id, weekOf, friday))
    r.errors.push(
      "A Sunday carousel is for school-break weeks: give break_id, a verified catalog break in that week.",
    );
  const school = schoolOutProblem(
    [d.headline, ...d.items.map((i) => i.what)].join(" "),
    d.break_id,
    ctx,
    holiday ? weekOf : date,
    friday,
  );
  if (school) r.errors.push(school);
  const refs = d.items.map((i) => i.ref);
  if (new Set(refs).size !== refs.length) r.errors.push("An item is repeated.");

  const items: ResolvedItem[] = [];
  const facts: PostFacts = { parks: [], events: [], venues: [], issue: null };
  for (const it of d.items) {
    const label = `item ${it.ref}`;
    r.errors.push(...textProblems(it.what, { month, label }));
    const got = await resolveItem(it, ctx, publishAt, date);
    if (!got.ok) {
      r.cut.push(got.cut);
      continue;
    }
    if (it.ref.startsWith("park:")) {
      const park = ctx.parks.get(it.ref.slice(5))!;
      if (ctx.cooling.has(park.slug))
        r.warnings.push(`${park.name} was on Instagram in the last 8 weeks.`);
    }
    items.push(got.item);
    facts.parks.push(...(got.fact.parks ?? []));
    facts.events.push(...(got.fact.events ?? []));
    facts.venues.push(...(got.fact.venues ?? []));
  }
  if (items.length < 3)
    r.errors.push(
      `Only ${items.length} items hold up after cuts: a carousel needs 3 to 5.`,
    );
  const n = headlineCount(d.headline);
  if (n != null && n !== items.length)
    r.errors.push(
      `The headline says ${n}, but the carousel has ${items.length} items${r.cut.length ? " after cuts" : ""}.`,
    );
  const spec = composeUnpack(d, items, facts, ctx.dms);
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
  const school = schoolOutProblem(
    [d.headline, ...d.ideas.flatMap((i) => [i.title, ...i.steps])].join(" "),
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
  const spec = composeAtHome(d, ctx.dms);
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
