import { unsafeText } from "@/lib/news/safety";
import { LOGISTICS } from "./short-what";

/**
 * An event's `short`: a complete phrase, written by the harvest routine
 * (or the backfill), saying what kids do there in 70 characters or fewer
 * ("Kids sculpt air-dry clay into a little creature to take home"). Code
 * checks it here; a failing line is dropped with a warning, never the
 * event. Pure: the hand-in validator, PATCH /api/events/<slug>/short and
 * scripts/backfill-shorts.mts share it.
 */

export const SHORT_MAX = 70;
export const SHORT_MIN = 12;

/** Another newsletter's name, any spacing (as events/validate.ts COMPETITOR_NAMES). */
const COMPETITORS =
  /bend[\s_.-]*(family[\s_.-]*loop|buzz)|family[\s_.-]*loop|\bthe[\s_.-]*buzz\b/i;

/** Words a complete phrase can't end on: a conjunction, preposition or article. */
const DANGLING_END =
  /\b(and|or|but|nor|plus|with|without|at|in|into|onto|on|for|from|to|of|by|through|around|about|over|under|near|as|than|like|the|a|an|their|your|its|our|some|each|every|while|then|before|after|during)$/i;

/** Verbs that can't end a phrase: they need an object or a place after them. */
const VERB_END =
  /\b(dig|digs|dive|dives|make|makes|build|builds|turn|turns|put|puts|take|takes|get|gets|go|goes|come|comes|head|heads|bring|brings|give|gives|roll|rolls|pick|picks|fill|fills|set|sets|keep|keeps|work|works|help|helps|learn|learns|join|joins|meet|meets|try|tries|explore|explores|create|creates|use|uses|find|finds|visit|visits|watch|watches|hear|hears|share|shares|follow|follows|decorate|decorates|shape|shapes|sculpt|sculpts)$/i;

/** We never speak in the first person; a short never says free or a price. */
const FIRST_PERSON = /\b(we|we're|we'll|us|our|ours|i|me|my)\b/i;
const MONEY =
  /\bfree\b|\$\s?\d|\b\d+\s?(dollars?|bucks)\b|\b(cost|costs|price|prices|fee|fees|admission)\b/i;
const LINKISH = /https?:|www\.|\.(com|org|net|gov|us|quest)\b|@\w|#\w/i;
const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Words any short may use without its summary saying them: kid words and
 * the little words that join a phrase.
 */
const GENERIC = new Set(
  "kids kid children child little littles young family families grown grownups grown-ups together their own each every new with from into onto that this they them then than while about over along after before through around".split(
    " ",
  ),
);

/** A rough stem ("sculpts", "sculpting" → "sculpt"), never shorter than 3 letters ("sing" stays "sing"). */
const stem = (w: string) => {
  let x = w.replace(/[‘’]/g, "'").replace(/'s$/, "").replace(/ies$/, "y");
  const cut = x.replace(/(ing|ed|es|s)$/, "");
  if (cut.length >= 3) x = cut;
  return x.length > 3 ? x.replace(/e$/, "") : x;
};

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' -]+/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

/** Content words in the short that its event's `what` and title don't have. */
export function ungroundedWords(
  short: string,
  source: { what: string; title: string },
): string[] {
  const vocab = new Set(words(`${source.title} ${source.what}`).map(stem));
  return words(short).filter(
    (w) => w.length >= 4 && !GENERIC.has(w) && !vocab.has(stem(w)),
  );
}

/** The short as stored: trimmed, one space, no final period. */
export function tidyShort(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/\.$/, "").trim();
}

/**
 * Why this short can't be stored, or [] when it can. `source` is the event
 * the short describes (its own `what` and title ground every word).
 */
export function shortProblems(
  raw: string,
  source: { what: string; title: string },
): string[] {
  const s = tidyShort(raw);
  const out: string[] = [];
  if (s.length < SHORT_MIN || s.length > SHORT_MAX)
    out.push(`${SHORT_MIN} to ${SHORT_MAX} characters (it has ${s.length}).`);
  if (/[,;:–—-]$/.test(s) || DANGLING_END.test(s))
    out.push(
      "It ends mid-phrase (a comma, conjunction, preposition or article). Write a complete phrase.",
    );
  // "Stories, songs, rhymes": a list of three or more needs its "and".
  if (/,.*,/.test(s) && !/\b(and|or)\b[^,]*$/.test(s))
    out.push("It ends on a dangling list. Finish the list with and or or.");
  // A verb that needs what comes next ("Babies through preschoolers dig",
  // "Kids build"): the phrase stops before its point.
  if (VERB_END.test(s))
    out.push(
      "It ends on a verb that needs more (dig, make, build...). Finish the phrase.",
    );
  const off = ungroundedWords(s, source);
  if (off.length)
    out.push(
      `"${off.join(", ")}" isn't in the event's own summary or title. Use only its words.`,
    );
  if (LOGISTICS.test(s))
    out.push(
      "No negations, rules or logistics (not, only, must, register, tickets). Say what kids do.",
    );
  if (FIRST_PERSON.test(s)) out.push("No first person (we, us, our).");
  if (MONEY.test(s)) out.push('No price or "free": the chips print the cost.');
  if (COMPETITORS.test(s)) out.push("Never name another newsletter.");
  // The roundup's text rules, so a stored short is never dropped there
  // ("vote" reads as politics).
  const unsafe = unsafeText(s);
  if (unsafe) out.push(`No ${unsafe} words.`);
  if (LINKISH.test(s)) out.push("No links, handles or hashtags.");
  if (EMOJI.test(s)) out.push("No emoji.");
  if (/^[a-z]/.test(s)) out.push("Start with a capital letter.");
  return out;
}

/** The short to store, or null with why (the event is kept either way). */
export function checkShort(
  raw: string | undefined,
  source: { what: string; title: string },
): { short: string | null; problems: string[] } {
  if (raw == null || !raw.trim()) return { short: null, problems: [] };
  const problems = shortProblems(raw, source);
  return problems.length
    ? { short: null, problems }
    : { short: tidyShort(raw), problems: [] };
}
