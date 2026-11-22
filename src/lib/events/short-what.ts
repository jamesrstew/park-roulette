/**
 * One short line saying what kids do at an event, from its stored `what`:
 * shared by the social roundup's slides and The Scoop's event cards, so
 * both cut the same way. Pure.
 */

/** The longest event descriptor (two lines on a slide or a card). */
export const DESC_MAX = 70;

/** Where a long sentence may be cut: before a clause or a place phrase. */
const CUTS =
  /(?=[,;:]\s)|(?=\s[–—-]\s)|(?=\s(?:with|at|in|into|on|for|from|during|where|while|and|or|plus|then|before|after|using|led by|hosted by|presented by|inside|outside|near|to (?:make|create|build|learn|explore|try|see|play|take|bring|share))\s)/gi;

/** Words a descriptor can't end on (abbreviations too: "Celebrate Dr"). */
const DANGLING =
  /\s+(and|or|with|the|a|an|for|to|of|at|in|on|plus|their|your|its|by|from|as|dr|mr|mrs|ms|st|mt|ft)$/i;

/** A period that isn't a sentence's end: titles, saints, mounts, a.m., initials. */
const ABBREV =
  /(?:\b(?:Dr|Mr|Mrs|Ms|St|Mt|Ft|No|vs|Jr|Sr|Ave|Rd|Blvd|approx|e\.g|i\.e)|\b[ap]\.m|(?:^|\s)[A-Z])\.$/i;

/** The first sentence, never split after an abbreviation ("Dr. Seuss", "10 a.m. Saturday"). */
export function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  for (const m of t.matchAll(/[.!?](?=\s+[A-Z0-9])/g)) {
    const head = t.slice(0, m.index + 1);
    if (m[0] === "." && ABBREV.test(head)) continue;
    return head;
  }
  return t;
}

/** A cut at a comma or a list's "and"/"or". */
const LIST_BREAK = /^(,|\s(?:and|or)\s)/i;

/** A clause a descriptor can't stop just before: it qualifies what came first. */
const QUALIFIER = /^[\s,;:–—-]*(but|except|unless)\b/i;

/** A negation or a rule: not what kids do, and wrong without the rest. */
const RULE =
  /\b(not|no|never|only|must|required|requires?|mandatory|cannot)\b|n't\b/i;

/**
 * A short line saying what kids do there, from the stored event's `what`
 * (the harvest's verified summary): its first sentence when that's 70
 * characters or less, else cut before a clause or a place phrase at a word
 * boundary ("Stories, songs and rhymes for babies" from "... for babies
 * and their grown-ups at the Downtown Bend Library"). Never an ellipsis,
 * a cut mid-thought or just before "but", "except" or "unless", a line
 * ending on an abbreviation, or one with a negation or a rule: then null
 * (the slide shows no line).
 */
export function shortWhat(
  what: string | undefined,
  /** The longest line: a slide's two lines (70), or a card's three. */
  max = DESC_MAX,
): string | null {
  if (!what) return null;
  const sentence = firstSentence(what);
  const first = sentence.replace(/[!?]+$/, "").trim();
  // "Meet Dr." with nothing after: the abbreviation is the end. Never a line.
  const plain = ABBREV.test(first) ? null : first.replace(/\.+$/, "").trim();
  if (!plain) return null;
  const tidy = (t: string) => {
    let x = t.trim().replace(/[\s,;:–—-]+$/, "");
    while (DANGLING.test(x))
      x = x.replace(DANGLING, "").replace(/[\s,;:–—-]+$/, "");
    return x ? x[0].toUpperCase() + x.slice(1) : x;
  };
  const ok = (x: string | null) => (x && !RULE.test(x) ? x : null);
  if (plain.length <= max) return plain.length >= 12 ? ok(tidy(plain)) : null;
  let best: string | null = null;
  for (const m of plain.matchAll(CUTS)) {
    if (QUALIFIER.test(plain.slice(m.index))) continue;
    // Inside a list ("the slide, rope swing, and ..."): a comma or "and"
    // after an earlier comma would leave the list half-said.
    const head = plain.slice(0, m.index);
    if (LIST_BREAK.test(plain.slice(m.index)) && /,\s/.test(head)) continue;
    const cut = tidy(head);
    if (cut.length > max) break;
    if (cut.length >= 24) best = cut;
  }
  return ok(best);
}
