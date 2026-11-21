/**
 * Binding a quote from structured data to its event: a data line (one
 * JSON, JSON-LD or .ics record) proves a fact only when it also names the
 * event, so a date from another record, or a record's "updated" time,
 * never proves this event's date. Pure, no imports: the events validator,
 * the nightly check and the issue checker share it.
 */

/** Lowercase words only ("Story Time: Snow!" -> "story time snow"). */
export const flat = (x: string) =>
  x
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const MINOR = new Set([
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

/**
 * Does this data line name the event? It holds the title, or the title's
 * stem (the part before a colon or dash), or every word of the stem.
 */
export function lineNamesEvent(lineText: string, title: string): boolean {
  const l = ` ${flat(lineText)} `;
  const stem = flat(title.split(/[:(|]| - | – /)[0]);
  if (!stem) return false;
  if (l.includes(` ${flat(title)} `) || l.includes(` ${stem} `)) return true;
  const words = stem.split(" ").filter((w) => w.length > 1 && !MINOR.has(w));
  return words.length > 0 && words.every((w) => l.includes(` ${w} `));
}

/**
 * Is a normalized quote in one line of the data that also names one of
 * the titles? With no titles, any line counts (callers that know the
 * event always pass its title).
 */
export function dataHasQuote(
  data: string | undefined,
  q: string,
  titles: readonly string[],
): boolean {
  if (!data || !q) return false;
  return data
    .split("\n")
    .some(
      (l) =>
        l.includes(q) &&
        (!titles.length || titles.some((t) => lineNamesEvent(l, t))),
    );
}
