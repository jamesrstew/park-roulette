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
  /\b(dig|digs|dive|dives|make|makes|build|builds|turn|turns|put|puts|take|takes|get|gets|go|goes|come|comes|head|heads|bring|brings|give|gives|roll|rolls|pick|picks|fill|fills|set|sets|keep|keeps|work|works|help|helps|learn|learns|join|joins|meet|meets|try|tries|explore|explores|create|creates|use|uses|find|finds|visit|visits|watch|watches|hear|hears|share|shares|follow|follows|shape|shapes|sculpt|sculpts)$/i;

/**
 * Good endings the rules above would refuse: a list of verbs ("sing, dance
 * and learn") and verbs whose "in" is part of them ("drops in", "join in").
 */
const VERB_LIST_END = /\w+,\s+\w+\s+(and|or)\s+\w+$/i;
const PARTICLE_END =
  /\b(drops?|dropping|dropped|join|joins|joining|chime|chimes|pitch|pitches|jump|jumps|tune|tunes|sign|signs|move|moves|settle|settles|tuck|tucks|dig|digs|dive|dives)\s+in$/i;

/** Words that need a noun after them: a phrase can't stop on one ("the museum's hidden"). */
const ADJECTIVE_END =
  /\b(hidden|little|big|small|tiny|giant|huge|new|old|special|favorite|fancy|own|other|different|local|classic|festive|colorful|bright|soft|simple|short|long|live|young|early|first|last|next|few|many|several|whole|full|real|great|best)$/i;

/** We never speak in the first person; a short never says free or a price. */
export const FIRST_PERSON = /\b(we|we're|we'll|us|our|ours|i|me|my)\b/i;
export const MONEY =
  /\bfree\b|\$\s?\d|\b\d+\s?(dollars?|bucks)\b|\b(cost|costs|price|prices|fee|fees|admission|pay|pays|paid|paying|donations?|complimentary)\b|\bno charge\b|\bat no cost\b/i;
const LINKISH = /https?:|www\.|\.(com|org|net|gov|us|quest)\b|@\w|#\w/i;
const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Words any short may use without its summary saying them: kid words and
 * the little words that join a phrase (three letters and up; shorter
 * words aren't checked).
 */
const GENERIC = new Set(
  "kids kid children child little littles young family families grown grownups grown-ups together their own each every new with from into onto that this they them then than while about over along after before through around the and for but nor its our his her you are was has had all any can out off too two six ten one who how why few may per via yet let got fun".split(
    " ",
  ),
);

/** Irregular verb forms, to their base, so "made" is grounded by "make". */
const IRREGULAR: Record<string, string> = {
  made: "make",
  built: "build",
  ran: "run",
  sang: "sing",
  sung: "sing",
  drew: "draw",
  drawn: "draw",
  wrote: "write",
  written: "write",
  took: "take",
  taken: "take",
  gave: "give",
  given: "give",
  found: "find",
  brought: "bring",
  went: "go",
  gone: "go",
  came: "come",
  saw: "see",
  seen: "see",
  ate: "eat",
  eaten: "eat",
  held: "hold",
  told: "tell",
  threw: "throw",
  thrown: "throw",
  flew: "fly",
  flown: "fly",
  rode: "ride",
  ridden: "ride",
  hid: "hide",
  hidden: "hide",
  dug: "dig",
  spun: "spin",
  swam: "swim",
  swum: "swim",
  read: "read",
  led: "lead",
  met: "meet",
  sat: "sit",
  stood: "stand",
  wove: "weave",
  woven: "weave",
  shook: "shake",
  shaken: "shake",
  knew: "know",
  known: "know",
  began: "begin",
  begun: "begin",
  heard: "hear",
  taught: "teach",
  caught: "catch",
  bought: "buy",
  felt: "feel",
  kept: "keep",
  left: "leave",
  lit: "light",
  slid: "slide",
  stuck: "stick",
};

/** A rough stem ("sculpts", "sculpting" → "sculpt"), never shorter than 3 letters ("sing" stays "sing"). */
const stem = (w: string) => {
  let x = w.replace(/[‘’]/g, "'").replace(/'s$/, "");
  if (Object.hasOwn(IRREGULAR, x)) x = IRREGULAR[x];
  x = x.replace(/ies$/, "y");
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

/**
 * Content words in the short that its event's `what` and title don't have.
 * The check is word by word: it proves each word came from the summary,
 * not that the phrase means what the summary says ("Kids paint clay"
 * passes against "Kids paint, then shape clay"). The complete-phrase rules
 * and the routine's own reading carry the meaning.
 */
export function ungroundedWords(
  short: string,
  source: { what: string; title: string },
): string[] {
  const vocab = new Set(words(`${source.title} ${source.what}`).map(stem));
  return words(short).filter(
    (w) => w.length >= 3 && !GENERIC.has(w) && !vocab.has(stem(w)),
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
  if (/[,;:–—-]$/.test(s) || (DANGLING_END.test(s) && !PARTICLE_END.test(s)))
    out.push(
      "It ends mid-phrase (a comma, conjunction, preposition or article). Write a complete phrase.",
    );
  if (/\w+'s?$/.test(s) && /'s?$/.test(s))
    out.push("It ends on a possessive. Finish the phrase.");
  else if (ADJECTIVE_END.test(s))
    out.push(
      "It ends on a word that needs a noun after it. Finish the phrase.",
    );
  // "Stories, songs, rhymes": a list of three or more needs its "and".
  if (/,.*,/.test(s) && !/\b(and|or)\b[^,]*$/.test(s))
    out.push("It ends on a dangling list. Finish the list with and or or.");
  // "Stories, songs for babies": two items joined by a bare comma. A comma
  // after one or two opening words is a list unless a clause follows it
  // ("Kids paint, then hang it").
  else if (
    /^[^,\s]+(\s[^,\s]+)?,\s/.test(s) &&
    !/\b(and|or)\b/i.test(s) &&
    !/^[^,]+,\s+(then|while|with|plus|so|but|in|at|for|from|as|before|after|using|playing|making)\b/i.test(
      s,
    )
  )
    out.push('It reads as a list missing its "and". Join the items with and.');
  // A verb that needs what comes next ("Babies through preschoolers dig",
  // "Kids build"): the phrase stops before its point.
  if (VERB_END.test(s) && !VERB_LIST_END.test(s))
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
