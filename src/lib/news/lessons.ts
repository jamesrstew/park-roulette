import { createHash } from "node:crypto";
import { z } from "zod";
import { isIsoDate } from "./time";
import { BLOCKED_DOMAINS } from "./validate";

/**
 * The writer's self-improvement loop, the pure half: the retro a routine
 * POSTs at the end of every run, how its problems become lessons, and how
 * a repeat finds the lesson it repeats (exact fingerprint first, then
 * word-trigram similarity). No database here; lessons-store.ts does the
 * storing, under one advisory lock.
 */

export const LESSON_CATEGORIES = [
  "validator",
  "source",
  "data",
  "rule_conflict",
  "idea",
] as const;
export type LessonCategory = (typeof LESSON_CATEGORIES)[number];

export const LESSON_STATUSES = [
  "open",
  "needs_james",
  "fix_proposed",
  "fixed",
  "wontfix",
] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/** Statuses the plan and the fuzzy match look at. */
export const LIVE_STATUSES: readonly LessonStatus[] = [
  "open",
  "needs_james",
  "fix_proposed",
];

/** The only status automation may give a compliance lesson: James decides. */
export const COMPLIANCE_STATUSES: readonly LessonStatus[] = ["needs_james"];

/** A score at or over this merges a problem into a lesson. */
export const MERGE_AT = 0.55;
/** The plan carries lessons seen in the last 8 weeks, 20 at most. */
export const PLAN_LESSON_DAYS = 56;
export const PLAN_LESSON_MAX = 20;
/** Examples kept per lesson. */
export const EXAMPLES_KEPT = 10;

const Day = z
  .string()
  .refine((d) => isIsoDate(d), "Use a real date, YYYY-MM-DD");
const Str = (max: number, min = 1) => z.string().trim().min(min).max(max);
const Https = z.url({ protocol: /^https?$/ }).max(500);

export const BLOCKED_KINDS = [
  "bot_check",
  "reset",
  "timeout",
  "http_status",
  "not_allowlisted",
] as const;

/** What a rule change is about (events-harvest.md §6 lists them). */
export const RULE_TARGETS = [
  "validator",
  "command",
  "catalog",
  "plan",
] as const;

export const RetroSchema = z.strictObject({
  run: z.strictObject({
    kind: z.enum(["writer", "events", "maintainer", "social"]),
    issue_date: Day.optional(),
    /** The social routine's week (its Monday). */
    week_of: Day.optional(),
    session: Str(120).optional(),
  }),
  problems: z
    .array(
      z.strictObject({
        category: z.enum(LESSON_CATEGORIES),
        title: Str(120, 8),
        detail: Str(600, 20),
        /** The validator message or the command section it's about. */
        rule: Str(300).optional(),
        /** A sighting of a lesson from the plan: merged into it, by id. */
        lesson_id: z.number().int().positive().optional(),
        examples: z
          .array(
            z.strictObject({
              url: Https.optional(),
              message: Str(300).optional(),
            }),
          )
          .max(5)
          .optional(),
      }),
    )
    .max(20)
    .default([]),
  blocked_hosts: z
    .array(
      z.strictObject({
        host: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)
          .max(120),
        kind: z.enum(BLOCKED_KINDS),
        status: z.number().int().min(0).max(999).optional(),
        url: Https,
      }),
    )
    .max(20)
    .default([]),
  rule_changes: z
    .array(
      z.strictObject({
        target: z.preprocess(
          // The routines call the validator "the checker" (Nov 22 retro).
          (v) => (v === "checker" ? "validator" : v),
          z.enum(RULE_TARGETS),
        ),
        section: Str(80),
        current: Str(300),
        proposed: Str(300),
        why: Str(300),
      }),
    )
    .max(10)
    .default([]),
});
export type Retro = z.infer<typeof RetroSchema>;

export type Example = { url?: string; message?: string; at: string };

/** One problem from a retro, ready to match or become a lesson. */
export type Candidate = {
  category: LessonCategory;
  title: string;
  detail: string;
  host: string | null;
  fingerprint: string;
  examples: Example[];
  compliance: boolean;
  /** A sighting: the writer named the lesson it saw again. */
  lessonId?: number;
};

/** A stored lesson, as matching needs it. */
export type LessonLike = {
  id: number;
  category: string;
  title: string;
  detail: string;
  host: string | null;
  fingerprint: string;
  status: string;
};

// --- Normalizing ---------------------------------------------------------

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have " +
    "he her his i if in into is it its it's me my no not of on or our out so than " +
    "that the their them then there these they this to too up us was we were what " +
    "when where which while who why will with would you your"
  ).split(" "),
);

const MONTHS =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/g;
const WEEKDAYS = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?s?\b/g;

/** "Resets" -> "reset", "blocking" -> "block", "cities" -> "city". */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/**
 * Text to compare: lowercase, every URL replaced by its host, dates,
 * times, months, weekdays and digits stripped, stopwords dropped, words
 * lightly stemmed. Order is kept (for trigrams).
 */
export function lessonTokens(text: string): string[] {
  const t = text
    .toLowerCase()
    .replace(/https?:\/\/([^/\s?#]+)[^\s]*/g, (_, h: string) =>
      h.replace(/^www\./, "").replace(/\./g, "_"),
    )
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)/g, " ")
    .replace(MONTHS, " ")
    .replace(WEEKDAYS, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z_\s]+/g, " ");
  return t
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

export function fingerprintOf(
  category: string,
  host: string | null,
  text: string,
): string {
  const sorted = [...new Set(lessonTokens(text))].sort().join(" ");
  const sha = createHash("sha1").update(sorted).digest("hex");
  return `${category}:${host ?? ""}:${sha}`;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

const trigrams = (tokens: string[]) => {
  const out = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++)
    out.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  return out;
};

/** Titles this short compare as word sets, not just trigrams. */
const SHORT_TITLE = 6;
/** A short title alone merges only when this alike. */
export const SHORT_TITLE_ALONE = 0.75;

/**
 * How alike a problem and a lesson are, 0 to 1: word-trigram Jaccard on
 * title + detail. When either title is short (few trigrams to go on), the
 * titles' word sets count too, but only if they're nearly the same
 * (0.75), or alike (0.55) with details that are alike as well: two short
 * titles sharing a couple of words ("Quote too short") aren't one lesson.
 */
export function lessonSimilarity(
  a: { title: string; detail: string },
  b: { title: string; detail: string },
): number {
  const ta = lessonTokens(`${a.title} ${a.detail}`);
  const tb = lessonTokens(`${b.title} ${b.detail}`);
  let score = jaccard(trigrams(ta), trigrams(tb));
  const ha = lessonTokens(a.title);
  const hb = lessonTokens(b.title);
  if (ha.length < SHORT_TITLE || hb.length < SHORT_TITLE) {
    const title = jaccard(new Set(ha), new Set(hb));
    const detail = jaccard(
      new Set(lessonTokens(a.detail)),
      new Set(lessonTokens(b.detail)),
    );
    if (title >= SHORT_TITLE_ALONE) score = Math.max(score, title);
    else if (title >= MERGE_AT && detail >= MERGE_AT)
      score = Math.max(score, Math.min(title, detail));
  }
  return score;
}

// --- Compliance ----------------------------------------------------------

const COMPETITOR_WORDS =
  /\b(competitors?|other newsletters?|(the\s*)?bend\s*buzz|bend\s*family\s*loop|family\s*loop|bendfamilyloop|bendbuzz|beehiiv|substack|mailchimp|mailchi\.?mp|buttondown|campaign-archive|list-manage|blocked_domains|blocklist|block list)\b/i;
/** Getting past a site's defenses is never a fix (decisions, item 6). */
const EVASION_WORDS =
  /\b(bot[- ]?(check|wall|protection|detection)|captcha|challenge|cloudflare|sucuri|user[- ]?agent|ua string|headers?|browser[- ]style|headless|puppeteer|playwright|proxy|proxies|rotate|evad\w*|evasion|bypass\w*|get (past|around)|work ?around|spoof\w*|impersonat\w*|cookies?)\b/i;
/** What a rule change aimed at the validator or this file may never loosen. */
const RULE_LIMIT_WORDS =
  /\b(minimum|min|maximum|max|length|characters?|chars?|allow ?list|allowlisted|link_domains|event_domains|lead_domains|discovery_domains|domains?|hosts?)\b/i;
const CONSENT_WORDS =
  /\b(consent|opt[- ]?(in|out)|unsubscrib\w*|tcpa|ctia|10dlc|can-?spam|stop keyword|quiet hours)\b/i;
const LEGAL_WORDS =
  /\b(terms( of (service|use))?|privacy( policy)?|takedowns?|dmca)\b|\/(terms|privacy)\b/i;
const SAFETY_WORDS =
  /\b(wordlists?|word lists?|banned (phrases?|words?)|safety (list|words?|rules?)|political|sexual|adult|nsfw)\b/i;
const EVIDENCE_RULE =
  /\b(evidence|quotes?)\b[^.]{0,80}\b(rule|minimum|min|length|characters?|chars?|shorter|longer|counts?|limits?|loosen|relax|lower|raise|allow|skip|drop|require\w*)\b|\b(rule|minimum|length|characters?|shorter|loosen|relax|lower|allow|skip|require\w*)\b[^.]{0,80}\b(evidence|quotes?)\b/i;

/**
 * Does this touch something only James decides: competitor links or
 * names, consent, evidence or quote rules, safety wordlists, Terms or
 * Privacy? Code sets it (never the writer), and it only ever turns on.
 */
export function touchesCompliance(...texts: (string | undefined)[]): boolean {
  const t = texts.filter(Boolean).join(" \n ");
  const lower = t.toLowerCase();
  if (BLOCKED_DOMAINS.some((d) => lower.includes(d))) return true;
  return [
    COMPETITOR_WORDS,
    CONSENT_WORDS,
    LEGAL_WORDS,
    SAFETY_WORDS,
    EVIDENCE_RULE,
    EVASION_WORDS,
  ].some((re) => re.test(t));
}

/**
 * A proposed rule change is James's call when it touches compliance, or
 * when it aims at the validator or a command file and names a minimum, a
 * length, characters, the allowlist or domains.
 */
export function ruleChangeCompliance(r: {
  target: string;
  section: string;
  current: string;
  proposed: string;
  why: string;
}): boolean {
  if (touchesCompliance(r.section, r.current, r.proposed, r.why)) return true;
  return (
    (r.target === "validator" || r.target === "command") &&
    RULE_LIMIT_WORDS.test(`${r.section} ${r.current} ${r.proposed} ${r.why}`)
  );
}

// --- Retro -> candidates --------------------------------------------------

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const BLOCKED_WORDS: Record<(typeof BLOCKED_KINDS)[number], string> = {
  bot_check: "shows a bot check instead of the page",
  reset: "resets the connection (no answer)",
  timeout: "times out",
  http_status: "answers an error status",
  not_allowlisted: "isn't on the link allowlist",
};

/**
 * A retro's problems, blocked hosts and rule changes as lesson
 * candidates. Blocked hosts are source lessons keyed by host and kind;
 * rule changes are rule_conflict lessons.
 */
export function retroCandidates(retro: Retro, now: Date): Candidate[] {
  const at = now.toISOString();
  const out: Candidate[] = [];
  for (const p of retro.problems) {
    const examples: Example[] = (p.examples ?? []).map((e) => ({
      ...(e.url ? { url: e.url } : {}),
      ...(e.message ? { message: e.message } : {}),
      at,
    }));
    // The problem as reported: kept as an example when it merges.
    examples.unshift({
      message: `${p.title}: ${p.detail}`.slice(0, 300),
      at,
    });
    if (p.rule) examples.push({ message: p.rule.slice(0, 300), at });
    const host =
      p.category === "source"
        ? (p.examples
            ?.map((e) => (e.url ? hostOf(e.url) : null))
            .find(Boolean) ?? null)
        : null;
    const detail = p.rule ? `${p.detail} (Rule: ${p.rule})` : p.detail;
    out.push({
      category: p.category,
      title: p.title,
      detail: detail.slice(0, 900),
      host,
      fingerprint: fingerprintOf(p.category, host, `${p.title} ${p.detail}`),
      examples,
      compliance: touchesCompliance(p.title, p.detail, p.rule),
      ...(p.lesson_id ? { lessonId: p.lesson_id } : {}),
    });
  }
  for (const b of retro.blocked_hosts) {
    // A missing page is a dead link, not a host that keeps us out.
    if (b.kind === "http_status" && (b.status === 404 || b.status === 410))
      continue;
    const host = b.host.replace(/^www\./, "");
    out.push({
      category: "source",
      title: `${host} ${BLOCKED_WORDS[b.kind]}`,
      detail: `${host} ${BLOCKED_WORDS[b.kind]}${b.status ? ` (status ${b.status})` : ""}, so its events and links are cut. Recheck it weekly; never get past a bot check.`,
      host,
      // Keyed by host and kind alone: every sighting is the same lesson.
      fingerprint: `source:${host}:blocked:${b.kind}`,
      examples: [
        {
          url: b.url,
          ...(b.status != null ? { message: `status ${b.status}` } : {}),
          at,
        },
      ],
      compliance: false,
    });
  }
  for (const r of retro.rule_changes) {
    const title = `${r.target}: ${r.section}`.slice(0, 120);
    const detail =
      `Current: ${r.current} Proposed: ${r.proposed} Why: ${r.why}`.slice(
        0,
        900,
      );
    out.push({
      category: "rule_conflict",
      title,
      detail,
      host: null,
      fingerprint: fingerprintOf(
        "rule_conflict",
        null,
        `${r.target} ${r.section} ${r.proposed}`,
      ),
      examples: [{ message: r.proposed.slice(0, 300), at }],
      compliance: ruleChangeCompliance(r),
    });
  }
  return out;
}

// --- Matching ------------------------------------------------------------

export type Match =
  | { kind: "new" }
  | { kind: "merge"; lesson: LessonLike; score: number; reopen: boolean };

/**
 * Which lesson a candidate repeats, if any: the lesson it names (a
 * sighting), then an exact fingerprint (any status), then the most alike
 * live or fixed lesson in the same category or with the same host,
 * scoring MERGE_AT or more. A repeat of a fixed lesson reopens it.
 */
export function matchLesson(
  c: Candidate,
  lessons: readonly LessonLike[],
): Match {
  const merge = (lesson: LessonLike, score: number): Match => ({
    kind: "merge",
    lesson,
    score,
    reopen: lesson.status === "fixed",
  });
  if (c.lessonId) {
    const named = lessons.find((l) => l.id === c.lessonId);
    if (named) return merge(named, 1);
  }
  const exact = lessons.find((l) => l.fingerprint === c.fingerprint);
  if (exact) return merge(exact, 1);
  let best: { lesson: LessonLike; score: number } | null = null;
  for (const l of lessons) {
    if (
      l.status !== "fixed" &&
      !LIVE_STATUSES.includes(l.status as LessonStatus)
    )
      continue;
    if (l.category !== c.category && !(c.host && l.host === c.host)) continue;
    // A blocked host's lesson is about that host only.
    if (c.host && l.host && c.host !== l.host) continue;
    const score = lessonSimilarity(c, l);
    if (score >= MERGE_AT && (!best || score > best.score))
      best = { lesson: l, score };
  }
  return best ? merge(best.lesson, best.score) : { kind: "new" };
}

/** A lesson's examples after a sighting: the newest last, 10 at most. */
export function withExamples(old: unknown, add: Example[]): Example[] {
  const prev = Array.isArray(old) ? (old as Example[]) : [];
  return [...prev, ...add].slice(-EXAMPLES_KEPT);
}

// --- Status changes ------------------------------------------------------

/** "https://github.com/<owner>/<repo>/pull/<n>" for this repo, or null. */
export function prRef(
  url: string | undefined,
  repo = "jamesrstew/park-roulette",
): { owner: string; repo: string; number: number } | null {
  if (!url) return null;
  const m = url.match(
    /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d{1,7})\/?$/,
  );
  if (!m) return null;
  if (`${m[1]}/${m[2]}`.toLowerCase() !== repo.toLowerCase()) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export const LessonPatch = z.strictObject({
  status: z.enum(LESSON_STATUSES),
  pr_url: z.string().max(200).optional(),
  /** needs_james: the decision needed; fix_proposed: the fix plan; wontfix: why. */
  note: Str(600).optional(),
});
export type LessonPatch = z.infer<typeof LessonPatch>;

/**
 * Why a status change is refused, or null (maintainer token only). The
 * maintainer is report-only: it triages (needs_james with the decision
 * needed, fix_proposed with a written fix plan, wontfix with why). fixed
 * is set by an explicit call after a reviewed fix ships, never by the
 * Sunday task. A compliance lesson only ever moves to needs_james. A
 * pr_url, when given, must be a pull request on this repository.
 */
export function patchProblem(
  lesson: { compliance: boolean },
  patch: LessonPatch,
  repo?: string,
): string | null {
  if (lesson.compliance && !COMPLIANCE_STATUSES.includes(patch.status))
    return "A compliance lesson can only move to needs_james. James decides the rest.";
  if (patch.pr_url !== undefined && !prRef(patch.pr_url, repo))
    return "pr_url must be a pull request on this repository.";
  if (patch.status === "needs_james" && !patch.note)
    return "needs_james needs a note: the decision James has to make.";
  if (patch.status === "fix_proposed" && (patch.note?.length ?? 0) < 40)
    return "fix_proposed needs a note with the fix plan (40 characters or more): what to change, where, and the test that proves it.";
  if (patch.status === "wontfix" && !patch.note)
    return "wontfix needs a one-line note saying why.";
  return null;
}

// --- The summary email ---------------------------------------------------

export const SummarySchema = z.strictObject({
  text: Str(1200),
  pr_url: z.string().max(200).optional(),
});

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
/** With separators ("541-555-0100", "(541) 555 0100") or without ("5415550100"). */
const PHONE =
  /(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|(?<![\d/.-])\+?1?\d{10}(?!\d|[/-]|\.\d)/;

/**
 * No personal details in what the routines send: an address or a phone
 * number is refused, not scrubbed.
 */
export function personalDetails(text: string): string | null {
  if (EMAIL.test(text)) return "No email addresses.";
  if (PHONE.test(text)) return "No phone numbers.";
  return null;
}

/**
 * The summary email: no personal details, and no links but this
 * repository's (a pull request, or a file on GitHub).
 */
export function summaryProblem(
  text: string,
  repo = "jamesrstew/park-roulette",
): string | null {
  const pii = personalDetails(text);
  if (pii) return pii.replace(".", " in the summary.");
  for (const url of text.match(/https?:\/\/[^\s)>\]]+/gi) ?? [])
    if (!repoUrl(url, repo))
      return `Only links to this repository (${url.slice(0, 60)} isn't one).`;
  return null;
}

/** A link on github.com to this repository. */
export function repoUrl(
  url: string,
  repo = "jamesrstew/park-roulette",
): boolean {
  return url
    .toLowerCase()
    .replace(/[.,;:]+$/, "")
    .startsWith(`https://github.com/${repo.toLowerCase()}/`);
}
