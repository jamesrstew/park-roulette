/**
 * Event descriptors, shared: the whole first sentence of `what`
 * (firstSentence, with a max for The Scoop's cards and the roundup's
 * fallback) and the logistics guard. Never a clause cut: the roundup's
 * short line is the event's own checked `short` (lib/events/short.ts).
 * Pure.
 */

/** The longest event descriptor (two lines on the slide). */
export const DESC_MAX = 70;

/** A period that isn't a sentence's end: titles, saints, mounts, a.m., initials. */
const ABBREV =
  /(?:\b(?:Dr|Mr|Mrs|Ms|St|Mt|Ft|No|vs|Jr|Sr|Ave|Rd|Blvd|approx|e\.g|i\.e)|\b[ap]\.m|(?:^|\s)[A-Z])\.$/i;

/**
 * The first sentence, never split after an abbreviation ("Dr. Seuss",
 * "10 a.m. Saturday"). With a max (The Scoop's cards): the whole sentence,
 * its period dropped, or null when it's longer. Never a clause cut.
 */
export function firstSentence(text: string): string;
export function firstSentence(
  text: string | undefined,
  max: number,
): string | null;
export function firstSentence(
  text: string | undefined,
  max?: number,
): string | null {
  if (max !== undefined) {
    if (!text?.trim()) return null;
    const whole = firstSentence(text);
    // Ending on an abbreviation ("Meet Dr."): never a line.
    if (ABBREV.test(whole)) return null;
    const s = whole.replace(/\.$/, "").trim();
    return s && s.length <= max ? s : null;
  }
  text ??= "";
  const t = text.replace(/\s+/g, " ").trim();
  for (const m of t.matchAll(/[.!?](?=\s+[A-Z0-9])/g)) {
    const head = t.slice(0, m.index + 1);
    if (m[0] === "." && ABBREV.test(head)) continue;
    return head;
  }
  return t;
}

/** A negation or a rule: not what kids do, and wrong without the rest. */
export const RULE =
  /\b(not|no|never|only|must|required|requires?|mandatory|cannot)\b|n't\b/i;

/**
 * Logistics, not what kids do: the roundup's negation and rule guard plus
 * sign-up and bring-your-own words. A card shows no such sentence.
 */
export const LOGISTICS = new RegExp(
  `${RULE.source}|\\b(registration|register|registering|sign[- ]?ups?|tickets?|reservations?|reserve|bring your own|space is limited|limited space|first come)\\b`,
  "i",
);
