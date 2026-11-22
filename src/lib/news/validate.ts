import {
  aliasPathProblem,
  allowedLink,
  type Catalog,
  isClosedPark,
  leadMessage,
  onList,
  seasonalDefault,
} from "./catalog";
import {
  COOLDOWN_WEEKS,
  cooling,
  freeItems,
  lastUsed,
  type SentIssue,
} from "./cooldowns";
import { WINTER_SUBJECT_WORDS } from "./tiers";
import {
  type Issue,
  type IssueEvidence,
  type MemeSnapshot,
  IssueSchema,
  issueText,
  issueUnits,
  type Unit,
  withoutUnits,
  wordCount,
} from "./issue";
import type { Plan } from "./plan-types";
import { weekdayOf, weekendOf } from "./time";
import { LIKES_FLOOR, postUrl } from "./xapi";
import { ageTags } from "@/lib/events/ages";
import { dateEnds, type StoredEvent } from "@/lib/events/model";
import { dataHasQuote } from "@/lib/events/binding";
import { machinePrintsDay, machinePrintsTime } from "@/lib/events/machine-time";

/**
 * The one validator. The writer's self-check (POST /api/news/check), the
 * draft inbox (POST /api/news/drafts) and the sender (just before sending)
 * all call validateIssue, so a draft that passes here is exactly what the
 * sender would send.
 *
 * Fail closed, but small: a problem in a required part (subject, hello,
 * Wheel Pick, passport, sign-off) fails the issue; a problem in any other
 * item cuts that item, and an empty section drops out.
 */

/** The canonical link to a post, from its snapshot. */
export function memeLink(s: MemeSnapshot): string {
  if (s.kind === "x") return postUrl(s);
  if (s.kind === "instagram") return s.permalink;
  return `https://www.tiktok.com/@${s.handle}/video/${s.id}`;
}

export type Rule =
  | "schema"
  | "length"
  | "subject"
  | "style"
  | "links"
  | "evidence"
  | "dates"
  | "catalog"
  | "plan"
  | "cooldown"
  | "seasonal"
  | "weather"
  | "similarity";

export type Finding = { rule: Rule; path: string; message: string };

export type ValidationReport = {
  ok: boolean;
  issue_date: string | null;
  checked_at: string;
  /** False when links and evidence weren't fetched (a quick check). */
  network: boolean;
  errors: Finding[];
  /** Items cut from the issue (the issue can still go). */
  dropped: Finding[];
  warnings: Finding[];
  words: number;
  /** The issue as it would be sent: cut items removed. */
  issue: Issue | null;
};

export type FetchResult = {
  status: number;
  /** Where redirects ended up. */
  finalUrl: string;
  /** The page as text (tags stripped), for evidence quotes. */
  text: string;
  /** The Content-Type header (photos must be image/*). */
  contentType?: string;
  /** The site showed a bot check instead of the page (we never get past one). */
  blocked?: string;
  /** Status 0: the site never answered ("connection reset", "timed out"). */
  unreachable?: string;
  /** Why the page couldn't be read, for the retro's blocked hosts. */
  blockedKind?: BlockedKind;
  /**
   * The organizer's own structured data on the page, one record a line:
   * JSON-LD Events, or the whole body when it's JSON or an .ics feed
   * (lib/events/structured.ts). Events evidence may quote it.
   */
  data?: string;
};

/** How a host kept us out (the retro's blocked_hosts kinds, minus allowlist). */
export type BlockedKind = "bot_check" | "reset" | "timeout" | "http_status";
/**
 * Fetch a page or image. `domains` is the allowlist for this link: every
 * redirect hop must stay on it (and off private networks).
 */
export type Fetcher = (
  url: string,
  domains: readonly string[],
) => Promise<FetchResult>;

export type ParkInfo = {
  name: string;
  city: string;
  status: string;
  play: string;
  approved: boolean;
};

export type ValidateContext = {
  /**
   * draft (the check and drafts routes, the default) or send (the
   * sender). At send, a required Indoor pick that fails is dropped with a
   * warning instead of failing the issue: it never skips a week.
   */
  stage?: "draft" | "send";
  catalog: Catalog;
  /** Every park on the map, by slug. */
  parks: ReadonlyMap<string, ParkInfo>;
  /** Sent issues before this one (any order). */
  history: readonly SentIssue[];
  /** The stored, code-made plan for this issue date. */
  plan: Plan | null;
  /** Omit for a quick check with no link or evidence fetching. */
  fetcher?: Fetcher;
  /** Our own site (links to it made by code aren't fetched). */
  site: string;
  /**
   * Parents' corner: fetch the named post as it is now (X lookup, or
   * TikTok oEmbed plus a copy of its cover). Null: it's gone or ineligible.
   * Omitted with no network.
   */
  /**
   * Instagram picks only: an X stand-in with its card (drawn at draft
   * time from the plan's best X candidate; at send, the drafted one if
   * its post still exists). Null: none.
   */
  memeFallback?: () => Promise<MemeSnapshot | null>;
  /** Event pages on /events, by slug (an outing may name its own). */
  events?: ReadonlySet<string>;
  /**
   * The stored events themselves, by slug: an outing that names one may
   * leave its evidence out and use the event's verified quotes.
   */
  eventData?: ReadonlyMap<string, StoredEventRef>;
  memeSource?: (
    meme: NonNullable<Issue["meme"]>,
  ) => Promise<MemeSnapshot | null>;
  now: Date;
};

/**
 * Domains allowed in one section only, on top of the catalog's allowlist:
 * the featured park's photo (Wikimedia Commons) and the parent meme
 * (social platforms and the outlets that write about them).
 */
export const SECTION_DOMAINS: Record<string, readonly string[]> = {
  photo: [
    "upload.wikimedia.org",
    "commons.wikimedia.org",
    "bendparksandrec.org",
  ],
  meme: [
    "tiktok.com",
    "instagram.com",
    "x.com",
    "twitter.com",
    "huffpost.com",
    "today.com",
    "scarymommy.com",
    "mother.ly",
  ],
};

/**
 * Other newsletters, never a link or evidence (James's hard rule): we go
 * to the primary source, the organizer's or venue's own page, or an
 * official city, parks, library or Forest Service page. Each entry blocks
 * the domain and every subdomain.
 */
export const BLOCKED_DOMAINS = [
  "bendbuzz.com",
  "thebendbuzz.com",
  "bendfamilyloop.com",
  "beehiiv.com",
  "substack.com",
  "campaign-archive.com",
  "list-manage.com",
  "mailchi.mp",
  "buttondown.email",
  "buttondown.com",
] as const;

export function blockedLink(url: string): boolean {
  const h = host(url);
  return !!h && BLOCKED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Naming another newsletter (even "via Bend Family Loop") is out too. */
// Any spacing or case ("BendBuzz", "Bend-Family-Loop"), as the events
// checker's COMPETITOR_NAMES.
const MENTIONS = /bend[\s_.-]*(family[\s_.-]*loop|buzz)/i;

/**
 * The site a link belongs to, for "the link and its evidence come from
 * the same place": the allowlist entry it matched, else its last two
 * labels (four for Oregon's .or.us names).
 */
export function siteOf(url: string, domains: readonly string[]): string {
  const h = host(url);
  const matched = domains
    .filter((d) => h === d || h.endsWith(`.${d}`))
    .sort((a, b) => b.length - a.length)[0];
  if (matched) return matched;
  const labels = h.split(".");
  // Oregon's public bodies: ci.<city>.or.us, <district>.k12.or.us.
  return labels.slice(/\.or\.us$/.test(h) ? -4 : -2).join(".");
}

/** Open licenses we can show with a credit line. */
const PHOTO_LICENSE =
  /^(CC0( 1\.0)?|PD|Public domain|CC BY( \d\.\d)?|CC BY-SA( \d\.\d)?)$/i;

/** Where a featured-park photo may come from (https, default port only). */
export function photoSource(src: string): "bprd" | "wikimedia" | null {
  try {
    const u = new URL(src);
    if (u.protocol !== "https:" || u.port || u.username || u.password)
      return null;
  } catch {
    return null;
  }
  const h = host(src);
  if (h === "upload.wikimedia.org") return "wikimedia";
  if (/(^|\.)bendparksandrec\.org$/.test(h)) return "bprd";
  return null;
}

const path = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const LIMITS = {
  subjectMax: 45,
  wordsMin: 200,
  wordsTarget: [350, 500] as const,
  wordsMax: 500,
  exclamations: 1,
  /** Word-trigram overlap with any earlier section or issue. */
  sectionSimilarity: 0.5,
  issueSimilarity: 0.3,
  /** Similarity looks at the last 8 sent issues. */
  similarityWindow: 8,
  /** Subjects may never repeat within a year. */
  subjectRepeatWeeks: 52,
} as const;

// --- Style rules ---------------------------------------------------------

/** Phrases that read like an ad or a bot. Lowercase. */
export const BANNED_PHRASES = [
  "hidden gem",
  "nestled",
  "something for everyone",
  "fun for the whole family",
  "fun for all ages",
  "don't miss",
  "do not miss",
  "must-see",
  "must see",
  "look no further",
  "whether you're",
  "boasts",
  "vibrant",
  "delve",
  "tapestry",
  "unforgettable",
  "game-changer",
  "game changer",
  "in today's",
  "bustling",
  "a stone's throw",
  "elevate",
  "unwind",
  "embark",
  "treasure trove",
  "adventure awaits",
  "memories to last",
  "perfect for the whole family",
  "sponsored",
];

/**
 * Doom words (weather-season spec section 6): lead with what works.
 * Whole words only ("embrace", "bracelets" and "non-toxic paints" pass),
 * and a "not" in front lets one through ("not scary for toddlers").
 */
export const DOOM_WORDS: [RegExp, string][] = [
  [/\bbrutal\b/i, "brutal"],
  [/\bnasty\b/i, "nasty"],
  [/\bmiserable\b/i, "miserable"],
  [/\bdreary\b/i, "dreary"],
  [/\bstuck inside\b/i, "stuck inside"],
  [/\bcabin fever\b/i, "cabin fever"],
  [/\bhunker(?:ing)? down\b/i, "hunker down"],
  [/\w*pocalypse\b/i, "-pocalypse"],
  [/\bbad air\b/i, "bad air"],
  [/(?<!non-)\btoxic\b/i, "toxic"],
  [/(?<!\bnot )\bdangerous\b/i, "dangerous"],
  [/(?<!\bnot )\bscary\b/i, "scary"],
  [/\bbrace(?: yourself| yourselves| for)?\b(?!s)/i, "brace"],
];

const DASHES = /—|―|--| – /;

/** "We went", "I saw", "my kids love": claims the writer can't have lived. */
const FIRST_PERSON = [
  /\b(i|we)(?:'ve| have| had| just| finally| recently| all| both| also)?\s+(went|go|going|saw|see|seen|visited|tried|loved|love|played|took|spent|stopped|checked|found|discovered|hiked|biked|walked|sledded|skated|swam|explored|been|spotted|noticed|watched)\b/i,
  /\b(my|our)\s+(kids?|son|daughter|family|toddler|little ones?|crew|boys?|girls?|husband|wife)\b/i,
  /\b(last|this past)\s+(weekend|week|saturday|sunday)\s*,?\s*(we|i)\b/i,
];

const EMOJI = new RegExp("\\p{Extended_Pictographic}", "u");

/** Words in a subject that are shouting (four or more capital letters). */
function shouting(s: string): boolean {
  const ok = new Set(["SHARC", "OMSI", "BPRD", "RAPRD", "USFS"]);
  return (s.match(/\b[A-Z]{4,}\b/g) ?? []).some((w) => !ok.has(w));
}

export function styleProblems(text: string): string[] {
  const out: string[] = [];
  if (MENTIONS.test(text))
    out.push("Names another newsletter. Credit the primary source instead.");
  if (DASHES.test(text))
    out.push(
      "Has an em dash (or a stand-in for one). Use a period or a comma.",
    );
  const lower = text.toLowerCase().replace(/’/g, "'");
  for (const p of BANNED_PHRASES)
    if (lower.includes(p)) out.push(`Banned phrase: "${p}".`);
  for (const [re, w] of DOOM_WORDS)
    if (re.test(lower)) out.push(`Doom word: "${w}". Lead with what works.`);
  for (const re of FIRST_PERSON) {
    const m = text.replace(/’/g, "'").match(re);
    if (m)
      out.push(
        `First-person experience claim: "${m[0]}". Say what the park has, not what we did.`,
      );
  }
  return out;
}

/** Heads up text about a park joining the map (James: never news). */
export const NEW_ON_MAP =
  /\bnew parks?\b|\badded\b[^.]{0,40}\bto (the|our) map\b|\bnew (on|to) the map\b|\bjoined the map\b|\bnewly added\b/i;

// --- Similarity ----------------------------------------------------------

const STOP = new Set(
  "a an and are as at be but by for from has have in is it its of on or so that the their there this to was were will with you your".split(
    " ",
  ),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function trigrams(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++)
    out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** Jaccard overlap of word trigrams: 0 (nothing shared) to 1 (the same). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

// --- Evidence ------------------------------------------------------------

/** Text for "is this quote on the page": entities decoded, spaces collapsed. */
export function normalizeText(s: string): string {
  // Entities first (one pass, so "&amp;ndash;" stays text), then the
  // characters they and the page produce: dashes, quotes, spaces.
  return s
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, e: string) => {
      if (e[0] === "#")
        return codePoint(
          e[1] === "x" || e[1] === "X"
            ? parseInt(e.slice(2), 16)
            : Number(e.slice(1)),
        );
      return NAMED[e.toLowerCase()] ?? m;
    })
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  ndash: "-",
  mdash: "-",
  hellip: "...",
  lt: "<",
  gt: ">",
  middot: "·",
  bull: "•",
};

/** A numeric entity as text; out-of-range and surrogate code points drop. */
function codePoint(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return "";
  if (n >= 0xd800 && n <= 0xdfff) return "";
  return String.fromCodePoint(n);
}

/** Where one element closes and the next opens, with no text between. */
const SEAM = "\u0001";

/**
 * An HTML page as plain text (scripts and styles removed). Block ends and
 * <br> are spaces. Where one inline element closes and the next opens
 * with nothing between them, a digit meeting a letter or a digit gets a
 * space ("<span>Dec</span><span>4</span><span>2026</span>" is "Dec 4
 * 2026", lesson 5); letters stay joined, so a word split by its styling
 * ("<b>Win</b><i>ter</i>") stays one word. The events routine quotes
 * page text the same way (events-harvest.md §3).
 */
export function pageText(html: string): string {
  return normalizeText(
    html
      .replaceAll(SEAM, "")
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|td|tr)>/gi, " ")
      .replace(/(?:<[^>]+>)+/g, (run) =>
        /<\/[^>]*>[\s\S]*<[a-z]/i.test(run) ? SEAM : "",
      )
      .replace(/([a-z0-9])\u0001(?=\d)|(\d)\u0001(?=[a-z])/gi, "$1$2 ")
      .replaceAll(SEAM, ""),
  );
}

/** "$8", "$8.50": whole prices only, never "$8" inside "$80". */
const PRICE = /\$\s?\d+(?:\.\d{2})?(?!\d|\.\d)/g;

/**
 * Does a quote print this price? Compared as amounts, so "$13" matches
 * "$13.00" but never "$13.50" or "$130", and "$13.50" needs its cents.
 */
export function quoteHasPrice(quote: string, price: string): boolean {
  const want = Number(price.replace(/[$\s,]/g, ""));
  if (!Number.isFinite(want)) return false;
  return [...quote.matchAll(/\$\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)/g)].some(
    (m) => Number(m[1].replace(/,/g, "")) === want,
  );
}

/**
 * "Free" only in an admission sense: free admission, a free event, free
 * for all, free and open to the public, no cost. ("Free parking" or
 * "under 3 free" don't make an event free.)
 */
export const FREE_ADMISSION =
  /\bfree (admission|entry|event|of charge|to attend|to the public|for (all|everyone|everybody|families|kids)|and open to (the public|all|everyone))\b|\b(admission|entry|it|this event|the event)( is)? free\b|\bno (cost|charge|admission fee)\b|^\s*free\.?\s*$/i;

/** A stored event as the issue validator sees it (lib/events/store.ts). */
export type StoredEventRef = {
  data: StoredEvent;
  status: string;
  confirm: string;
};

/** A bare "Free" that's about admission, not free parking or snacks. */
const BARE_FREE =
  /\bfree\b(?!\s+(parking|wi-?fi|coffee|snacks?|refreshments|crafts?|gifts?|samples?|swag|t-shirts?))/i;

/** "$5", "free" with a date or time: a short quote may still prove it. */
const SHORT_TIME = /\b\d{1,2}(:\d{2})?\s*(a\.?m|p\.?m)\b|\bnoon\b/i;
export function shortQuoteOk(quote: string, day: string): boolean {
  const q = quote.trim();
  if (q.length >= 20) return true;
  return (
    q.length >= 8 &&
    /\$\s?\d|\bfree\b/i.test(q) &&
    (quoteHasDay(q, day) || SHORT_TIME.test(q))
  );
}

/**
 * The evidence an outing borrows from its stored event (writer-fixes item
 * 5): the quote that prints the outing's day first, then quotes with a
 * price or a time, at most 3. A reason instead when the event can't stand
 * in: missing, passed, canceled, unconfirmed, or not on that day.
 */
/** The names a data line may use to point at this unit: its own first
 * text, plus the stored event's title when an outing borrows its quotes
 * (a writer may shorten "Toddler Storytime: Snow!" to "Story time"). */
function eventTitleNames(
  key: string,
  texts: string[],
  weekend: { event?: string }[] | undefined,
  events: ReadonlyMap<string, StoredEventRef> | undefined,
): string[] {
  const names = texts.slice(0, 1);
  const m = /^weekend\.(\d+)$/.exec(key);
  const slug = m ? weekend?.[Number(m[1])]?.event : undefined;
  const title = slug ? events?.get(slug)?.data.title : undefined;
  return title ? [...names, title] : names;
}

export function outingEventEvidence(
  w: { event?: string; day: string },
  events: ReadonlyMap<string, StoredEventRef> | undefined,
  now: Date,
): IssueEvidence[] | string {
  const none =
    "No evidence: give quotes from the official page, or name a stored, upcoming event (event).";
  if (!w.event || !events) return none;
  const row = events.get(w.event);
  if (!row) return `No event page "${w.event}" on /events.`;
  const e = row.data;
  const date = e.dates.find(
    (d) =>
      d.day === w.day || (d.end_day && d.day <= w.day && w.day <= d.end_day),
  );
  if (!date) return `The event "${w.event}" isn't on ${w.day}.`;
  if (dateEnds(date).getTime() <= now.getTime())
    return `The event "${w.event}" on ${w.day} has passed.`;
  const status = e.statusByDay?.[date.day] ?? row.status;
  if (status !== "scheduled")
    return `The event "${w.event}" is ${status} on ${w.day}. Leave this outing out.`;
  if (e.ages && !e.ages.kids)
    return `The event "${w.event}" isn't a kids' event. Leave this outing out.`;
  if (row.confirm !== "ok")
    return `The event "${w.event}" couldn't be confirmed on its page lately. Quote the official page instead.`;
  // Its evidence is a newsletter's listing (a page, or an issue in our
  // inbox): never an issue's evidence.
  if (e.verified_via === "listing")
    return `The event "${w.event}" stands on a newsletter's listing. Quote the official page instead.`;
  const target = e.targets?.[date.day];
  const all = [
    ...(target ? [target] : []),
    ...e.evidence.filter((x) => /\$\s?\d|\bfree\b/i.test(x.quote)),
    ...e.evidence.filter((x) => SHORT_TIME.test(x.quote)),
    ...e.evidence,
  ];
  const seen = new Set<string>();
  const out: IssueEvidence[] = [];
  for (const x of all) {
    const k = `${x.url} ${x.quote}`;
    if (seen.has(k) || out.length >= 3) continue;
    seen.add(k);
    out.push({ url: x.url, quote: x.quote.slice(0, 300) });
  }
  return out.length ? out : none;
}

/**
 * Every price claim in some texts: dollar amounts, and "free" when a text
 * says admission is free (a bare "Free" cost, or "free admission"...).
 */
function priceClaims(texts: string | string[]): string[] {
  const list = Array.isArray(texts) ? texts : [texts];
  return [
    ...list.flatMap((t) => t.match(PRICE) ?? []),
    ...(list.some((t) => FREE_ADMISSION.test(t)) ? ["free"] : []),
  ];
}

function quotesPrice(quotes: string[], claim: string): boolean {
  return claim === "free"
    ? quotes.some((q) => FREE_ADMISSION.test(q))
    : quotes.some((q) => quoteHasPrice(q, claim));
}

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
const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Does a quote print this day: its weekday, or its date ("Dec. 5", "12/5")? */
export function quoteHasDay(quote: string, date: string): boolean {
  const q = quote.toLowerCase();
  const [, m, d] = date.split("-").map(Number);
  const wd = DAYS[weekdayOf(date)];
  if (new RegExp(`\\b(${wd}s?|${wd.slice(0, 3)}\\.?)\\b`).test(q)) return true;
  if (new RegExp(`\\b${MONTHS[m - 1]}[a-z]*\\.?\\s+${d}(?!\\d)`).test(q))
    return true;
  if (new RegExp(`\\b${m}/${d}(?!\\d)`).test(q)) return true;
  // The organizer's structured data, as a Pacific day ("2026-12-05T10:30";
  // "2026-12-06T01:00:00Z" is Dec 5 in Bend).
  return machinePrintsDay(q, date);
}

/** Does a quote print the outing's start time ("1 to 3 pm" needs a 1 o'clock time)? */
export function quoteHasTime(quote: string, time: string): boolean {
  const q = quote.toLowerCase();
  if (/\bnoon\b/i.test(time)) return /\bnoon\b|\b12(:00)?\s*(p\.?m\.?)/.test(q);
  const hour = time.match(/\d{1,2}/)?.[0];
  if (!hour) return false;
  // Structured data prints 24-hour times after a date, read in Pacific
  // time ("…-05T13:00"; "…-05T21:00:00Z" is 1 pm).
  const pm = /p\.?m/i.test(time);
  const am = /a\.?m/i.test(time);
  if (pm || am) {
    const min = time.match(/\d{1,2}:(\d{2})/)?.[1] ?? "00";
    const h24 = (Number(hour) % 12) + (pm ? 12 : 0);
    if (machinePrintsTime(q, `${String(h24).padStart(2, "0")}:${min}`))
      return true;
  }
  return new RegExp(
    `\\b${hour}(:\\d{2})?\\s*(a\\.?m\\.?|p\\.?m\\.?|to\\b|-|until\\b)`,
  ).test(q);
}

const DAY_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Hour tokens in "10 am to 4 pm", "10:30am-6", "noon to 5". */
function hourTokens(text: string): number[] {
  const t = text.toLowerCase();
  const out: number[] = [];
  for (const m of t.matchAll(
    /\b(noon|\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/g,
  )) {
    if (m[1] === "noon") out.push(12);
    else {
      const h = Number(m[1]);
      if (h >= 1 && h <= 24) out.push(h % 12 || 12);
    }
  }
  return out;
}

/**
 * Does one segment of a quote cover this weekday ("Saturday", "Sat",
 * "Tue-Sat", "Monday through Friday", "daily", "weekends") and print both
 * the open and the close hour of `hours`?
 */
export function quoteHasHoursFor(
  quote: string,
  hours: string,
  date: string,
): boolean {
  const want = hourTokens(hours);
  if (want.length < 2) return false;
  const open = want[0];
  const close = want[want.length - 1];
  const wd = weekdayOf(date);
  const day = String.raw`(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?`;
  const covers = (seg: string) => {
    const s = seg.toLowerCase();
    if (/\b(daily|every day|7 days|seven days)\b/.test(s)) return true;
    if (/\bweekends?\b/.test(s) && (wd === 0 || wd === 6)) return true;
    if (/\bweekdays\b/.test(s) && wd >= 1 && wd <= 5) return true;
    for (const r of s.matchAll(
      new RegExp(`\\b${day}\\s*(?:-|–|—|to|through|thru)\\s*${day}`, "g"),
    )) {
      const a = DAY_ABBR.indexOf(r[1]);
      const b = DAY_ABBR.indexOf(r[2]);
      if (a <= b ? wd >= a && wd <= b : wd >= a || wd <= b) return true;
    }
    return new RegExp(`\\b${DAY_ABBR[wd]}[a-z]*\\.?(?![a-z])`).test(s);
  };
  return quote.split(/[;\n|]|\.\s+(?=[A-Z])/).some((seg) => {
    if (!covers(seg)) return false;
    const got = hourTokens(seg.replace(new RegExp(day, "gi"), " "));
    return got.includes(open) && got.includes(close);
  });
}

/**
 * Forecast numbers in the writer's words must be the plan's (weather-season
 * spec, validator rule 4): snow inches (near snow, ice or rain words) and
 * winds no higher than the plan has, an AQI the plan forecast or
 * observed, a high or low the forecast has (within a degree), and never a
 * certainty ("while 6 inches fall"). Other numbers ("42 inches tall",
 * "below 32 degrees") aren't forecasts and pass.
 */
export function weatherNumberProblems(
  text: string,
  plan: Plan | null | undefined,
): string[] {
  const out: string[] = [];
  const t = text.replace(/\u00a0/g, " ");
  const tiers = Object.values(plan?.weather.tiers?.towns ?? {}).flat();
  const maxSnow = Math.max(0, ...tiers.map((d) => d.snow_in));
  const maxWind = Math.max(
    0,
    ...tiers.map((d) => Math.max(d.gust_mph ?? 0, d.wind_mph ?? 0)),
  );
  const aqis = new Set(
    tiers.flatMap((d) =>
      [d.aqi, d.aqi_observed].filter((n): n is number => n != null),
    ),
  );
  const temps = [
    ...tiers.flatMap((d) => (d.high == null ? [] : [d.high])),
    ...(plan?.forecast?.days ?? []).flatMap((d) =>
      [d.high, d.low].filter((n): n is number => n != null),
    ),
  ];
  // One sentence at a time, so a number is judged by its own words.
  for (const sentence of t.split(/(?<=[.!?])\s+/)) {
    const weathery = /\b(snow|sleet|ice|icy|rain|freezing|accumulat\w*)\b/i;
    for (const m of sentence.matchAll(
      /(\d+(?:\.\d+)?)(?:\s*(?:to|-)\s*(\d+(?:\.\d+)?))?\s*(?:inch|inches|in\.)\b/gi,
    )) {
      const near = sentence.slice(
        Math.max(0, (m.index ?? 0) - 40),
        (m.index ?? 0) + m[0].length + 40,
      );
      if (!weathery.test(near)) continue;
      const hi = Number(m[2] ?? m[1]);
      if (hi > maxSnow)
        out.push(
          `"${m[0]}" of snow isn't in the plan's forecast (${maxSnow ? `up to ${maxSnow} inches` : "no snow amount"}).`,
        );
    }
    for (const m of sentence.matchAll(
      /(\d+)(?:\s*(?:to|-)\s*(\d+))?\s*mph\b/gi,
    )) {
      const hi = Number(m[2] ?? m[1]);
      if (hi > maxWind)
        out.push(
          `"${m[0]}" isn't in the plan's forecast (${maxWind ? `winds to ${maxWind} mph` : "no wind named"}).`,
        );
    }
    for (const m of sentence.matchAll(
      /\b(?:aqi|air quality(?: index)?(?: forecast)?)(?:\s+(?:of|is|at|near|was))?\s+(\d{2,3})\b/gi,
    ))
      if (!aqis.has(Number(m[1])))
        out.push(`AQI ${m[1]} isn't in the plan's air quality forecast.`);
    // Temperatures only next to forecast words: "a high of 31", "lows
    // near 18", "temperatures around 40", "forecast ... 95 degrees".
    const forecastWords =
      /\b(forecast|high|highs|low|lows|temperatures?|temps?)\b/i;
    for (const m of sentence.matchAll(
      /\b(?:high|low|temperature|temp)s?\s+(?:of|near|around|in the)\s+(-?\d{1,3})\b|(-?\d{1,3})\s*(?:°|degrees)/gi,
    )) {
      if (m[2] !== undefined && !forecastWords.test(sentence)) continue;
      const n = Number(m[1] ?? m[2]);
      if (temps.length && !temps.some((x) => Math.abs(x - n) <= 1))
        out.push(`${n}° isn't a high or low in the plan's forecast.`);
    }
  }
  if (
    /\b(while|as)\s+[^.]{0,20}\binch(es)?\b[^.]{0,20}\b(fall|falls|falling)\b|\binch(es)?\s+(will|is going to)\s+fall\b/i.test(
      t,
    )
  )
    out.push(
      'A forecast is a range, never a certainty: say "the forecast calls for 4 to 6 inches", not "while 6 inches fall".',
    );
  return out;
}

// --- The validator -------------------------------------------------------

export async function validateIssue(
  input: unknown,
  ctx: ValidateContext,
): Promise<ValidationReport> {
  const base = {
    checked_at: ctx.now.toISOString(),
    network: !!ctx.fetcher,
    warnings: [] as Finding[],
  };
  const parsed = IssueSchema.safeParse(input);
  if (!parsed.success)
    return {
      ...base,
      ok: false,
      issue_date:
        typeof (input as { issue_date?: unknown })?.issue_date === "string"
          ? (input as { issue_date: string }).issue_date
          : null,
      errors: parsed.error.issues.map((i) => ({
        rule: "schema",
        path: i.path.join(".") || "(issue)",
        message: i.message,
      })),
      dropped: [],
      words: 0,
      issue: null,
    };

  const issue = parsed.data;
  const { catalog, plan, history } = ctx;
  // An outing from a stored event may leave its evidence out: the event's
  // verified quotes stand in, and are fetched again like any other.
  const borrowed = new Map<number, string>();
  const lent = new Set<number>();
  (issue.weekend ?? []).forEach((w, i) => {
    if (w.evidence.length) return;
    const got = outingEventEvidence(w, ctx.eventData, ctx.now);
    if (typeof got === "string") borrowed.set(i, got);
    else {
      w.evidence = got;
      lent.add(i);
    }
  });
  const month = Number(issue.issue_date.slice(5, 7));
  const errors: Finding[] = [];
  const warnings = base.warnings;
  /** Problems per unit; a required unit's problems become errors. */
  const problems = new Map<string, Finding[]>();
  /** `unit` is a unit key: "subject", "plan_b", "weekend.1", ... */
  const flag = (unit: string, rule: Rule, message: string) =>
    problems.set(unit, [
      ...(problems.get(unit) ?? []),
      { rule, path: unit, message },
    ]);
  const units = issueUnits(issue);
  /** Image fetches that run alongside the link checks. */
  const imageChecks: Promise<void>[] = [];

  // The plan: code-made, stored, for this exact date.
  if (!plan) {
    errors.push({
      rule: "plan",
      path: "issue_date",
      message: "No plan for this date. GET /api/news/plan first.",
    });
  } else if (plan.issue_date !== issue.issue_date) {
    errors.push({
      rule: "plan",
      path: "issue_date",
      message: `The plan is for ${plan.issue_date}, not ${issue.issue_date}.`,
    });
  }
  if (plan?.calendar.skip)
    errors.push({
      rule: "dates",
      path: "issue_date",
      message: `No issue this week (${plan.calendar.skip}).`,
    });

  // Style: em dashes, banned phrases, first-person claims.
  for (const u of units)
    for (const t of u.texts)
      for (const m of styleProblems(t)) flag(u.key, "style", m);

  // Subject.
  if (EMOJI.test(issue.subject))
    flag("subject", "subject", "No emoji in the subject.");
  if (shouting(issue.subject) || issue.subject === issue.subject.toUpperCase())
    flag("subject", "subject", "No all-caps in the subject.");
  const recent = [...history].sort((a, b) =>
    b.issueDate.localeCompare(a.issueDate),
  );
  const norm = (s: string) => words(s).join(" ");
  for (const h of recent) {
    if (
      cooling(h.issueDate, issue.issue_date, LIMITS.subjectRepeatWeeks) &&
      norm(h.body.subject) === norm(issue.subject)
    )
      flag("subject", "subject", `Repeats the ${h.issueDate} subject.`);
  }
  for (const h of recent.slice(0, LIMITS.similarityWindow)) {
    const s = similarity(trigrams(h.body.subject), trigrams(issue.subject));
    if (s >= LIMITS.sectionSimilarity)
      flag(
        "subject",
        "subject",
        `Too close to the ${h.issueDate} subject ("${h.body.subject}").`,
      );
  }

  // The Wheel Pick: code spun it; the writer only writes about it.
  const wp = issue.wheel_pick.park;
  if (plan && plan.wheel_pick?.slug !== wp)
    flag(
      "wheel_pick",
      "plan",
      plan.wheel_pick
        ? `The Wheel Pick is ${plan.wheel_pick.slug}, from the plan. Write about that park.`
        : "The plan has no Wheel Pick this week.",
    );
  const park = ctx.parks.get(wp);
  if (!park) flag("wheel_pick", "catalog", `No park "${wp}" on the map.`);
  else if (park.status !== "active" || !park.approved || isClosedPark(wp))
    flag(
      "wheel_pick",
      "catalog",
      `${park.name} isn't open on the map right now.`,
    );
  if (
    cooling(
      lastUsed(history, "wheel").get(wp),
      issue.issue_date,
      COOLDOWN_WEEKS.wheel,
    )
  )
    flag(
      "wheel_pick",
      "cooldown",
      `${wp} was a Wheel Pick in the last ${COOLDOWN_WEEKS.wheel} weeks.`,
    );
  if (
    cooling(
      lastUsed(history, "featured").get(wp),
      issue.issue_date,
      COOLDOWN_WEEKS.featured,
    )
  )
    flag(
      "wheel_pick",
      "cooldown",
      `${wp} was featured in the last ${COOLDOWN_WEEKS.featured} weeks.`,
    );

  // The Indoor pick (plan_b kind venue): only when the plan's gate is
  // open, a venue from plan.indoor.venues, for a disruptive day, with its
  // hours quoted. Without the gate, plan_b is a clear-week "Best time to
  // go" tip.
  const gate = plan?.indoor?.open ?? false;
  if (issue.plan_b) {
    const pb = issue.plan_b;
    if (pb.kind === "venue") {
      const venue = catalog.venues.find((v) => v.id === pb.venue_id);
      const offered = plan?.indoor?.venues ?? [];
      if (!gate)
        flag(
          "plan_b",
          "plan",
          "No counted day is disruptive this week, so there's no Indoor pick. Use a Best time to go tip, or leave it out.",
        );
      else if (!pb.venue_id || !venue)
        flag("plan_b", "catalog", `Unknown venue "${pb.venue_id ?? ""}".`);
      else if (!venue.verified)
        flag(
          "plan_b",
          "catalog",
          `${venue.name} isn't verified in the catalog.`,
        );
      else if (!offered.some((v) => v.id === venue.id))
        flag(
          "plan_b",
          "plan",
          `${venue.name} isn't one of this week's Indoor pick venues (plan.indoor.venues).`,
        );
      if (gate) {
        // The third pick in a row is one line: only the venue and its day
        // are printed, so only those are required.
        const short = plan?.indoor?.short ?? false;
        if (
          !pb.for_day ||
          (!short && (!pb.why_kids || !pb.hours || !pb.cost || !pb.tip))
        )
          flag(
            "plan_b",
            "schema",
            short
              ? "A short Indoor pick needs for_day."
              : "An Indoor pick needs for_day, why_kids, hours, cost and tip.",
          );
        if (pb.for_day && pb.for_day !== plan?.indoor?.for_day)
          flag(
            "plan_b",
            "plan",
            `The Indoor pick is for ${plan?.indoor?.for_day ?? "no day"} (plan.indoor.for_day), not ${pb.for_day}.`,
          );
        // Open: that day's hours, open and close, in one quote that names
        // the day (or a range or "daily" that covers it).
        const quotes = pb.evidence.map((e) => e.quote);
        if (
          !short &&
          pb.hours &&
          pb.for_day &&
          !quotes.some((q) => quoteHasHoursFor(q, pb.hours!, pb.for_day!))
        )
          flag(
            "plan_b",
            "evidence",
            "The Open line's hours (open and close) must appear in an evidence quote from the venue's own page that names that day.",
          );
        if (
          !short &&
          pb.cost &&
          !/^free\.?$/i.test(pb.cost.trim()) &&
          !priceClaims(pb.cost).length
        )
          flag(
            "plan_b",
            "evidence",
            `The cost "${pb.cost}" names no price. Use a printed price or "Free".`,
          );
      }
    } else {
      if (gate)
        flag(
          "plan_b",
          "plan",
          "A counted day is disruptive, so this week needs an Indoor pick, not a Best time to go tip.",
        );
      if (!pb.title || !pb.text)
        flag(
          "plan_b",
          "schema",
          "A Best time to go tip needs a title and text.",
        );
      if (pb.tip_id) {
        const tip = catalog.tips.find((t) => t.id === pb.tip_id);
        if (!tip || !tip.verified)
          flag(
            "plan_b",
            "catalog",
            `Unknown or unverified tip "${pb.tip_id}".`,
          );
        else if (
          !freeItems(catalog.tips, history, issue.issue_date, "tip").some(
            (t) => t.id === tip.id,
          )
        )
          flag(
            "plan_b",
            "cooldown",
            `Tip ${tip.id} ran in the last ${COOLDOWN_WEEKS.tip} weeks or is out of season.`,
          );
      }
    }
  }

  // Dress for it / Good to know: only on a plan-around weekend, with a
  // free tip that matches its trigger.
  if (issue.dress) {
    const offered = plan?.dress?.tips ?? [];
    if (!offered.length)
      flag(
        "dress",
        "plan",
        "No counted day is plan-around this week, so there's no dress line.",
      );
    else if (!offered.some((t) => t.id === issue.dress?.tip_id))
      flag(
        "dress",
        "cooldown",
        `Tip ${issue.dress.tip_id} isn't one of this week's dress tips (plan.dress.tips): unknown, cooling down or off-trigger.`,
      );
  }

  // Forecast numbers in the words match the plan (amounts are ranges:
  // never a number the plan doesn't have, never a certainty).
  for (const u of units)
    for (const t of u.texts)
      for (const m of weatherNumberProblems(t, plan)) flag(u.key, "weather", m);

  // When the gate is open, the opener names the disruptive day.
  if (gate && plan) {
    const names = plan.weather.bad_days.map((d) => DAYS[weekdayOf(d)]);
    const hello = issue.hello.text.toLowerCase();
    if (!names.some((n) => hello.includes(n)))
      flag(
        "hello",
        "weather",
        `The opener must name the disruptive day (${names.map((n) => n[0].toUpperCase() + n.slice(1)).join(" or ")}).`,
      );
  }

  // December to February: no cold words in the subject unless a day is
  // disruptive.
  if (
    (month === 12 || month <= 2) &&
    !gate &&
    WINTER_SUBJECT_WORDS.test(issue.subject)
  )
    flag(
      "subject",
      "subject",
      "From December to February the subject can't say cold, chilly, freezing or bundle unless a day is disruptive.",
    );

  // Outing balance: This weekend holds at most one indoor outing (two with
  // an Indoor pick), and never the pick's own venue.
  {
    const indoorNames = catalog.venues.map((v) => v.name.toLowerCase());
    const pickName =
      issue.plan_b?.kind === "venue"
        ? catalog.venues
            .find((v) => v.id === issue.plan_b?.venue_id)
            ?.name.toLowerCase()
        : undefined;
    const max = gate ? 2 : 1;
    let n = 0;
    (issue.weekend ?? []).forEach((w, i) => {
      const where = `${w.name} ${w.place}`.toLowerCase();
      const hit = indoorNames.find((v) => where.includes(v));
      if (!hit) return;
      if (pickName && hit === pickName)
        flag(
          `weekend.${i}`,
          "plan",
          "This outing is at the Indoor pick's own venue. Pick another.",
        );
      else if (++n > max)
        flag(
          `weekend.${i}`,
          "plan",
          `This weekend holds at most ${max} indoor outing${max > 1 ? "s" : ""}.`,
        );
    });
  }

  // Heads up: changes on our own map since the last issue, never the
  // seasonal default.
  const changes = new Map(plan?.deltas.changes.map((c) => [c.id, c]) ?? []);
  (issue.heads_up ?? []).forEach((h, i) => {
    const key = `heads_up.${i}`;
    if (h.kind === "park_change") {
      const c = h.change_id ? changes.get(h.change_id) : undefined;
      if (!c)
        flag(
          key,
          "plan",
          "A park change must be one of the plan's deltas (change_id).",
        );
      else if (c.park !== h.park)
        flag(key, "plan", `Change ${c.id} is about ${c.park}, not ${h.park}.`);
    } else
      flag(
        key,
        "plan",
        "Heads up never includes parks new to the map: that's a data change, not news.",
      );
    if (NEW_ON_MAP.test(h.text))
      flag(
        key,
        "plan",
        'Heads up is only for changes that affect a visit, never "new park" or "added to the map".',
      );
    if (!ctx.parks.has(h.park))
      flag(key, "catalog", `No park "${h.park}" on the map.`);
    const d = seasonalDefault(h.text, month, catalog.seasonal_defaults);
    if (d)
      flag(
        key,
        "seasonal",
        `That's the usual seasonal state, not news (${d.label}).`,
      );
  });

  // This weekend: Friday to Sunday of this week, from the catalog or real pages.
  const wk = weekendOf(issue.issue_date);
  const featuredLast = lastUsed(history, "featured");
  const freeSeries = new Set(
    freeItems(catalog.event_series, history, issue.issue_date, "series").map(
      (s) => s.id,
    ),
  );
  (issue.weekend ?? []).forEach((w, i) => {
    const key = `weekend.${i}`;
    const noEvidence = borrowed.get(i);
    if (noEvidence) flag(key, "evidence", noEvidence);
    // Borrowed quotes passed the events rule when the event was stored.
    for (const e of lent.has(i) ? [] : w.evidence)
      if (!shortQuoteOk(e.quote, w.day))
        flag(
          key,
          "evidence",
          `The quote "${e.quote}" is too short: 20 characters, or 8 with a price or "free" and a date or time.`,
        );
    if (w.day < wk.from || w.day > wk.to)
      flag(
        key,
        "dates",
        `${w.day} isn't this weekend (${wk.from} to ${wk.to}).`,
      );
    if (w.series_id) {
      const s = catalog.event_series.find((x) => x.id === w.series_id);
      if (!s || !s.verified)
        flag(
          key,
          "catalog",
          `Unknown or unverified event series "${w.series_id}".`,
        );
      else if (!freeSeries.has(s.id))
        flag(
          key,
          "cooldown",
          `${s.name} ran in the last ${COOLDOWN_WEEKS.series} weeks or is out of season.`,
        );
    }
    if (w.park) {
      const p = ctx.parks.get(w.park);
      if (!p) flag(key, "catalog", `No park "${w.park}" on the map.`);
      else if (p.status !== "active" || isClosedPark(w.park))
        flag(key, "catalog", `${p.name} isn't open on the map.`);
      if (w.park === wp)
        flag(key, "cooldown", "Already the Wheel Pick this week.");
      else if (
        cooling(
          featuredLast.get(w.park),
          issue.issue_date,
          COOLDOWN_WEEKS.featured,
        )
      )
        flag(
          key,
          "cooldown",
          `${w.park} was featured in the last ${COOLDOWN_WEEKS.featured} weeks.`,
        );
    }
    // Evidence: one quote must print the day (or date) and the start time;
    // every price claim, "free" included, must be printed in a quote.
    const quotes = w.evidence.map((e) => e.quote);
    // Ages: only the words printed on the page; code makes the tags.
    if (w.ages)
      flag(
        key,
        "schema",
        'Use ages_text: the age words as printed on the page ("Ages 5 and under"). Code makes the age tags.',
      );
    if (w.ages_text) {
      const norm = (x: string) => normalizeText(x).toLowerCase();
      const a = ageTags(w.ages_text);
      if (!quotes.some((q) => norm(q).includes(norm(w.ages_text!))))
        flag(
          key,
          "evidence",
          `The ages "${w.ages_text}" must appear word for word in an evidence quote.`,
        );
      else if (!a)
        flag(
          key,
          "evidence",
          `"${w.ages_text}" doesn't say an age we can read.`,
        );
      else if (!a.kids)
        flag(key, "evidence", `Not a kids' outing ("${w.ages_text}").`);
    }
    if (w.event && ctx.events && !ctx.events.has(w.event))
      flag(key, "catalog", `No event page "${w.event}" on /events.`);
    // The cost is a price or "free", from the page. "Check the page for
    // prices" isn't a cost: with no price printed, the outing goes.
    if (!priceClaims([w.cost]).length)
      flag(
        key,
        "evidence",
        `The cost "${w.cost}" names no price. With no price printed on the page, leave this outing out.`,
      );
    for (const claim of priceClaims([w.cost, w.what]))
      if (
        !quotesPrice(quotes, claim) &&
        // A listing's bare "Free" next to the outing's date counts (the
        // events rule: "Free · Dec 6").
        !(
          claim === "free" &&
          quotes.some((q) => BARE_FREE.test(q) && quoteHasDay(q, w.day))
        )
      )
        flag(
          key,
          "evidence",
          `The price claim "${claim}" must appear in an evidence quote.`,
        );
    if (!quotes.some((q) => quoteHasDay(q, w.day) && quoteHasTime(q, w.time)))
      flag(
        key,
        "evidence",
        "One evidence quote must show both the day or date and the time, as printed.",
      );
  });

  // Primary source: an outing's link and its evidence come from the same
  // site, so the link goes to the page that proved the facts. (Heads up
  // items are changes on our own map: no outside links.)
  (issue.weekend ?? []).forEach((w, i) => {
    // dpl.libnet.info is the library, hdm.mux.earth the museum.
    const org = (u: string) => {
      const s = siteOf(u, [
        ...catalog.link_domains,
        ...(catalog.evidence_domains ?? []),
      ]);
      return catalog.site_aliases?.[s] ?? s;
    };
    const site = org(w.url);
    for (const e of w.evidence)
      if (org(e.url) !== site)
        flag(
          `weekend.${i}`,
          "evidence",
          `The evidence (${host(e.url)}) must come from the same site as the link (${host(w.url)}).`,
        );
  });

  // Price claims in Plan B need evidence too.
  if (issue.plan_b) {
    const quotes = issue.plan_b.evidence.map((e) => e.quote);
    // A free catalog venue (a library) may just say "Free".
    const freeVenue =
      catalog.venues.find((v) => v.id === issue.plan_b?.venue_id)?.cost ===
        "free" && /^free\.?$/i.test(issue.plan_b.cost?.trim() ?? "");
    for (const claim of priceClaims(
      [issue.plan_b.text, freeVenue ? undefined : issue.plan_b.cost].filter(
        (t): t is string => !!t,
      ),
    ))
      if (!quotesPrice(quotes, claim))
        flag(
          "plan_b",
          "evidence",
          `The price claim "${claim}" must appear in an evidence quote.`,
        );
  }

  // The featured park's photo: Bend Park & Recreation District's own
  // site (credited to BPRD), or Wikimedia Commons (openly licensed,
  // credited to the author). Anything else is cut, and the email falls
  // back to the park's crayon card.
  const photo = issue.wheel_pick.photo;
  const kind = photo ? photoSource(photo.src) : null;
  if (photo && !kind)
    flag(
      "photo",
      "links",
      "Photos come from bendparksandrec.org or upload.wikimedia.org only.",
    );
  if (
    photo &&
    kind === "bprd" &&
    !/^\/park\/[a-z0-9-]+\/?$/.test(path(photo.sourceUrl))
  )
    flag(
      "photo",
      "links",
      "sourceUrl must be the park's page on bendparksandrec.org (/park/...).",
    );
  if (
    photo &&
    kind === "bprd" &&
    !/(^|\.)bendparksandrec\.org$/.test(host(photo.sourceUrl))
  )
    flag("photo", "links", "sourceUrl must be on bendparksandrec.org.");
  if (photo && kind === "wikimedia") {
    if (host(photo.sourceUrl) !== "commons.wikimedia.org")
      flag(
        "photo",
        "links",
        "The photo's sourceUrl must be its commons.wikimedia.org page.",
      );
    if (!photo.author)
      flag("photo", "catalog", "A Commons photo needs its author.");
    if (!photo.license || !PHOTO_LICENSE.test(photo.license.trim()))
      flag(
        "photo",
        "catalog",
        `License "${photo.license ?? ""}" isn't CC0, PD, CC BY or CC BY-SA.`,
      );
    if (
      !photo.licenseUrl ||
      !/(^|\.)(creativecommons\.org|wikimedia\.org|wikipedia\.org)$/.test(
        host(photo.licenseUrl),
      )
    )
      flag(
        "photo",
        "links",
        "licenseUrl must point to the license (creativecommons.org or Wikimedia).",
      );
  }
  // At send time the image itself must answer 200 as an image.
  if (photo && kind && ctx.fetcher) {
    const src = photo.src;
    const f = ctx.fetcher;
    imageChecks.push(
      f(src, SECTION_DOMAINS.photo).then(
        (r) => {
          if (r.status !== 200 || !(r.contentType ?? "").startsWith("image/"))
            flag(
              "photo",
              "links",
              `The photo answered ${r.status} ${r.contentType ?? ""}, not an image.`,
            );
        },
        () => {
          flag("photo", "links", "The photo didn't answer.");
        },
      ),
    );
  }

  // Parents' corner: an X post from the plan's candidates (or a TikTok
  // video), fetched by code as it is now. Its snapshot is code's, never
  // the writer's.
  const meme = issue.meme;
  let memeSnap: MemeSnapshot | null = null;
  let memeFallback: MemeSnapshot | null = null;
  if (meme) {
    const igPick = (plan?.parents_corner?.instagram ?? []).find(
      (c) => c.id === meme.postId,
    );
    if (
      meme.platform === "x" &&
      !(plan?.parents_corner?.candidates ?? []).some(
        (c) => c.id === meme.postId,
      )
    )
      flag("meme", "plan", "An X post must be one of the plan's candidates.");
    else if (
      meme.platform === "instagram" &&
      (!igPick || igPick.username !== meme.account)
    )
      flag(
        "meme",
        "plan",
        "An Instagram post must be one of the plan's candidates, with its account.",
      );
    else if (ctx.memeSource) {
      memeSnap = await ctx.memeSource(meme).catch(() => null);
      if (meme.platform === "instagram") {
        const fb = await ctx.memeFallback?.().catch(() => null);
        if (memeSnap) memeFallback = fb ?? null;
        else if (fb) {
          // The Instagram post is gone: the X stand-in goes instead.
          memeSnap = fb;
          warnings.push({
            rule: "links",
            path: "meme",
            message:
              "The Instagram post is gone, so the X post drafted with it goes instead.",
          });
        }
      }
      if (!memeSnap)
        flag(
          "meme",
          "links",
          "The post is gone, private, flagged or has no cover now.",
        );
      else if (
        meme.platform === "x" &&
        memeSnap.kind === "x" &&
        memeSnap.likes < LIKES_FLOOR
      )
        flag("meme", "plan", `Under ${LIKES_FLOOR} likes.`);
    } else
      warnings.push({
        rule: "links",
        path: "meme",
        message:
          "Quick check: the post wasn't fetched. The sender will fetch it.",
      });
  }

  // The passport challenge.
  const ch = catalog.challenges.find(
    (c) => c.id === issue.passport.challenge_id,
  );
  if (!ch || !ch.verified)
    flag(
      "passport",
      "catalog",
      `Unknown challenge "${issue.passport.challenge_id}".`,
    );
  else if (
    !freeItems(catalog.challenges, history, issue.issue_date, "challenge").some(
      (c) => c.id === ch.id,
    )
  )
    flag(
      "passport",
      "cooldown",
      `${ch.title} ran in the last ${COOLDOWN_WEEKS.challenge} weeks or is out of season.`,
    );

  // Similarity to the last 8 sent issues, section by section.
  const window = recent.slice(0, LIMITS.similarityWindow);
  const past = window.flatMap((h) =>
    issueUnits(h.body)
      .filter((u) => u.key !== "signoff" && u.key !== "subject")
      .map((u) => ({ date: h.issueDate, grams: trigrams(u.texts.join(" ")) })),
  );
  for (const u of units) {
    if (u.key === "signoff" || u.key === "subject") continue;
    const grams = trigrams(u.texts.join(" "));
    if (grams.size < 4) continue;
    for (const p of past) {
      const s = similarity(grams, p.grams);
      if (s >= LIMITS.sectionSimilarity) {
        flag(
          u.key,
          "similarity",
          `Reads too much like the ${p.date} issue (${Math.round(s * 100)}% overlap).`,
        );
        break;
      }
    }
  }

  // Links: on the allowlist, and (with the network) answering 200.
  const pages = new Map<string, Promise<FetchResult | null>>();
  const fetchOnce = (url: string, domains: readonly string[]) => {
    if (!pages.has(url))
      pages.set(
        url,
        ctx.fetcher!(url, domains).catch(() => null),
      );
    return pages.get(url)!;
  };
  // Our own site is never evidence. Links to it are fetched like any
  // other, except the ones code makes (park pages, the passport, issues).
  const siteHost = host(ctx.site);
  const ours = (url: string) => {
    const h = host(url);
    return (
      h === siteHost ||
      h === "parkroulette.quest" ||
      h.endsWith(".parkroulette.quest")
    );
  };
  const codeLink = (url: string) =>
    ours(url) &&
    /^\/(parks\/[a-z0-9-]+\/?$|passport\/?$|news\/issues\/|texts(\/|$)|newsletter(\/|$))/.test(
      path(url),
    );
  const venueUrl =
    issue.plan_b?.kind === "venue"
      ? catalog.venues.find((v) => v.id === issue.plan_b?.venue_id)?.url
      : undefined;
  const checks: Promise<void>[] = [];
  const namesFor = (key: string, texts: string[]) =>
    eventTitleNames(key, texts, issue.weekend, ctx.eventData);
  for (const u of units) {
    const domains = [
      ...catalog.link_domains,
      ...(SECTION_DOMAINS[u.key] ?? []),
    ];
    const urls = [
      ...u.urls,
      ...u.evidence.map((e) => e.url),
      ...(u.key === "plan_b" && venueUrl ? [venueUrl] : []),
    ];
    // Another newsletter is never a link, evidence or a photo source.
    for (const url of new Set([...urls, ...u.evidence.map((e) => e.url)]))
      if (blockedLink(url))
        flag(
          u.key,
          "links",
          `${host(url)} is another newsletter. Link the primary source.`,
        );
    for (const e of u.evidence)
      if (ours(e.url))
        flag(
          u.key,
          "evidence",
          "Our own site can't be evidence. Quote the organizer's page.",
        );
    // A data host (the organizer's page loads its facts from it) is
    // evidence only, on the organizer's own paths.
    const evidenceOnly = catalog.evidence_domains ?? [];
    for (const url of new Set(u.urls)) {
      const d = onList(url, evidenceOnly);
      if (d)
        flag(
          u.key,
          "links",
          `${d} is a data host: evidence only. Link the organizer's page.`,
        );
    }
    for (const e of u.evidence) {
      const a = aliasPathProblem(e.url, catalog.alias_paths);
      if (a.problem) flag(u.key, "evidence", a.problem);
    }
    const evDomains = [...domains, ...evidenceOnly];
    for (const url of new Set(urls)) {
      if (codeLink(url)) continue;
      const lead = onList(url, catalog.lead_domains ?? []);
      if (lead) {
        flag(u.key, "links", leadMessage(lead));
        continue;
      }
      if (
        !ours(url) &&
        !allowedLink(url, u.urls.includes(url) ? domains : evDomains)
      ) {
        flag(
          u.key,
          "links",
          `${new URL(url).hostname} isn't on the link allowlist.`,
        );
        continue;
      }
      if (!ctx.fetcher) continue;
      checks.push(
        fetchOnce(
          url,
          ours(url) ? [siteHost, "parkroulette.quest"] : evDomains,
        ).then((r) => {
          if (!r) flag(u.key, "links", `${url} didn't answer.`);
          else if (r.status !== 200)
            flag(
              u.key,
              "links",
              r.blocked
                ? `${host(url)} shows ${r.blocked} instead of the page. Use another official page.`
                : r.unreachable
                  ? `${host(url)} didn't answer (${r.unreachable}).`
                  : `${url} answered ${r.status}, not 200.`,
            );
          else if (!ours(r.finalUrl) && !allowedLink(r.finalUrl, evDomains))
            flag(u.key, "links", `${url} redirects off the allowlist.`);
        }),
      );
    }
    if (!ctx.fetcher) continue;
    for (const e of u.evidence) {
      if (ours(e.url) || !allowedLink(e.url, evDomains)) continue;
      checks.push(
        fetchOnce(e.url, evDomains).then((r) => {
          if (r?.status !== 200) return; // already flagged as a link
          const q = normalizeText(e.quote);
          // Page text, or the organizer's structured data (JSON-LD, JSON, .ics).
          // A data line counts only when it names the item (its first
          // text: the outing's name, the venue pick's words).
          if (
            !r.text.includes(q) &&
            !dataHasQuote(r.data, q, namesFor(u.key, u.texts))
          )
            flag(
              u.key,
              "evidence",
              `The quote "${e.quote.slice(0, 60)}" isn't on ${e.url} anymore.`,
            );
        }),
      );
    }
  }
  await Promise.all([...checks, ...imageChecks]);
  if (!ctx.fetcher)
    warnings.push({
      rule: "links",
      path: "(issue)",
      message:
        "Quick check: links and evidence weren't fetched. The sender will fetch them.",
    });

  // Decide: required units fail the issue; anything else is cut.
  const required = new Map(units.map((u: Unit) => [u.key, u.required]));
  const dropped: Finding[] = [];
  const cut = new Set<string>();
  for (const [key, list] of problems) {
    if (required.get(key)) errors.push(...list);
    else {
      dropped.push(...list);
      cut.add(key);
    }
  }
  // The weekend ahead comes from the plan, never the writer, and is frozen
  // into the issue so the archive and its weather card never change.
  const forecast = plan?.forecast?.days;
  const given = issue.weekend_ahead?.days;
  if (given && JSON.stringify(given) !== JSON.stringify(forecast))
    warnings.push({
      rule: "plan",
      path: "weekend_ahead.days",
      message: "The forecast comes from the plan; the one sent was replaced.",
    });
  // With the gate open, the Indoor pick is required (unless the plan had
  // no venue at all): a cut or missing one fails the issue.
  if (
    gate &&
    (plan?.indoor?.venues.length ?? 0) > 0 &&
    (cut.has("plan_b") || issue.plan_b?.kind !== "venue")
  )
    (ctx.stage === "send" ? warnings : errors).push({
      rule: "plan",
      path: "plan_b",
      message:
        ctx.stage === "send"
          ? "The Indoor pick didn't check out at send time, so it was dropped; the rest of the issue goes."
          : "A counted day is disruptive, so the issue needs its Indoor pick (plan.indoor.venues).",
    });
  const trimmed = withoutUnits(issue, cut);
  const cleaned: Issue = {
    ...trimmed,
    meme:
      trimmed.meme && memeSnap
        ? {
            platform: memeSnap.kind,
            postId: memeSnap.id,
            url: memeLink(memeSnap),
            ...(memeSnap.kind === "instagram"
              ? { account: memeSnap.username }
              : {}),
            snapshot: memeSnap,
            ...(memeFallback ? { fallback: memeFallback } : {}),
          }
        : // Without the network the writer's snapshot never survives.
          trimmed.meme && { ...trimmed.meme, snapshot: undefined },
    weekend_ahead:
      forecast || trimmed.weekend_ahead?.note
        ? { days: forecast, note: trimmed.weekend_ahead?.note }
        : undefined,
    // Code's parts of the Indoor pick, frozen from the plan.
    plan_b:
      trimmed.plan_b?.kind === "venue" && plan?.indoor?.open
        ? {
            ...trimmed.plan_b,
            closer_to_home: plan.indoor.closer_to_home.length
              ? plan.indoor.closer_to_home
              : undefined,
            short: plan.indoor.short || undefined,
          }
        : trimmed.plan_b,
  };

  // Whole-issue checks, on what would actually go out.
  const text = issueText(cleaned);
  const n = wordCount(text);
  if (n > LIMITS.wordsMax)
    errors.push({
      rule: "length",
      path: "(issue)",
      message: `${n} words. Keep it to ${LIMITS.wordsMax}.`,
    });
  else if (n < LIMITS.wordsMin)
    errors.push({
      rule: "length",
      path: "(issue)",
      message: `Only ${n} words after cuts. Too thin to send.`,
    });
  else if (n < LIMITS.wordsTarget[0])
    warnings.push({
      rule: "length",
      path: "(issue)",
      message: `${n} words. The target is ${LIMITS.wordsTarget[0]} to ${LIMITS.wordsTarget[1]}.`,
    });
  const bangs = (
    `${cleaned.subject} ${cleaned.preview} ${text}`.match(/!/g) ?? []
  ).length;
  if (bangs > LIMITS.exclamations)
    errors.push({
      rule: "style",
      path: "(issue)",
      message: `${bangs} exclamation points. One at most.`,
    });
  if (cleaned.weekend && cleaned.weekend.length < 2)
    warnings.push({
      rule: "dates",
      path: "weekend",
      message: "Only one outing left this weekend.",
    });
  if (issue.weekend && !cleaned.weekend)
    warnings.push({
      rule: "dates",
      path: "weekend",
      message: "Every weekend outing was cut, so the section drops.",
    });

  // The subject must name something that's still in the body.
  const body = words(issueText({ ...cleaned, subject: "" }));
  const bodyWords = new Set(body);
  const named = words(cleaned.subject).filter(
    (w) => w.length >= 4 && !STOP.has(w),
  );
  if (
    named.length &&
    !named.some((w) => bodyWords.has(w) || bodyWords.has(w.replace(/s$/, "")))
  )
    errors.push({
      rule: "subject",
      path: "subject",
      message: "The subject must name something in the issue.",
    });

  const whole = trigrams(text);
  for (const h of window) {
    const s = similarity(whole, trigrams(issueText(h.body)));
    if (s >= LIMITS.issueSimilarity)
      errors.push({
        rule: "similarity",
        path: "(issue)",
        message: `Reads too much like the ${h.issueDate} issue (${Math.round(s * 100)}% overlap).`,
      });
  }

  return {
    ...base,
    ok: errors.length === 0,
    issue_date: issue.issue_date,
    errors,
    dropped,
    words: n,
    issue: cleaned,
  };
}
