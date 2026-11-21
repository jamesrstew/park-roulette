import { dataHasQuote } from "./binding";
import { normalizeText, pageText } from "@/lib/news/validate";

/**
 * Structured evidence: the organization's own machine data, as text a
 * quote can be matched against. Some official pages print no text
 * without JavaScript (the High Desert Museum, Sunriver Resort), but they
 * carry the same facts as JSON-LD, a CMS JSON endpoint, the page's own
 * Next.js data, or an .ics feed.
 * Each record becomes one line of its field values, " | " between
 * fields, so a quote is copied from the organizer's data, never made up.
 * Pure: no network, no server imports.
 */

/** At most this many characters of structured text per page. */
const MAX_CHARS = 400_000;

/** Join a record's values into one line. */
const line = (values: unknown[]) =>
  values
    .map((v) => (typeof v === "number" ? String(v) : v))
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => cleanValue(v))
    .filter(Boolean)
    .join(" | ");

/** A field's value as plain text (HTML in a description stripped). */
function cleanValue(v: string): string {
  return /<[a-z!/]/i.test(v) ? pageText(v) : normalizeText(v);
}

const isEventType = (t: unknown): boolean =>
  (typeof t === "string" && /Event$/.test(t)) ||
  (Array.isArray(t) && t.some(isEventType));

/** Every object in a JSON-LD tree (the @graph included). */
function* objects(
  node: unknown,
  depth = 0,
): Generator<Record<string, unknown>> {
  if (depth > 8 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) yield* objects(n, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  yield o;
  for (const v of Object.values(o)) yield* objects(v, depth + 1);
}

/** The values of a Place or PostalAddress (name, street, town). */
function place(p: unknown): unknown[] {
  if (typeof p === "string") return [p];
  if (!p || typeof p !== "object") return [];
  const o = p as Record<string, unknown>;
  const a = o.address;
  const addr =
    a && typeof a === "object"
      ? [
          (a as Record<string, unknown>).streetAddress,
          (a as Record<string, unknown>).addressLocality,
        ]
      : [a];
  return [o.name, ...addr];
}

/** The values of offers (price, "Free"), one object or a list. */
function offers(x: unknown): unknown[] {
  const list = Array.isArray(x) ? x : x ? [x] : [];
  return list.flatMap((o) =>
    o && typeof o === "object"
      ? [
          (o as Record<string, unknown>).name,
          (o as Record<string, unknown>).price,
        ]
      : [],
  );
}

/** One line per JSON-LD Event on an HTML page. */
export function jsonLdText(html: string): string {
  const out: string[] = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // a broken block is just not evidence
    }
    for (const o of objects(parsed)) {
      if (!isEventType(o["@type"])) continue;
      out.push(
        line([
          o.name,
          o.startDate,
          o.endDate,
          o.eventStatus,
          ...place(o.location),
          ...offers(o.offers),
          o.isAccessibleForFree === true ? "Free" : undefined,
          o.typicalAgeRange,
          o.description,
        ]),
      );
    }
  }
  return out.filter(Boolean).join("\n").slice(0, MAX_CHARS);
}

/**
 * Bookkeeping times (when a record was edited, not when the event is), and
 * other dates that aren't the event's: how far a booking calendar is
 * filled in (availabilityCoveredTo), when a listing expires, a cutoff or
 * deadline, blackout, sold-out, closed or excluded dates.
 */
const DROP_KEY =
  /modif|updat|creat|publish|covered|expir|cutoff|deadline|blackout|unavailable|sold_?out|closed|exclud/i;
/** A link or path ("https://…/2026-12-24/…", "/events/2026-12-23/"). */
const URLISH = /^(https?:\/\/|\/)\S*$/i;
/** Labels on a record (Sunriver's "kouto.vibe" tags). */
const TAG_KEY = /^(tags|categories|labels|vibes|badges)$/;
/** A record's own name. */
const TITLE_KEY = /^(title|name|eventname|summary|heading)$/;
/** Machine dates in a value ("2026-11-21", "20261121T1000"). */
const MACHINE = /\d{4}-\d{2}-\d{2}|\d{8}t\d{4}/i;

const bare = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");
/** A known start or end key (startDate, event_start, raw_end_time, date...). */
export function whenKey(k: string): boolean {
  const b = bare(k);
  return (
    /^(start|end|begin|starts|ends)/.test(b) ||
    /(start|end)(date|time|at|datetime)?$/.test(b) ||
    /dates$/.test(b) ||
    /^(date|dates|time|datetime|datestring|timestring|datedisplay|timedisplay|simpledate|when|day)$/.test(
      b,
    )
  );
}

/**
 * A CMS JSON endpoint: one line per record (an object with string values),
 * its title first, then its known start and end values, then the rest.
 * Bookkeeping keys (modified, updated, created, published) are dropped,
 * and when a record has known start or end keys, other machine dates in
 * it are dropped too. A nested record without a title of its own (an
 * event's dates[]) starts with its parent's title, so every line says
 * which event it's about.
 */
export function jsonText(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "";
  }
  return jsonLines(parsed).join("\n").slice(0, MAX_CHARS);
}

const scalar = (v: unknown): v is string | number =>
  typeof v === "string" || typeof v === "number";

/**
 * One line per record of a parsed JSON tree (see jsonText). A date inside
 * a link or path value is never one of the record's dates. With `oneLevel`
 * (a page's own render data, where records nest in layout), a record
 * passes its title to the records directly inside it, no deeper.
 */
function jsonLines(parsed: unknown, maxDepth = 10, oneLevel = false): string[] {
  const out: string[] = [];
  const walk = (
    node: unknown,
    depth: number,
    parentTitle?: string,
    tag = false,
  ) => {
    if (depth > maxDepth || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1, parentTitle, tag);
      return;
    }
    const entries = Object.entries(node as Record<string, unknown>).filter(
      ([k]) => !DROP_KEY.test(k),
    );
    // A list of plain values (availableDates: ["2026-11-21"]) is one value.
    const scalars = entries
      .flatMap(([k, v]): [string, string | number][] =>
        scalar(v)
          ? [[k, v]]
          : Array.isArray(v) &&
              v.length > 0 &&
              v.length <= 60 &&
              v.every(scalar)
            ? [[k, v.join(", ")]]
            : [],
      )
      .filter(([, v]) => !(URLISH.test(String(v)) && MACHINE.test(String(v))));
    // A tag's name ("Exclusive to Resort Guests & Members") is a value of
    // the record it labels, not a record of its own.
    const title = tag
      ? undefined
      : scalars.find(([k]) => TITLE_KEY.test(bare(k)))?.[1];
    const hasWhen = scalars.some(([k]) => whenKey(k));
    const kept = scalars.filter(
      ([k, v]) => !hasWhen || whenKey(k) || !MACHINE.test(String(v)),
    );
    const own = line([
      title ?? parentTitle,
      ...kept.filter(([k]) => whenKey(k)).map(([, v]) => v),
      ...kept
        .filter(([k]) => !whenKey(k) && (tag || !TITLE_KEY.test(bare(k))))
        .map(([, v]) => v),
    ]);
    const hasOwn = kept.some(([k]) => tag || !TITLE_KEY.test(bare(k)));
    if (own && hasOwn) out.push(own);
    const next =
      typeof title === "string" ? title : oneLevel ? undefined : parentTitle;
    for (const [k, v] of entries)
      if (v && typeof v === "object")
        walk(v, depth + 1, next, TAG_KEY.test(bare(k)));
  };
  walk(parsed, 0);
  return out;
}

/**
 * The rows of a flight payload, each without its "id:" prefix. A row ends
 * at a newline, except a text row ("1a:T9e9,..."), which is that many
 * UTF-8 bytes (hex) with no newline after it.
 */
export function flightRows(payload: string): string[] {
  const bytes = new TextEncoder().encode(payload);
  const dec = new TextDecoder();
  const rows: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    let colon = i;
    while (colon < bytes.length && bytes[colon] !== 58 && bytes[colon] !== 10)
      colon++;
    if (colon >= bytes.length) break;
    if (bytes[colon] === 10) {
      i = colon + 1; // not a row
      continue;
    }
    const at = colon + 1;
    if (bytes[at] === 84 /* T */) {
      let comma = at + 1;
      while (comma < bytes.length && bytes[comma] !== 44) comma++;
      const len = parseInt(dec.decode(bytes.subarray(at + 1, comma)), 16);
      if (!Number.isFinite(len)) break;
      rows.push(dec.decode(bytes.subarray(comma + 1, comma + 1 + len)));
      i = comma + 1 + len;
      continue;
    }
    let nl = at;
    while (nl < bytes.length && bytes[nl] !== 10) nl++;
    rows.push(dec.decode(bytes.subarray(at, nl)));
    i = nl + 1;
  }
  return rows;
}

/**
 * The data a Next.js page carries for its own rendering, when its HTML has
 * no text of its own (a client-rendered page, like Sunriver Resort's): the
 * App Router's flight data (self.__next_f.push([1, "..."]) chunks, one
 * "id:JSON" row a line) and the Pages Router's __NEXT_DATA__. Each JSON
 * row is read like a CMS endpoint (one line per record). This is the
 * organizer's own page, as its own script reads it.
 */
export function nextDataText(html: string): string {
  const out: string[] = [];
  const chunks: string[] = [];
  for (const m of html.matchAll(
    /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g,
  )) {
    try {
      chunks.push(JSON.parse(m[1]) as string);
    } catch {
      // a broken chunk is just not evidence
    }
  }
  for (const row of flightRows(chunks.join(""))) {
    if (!/^[[{]/.test(row)) continue;
    try {
      // React trees nest deep: allow more depth than a CMS record.
      out.push(...jsonLines(JSON.parse(row), 60, true));
    } catch {
      continue;
    }
  }
  const nd = html.match(
    /<script\b[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (nd)
    try {
      out.push(...jsonLines(JSON.parse(nd[1]), 40, true));
    } catch {
      // not evidence
    }
  return out.join("\n").slice(0, MAX_CHARS);
}

const ICS_FIELDS = [
  "SUMMARY",
  "DTSTART",
  "DTEND",
  "LOCATION",
  "STATUS",
  "DESCRIPTION",
] as const;

/** An .ics feed: one line per VEVENT (summary, start, end, place, status, description). */
export function icsText(body: string): string {
  // Unfold continuation lines (RFC 5545 3.1).
  const lines = body.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: string[] = [];
  let ev: Partial<Record<(typeof ICS_FIELDS)[number], string>> | null = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") ev = {};
    else if (l === "END:VEVENT" && ev) {
      out.push(line(ICS_FIELDS.map((f) => ev![f])));
      ev = null;
    } else if (ev) {
      const m = l.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/);
      const f = m?.[1] as (typeof ICS_FIELDS)[number] | undefined;
      if (f && ICS_FIELDS.includes(f))
        ev[f] = m![2].replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
    }
  }
  return out.join("\n").slice(0, MAX_CHARS);
}

/** The structured text of a fetched body, by its type. */
export function structuredText(body: string, contentType: string): string {
  const t = contentType.toLowerCase();
  if (t.includes("text/calendar") || /^BEGIN:VCALENDAR/.test(body.trimStart()))
    return icsText(body);
  if (t.includes("json")) return jsonText(body);
  if (t.includes("html") || /<html|<script/i.test(body.slice(0, 2000)))
    return [jsonLdText(body), nextDataText(body)]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_CHARS);
  return "";
}

/**
 * Is a quote on this page: in its text, or in one line of its structured
 * data that also names the event (with `title`), so a date from another
 * record, or a record's "updated" time, never proves this event's date?
 */
export function onPage(
  r: { text: string; data?: string },
  quote: string,
  title?: string,
): boolean {
  const q = normalizeText(quote);
  if (!q) return false;
  if (r.text.includes(q)) return true;
  return dataHasQuote(r.data, q, title ? [title] : []);
}
