import {
  allowedLink,
  type Catalog,
  seasonalDefault,
  type WeatherLabel,
} from "./catalog";
import {
  COOLDOWN_WEEKS,
  cooling,
  freeItems,
  lastUsed,
  planBVenues,
  type SentIssue,
} from "./cooldowns";
import {
  type Issue,
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
};
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
const MENTIONS = /\b(the\s+)?bend\s+(family\s+loop|buzz)\b/i;

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

/** An HTML page as plain text (scripts and styles removed). */
export function pageText(html: string): string {
  return normalizeText(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|td|tr)>/gi, " ")
      .replace(/<[^>]+>/g, ""),
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
  return new RegExp(`\\b${m}/${d}(?!\\d)`).test(q);
}

/** Does a quote print the outing's start time ("1 to 3 pm" needs a 1 o'clock time)? */
export function quoteHasTime(quote: string, time: string): boolean {
  const q = quote.toLowerCase();
  if (/\bnoon\b/i.test(time)) return /\bnoon\b|\b12(:00)?\s*(p\.?m\.?)/.test(q);
  const hour = time.match(/\d{1,2}/)?.[0];
  if (!hour) return false;
  return new RegExp(
    `\\b${hour}(:\\d{2})?\\s*(a\\.?m\\.?|p\\.?m\\.?|to\\b|-|until\\b)`,
  ).test(q);
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
  else if (park.status !== "active" || !park.approved)
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

  // Plan B: a catalog venue that fits the weather, with the relaxed cooldown.
  if (issue.plan_b) {
    const pb = issue.plan_b;
    const bad = (
      plan?.weather.bad_days.length ? plan.weather.labels : []
    ) as WeatherLabel[];
    if (pb.kind === "venue") {
      const venue = catalog.venues.find((v) => v.id === pb.venue_id);
      if (!pb.venue_id || !venue)
        flag("plan_b", "catalog", `Unknown venue "${pb.venue_id ?? ""}".`);
      else if (!venue.verified)
        flag(
          "plan_b",
          "catalog",
          `${venue.name} isn't verified in the catalog.`,
        );
      else {
        const { weeks, eligible } = planBVenues(
          catalog,
          history,
          issue.issue_date,
          bad,
        );
        if (!eligible.some((v) => v.id === venue.id))
          flag(
            "plan_b",
            "cooldown",
            `${venue.name} isn't eligible this week (cooldown ${weeks ?? "none fits"} weeks, or it doesn't fit the weather or month).`,
          );
      }
    } else {
      if (bad.length)
        flag(
          "plan_b",
          "plan",
          "The weekend has bad weather, so Plan B must be an indoor or covered venue.",
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
      else if (p.status !== "active")
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
      if (!quotesPrice(quotes, claim))
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
    const site = siteOf(w.url, catalog.link_domains);
    for (const e of w.evidence)
      if (siteOf(e.url, catalog.link_domains) !== site)
        flag(
          `weekend.${i}`,
          "evidence",
          `The evidence (${host(e.url)}) must come from the same site as the link (${host(w.url)}).`,
        );
  });

  // Price claims in Plan B need evidence too.
  if (issue.plan_b) {
    const quotes = issue.plan_b.evidence.map((e) => e.quote);
    for (const claim of priceClaims(issue.plan_b.text))
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
    for (const url of new Set(urls)) {
      if (codeLink(url)) continue;
      if (!ours(url) && !allowedLink(url, domains)) {
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
          ours(url) ? [siteHost, "parkroulette.quest"] : domains,
        ).then((r) => {
          if (!r) flag(u.key, "links", `${url} didn't answer.`);
          else if (r.status !== 200)
            flag(
              u.key,
              "links",
              r.blocked
                ? `${host(url)} shows ${r.blocked} instead of the page. Use another official page.`
                : `${url} answered ${r.status}, not 200.`,
            );
          else if (!ours(r.finalUrl) && !allowedLink(r.finalUrl, domains))
            flag(u.key, "links", `${url} redirects off the allowlist.`);
        }),
      );
    }
    if (!ctx.fetcher) continue;
    for (const e of u.evidence) {
      if (ours(e.url) || !allowedLink(e.url, domains)) continue;
      checks.push(
        fetchOnce(e.url, domains).then((r) => {
          if (r?.status !== 200) return; // already flagged as a link
          if (!r.text.includes(normalizeText(e.quote)))
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
