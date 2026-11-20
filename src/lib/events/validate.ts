import { ageTags } from "./ages";
import {
  clock,
  type EventInput,
  EventInput as EventInputSchema,
  eventSlug,
  kindOf,
  pacificToday,
  seriesKey,
  type StoredEvent,
  storedFrom,
} from "./model";
import { allowedLink, type Catalog } from "@/lib/news/catalog";
import { addDays } from "@/lib/news/time";
import {
  blockedLink,
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
  catalog: Pick<Catalog, "link_domains" | "event_series">;
  /** Public parks on our map, by slug (a venue at a park uses its pin). */
  parks: ReadonlyMap<string, { lat: number; lng: number; name: string }>;
  /** Omit for a quick check (no pages fetched). */
  fetcher?: Fetcher;
  /** Our own host (never an event's page). */
  ownHost?: string;
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
};

/** Dates one series may carry from one hand-in. */
export const MAX_SERIES_DATES = 30;

/** Events this far out at most (the listing shows 60 days). */
export const MAX_DAYS_AHEAD = 120;
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

/**
 * One page cache for a whole hand-in, with at most 2 fetches at a time
 * per host (the same library page is often evidence for many events).
 */
export function pagePool(fetcher: Fetcher, perHost = 2) {
  const pages = new Map<string, Promise<Page>>();
  const busy = new Map<string, number>();
  const queue = new Map<string, (() => void)[]>();
  const acquire = async (h: string) => {
    if ((busy.get(h) ?? 0) >= perHost)
      await new Promise<void>((r) =>
        queue.set(h, [...(queue.get(h) ?? []), r]),
      );
    busy.set(h, (busy.get(h) ?? 0) + 1);
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

/** Does a quote print this date: "Nov 21", "November 21st", "11/21"? */
export function quotePrintsDate(quote: string, day: string): boolean {
  const q = quote.toLowerCase();
  const [y, m, d] = day.split("-").map(Number);
  // A printed year must be the claimed one (", 2025", "/2025", "/25").
  const yearOk = (printed: string | undefined) =>
    !printed ||
    Number(printed) === y ||
    (printed.length === 2 && Number(printed) === y % 100);
  const long = new RegExp(
    `\\b${MONTHS3[m - 1]}[a-z]*\\.?\\s+${d}(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4})\\b)?`,
    "g",
  );
  const short = new RegExp(
    `(?<!\\d)${m}/${d}(?!\\d)(?:/(\\d{4}|\\d{2})\\b)?`,
    "g",
  );
  return [...q.matchAll(long), ...q.matchAll(short)].some((x) => yearOk(x[1]));
}

/** A printed span in a quote ("Nov 4 to Dec 16", "Nov 4 - 25"), as dates. */
export function printedSpans(
  quote: string,
  year: number,
): { from: string; to: string }[] {
  const q = quote.toLowerCase();
  const mon = `(${MONTHS3.join("|")})[a-z]*\\.?`;
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
  const today = pacificToday(ctx.now);
  // Quotes under 12 characters only when they print a price or "free"
  // with a date or time.
  for (const x of e.evidence)
    if (
      x.quote.trim().length < 12 &&
      !(
        /\$\s?\d|\bfree\b/i.test(x.quote) &&
        (e.dates.some((d) => quotePrintsDate(x.quote, d.day)) ||
          /\b\d{1,2}(:\d{2})?\s*(a\.?m|p\.?m)\b|\bnoon\b/i.test(x.quote))
      )
    )
      p.push(
        `The quote "${x.quote}" is too short: 12 characters, or 8 with a price or "free" and a date or time.`,
      );

  for (const [name, text] of [
    ["title", e.title],
    ["what", e.what],
    ["cost", e.cost?.text ?? ""],
    ["parking", e.parking ?? ""],
    ["signup note", e.signup?.note ?? ""],
  ] as const)
    for (const s of styleProblems(text)) p.push(`${name}: ${s}`);

  if (e.series_id) {
    const s = ctx.catalog.event_series.find((x) => x.id === e.series_id);
    if (!s || !s.verified)
      p.push(`Unknown or unverified event series "${e.series_id}".`);
  }

  // Primary sources only.
  const links = [
    e.url,
    ...e.evidence.map((x) => x.url),
    ...(e.organizer ? [e.organizer.url] : []),
  ];
  for (const u of new Set(links)) {
    const h = host(u).replace(/^www\./, "");
    if (
      h === own ||
      h.endsWith(`.${own}`) ||
      /(^|\.)parkroulette\.quest$/.test(h)
    )
      p.push("Our own site is never an event's page or evidence.");
    else if (blockedLink(u))
      p.push(`${host(u)} is another newsletter. Link the primary source.`);
    else if (!allowedLink(u, domains))
      p.push(`${host(u)} isn't on the link allowlist.`);
  }
  const site = siteOf(e.url, domains);
  for (const x of e.evidence)
    if (siteOf(x.url, domains) !== site)
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
    if (!datePrinted(quotes, d.day, recurring))
      p.push(
        `No evidence quote prints ${d.day} (its month and day, or a weekly pattern within a printed span).`,
      );
    if (d.end_day && !datePrinted(quotes, d.end_day, false))
      p.push(`No evidence quote prints the end date ${d.end_day}.`);
    if (d.start && !quotes.some((q) => quotePrintsTime(q, d.start!, "start")))
      p.push(`No evidence quote prints the start time ${clock(d.start)}.`);
    if (d.end && !quotes.some((q) => quotePrintsTime(q, d.end!, "end")))
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
  const mine = e.evidence.filter((x) => siteOf(x.url, domains) === site);
  const target = (day: string) =>
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
  const pool = ctx.fetcher ? pagePool(ctx.fetcher) : null;
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
      const e = parsed.data;
      const { problems, checkQuote, targets } = checkEvent(e, ctx);
      const warnings: string[] = [];
      if (pool && !problems.length) await networkChecks(e, ctx, pool, problems);
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
          ? {}
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

async function networkChecks(
  e: EventInput,
  ctx: EventsContext,
  get: ReturnType<typeof pagePool>,
  problems: string[],
) {
  const domains = eventDomains(ctx.catalog.link_domains, ctx.ownHost);
  const main = await get(e.url, domains);
  if (!main || main.status !== 200)
    problems.push(
      main?.blocked
        ? `${host(e.url)} shows ${main.blocked} instead of the page, so it can't be checked. Use the organizer's own page.`
        : `${e.url} answered ${main?.status ?? "nothing"}, not 200.`,
    );
  for (const x of e.evidence) {
    const r = await get(x.url, domains);
    if (!r || r.status !== 200) {
      problems.push(
        r?.blocked
          ? `${host(x.url)} shows ${r.blocked} instead of the page, so the quote can't be checked.`
          : `${x.url} answered ${r?.status ?? "nothing"}, not 200.`,
      );
      continue;
    }
    if (!r.text.includes(normalizeText(x.quote)))
      problems.push(`The quote "${x.quote.slice(0, 60)}" isn't on ${x.url}.`);
  }
  // Our own words: never the official page's, never the roundup's.
  if (main?.text && containment(e.what, main.text) >= COPY_LIMIT.primary)
    problems.push(
      "The what-kids-do line copies the official page. Say it in our own words.",
    );
  if (e.discovery_url) {
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
}
