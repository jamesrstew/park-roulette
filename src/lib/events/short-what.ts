/**
 * Event descriptors, shared: the social roundup's short line (shortWhat,
 * unchanged from its reviewed behavior) and The Scoop cards' whole first
 * sentence (firstSentence with a max). Pure.
 */

/** The longest event descriptor (two lines on the slide). */
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
export function shortWhat(what: string | undefined): string | null {
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
  if (plain.length <= DESC_MAX)
    return plain.length >= 12 ? ok(tidy(plain)) : null;
  let best: string | null = null;
  for (const m of plain.matchAll(CUTS)) {
    if (QUALIFIER.test(plain.slice(m.index))) continue;
    const cut = tidy(plain.slice(0, m.index));
    if (cut.length > DESC_MAX) break;
    if (cut.length >= 24) best = cut;
  }
  return ok(best);
}
