/**
 * One short line saying what kids do at an event, from its stored `what`:
 * shared by the social roundup's slides and The Scoop's event cards, so
 * both cut the same way. Pure.
 */

/** The longest event descriptor (two lines on a slide or a card). */
export const DESC_MAX = 70;

/** Where a long sentence may be cut: before a clause or a place phrase. */
const CUTS =
  /(?=[,;:]\s)|(?=\s[–—-]\s)|(?=\s(?:with|at|in|on|for|from|during|where|while|and|or|plus|then|before|after|using|led by|hosted by|presented by|inside|outside|near|to (?:make|create|build|learn|explore|try|see|play|take|bring|share))\s)/gi;

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

/**
 * A head that stops inside an open comma run ("Kids bring a favorite book,
 * curl up" before "with snacks and read quietly"): back up to before the
 * run's first comma. A run already closed by "and" or "or" ("Stories,
 * songs and rhymes for babies") is whole.
 */
function openRun(head: string): string {
  // An open run after a colon ("circle time: sitting together") backs up too.
  const colon = head.indexOf(": ");
  if (colon >= 0 && !/\b(and|or)\b/i.test(head.slice(colon + 2)))
    return head.slice(0, colon);
  const last = head.lastIndexOf(", ");
  if (last < 0 || /\b(and|or)\b/i.test(head.slice(last + 2))) return head;
  return head.slice(0, head.indexOf(", "));
}

/** A head ending on an adjective a comma would split from its noun. */
const ADJ_COMMA =
  /\b(big|small|little|tiny|huge|fun|festive|bright|cozy|colorful|fancy|free|live|new|old|short|long|warm|quiet|calm|happy|silly|special|friendly|hands-on|interactive|magical|sparkly|snowy|giant)$/i;

/** A head that stops a clause short: a participle, or "and work it". */
const SHORT_CLAUSE =
  /(\b(brought|held|led|set|hosted|presented|offered|made|put|run|dig|dive)|\b(and|then)\s\w+\s(it|them))$/i;

/** A relative clause's first words ("pictures that go up"): back up before it. */
const SHORT_RELATIVE = /\s(that|which|who)(\s\S+){0,3}$/i;

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
    const rest = plain.slice(m.index);
    const comma = /^[,;:]/.test(rest);
    if (QUALIFIER.test(rest)) continue;
    const head = plain.slice(0, m.index).replace(SHORT_RELATIVE, "");
    // Inside a list ("the slide, rope swing, and ..."): a comma or "and"
    // after an earlier comma would leave the list half-said.
    if (LIST_BREAK.test(rest) && /,\s/.test(head)) continue;
    if (comma) {
      // A comma between two adjectives ("in a big, festive show").
      if (ADJ_COMMA.test(head)) continue;
      // A comma that starts a list ("sing, bounce and play"): never mid-list.
      if (/^,\s(?:[^,;:]+,\s)*[^,;:]*\b(and|or)\b/i.test(rest)) continue;
    }
    // A clause cut short ("pictures that go up", "exhibits brought").
    if (SHORT_CLAUSE.test(head)) continue;
    // "to shape" before "and decorate": the verbs are one thought.
    if (/\bto\s\w+$/i.test(head) && LIST_BREAK.test(rest)) continue;
    const run = openRun(head);
    // Backing up must not land just before a qualifier either.
    if (
      run !== head &&
      (QUALIFIER.test(plain.slice(run.length)) || ADJ_COMMA.test(run))
    )
      continue;
    const cut = tidy(run);
    if (cut.length > max) break;
    if (cut.length >= 24) best = cut;
  }
  return ok(best);
}
