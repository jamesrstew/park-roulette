/**
 * Parents' corner's plan-time text filter, shared by X and Instagram:
 * a candidate whose text or caption matches either list is dropped before
 * the writer sees it. Rule-based and conservative on purpose: a false
 * match costs one post, a miss costs a reader. The writer's own safety
 * bar still applies to whatever gets through.
 */

/**
 * Obvious politics: names, parties, offices and campaign words, "vote"
 * and "election" included.
 */
export const POLITICS =
  /\b(trump|biden|harris|kamala|obama|vance|desantis|newsom|pelosi|mcconnell|schumer|aoc|maga|gop|republicans?|democrats?|dems|liberals?|conservatives?|election|elections|election day|ballot|voters?|vot(e|es|ed|ing)|congress|senate|senators?|congressman|congresswoman|white house|president|presidential|governor|impeach\w*|campaign|politic\w*|partisan|left-?wing|right-?wing|tariffs?|immigration|ice raids?|abortion|gun control|second amendment|supreme court)\b/i;

/**
 * Profanity a family email won't carry, including the usual masked
 * spellings (f*ck, sh!t). Mild words (crap, damn, hell) pass.
 */
export const PROFANITY =
  /\b(f+[u*@#!]+c?k\w*|f[*@#!]+\w*k\w*|fck\w*|fuk\w*|wtf|stfu|af\b|sh[i!*1]t\w*|bullsh\w*|b[i!*1]tch\w*|a[s$*]{2}hole\w*|dick(head)?s?|cocks?|cocksuck\w*|puss(y|ies)|cunt\w*|bastards?|motherf\w*|goddamn\w*|twat\w*|wank\w*|slut\w*|whore\w*)\b/i;

/** Why a post's text is out ("politics", "profanity"), or null. */
export function unsafeText(text: string | undefined | null): string | null {
  if (!text) return null;
  if (POLITICS.test(text)) return "politics";
  if (PROFANITY.test(text)) return "profanity";
  return null;
}
