import { checkShort } from "./short";
import { ageTags } from "./ages";
import {
  clock,
  type EventInput,
  EventInput as EventInputSchema,
  eventSlug,
  issueId,
  kindOf,
  pacificToday,
  seriesKey,
  keyStem,
  slugify,
  type StoredEvent,
  storedFrom,
  titleStem,
  venueKey,
} from "./model";
import { machinePrintsDay, machinePrintsTime } from "./machine-time";
import { lineNamesEvent, namesByPhrase } from "./binding";
import { onPage } from "./structured";
import {
  aliasPathProblem,
  aliasSite,
  allowedLink,
  type Catalog,
  leadMessage,
  onList,
} from "@/lib/news/catalog";
import { addDays } from "@/lib/news/time";
import {
  blockedLink,
  type BlockedKind,
  type Fetcher,
  FREE_ADMISSION,
  normalizeText,
  quoteHasPrice,
  siteOf,
  styleProblems,
  trigrams,
} from "@/lib/news/validate";

/**
 * Kids' events through the shared validator rules (lib/news/validate.ts):
 * evidence quoted verbatim from the official page, primary sources only
 * (the competitor blocklist, the link allowlist, and the link and its
 * evidence from the same site), dates, times and prices printed in a
 * quote, ages only as printed, and our "what kids do" line never copied
 * from the official page or from the roundup where the event was found.
 * Each event stands alone: a bad one is cut, the rest go in.
 */

export type EventsContext = {
  catalog: Pick<Catalog, "link_domains" | "event_series"> &
    Partial<
      Pick<
        Catalog,
        | "lead_domains"
        | "site_aliases"
        | "alias_pins"
        | "alias_paths"
        | "listing_domains"
        | "not_organizer_domains"
        | "evidence_domains"
        | "shared_calendar_pages"
      >
    >;
  /** Public parks on our map, by slug (a venue at a park uses its pin). */
  parks: ReadonlyMap<string, { lat: number; lng: number; name: string }>;
  /** Omit for a quick check (no pages fetched). */
  fetcher?: Fetcher;
  /** Our own host (never an event's page). */
  ownHost?: string;
  /** Gap between fetches on one host (tests set 0). */
  fetchGapMs?: number;
  /**
   * A stored newsletter issue (lib/inbox/store.ts), for "issue:<id>"
   * evidence: its text and the day it was sent (Pacific). Set with the
   * fetcher; null when it isn't stored (never stored, or pruned).
   */
  issue?: (id: number) => Promise<{ text: string; day: string } | null>;
  now: Date;
};

export type EventVerdict = {
  index: number;
  title: string;
  ok: boolean;
  problems: string[];
  warnings: string[];
  /** Set when ok. */
  slug?: string;
  key?: string;
  kind?: ReturnType<typeof kindOf>;
  event?: StoredEvent;
  /** Handed in as part of the series at this index (merged into it). */
  merged?: number;
  /** Cut because a host kept us out (the retro reports it as blocked). */
  blocked?: { host: string; kind: BlockedKind; url: string };
};

/** Dates one series may carry from one hand-in. */
export const MAX_SERIES_DATES = 30;

/** Events this far out at most (the listing shows 60 days). */
export const MAX_DAYS_AHEAD = 60;
/** Quotes a one-off may carry (a series or annual event: MAX_SERIES_DATES). */
export const MAX_ONE_OFF_QUOTES = 8;
/** Share of our line's word trigrams found in a source page: too close. */
export const COPY_LIMIT = { primary: 0.5, discovery: 0.4 } as const;

/** How much of `ours` (its word trigrams) appears in `page`. */
export function containment(ours: string, page: string): number {
  // Short lines have few trigrams: compare word pairs instead.
  const tri = trigrams(ours);
  const short = tri.size < 6;
  const a = short ? bigrams(ours) : tri;
  if (!a.size) return 0;
  const b = short ? bigrams(page) : trigrams(page);
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / a.size;
}

/** Word pairs, normalized like trigrams. */
function bigrams(text: string): Set<string> {
  const w = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) out.add(`${w[i]} ${w[i + 1]}`);
  return out;
}

type Page = Awaited<ReturnType<Fetcher>> | null;

/** Milliseconds between two fetches from one host (politeness). */
export const HOST_GAP_MS = 500;

/**
 * One page cache for a whole hand-in, with at most 2 fetches at a time
 * per host (the same library page is often evidence for many events),
 * and at least 500 ms between two fetches' starts on one host.
 */
export function pagePool(fetcher: Fetcher, perHost = 2, gapMs = HOST_GAP_MS) {
  const pages = new Map<string, Promise<Page>>();
  const busy = new Map<string, number>();
  const queue = new Map<string, (() => void)[]>();
  const nextStart = new Map<string, number>();
  const acquire = async (h: string) => {
    if ((busy.get(h) ?? 0) >= perHost)
      await new Promise<void>((r) =>
        queue.set(h, [...(queue.get(h) ?? []), r]),
      );
    busy.set(h, (busy.get(h) ?? 0) + 1);
    // Reserve this host's next start slot, then wait for it.
    const at = Math.max(Date.now(), nextStart.get(h) ?? 0);
    nextStart.set(h, at + gapMs);
    if (at > Date.now())
      await new Promise((r) => setTimeout(r, at - Date.now()));
  };
  const release = (h: string) => {
    busy.set(h, (busy.get(h) ?? 1) - 1);
    const next = queue.get(h)?.shift();
    if (next) next();
  };
  return (u: string, domains: readonly string[]): Promise<Page> => {
    if (!pages.has(u)) {
      const h = host(u);
      pages.set(
        u,
        (async () => {
          await acquire(h);
          try {
            return await fetcher(u, domains).catch(() => null);
          } finally {
            release(h);
          }
        })(),
      );
    }
    return pages.get(u)!;
  };
}

const has = (quotes: string[], s: string) =>
  quotes.some((q) =>
    normalizeText(q).toLowerCase().includes(normalizeText(s).toLowerCase()),
  );

const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

/**
 * Does a quote print this time ("10 am", "10:30 a.m.", "noon", or "1 to
 * 3 p.m.")? A bare number ("Ages 3 to 10") is never a time. A start time
 * must open its range: "10 am to 2 pm" prints a 10 am start, not a 2 pm
 * one. An end time may be either end.
 */
export function quotePrintsTime(
  quote: string,
  hhmm: string,
  role: "start" | "end" = "start",
): boolean {
  const q = quote.toLowerCase().replace(/[\u2013\u2014]/g, "-");
  const [h24, m] = hhmm.split(":").map(Number);
  const h = h24 % 12 || 12;
  const ap = h24 < 12 ? "a" : "p";
  const mm = m ? `:${String(m).padStart(2, "0")}` : "(?::00)?";
  const own = new RegExp(`\\b${h}${mm}\\s*${ap}\\.?\\s?m\\b`, "g");
  const opens = new RegExp(
    `\\b${h}${mm}\\s*(?:${ap}\\.?\\s?m\\.?\\s*)?(?:-|to|until)\\s*\\d{1,2}(?::\\d{2})?\\s*${ap}\\.?\\s?m\\b`,
  );
  const noon = h24 === 12 && m === 0 ? /\bnoon\b/g : null;
  const afterConnector = (i: number) =>
    /(?:-|\bto|\buntil)\s*$/.test(q.slice(Math.max(0, i - 8), i));
  const hits = (re: RegExp | null) =>
    re ? [...q.matchAll(re)].map((x) => x.index ?? 0) : [];
  // Machine data, in Pacific time ("2026-11-22T01:00:00Z" is 5 pm on
  // Nov 21): "2026-11-21T10:30", "2026-11-21 10:30:00", "20261121T103000".
  if (machinePrintsTime(q, hhmm)) return true;
  if (role === "end") return hits(own).length > 0 || hits(noon).length > 0;
  return (
    opens.test(q) ||
    hits(own).some((i) => !afterConnector(i)) ||
    hits(noon).some((i) => !afterConnector(i))
  );
}

const MONTHS3 = [
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
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Does a quote print this date: "Nov 21", "November 21st", "11/21"? A
 * zero-padded day or month counts as printed ("December 02", "Dec 06,
 * 2026", "12/02"): the library's calendar and Wix sites print them.
 */
export function quotePrintsDate(quote: string, day: string): boolean {
  const q = quote.toLowerCase();
  const [y, m, d] = day.split("-").map(Number);
  // A printed year must be the claimed one (", 2025", "/2025", "/25").
  const yearOk = (printed: string | undefined) =>
    !printed ||
    Number(printed) === y ||
    (printed.length === 2 && Number(printed) === y % 100);
  const long = new RegExp(
    `\\b${MONTHS3[m - 1]}[a-z]*\\.?\\s+0?${d}(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4})\\b)?`,
    "g",
  );
  const short = new RegExp(
    `(?<!\\d)0?${m}/0?${d}(?!\\d)(?:/(\\d{4}|\\d{2})\\b)?`,
    "g",
  );
  if ([...q.matchAll(long), ...q.matchAll(short)].some((x) => yearOk(x[1])))
    return true;
  // The organizer's machine data, as a Pacific day: "2026-11-21",
  // "20261121T100000", "2026-11-22T01:00:00Z" (Nov 21 in Bend).
  return machinePrintsDay(q, day);
}

/** A printed span in a quote ("Nov 4 to Dec 16", "Nov 4 - 25"), as dates. */
export function printedSpans(
  quote: string,
  year: number,
): { from: string; to: string }[] {
  const q = quote.toLowerCase();
  const mon = MONTH_WORD;
  const re = new RegExp(
    `\\b${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|through|until)\\s*(?:${mon}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "g",
  );
  const iso = (mm: number, dd: number, y: number) =>
    `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return [...q.matchAll(re)].map((x) => {
    const m1 = MONTHS3.indexOf(x[1]) + 1;
    const m2 = x[3] ? MONTHS3.indexOf(x[3]) + 1 : m1;
    const y2 = m2 < m1 ? year + 1 : year;
    return { from: iso(m1, Number(x[2]), year), to: iso(m2, Number(x[4]), y2) };
  });
}

/**
 * A month as printed: its full name or a standard abbreviation ("Dec",
 * "Dec.", "Sept"), a whole word ("Junior", "Market", "Novel" and
 * "Decorate" are never months). Group 1 is the month's first three
 * letters.
 */
const MONTH_WORD =
  "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|t|tember|ober|ember)?\\.?(?![a-z])";
const MONTH_NAMES = new Set([
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
]);
/** Is this printed word a month ("Dec.", "Sept", "December")? */
const isMonth = (w: string) =>
  MONTH_NAMES.has(w.toLowerCase().replace(/\.$/, ""));

/** A run's match in a text, where it is, and its days. */
type Run = { from: string; to: string; at: number; end: number; year: boolean };

function runsIn(text: string, year: number): Run[] {
  const q = text.toLowerCase();
  const re = new RegExp(
    `\\b${MONTH_WORD}\\s+0?(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|through|thru)\\s*(?:${MONTH_WORD}\\s+)?0?(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:]|\\s*[ap]\\.?\\s?m\\b)(?:,?\\s+(20\\d{2})\\b)?`,
    "g",
  );
  const iso = (y: number, mm: number, dd: number) =>
    `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const out: Run[] = [];
  for (const x of q.matchAll(re)) {
    // The words as printed must be months ("dec" in "decorate" is not).
    const words = x[0].match(/[a-z]+\.?/g) ?? [];
    if (!isMonth(words[0] ?? "") || (x[3] && !words.slice(1).some(isMonth)))
      continue;
    const m1 = MONTHS3.indexOf(x[1]) + 1;
    const m2 = x[3] ? MONTHS3.indexOf(x[3]) + 1 : m1;
    const d1 = Number(x[2]);
    const d2 = Number(x[4]);
    const y2 = x[5] ? Number(x[5]) : m2 < m1 ? year + 1 : year;
    const y1 = m2 < m1 ? y2 - 1 : y2;
    const from = iso(y1, m1, d1);
    const to = iso(y2, m2, d2);
    if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31 && from <= to)
      out.push({
        from,
        to,
        at: x.index ?? 0,
        end: (x.index ?? 0) + x[0].length,
        year: !!x[5],
      });
  }
  return out;
}

/**
 * A run of dates as the organizer prints it, with its year: "December
 * 3–20, 2026" or "Nov 27 – Dec 6, 2026" (en dashes read as "-"). A year
 * after the run is the end's; with none printed, the run is read in the
 * given year (and one that wraps the new year ends in the next). Each run
 * is an inclusive span of days, never a list of performance dates.
 */
export function printedRuns(
  text: string,
  year: number,
): { from: string; to: string }[] {
  return runsIn(normalizeText(text), year).map(({ from, to }) => ({
    from,
    to,
  }));
}

/** Weekdays a text names ("Thursdays", "Thu-Sun", "Fri & Sat"), 0 = Sunday. */
export function namedWeekdays(text: string): Set<number> {
  const t = text.toLowerCase();
  const day =
    "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?s?\\.?(?![a-z])";
  const idx = (w: string) =>
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(w.slice(0, 3));
  const out = new Set<number>();
  const range = new RegExp(`\\b${day}\\s*(?:-|to|through|thru)\\s*${day}`, "g");
  for (const m of t.matchAll(range)) {
    const a = idx(m[1]);
    const b = idx(m[2]);
    for (let i = a; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === b) break;
    }
  }
  for (const m of t.matchAll(new RegExp(`\\b${day}`, "g"))) out.add(idx(m[1]));
  return out;
}

/** The event's title, or its stem, where the text prints it. */
function titleSpots(
  text: string,
  title: string,
): { at: number; end: number }[] {
  const phrase = (x: string) =>
    x
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  const re = (words: string[]) =>
    new RegExp(`(?<![a-z0-9])${words.join("[^a-z0-9]+")}(?![a-z0-9])`, "g");
  const t = text.toLowerCase();
  const out: { at: number; end: number }[] = [];
  for (const w of [phrase(title), phrase(title.split(/[:(|]| - | – /)[0])])
    if (w.length)
      for (const m of t.matchAll(re(w)))
        out.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}

/** How near a run must be to the event's name: the same item. */
export const RUN_NEAR_TITLE = 150;

/**
 * Does an organizer's page print this date inside the event's run of dates
 * ("December 3–20, 2026", lessons 56 and 64)? Only as a cross-check of a
 * listing quote that names the event and prints this exact date: a run
 * never proves a date alone. The run must sit in the event's own item,
 * within 150 characters of its name with no other date, run or item
 * break (●, |) between; when that item names weekdays ("Thursdays",
 * "Thu-Sun"), the date's must be one; and a run with no year counts only
 * when the page prints the event's year and no other.
 */
export function runCoversDate(
  page: { text: string; data?: string },
  day: string,
  title: string,
  listingQuotes: readonly string[] = [],
): boolean {
  if (
    !listingQuotes.some(
      (q) => lineNamesEvent(q, title) && quotePrintsDate(q, day),
    )
  )
    return false;
  const year = Number(day.slice(0, 4));
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const texts = [page.text ?? "", ...(page.data ? page.data.split("\n") : [])];
  const allText = texts.join("\n");
  const years = new Set(allText.match(/\b20\d{2}\b/g) ?? []);
  const yearOk = years.size === 1 && years.has(String(year));
  const DATEISH = new RegExp(
    `\\b${MONTH_WORD}\\s+\\d{1,2}\\b|\\b\\d{1,2}/\\d{1,2}\\b|[●|]`,
    "i",
  );
  for (const raw of texts) {
    const text = normalizeText(raw);
    const titles = titleSpots(text, title);
    for (const y of [year, year - 1])
      for (const r of runsIn(text, y)) {
        if (!(r.from <= day && day <= r.to)) continue;
        if (!r.year && !yearOk) continue;
        for (const t of titles) {
          const gap =
            t.end <= r.at ? text.slice(t.end, r.at) : text.slice(r.end, t.at);
          if (t.end > r.at && t.at < r.end) continue;
          if (gap.length > RUN_NEAR_TITLE || DATEISH.test(gap)) continue;
          // The item: from the first of the two to 150 characters past the
          // last, up to the next item break or date.
          const start = Math.min(t.at, r.at);
          const last = Math.max(t.end, r.end);
          let tail = text.slice(last, last + RUN_NEAR_TITLE);
          const stop = tail.search(DATEISH);
          if (stop >= 0) tail = tail.slice(0, stop);
          const days = namedWeekdays(text.slice(start, last) + tail);
          if (days.size && !days.has(weekday)) continue;
          return true;
        }
      }
  }
  return false;
}

/**
 * Is this date printed? Its month and day (or M/D), or, for a series, a
 * recurrence on its weekday ("every Saturday", "Saturdays") inside a span
 * the page prints ("Nov 4 to Dec 16").
 */
export function datePrinted(
  quotes: readonly string[],
  day: string,
  recurring: boolean,
): boolean {
  if (quotes.some((q) => quotePrintsDate(q, day))) return true;
  if (!recurring) return false;
  const wd = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
  const year = Number(day.slice(0, 4));
  return quotes.some((q) => {
    const l = q.toLowerCase();
    // "every Saturday" or "Saturdays", but never "no ..." or "except ...".
    const hits = [
      ...l.matchAll(new RegExp(`\\bevery ${wd}\\b|\\b${wd}s\\b`, "g")),
    ];
    if (
      !hits.some(
        (h) =>
          // The words before it in the same clause.
          !/\b(no|except|excluding|not|closed)\b/.test(
            l.slice(0, h.index).split(/[.;,]/).pop() ?? "",
          ),
      )
    )
      return false;
    return quotes.some((sq) =>
      [...printedSpans(sq, year), ...printedSpans(sq, year - 1)].some(
        (sp) => sp.from <= day && day <= sp.to,
      ),
    );
  });
}

/**
 * Naming another newsletter (even "via Bend Family Loop", "the Family
 * Loop", "The Buzz") is out (as lib/news/lessons.ts COMPETITOR_WORDS).
 */
export const COMPETITOR_NAMES =
  /bend[\s_.-]*(family[\s_.-]*loop|buzz)|family[\s_.-]*loop|\bthe[\s_.-]*buzz\b/i;

/** Tracking query keys we strip from a link before storing it. */
const TRACKING =
  /^(utm_.*|mc_.*|fbclid|gclid|dclid|msclkid|igshid|ref|_hs.*)$/i;

/** A link without tracking parameters or a fragment. */
export function cleanLink(u: string): string {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return u;
  }
  for (const k of [...url.searchParams.keys()])
    if (TRACKING.test(k)) url.searchParams.delete(k);
  url.hash = "";
  return url.toString();
}

/** Weekday words in a quote ("Sat", "Saturday"), as 0 (Sunday) to 6. */
function weekdaysIn(q: string): number[] {
  const out: number[] = [];
  const re =
    /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|rsday|urday|sday)?\b/gi;
  for (const m of q.matchAll(re))
    out.push(
      ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(
        m[1].toLowerCase().slice(0, 3),
      ),
    );
  return out;
}

/**
 * The issue's date on a newsletter page: the first printed "Nov 19, 2026"
 * (an issue's byline), as YYYY-MM-DD. Null when it prints none.
 */
export function issueDay(text: string): string | null {
  const m = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  );
  if (!m) return null;
  const mm = MONTHS3.indexOf(m[1].toLowerCase()) + 1;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000,
  );

/** Not open to the public: a resort's guests, owners or members only. */
const EXCLUSIVE =
  /\bexclusive experience\b|\bexclusive(ly)?\s+(to|for)\b[^|]{0,60}?\b(guests?|owners?|members?|residents?)\b|\b(guests?|owners?|members?|residents?)\s+only\b|\bavailable (only )?to (resort |registered |overnight )?guests\b|\bprivate event\b/i;

const STOP = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "on",
  "the",
  "with",
]);
/** A title's words, lightly stemmed ("times" -> "time"), stop words out. */
export function titleWords(title: string): Set<string> {
  return new Set(
    slugify(title)
      .split("-")
      .filter((w) => w && !STOP.has(w))
      .map((w) =>
        w.length > 4 && w.endsWith("ies")
          ? `${w.slice(0, -3)}y`
          : w.length > 3
            ? w.replace(/s$/, "")
            : w,
      ),
  );
}

/**
 * Is this hand-in the catalog series? Same town, a venue on the series'
 * list when it has one, and a word of the title stem in common with the
 * series name ("Family Story Time" is DPL's story times; "Teen Gaming"
 * isn't).
 */
export function seriesMatches(
  e: Pick<EventInput, "title" | "venue">,
  s: { name: string; town: string; venues?: string[] },
): boolean {
  const norm = (x: string) => slugify(x);
  if (norm(s.town) !== norm(e.venue.town)) return false;
  if (
    s.venues &&
    !s.venues.some(
      (v) => venueKey({ name: v, town: s.town }) === venueKey(e.venue),
    )
  )
    return false;
  // The whole stem, or a distinctive word in common: "family", "kids",
  // "story", "time" and "club" alone never make two programs one series.
  if (keyStem(e.title) === keyStem(s.name)) return true;
  const mine = titleWords(titleStem(e.title));
  const theirs = titleWords(titleStem(s.name));
  if ([...mine].every((w) => theirs.has(w)) && mine.size) return true;
  return [...mine].some((w) => theirs.has(w) && !GENERIC_WORDS.has(w));
}

/** Words too common to tie a hand-in to a catalog series. */
const GENERIC_WORDS = new Set([
  "family",
  "kid",
  "kids",
  "story",
  "storytime",
  "time",
  "club",
  "fun",
  "day",
  "night",
  "event",
  "program",
]);

/** Hosts that are never an event's page: our own site, roads, weather. */
export const NOT_EVENT_DOMAINS = [
  "parkroulette.quest",
  "tripcheck.com",
  "weather.gov",
];

/** The events allowlist: the catalog's, minus our site, roads and weather. */
export function eventDomains(
  linkDomains: readonly string[],
  ownHost?: string,
): string[] {
  return linkDomains.filter(
    (d) =>
      !NOT_EVENT_DOMAINS.some((n) => d === n || d.endsWith(`.${n}`)) &&
      d !== ownHost,
  );
}

const STATUS_WORD = {
  canceled: /\bcancel(l?ed|lation)?\b/i,
  postponed: /\bpostpone(d|ment)?\b/i,
  rescheduled: /\breschedul(ed|ing)?\b|\bnew date\b|\bmoved to\b/i,
} as const;
const NEGATED =
  /\bno (cancel|postpon|reschedul)|\bnot (been )?(cancel|postpon|reschedul)|\bwithout (cancel|postpon)|\bnever (cancel|postpon)|\bunless (cancel|postpon)|\bif (it'?s |we )?(cancel|postpon)|\bin case of (cancel|postpon)|\brain or shine\b/i;

/**
 * Is this link one of the known multi-program pages (catalog
 * shared_calendar_pages: the library's calendar and its kids' programs
 * list)? Compared by host and path, any query or fragment aside.
 */
export function onMultiProgramPage(
  url: string,
  pages: readonly string[],
): boolean {
  const key = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`;
    } catch {
      return u;
    }
  };
  const k = key(url);
  return pages.some((p) => key(p) === k);
}

/**
 * A line from a page of many programs proves a fact only when it names
 * this event and its venue: the kids' programs list prints "Nov 30 Story
 * Time Preschool Story Time 10:30 AM ● Central Library", which is never
 * Family Story Time's date, and a Redmond Library line is never Central
 * Library's (Family Story Time, Nov 22).
 */
export function lineNamesEventAt(
  line: string,
  title: string,
  venue: string,
): boolean {
  if (!lineNamesEvent(line, title)) return false;
  // Only the first venue marker after the program's name counts: the list
  // prints "Title 9:30 AM ● Branch ...", and the line before it ends
  // "Find <its branch>", the line after it starts with the next date.
  const text = normalizeText(line);
  const spot = titleSpots(text, title)[0];
  let rest = spot ? text.slice(spot.end) : text;
  const NEXT = new RegExp(`\\b${MONTH_WORD}\\s+\\d{1,2}\\b`, "i");
  const dot = rest.indexOf("●");
  if (dot >= 0) {
    rest = rest.slice(dot + 1);
    const next = rest.indexOf("●");
    if (next >= 0) rest = rest.slice(0, next);
  }
  const date = rest.search(NEXT);
  if (date >= 0) rest = rest.slice(0, date);
  return lineNamesEvent(rest, venue);
}

/** Everything that can be checked without the network. */
export function checkEvent(
  e: EventInput,
  ctx: EventsContext,
): {
  problems: string[];
  checkQuote: string;
  targets: Record<string, { url: string; quote: string }>;
} {
  const p: string[] = [];
  const own = ctx.ownHost ?? "parkroulette.quest";
  const domains = eventDomains(ctx.catalog.link_domains, own);
  const quotes = e.evidence.map((x) => x.quote);
  const listing = e.verified_via === "listing";
  // A newsletter's own page, or one of its issues in our inbox.
  const onListing = (u: string) =>
    issueId(u) != null || !!onList(u, ctx.catalog.listing_domains ?? []);
  // A listing page lists dozens of events: its quotes prove a date, a
  // weekly pattern or a time only next to the event's name.
  // A page of many programs (the library's kids' programs list): only
  // next to its name and venue.
  const multi = (u: string) =>
    onMultiProgramPage(u, ctx.catalog.shared_calendar_pages ?? []);
  const proves = (x: { url: string; quote: string }) =>
    multi(x.url)
      ? lineNamesEventAt(x.quote, e.title, e.venue.name)
      : !(listing && onListing(x.url)) || lineNamesEvent(x.quote, e.title);
  const proof = e.evidence.filter(proves).map((x) => x.quote);
  const today = pacificToday(ctx.now);
  // Quotes under 12 characters only when they print a date and a time
  // ("Dec 6 · 10:30am"), or a price or "free" with a date or time.
  const TIMEISH = /\b\d{1,2}(:\d{2})?\s*(a\.?m|p\.?m)\b|\bnoon\b/i;
  for (const x of e.evidence) {
    if (x.quote.trim().length >= 12) continue;
    const dated = e.dates.some((d) => quotePrintsDate(x.quote, d.day));
    const timed =
      TIMEISH.test(x.quote) ||
      e.dates.some((d) => !!d.start && quotePrintsTime(x.quote, d.start));
    const priced = /\$\s?\d|\bfree\b/i.test(x.quote);
    if (!((dated && timed) || (priced && (dated || timed))))
      p.push(
        `The quote "${x.quote}" is too short: 12 characters, or 8 with a date and a time, or a price or "free" with a date or time.`,
      );
  }
  // A bare date-and-time line ("Dec 6 · 10:30am") proves a date only on
  // the event's own page, or next to its name: elsewhere it could be any
  // event's.
  for (const x of e.evidence)
    if (
      x.quote.trim().length <= 12 &&
      x.url !== e.url &&
      !lineNamesEvent(x.quote, e.title) &&
      e.dates.some((d) => quotePrintsDate(x.quote, d.day))
    )
      p.push(
        `The short quote "${x.quote}" must come from the event's own page (${e.url}) or name the event.`,
      );
  for (const x of e.evidence)
    if (
      multi(x.url) &&
      !lineNamesEventAt(x.quote, e.title, e.venue.name) &&
      e.dates.some((d) => quotePrintsDate(x.quote, d.day))
    )
      p.push(
        `The quote "${x.quote.slice(0, 60)}" is from a page of many programs and doesn't name "${e.title}" at ${e.venue.name}: quote the line for this program and venue, or its own page.`,
      );
  if (kindOf(e) === "one_off" && e.evidence.length > MAX_ONE_OFF_QUOTES)
    p.push(
      `A one-off takes at most ${MAX_ONE_OFF_QUOTES} quotes (a series up to ${MAX_SERIES_DATES}, one per date).`,
    );

  for (const [name, text] of [
    ["title", e.title],
    ["what", e.what],
    ["cost", e.cost?.text ?? ""],
    ["parking", e.parking ?? ""],
    ["signup note", e.signup?.note ?? ""],
  ] as const)
    for (const s of styleProblems(text)) p.push(`${name}: ${s}`);
  // Never a competitor's name (any spacing: "BendBuzz", "Bend-Buzz") in
  // anything we keep or show.
  for (const [name, text] of [
    ["title", e.title],
    ["what", e.what],
    ["cost", e.cost?.text],
    ...(e.cost?.prices ?? []).map((x) => ["cost", x.label] as const),
    ["parking", e.parking],
    ["signup note", e.signup?.note],
    ["ages_text", e.ages_text],
    ["venue", e.venue.name],
    ["venue", e.venue.street],
    ["organizer", e.organizer?.name],
    ["status", e.status?.quote],
  ] as const)
    if (text && COMPETITOR_NAMES.test(text))
      p.push(`${name}: never name another newsletter.`);

  if (e.series_id) {
    const s = ctx.catalog.event_series.find((x) => x.id === e.series_id);
    if (!s || !s.verified)
      p.push(`Unknown or unverified event series "${e.series_id}".`);
    else if (!seriesMatches(e, s))
      p.push(
        `"${e.title}" at ${e.venue.name} isn't the catalog series "${s.name}". Leave series_id out.`,
      );
  }

  // Primary sources only.
  const links = [
    e.url,
    ...e.evidence.map((x) => x.url),
    ...(e.organizer ? [e.organizer.url] : []),
  ];
  // An alias host (the library's calendar system, the museum's CMS) is
  // evidence only: the event's link is the organization's own site.
  const aliases = ctx.catalog.site_aliases ?? {};
  for (const u of [e.url, ...(e.organizer ? [e.organizer.url] : [])]) {
    const a = onList(u, Object.keys(aliases));
    if (a)
      p.push(
        `${a} is ${aliases[a]}'s data host: evidence only. Link a page on ${aliases[a]}.`,
      );
  }
  // An alias host's evidence carries its pinned values (hdm.mux.earth's
  // CMS answers for any site: site= must be the museum's).
  for (const x of e.evidence) {
    const a = onList(x.url, Object.keys(ctx.catalog.alias_pins ?? {}));
    if (!a) continue;
    const q = new URL(x.url).searchParams;
    for (const [k, want] of Object.entries(ctx.catalog.alias_pins![a]))
      if (q.get(k) !== want) p.push(`Evidence on ${a} needs ${k}=${want}.`);
  }
  // A host serving many organizations by path: the organizer's own paths.
  for (const x of e.evidence) {
    const a = aliasPathProblem(x.url, ctx.catalog.alias_paths);
    if (a.problem) p.push(a.problem);
  }
  // A data host is evidence only.
  for (const u of [e.url, ...(e.organizer ? [e.organizer.url] : [])]) {
    const d = onList(u, ctx.catalog.evidence_domains ?? []);
    if (d)
      p.push(`${d} is a data host: evidence only. Link the organizer's page.`);
  }
  // A link never carries another newsletter, in its host, path, query or
  // fragment ("?from=bendfamilyloop"): tracking is stripped before this.
  const named = [
    ...(ctx.catalog.listing_domains ?? []),
    ...(ctx.catalog.lead_domains ?? []),
  ];
  for (const u of [e.url, ...(e.organizer ? [e.organizer.url] : [])]) {
    let raw = u;
    try {
      raw = decodeURIComponent(u);
    } catch {
      // keep it encoded
    }
    if (
      COMPETITOR_NAMES.test(raw) ||
      named.some((d) => raw.toLowerCase().includes(d))
    )
      p.push(
        "A link can't carry another newsletter's name or address. Link the organizer's own page.",
      );
  }
  // Verified on a newsletter's listing (the organizer's site keeps the
  // checker out): its evidence is the listing; its link is the
  // organizer's page, on the allowlist or not ("assume the links they
  // give are good"), but never the newsletter, an aggregator or a reseller.
  if (listing && !e.evidence.some((x) => onListing(x.url)))
    p.push(
      'verified_via "listing" needs the newsletter\'s own listing of the event as evidence.',
    );
  // An issue in our inbox lists dozens of events: every quote from it
  // names the event (its date, time, price or ages only next to its name).
  for (const x of e.evidence)
    if (issueId(x.url) != null && !lineNamesEvent(x.quote, e.title))
      p.push(
        `The quote from ${x.url} "${x.quote.slice(0, 60)}" must name the event ("${e.title}").`,
      );
  // A newsletter page lists dozens of events: a date from it proves this
  // event's date only next to its name (a listing event page's JSON-LD or
  // its "Title When Saturday, Nov 28 · 4pm", an issue's day line through
  // the event's line).
  if (listing)
    for (const x of e.evidence)
      if (
        onListing(x.url) &&
        e.dates.some((d) => quotePrintsDate(x.quote, d.day)) &&
        !lineNamesEvent(x.quote, e.title)
      )
        p.push(
          `The listing quote "${x.quote.slice(0, 60)}" prints a date but not the event's name: quote the date with the title.`,
        );
  // A printed weekday must be the date's own.
  if (listing)
    for (const x of e.evidence) {
      if (!onListing(x.url)) continue;
      const wds = weekdaysIn(x.quote);
      if (!wds.length) continue;
      for (const d of e.dates)
        if (
          quotePrintsDate(x.quote, d.day) &&
          !wds.includes(new Date(`${d.day}T12:00:00Z`).getUTCDay())
        )
          p.push(
            `The listing quote "${x.quote.slice(0, 60)}" prints a weekday that isn't ${d.day}'s.`,
          );
    }
  if (!listing && e.evidence.some((x) => onListing(x.url)))
    p.push(
      "A newsletter's listing is evidence only with verified_via \"listing\", when the organizer's own page keeps the checker out.",
    );
  for (const u of [e.url, ...(e.organizer ? [e.organizer.url] : [])]) {
    const r = onList(u, ctx.catalog.not_organizer_domains ?? []);
    if (r)
      p.push(
        `${r} sells tickets or lists other people's events: link the organizer's own page.`,
      );
  }
  const organizerLinks = new Set([
    e.url,
    ...(e.organizer ? [e.organizer.url] : []),
  ]);
  const evDomains = [...domains, ...(ctx.catalog.evidence_domains ?? [])];
  for (const u of new Set(links)) {
    // The listing itself: its checks are above.
    if (listing && onListing(u) && !organizerLinks.has(u)) continue;
    const h = host(u).replace(/^www\./, "");
    const lead = onList(u, ctx.catalog.lead_domains ?? []);
    if (lead) p.push(leadMessage(lead));
    else if (
      h === own ||
      h.endsWith(`.${own}`) ||
      /(^|\.)parkroulette\.quest$/.test(h)
    )
      p.push("Our own site is never an event's page or evidence.");
    else if (blockedLink(u))
      p.push(`${host(u)} is another newsletter. Link the primary source.`);
    else if (
      !allowedLink(u, organizerLinks.has(u) ? domains : evDomains) &&
      !(listing && organizerLinks.has(u) && /^https:/.test(u))
    )
      p.push(`${host(u)} isn't on the link allowlist.`);
  }
  const org = (u: string) =>
    aliasSite(siteOf(u, evDomains), ctx.catalog.site_aliases);
  const site = org(e.url);
  for (const x of e.evidence)
    if (!(listing && onListing(x.url)) && org(x.url) !== site)
      p.push(
        `The evidence (${host(x.url)}) must come from the same site as the link (${host(e.url)}).`,
      );
  if (e.discovery_url && e.discovery_url === e.url)
    p.push("The discovery link is the official page; leave it out.");

  // Dates: each one printed in a quote, and its start time too.
  for (const d of e.dates) {
    if (d.day > addDays(today, MAX_DAYS_AHEAD))
      p.push(`${d.day} is more than ${MAX_DAYS_AHEAD} days out.`);
    if (d.end_day && d.end_day < d.day)
      p.push(`${d.day}: it ends before it starts.`);
    if (d.start && d.end && !d.end_day && d.end <= d.start)
      p.push(`${d.day}: the end time is before the start.`);
    const recurring = kindOf(e) === "series" || !!e.series_id;
    if (!datePrinted(proof, d.day, recurring))
      p.push(
        `No evidence quote prints ${d.day} (its month and day, or a weekly pattern within a printed span).`,
      );
    if (d.end_day && !datePrinted(proof, d.end_day, false))
      p.push(`No evidence quote prints the end date ${d.end_day}.`);
    if (d.start && !proof.some((q) => quotePrintsTime(q, d.start!, "start")))
      p.push(`No evidence quote prints the start time ${clock(d.start)}.`);
    if (d.end && !proof.some((q) => quotePrintsTime(q, d.end!, "end")))
      p.push(`No evidence quote prints the end time ${clock(d.end)}.`);
  }
  if (!e.dates.some((d) => d.day >= today || (d.end_day ?? d.day) >= today))
    p.push("Every date has passed.");

  // Prices: every amount, and "free", printed in a quote.
  if (e.cost) {
    for (const pr of e.cost.prices)
      if (
        pr.amount > 0 &&
        !quotes.some((q) => quoteHasPrice(q, `$${pr.amount}`))
      )
        p.push(`The price $${pr.amount} must appear in an evidence quote.`);
    if (e.cost.free && /\$\s?\d/.test(e.cost.text))
      p.push(
        `"Free" with a price in the cost: say what's free in its own words.`,
      );
    else if (
      e.cost.free &&
      !quotes.some(
        (q) =>
          FREE_ADMISSION.test(q) ||
          // A bare "Free" next to the event's own title or date
          // ("Santa Flies In · Dec 6 · Free").
          (/\bfree\b(?!\s+(parking|wi-?fi|coffee|snacks?|refreshments|crafts?|gifts?|samples?|swag|t-shirts?))/i.test(
            q,
          ) &&
            (has([q], e.title) ||
              e.dates.some((d) => quotePrintsDate(q, d.day)))),
      )
    )
      p.push(
        `"Free" needs a quote about admission ("free admission", "no cost"), or "Free" next to the event's title or date.`,
      );
    for (const m of e.cost.text.match(/\$\s?\d+(?:\.\d{1,2})?/g) ?? [])
      if (!quotes.some((q) => quoteHasPrice(q, m)))
        p.push(`The price ${m} must appear in an evidence quote.`);
  }

  // Ages: only as printed, and never a grown-up event.
  if (e.ages_text) {
    if (!has(quotes, e.ages_text))
      p.push(
        `The ages "${e.ages_text}" must appear word for word in an evidence quote.`,
      );
    const a = ageTags(e.ages_text);
    if (!a)
      p.push(
        `"${e.ages_text}" doesn't say an age we can read. Leave ages_text out.`,
      );
    else if (!a.kids) p.push(`Not a kids' event ("${e.ages_text}").`);
  }

  // Sign-up and parking: only when the page says so.
  if (
    e.signup &&
    e.signup.kind !== "none" &&
    !quotes.some((q) =>
      /regist|sign[- ]?up|ticket|reserv|rsvp|sell out|sold out|book/i.test(q),
    )
  )
    p.push("Sign-up needs a quote about registering, tickets or selling out.");
  if (
    e.signup?.kind === "none" &&
    !quotes.some((q) =>
      /no (registration|sign[- ]?up|tickets?)|drop[- ]in|just (come|show up)|free and open/i.test(
        q,
      ),
    )
  )
    p.push(
      `"No sign-up" needs a quote that says so (drop-in, no registration).`,
    );
  if (
    e.parking &&
    !quotes.some((q) =>
      /park(ing)?\b.*\b(lot|free|permit|street)|sno-park|parking/i.test(q),
    )
  )
    p.push("Parking needs a quote about parking.");

  // Canceled, postponed, rescheduled: its own quote from the same page.
  if (e.status) {
    if (!has(quotes, e.status.quote))
      p.push("The status quote must be one of the evidence quotes.");
    if (NEGATED.test(e.status.quote))
      p.push("The status quote says it is not canceled or postponed.");
    else if (!STATUS_WORD[e.status.kind].test(e.status.quote))
      p.push(`The status quote must say ${e.status.kind}.`);
    if (e.status.kind === "rescheduled") {
      if (!e.status.previous_day)
        p.push("A rescheduled event needs previous_day.");
      else if (!quotes.some((q) => quotePrintsDate(q, e.status!.previous_day!)))
        p.push("The old date (previous_day) must be printed in a quote.");
    }
  }

  // The venue's pin: its park on our map, or a point the writer gave.
  if (e.venue.park && !ctx.parks.has(e.venue.park))
    p.push(`No park "${e.venue.park}" on the map.`);
  if ((e.venue.lat == null) !== (e.venue.lng == null))
    p.push("Give both lat and lng, or neither.");

  const first = [...e.dates].sort((a, b) => a.day.localeCompare(b.day))[0];
  const mine = listing
    ? e.evidence
    : e.evidence.filter((x) => org(x.url) === site);
  const good = mine.filter(proves);
  const target = (day: string) =>
    good.find((x) => quotePrintsDate(x.quote, day)) ??
    good.find((x) => datePrinted([x.quote], day, true)) ??
    mine.find((x) => quotePrintsDate(x.quote, day)) ??
    mine.find((x) => datePrinted([x.quote], day, true)) ??
    mine[0] ??
    e.evidence[0];
  const targets = Object.fromEntries(
    e.dates.map((d) => {
      const t = target(d.day);
      return [d.day, { url: t.url, quote: t.quote }];
    }),
  );
  return {
    problems: [...new Set(p)],
    checkQuote: target(first.day).quote,
    targets,
  };
}

/** Validate a batch. Network checks run when ctx.fetcher is set. */
export async function validateEvents(
  input: unknown,
  ctx: EventsContext,
): Promise<{ ok: boolean; error?: string; events: EventVerdict[] }> {
  const list = (input as { events?: unknown } | null)?.events;
  if (!Array.isArray(list) || !list.length || list.length > 60)
    return { ok: false, error: "Send {events: [...]} (1 to 60).", events: [] };
  const seen = new Map<string, number>();
  const pool = ctx.fetcher
    ? pagePool(ctx.fetcher, 2, ctx.fetchGapMs ?? HOST_GAP_MS)
    : null;
  const verdicts = await Promise.all(
    list.map(async (raw, index): Promise<EventVerdict> => {
      const title = String((raw as { title?: unknown })?.title ?? `#${index}`);
      const parsed = EventInputSchema.safeParse(raw);
      if (!parsed.success)
        return {
          index,
          title,
          ok: false,
          warnings: [],
          problems: parsed.error.issues.map(
            (i) => `${i.path.join(".") || "(event)"}: ${i.message}`,
          ),
        };
      const warn: string[] = [];
      const e = {
        ...parsed.data,
        url: cleanLink(parsed.data.url),
        ...(parsed.data.organizer
          ? {
              organizer: {
                ...parsed.data.organizer,
                url: cleanLink(parsed.data.organizer.url),
              },
            }
          : {}),
      };
      // A listing event's link is the organizer's page; a second
      // organizer link would go unchecked.
      if (e.verified_via === "listing" && e.organizer) {
        delete e.organizer;
        warn.push(
          "Left out organizer: a listing event's url is the organizer's page.",
        );
      }
      // The short line: checked against this event's own words, dropped
      // with a warning when it fails (never the event).
      if (e.short !== undefined) {
        const raw = e.short;
        delete e.short;
        if (typeof raw !== "string")
          warn.push("Left out short: it must be text (one phrase).");
        else if (raw.trim()) {
          const sc = checkShort(raw, { what: e.what, title: e.title });
          if (sc.short) e.short = sc.short;
          else warn.push(`Left out short: ${sc.problems.join(" ")}`);
        }
      }
      const { problems, checkQuote, targets } = checkEvent(e, ctx);
      const warnings: string[] = [...warn];
      const blocked =
        pool && !problems.length
          ? await networkChecks(e, ctx, pool, problems, warnings)
          : undefined;
      const park = e.venue.park ? ctx.parks.get(e.venue.park) : null;
      const point = park
        ? { lat: park.lat, lng: park.lng }
        : e.venue.lat != null && e.venue.lng != null
          ? { lat: e.venue.lat, lng: e.venue.lng }
          : null;
      if (!ctx.fetcher) warnings.push("Quick check: pages weren't fetched.");
      return {
        index,
        title,
        ok: problems.length === 0,
        problems,
        warnings,
        ...(problems.length
          ? blocked
            ? { blocked }
            : {}
          : {
              slug: eventSlug(e),
              key: seriesKey(e),
              kind: kindOf(e),
              event: {
                ...storedFrom(e, point, checkQuote),
                targets,
                ...(e.status
                  ? {
                      statusByDay: Object.fromEntries(
                        e.dates.map((d) => [d.day, e.status!.kind]),
                      ),
                    }
                  : {}),
              },
            }),
      };
    }),
  );
  // One series, handed in as several objects (one per date): merge them
  // into the first, dates and their check targets together.
  const first = new Map<string, EventVerdict>();
  for (const v of verdicts) {
    if (!v.ok || !v.key || !v.event) continue;
    const f = first.get(v.key);
    if (!f) {
      first.set(v.key, v);
      seen.set(v.key, v.index);
      continue;
    }
    const at = (d: { day: string; start?: string }) =>
      `${d.day} ${d.start ?? ""}`;
    const have = new Set(f.event!.dates.map(at));
    const dates = [
      ...f.event!.dates,
      ...v.event.dates.filter((d) => !have.has(at(d))),
    ];
    if (dates.length > MAX_SERIES_DATES) {
      v.ok = false;
      v.problems.push(
        `Same series as #${seen.get(v.key)}, and together they pass ${MAX_SERIES_DATES} dates. Hand in the rest next week.`,
      );
      continue;
    }
    f.event = {
      ...f.event!,
      dates: dates.sort((a, b) => at(a).localeCompare(at(b))),
      targets: { ...f.event!.targets, ...v.event.targets },
      statusByDay: { ...f.event!.statusByDay, ...v.event.statusByDay },
    };
    if (f.kind === "one_off") f.kind = "series";
    v.ok = true;
    v.merged = f.index;
    v.event = undefined;
    v.key = undefined;
  }
  return { ok: verdicts.every((v) => v.ok), events: verdicts };
}

/**
 * A listing event's organizer page (verified_via "listing"). We trust the
 * newsletter's listing only when the organizer's site keeps us out: a bot
 * check, 403, 429, a 5xx, a reset or a timeout. Everything else decides:
 * a host that won't resolve, a redirect off its site, any other error
 * status (400, 401, 404, 405, 410, 451...), a page we can't read, or one
 * that doesn't name the event is cut; a page that names it must print
 * its dates too. We never try to get past a wall.
 */
export function organizerVerdict(
  r: Page,
  ev: {
    title: string;
    dates: readonly { day: string; end_day?: string }[];
    url?: string;
    recurring?: boolean;
    /** The listing's quotes: an exact date there lets a printed run agree. */
    listingQuotes?: readonly string[];
  },
): { cut?: string; trusted?: string } {
  const cut = (why: string) => ({ cut: `The organizer's page ${why}.` });
  if (!r) return cut("didn't answer");
  if (r.blocked) return { trusted: `shows ${r.blocked}` };
  if (r.unreachable)
    return /connection reset|timed out/.test(r.unreachable)
      ? { trusted: `didn't answer (${r.unreachable})` }
      : cut(`didn't answer (${r.unreachable})`);
  if (r.status === 0) {
    const to = host(r.finalUrl);
    return ev.url && to && to !== host(ev.url)
      ? cut(
          `redirects off its site to ${to}: link the page it lands on, if it's the organizer's`,
        )
      : cut("didn't resolve to a public address, or was refused");
  }
  if (r.status === 310) return cut("redirects too many times");
  if (
    r.status === 403 ||
    r.status === 429 ||
    (r.status >= 500 && r.status < 600)
  )
    return { trusted: `answered ${r.status}` };
  if (r.status === 404 || r.status === 410)
    return cut(
      `${r.finalUrl} answered ${r.status}: a dead link. Find the event's live page`,
    );
  if (r.status !== 200) return cut(`answered ${r.status}`);
  const text = r.text ?? "";
  if (looksWalled(text)) return { trusted: "shows a bot check" };
  if (!pageNamesEvent(r, ev.title))
    return cut(
      text.length < 40 && !r.data
        ? "prints nothing we can read without JavaScript. Quote its own data (JSON-LD, CMS), or leave it out"
        : `loaded and doesn't name "${ev.title}". Link the event's own page, or leave it out`,
    );
  // It names the event: its dates must be the page's too, each printed,
  // or inside the event's printed run (runCoversDate).
  const chunks = pageChunks(r);
  for (const d of ev.dates)
    if (
      !datePrinted(chunks, d.day, !!ev.recurring) &&
      !runCoversDate(r, d.day, ev.title, ev.listingQuotes)
    )
      return cut(
        `names "${ev.title}" but doesn't print ${d.day}. Check the date`,
      );
  return {};
}

/** A challenge or firewall page's words (served with any status). */
const WALL =
  /just a moment|checking (your|if the site connection is) (browser|secure)|verify (that )?you are (a )?human|attention required|access denied|request blocked|enable javascript and cookies|ddos protection/i;
const looksWalled = (text: string) => text.length < 3000 && WALL.test(text);

/** A page's sentences and data lines (a record or a sentence each). */
export function pageChunks(r: { text: string; data?: string }): string[] {
  return [
    ...(r.text ?? "").split(/(?<=[.!?])\s+|\s+\|\s+|\n/),
    ...(r.data ? r.data.split("\n") : []),
  ].filter(Boolean);
}

/**
 * Does a loaded page name the event? Within one sentence or one data
 * record (never words scattered across the page); a long run without
 * sentence breaks (a menu, a heading block) only by the title as a phrase.
 */
export function pageNamesEvent(
  r: { text: string; data?: string },
  title: string,
): boolean {
  return pageChunks(r).some((c) =>
    c.length <= 300 ? lineNamesEvent(c, title) : namesByPhrase(c, title),
  );
}

/** Why a page that didn't answer 200 was cut, and how the host kept us out. */
export function unreadable(
  url: string,
  r: Page,
  what: "page" | "quote",
): { problem: string; blocked?: EventVerdict["blocked"] } {
  const h = host(url);
  if (r?.blocked)
    return {
      problem:
        what === "page"
          ? `${h} shows ${r.blocked} instead of the page, so it can't be checked. Use the organizer's own page.`
          : `${h} shows ${r.blocked} instead of the page, so the quote can't be checked.`,
      blocked: { host: h, kind: r.blockedKind ?? "bot_check", url },
    };
  if (r?.unreachable)
    return {
      problem: `${h} didn't answer (${r.unreachable}).`,
      blocked: { host: h, kind: r.blockedKind ?? "reset", url },
    };
  return {
    problem: `${url} answered ${r?.status ?? "nothing"}, not 200.`,
    // A missing page (404, 410) is a dead link, not a host keeping us out.
    ...(r && r.status >= 400 && r.status !== 404 && r.status !== 410
      ? { blocked: { host: h, kind: "http_status" as const, url } }
      : {}),
  };
}

/** Days an issue may run ahead of the event it lists. */
export const ISSUE_MAX_AHEAD_DAYS = 42;

/**
 * Evidence from a newsletter issue in our inbox ("issue:<id>"), with the
 * listing rules: the issue is stored, the quote is in its text (the same
 * normalization as a web page), it names the event (checkEvent), a
 * printed weekday is the date's own (checkEvent), and the issue was sent
 * within 6 weeks before each date it proves (printed, or by a weekly
 * pattern; the first date for a quote that proves none). Our "what" is
 * never the issue's words. Returns the issue's day when it's stored and
 * the quote is in it (networkChecks caps the event's dates with it).
 */
async function issueChecks(
  e: EventInput,
  x: EventInput["evidence"][number],
  ctx: EventsContext,
  problems: string[],
): Promise<string | null> {
  const id = issueId(x.url)!;
  const issue = ctx.issue ? await ctx.issue(id) : null;
  if (!issue) {
    problems.push(
      `${x.url} isn't a stored newsletter issue (GET /api/events/issues lists them).`,
    );
    return null;
  }
  if (!onPage({ text: issue.text }, x.quote)) {
    problems.push(`The quote "${x.quote.slice(0, 60)}" isn't in ${x.url}.`);
    return null;
  }
  if (EXCLUSIVE.test(x.quote))
    problems.push(
      `${x.url} says "${e.title}" is for guests, owners or members only. Leave it out.`,
    );
  const recurring = kindOf(e) === "series" || !!e.series_id;
  const proven = e.dates.filter((d) =>
    datePrinted([x.quote], d.day, recurring),
  );
  const first = [...e.dates].sort((a, b) => a.day.localeCompare(b.day))[0];
  for (const d of proven.length ? proven : [first]) {
    const ahead = daysBetween(issue.day, d.day);
    if (ahead < 0 || ahead > ISSUE_MAX_AHEAD_DAYS)
      problems.push(
        `${x.url} (sent ${issue.day}) isn't within 6 weeks before ${d.day}.`,
      );
  }
  if (containment(e.what, issue.text) >= COPY_LIMIT.discovery)
    problems.push(
      "The what-kids-do line is too close to the listing. Say it in our own words.",
    );
  return issue.day;
}

async function networkChecks(
  e: EventInput,
  ctx: EventsContext,
  get: ReturnType<typeof pagePool>,
  problems: string[],
  warnings: string[],
): Promise<EventVerdict["blocked"]> {
  const domains = eventDomains(ctx.catalog.link_domains, ctx.ownHost);
  const evDomains = [...domains, ...(ctx.catalog.evidence_domains ?? [])];
  const listingHosts = ctx.catalog.listing_domains ?? [];
  const listing = e.verified_via === "listing";
  let blocked: EventVerdict["blocked"];
  // A listing event's link may be off the allowlist: fetch it within its
  // own registrable domain (a redirect elsewhere is refused, and cut).
  const main = await get(
    e.url,
    listing ? [...domains, siteOf(e.url, domains)] : domains,
  );
  // Where it lands must be the organizer's too, never a reseller.
  const landed =
    main?.finalUrl &&
    onList(main.finalUrl, ctx.catalog.not_organizer_domains ?? []);
  if (landed)
    problems.push(
      `${e.url} lands on ${landed}, which sells tickets or lists other people's events. Link the organizer's own page.`,
    );
  if (listing) {
    const why = organizerVerdict(main, {
      title: e.title,
      dates: e.dates,
      url: e.url,
      recurring: kindOf(e) === "series" || !!e.series_id,
      listingQuotes: e.evidence
        .filter((x) => issueId(x.url) != null || !!onList(x.url, listingHosts))
        .map((x) => x.quote),
    });
    if (why.cut) problems.push(why.cut);
    else if (why.trusted)
      warnings.push(
        `Trusted the listing: ${host(e.url)} ${why.trusted}. The nightly check keeps watching the listing.`,
      );
  } else if (!main || main.status !== 200) {
    const u = unreadable(e.url, main, "page");
    problems.push(u.problem);
    blocked ??= u.blocked;
  }
  const issueDays: string[] = [];
  for (const x of e.evidence) {
    if (issueId(x.url) != null) {
      const day = await issueChecks(e, x, ctx, problems);
      if (day) issueDays.push(day);
      continue;
    }
    const onListing = listing && !!onList(x.url, listingHosts);
    const r = await get(
      x.url,
      onListing ? [...evDomains, ...listingHosts] : evDomains,
    );
    if (!r || r.status !== 200) {
      const u = unreadable(x.url, r, "quote");
      problems.push(u.problem);
      blocked ??= u.blocked;
      continue;
    }
    if (!onPage(r, x.quote, e.title)) {
      problems.push(`The quote "${x.quote.slice(0, 60)}" isn't on ${x.url}.`);
      continue;
    }
    const q = normalizeText(x.quote);
    const lines = (r.data ?? "")
      .split("\n")
      .filter((l) => l.includes(q) && lineNamesEvent(l, e.title));
    // Not open to the public (a resort's guests, owners or members only).
    if (
      EXCLUSIVE.test(x.quote) ||
      (r.data ?? "")
        .split("\n")
        .some((l) => lineNamesEvent(l, e.title) && EXCLUSIVE.test(l))
    )
      problems.push(
        `${host(x.url)} says "${e.title}" is for guests, owners or members only. Leave it out.`,
      );
    // A catalog by path: the record must be that catalog's own.
    const alias = aliasPathProblem(x.url, ctx.catalog.alias_paths);
    if (alias.prefix && !r.text.includes(q)) {
      const id = alias.prefix.split("/").filter(Boolean).pop()!;
      if (!lines.some((l) => l.includes(id)))
        problems.push(
          `The record quoted on ${host(x.url)} isn't in catalog ${id}.`,
        );
    }
    // A listing's year-less date: only from an issue dated within 6
    // weeks before the event.
    if (onListing) {
      const printed = e.dates.filter((d) => quotePrintsDate(x.quote, d.day));
      const yearless =
        printed.length > 0 &&
        !/\b20\d{2}\b/.test(x.quote) &&
        !printed.some((d) => machinePrintsDay(x.quote.toLowerCase(), d.day));
      if (yearless) {
        const issued = issueDay(r.text);
        if (!issued)
          problems.push(
            `Can't tell the issue's date on ${x.url}, so "${x.quote.slice(0, 40)}" has no year. Quote a line with the year (a listing page's JSON-LD).`,
          );
        else
          for (const d of printed) {
            const ahead = daysBetween(issued, d.day);
            if (ahead < 0 || ahead > 42)
              problems.push(
                `The issue (${issued}) isn't within 6 weeks before ${d.day}: its year-less date may be another year's.`,
              );
          }
      }
    }
  }
  // An event standing on an issue: no date past 6 weeks after it (a
  // series' later dates need a later issue, or another source).
  if (issueDays.length) {
    const cap = addDays(issueDays.sort().at(-1)!, ISSUE_MAX_AHEAD_DAYS);
    for (const d of e.dates)
      if (d.day > cap)
        problems.push(
          `${d.day} is more than 6 weeks after the issue it stands on (${cap} at most).`,
        );
  }
  // Our own words: never the listing's.
  if (listing)
    for (const x of e.evidence) {
      if (!onList(x.url, listingHosts)) continue;
      const r = await get(x.url, [...evDomains, ...listingHosts]);
      if (r?.text && containment(e.what, r.text) >= COPY_LIMIT.discovery)
        problems.push(
          "The what-kids-do line is too close to the listing. Say it in our own words.",
        );
    }
  // Our own words: never the official page's, never the roundup's.
  const mainText =
    main?.status === 200 && !main.blocked
      ? [main.text, main.data].filter(Boolean).join(" ")
      : "";
  if (mainText && containment(e.what, mainText) >= COPY_LIMIT.primary)
    problems.push(
      "The what-kids-do line copies the official page. Say it in our own words.",
    );
  const discoveryIssue = e.discovery_url ? issueId(e.discovery_url) : null;
  if (discoveryIssue != null) {
    const d = ctx.issue ? await ctx.issue(discoveryIssue) : null;
    if (!d)
      problems.push(
        `${e.discovery_url} isn't a stored issue, so the copy check couldn't run.`,
      );
    else if (containment(e.what, d.text) >= COPY_LIMIT.discovery)
      problems.push(
        "The what-kids-do line is too close to where we found the event. Write it from the official page.",
      );
  } else if (e.discovery_url) {
    const d = await get(e.discovery_url, [host(e.discovery_url)]);
    // A discovery page we can't read can't clear the copy check.
    if (!d || d.status !== 200)
      problems.push(
        "The discovery page didn't load, so the copy check couldn't run. Try again later.",
      );
    else if (containment(e.what, d.text) >= COPY_LIMIT.discovery)
      problems.push(
        "The what-kids-do line is too close to where we found the event. Write it from the official page.",
      );
  }
  return blocked;
}
