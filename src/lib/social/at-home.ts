import type { SeasonThemes } from "@/lib/news/catalog";
import { addDays, holidays } from "@/lib/news/time";
import { type AtHomeIdea, IDEA_SIMILAR, IDEA_TEXT_SIMILAR } from "./model";

/**
 * Saturday's "at home" post: the season themes a Saturday may use, the
 * idea-title cooldown, and the safety, brand and household rules every
 * idea is held to. Pure.
 */

// --- Themes --------------------------------------------------------------------

export type ActiveTheme = {
  id: string;
  label: string;
  hint: string;
  /** month: the month's own theme; holiday: a holiday near the day. */
  kind: "month" | "holiday";
  /** The holiday's date (holidays only). */
  date?: string;
};

/** A holiday's dates near `day` (this year, last and next). */
function holidayDates(
  h: SeasonThemes["holidays"][number],
  day: string,
): string[] {
  const y = Number(day.slice(0, 4));
  const years = [y - 1, y, y + 1];
  if (h.dates.length) return h.dates;
  if (!h.on) return [];
  if (h.on.startsWith("holiday:")) {
    const name = h.on.slice("holiday:".length);
    return years.flatMap((yr) =>
      Object.entries(holidays(yr))
        .filter(([, n]) => n === name)
        .map(([d]) => d),
    );
  }
  return years.map((yr) => `${yr}-${h.on}`);
}

/**
 * The themes a post on `day` may use: the month's themes, plus any holiday
 * whose window (`before` days ahead to `after` days after) covers the day.
 * Holidays first: they're the stronger hook.
 */
export function themesFor(day: string, cal: SeasonThemes): ActiveTheme[] {
  const month = Number(day.slice(5, 7));
  const out: ActiveTheme[] = [];
  for (const h of cal.holidays)
    for (const date of holidayDates(h, day))
      if (addDays(date, -h.before) <= day && day <= addDays(date, h.after)) {
        out.push({
          id: h.id,
          label: h.label,
          hint: h.hint,
          kind: "holiday",
          date,
        });
        break;
      }
  for (const t of cal.months.find((m) => m.month === month)?.themes ?? [])
    if (!out.some((o) => o.id === t.id)) out.push({ ...t, kind: "month" });
  return out;
}

// --- The idea cooldown: titles compared as stemmed content words ------------

const STOP = new Set(
  "a an the and or of for with to in on at by your our my mini little big easy simple quick fun super diy homemade make making game games time".split(
    " ",
  ),
);

const stem = (w: string) =>
  w
    .replace(/'s$/, "")
    .replace(/ies$/, "y")
    .replace(/(ing|ings)$/, "")
    .replace(/(es|s)$/, "")
    .replace(/e$/, "");

/** A title's stemmed content words ("Painting ice cubes" → paint, ice, cub). */
export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[^a-z' -]+/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length >= 2 && !STOP.has(w))
      .map(stem)
      .filter(Boolean),
  );
}

/**
 * Two titles' similarity: the share of the shorter title's content words
 * found in the other (containment, 0 to 1), so a rephrased or longer
 * title ("Painting the snow with colors" after "Snow paint") still counts.
 */
export function titleSimilarity(a: string, b: string): number {
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}

/** Words any idea may share without being the same idea. */
const COMMON = new Set(
  "each one two three all your kid kids little big grown up then them they it its this that with into onto from over under around out off put set add take give get let make made use the and for paper crayon tape water bowl cup spoon table floor room turn take".split(
    " ",
  ),
);

/** An idea's stemmed content words: title, what you need and the steps. */
export function ideaWords(text: string): Set<string> {
  return new Set(
    [...titleWords(text)].filter((w) => w.length >= 3 && !COMMON.has(w)),
  );
}

/** Jaccard of two ideas' whole words (title, need, steps), 0 to 1. */
export function ideaOverlap(a: string, b: string): number {
  const x = ideaWords(a);
  const y = ideaWords(b);
  if (x.size < 3 || y.size < 3) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** A recent idea: its title, and its whole text (title, need, steps). */
export type RecentIdea = { title: string; text: string };

/** An idea as one text, for the overlap check. */
export const ideaText = (i: {
  title: string;
  need: readonly string[];
  steps: readonly string[];
  payoff?: string;
}) =>
  [i.title, ...i.need, ...i.steps, ...(i.payoff ? [i.payoff] : [])].join(". ");

/**
 * The recent idea this one repeats, or null: a title whose content words
 * are mostly contained in the other's, or the same idea in other words
 * (the whole text overlaps by IDEA_TEXT_SIMILAR or more).
 */
export function repeatOf(
  idea: { title: string; text?: string },
  recent: readonly (RecentIdea | string)[],
): string | null {
  for (const r of recent) {
    const old = typeof r === "string" ? { title: r, text: r } : r;
    if (titleSimilarity(idea.title, old.title) >= IDEA_SIMILAR)
      return old.title;
    if (idea.text && ideaOverlap(idea.text, old.text) >= IDEA_TEXT_SIMILAR)
      return old.title;
  }
  return null;
}

// --- Safety -------------------------------------------------------------------

type Hazard = { re: RegExp; what: string; under?: number };

/**
 * Hazard words. `under`: banned when the idea's youngest age is below it
 * (scissors for toddlers, small parts for under-3s); otherwise banned for
 * every age (knives, heat, chemicals).
 */
const HAZARDS: Hazard[] = [
  {
    re: /\b(knife|knives|blades?|box ?cutters?|razors?|craft knife|x-?acto|peelers?|graters?)\b/i,
    what: "knives and blades",
  },
  {
    re: /\b(glue ?guns?|hot ?glue|glue sticks? gun)\b/i,
    what: "glue guns",
  },
  {
    re: /\b(stoves?|stovetop|ovens?|burners?|bak(e|es|ed|ing)|boil(s|ed|ing)?|microwav\w*|toaster|griddle|grill(s|ed|ing)?|fry(ing)?|simmer\w*|melt(ed|ing)? (the |some )?(wax|crayons?|chocolate|butter)|hot (water|cocoa|chocolate|oil|pan|pot|plate|tea|wax)|irons?|ironing|kettles?|heated|heating|heaters?|heat (up|it|them|the|some)|warm(ed|ing)? (up )?(the |some |a )?(water|milk|cocoa|chocolate|tea|oil|wax|dough|soup|food|it|them)|warmed|(?<!pretend )(?<!play )cook(s|ed|ing)?|cooked|toast(ed|ing)?|steam(ed|ing)?|roast(ed|ing)?)\b/i,
    what: "heat (stove, oven, kettle, anything heated, warmed or cooked)",
  },
  {
    re: /\b(candles?|matches|matchsticks?|lighters?|fires?|firepit|fire pit|campfires?|sparklers?|fireworks?|flames?|torch(es)?)\b/i,
    what: "fire and flames",
  },
  {
    re: /\b(bleach|ammonia|(?<!pipe[ -])cleaners?|cleaning (spray|products?)|hydrogen peroxide|peroxide|(rubbing )?alcohol|glow ?sticks?|(hand )?sanitizers?|detergents?|laundry pods?|dishwasher pods?|borax|solvents?|paint thinner|turpentine|acetone|nail polish( remover)?|super ?glue|spray ?paint|essential oils?|medicines?|pills?|chemicals?|drain cleaners?)\b/i,
    what: "chemicals and cleaners",
  },
  {
    re: /\b(button batter(y|ies)|coin batter(y|ies)|batter(y|ies)|magnets?|dry ice)\b/i,
    what: "batteries, magnets or dry ice",
  },
  {
    re: /\b(plastic (bags?|wrap)|grocery bags?|dry[- ]cleaning bags?)\b/i,
    what: "plastic bags (suffocation)",
  },
  { re: /\b(ladders?|roofs?|step ?stools?)\b/i, what: "climbing up high" },
  {
    re: /\b(stand(s|ing)?|climb(s|ing)?|jump(s|ing)?|balanc(e|es|ing)) (up )?(on|onto|off) (a |the |your |some )?(chairs?|counters?|countertops?|tables?|furniture|couch(es)?|sofas?|beds?|desks?|stools?)\b/i,
    what: "standing or jumping on furniture",
  },
  { re: /\btrampolines?\b/i, what: "trampolines" },
  {
    re: /\b(snow (tunnels?|caves?|holes?)|tunnel(s|ing)? (into|under|through) (the )?snow|(dig|digs|digging|crawl|crawls|crawling)\b[^.]{0,40}\b(snow|snow ?banks?|drifts?|piles? of snow)|snow ?forts?\b[^.]{0,60}\b(dig|digging|crawl|crawling|inside|tunnel)\w*|(dig|crawl|tunnel)\w*\b[^.]{0,60}\bsnow ?forts?)\b/i,
    what: "snow tunnels or digging into snow (collapse)",
  },
  {
    re: /\b(frozen (ponds?|lakes?|rivers?|creeks?|canals?|puddles? on the pond)|thin ice|(pond|lake|river|creek) ice|(walk|skat|slid|stand|play|step)\w* (on|across) (the )?ice|ice (on|over) the (pond|lake|river|creek)|ponds?|lakes?|rivers?|creeks?|canals?)\b/i,
    what: "ponds, lakes, rivers or ice",
  },
  {
    re: /\b(streets?|roads?|driveways?|curbs?|alleys?|parking lots?|cul-de-sacs?)\b/i,
    what: "street or driveway play",
  },
  {
    re: /\b(overnight|the night before|the day before|a day ahead|(let|leave)\b[^.]{0,30}\bfor (a few |several |two |three |\d+ )?(hours|a day)|freezers?|freez(e|es|ing)(?! (dance|tag|game))|frozen (overnight|solid))\b/i,
    what: "prep the night before (the post goes out Saturday morning)",
  },
  {
    re: /\b(scissors|cut(s|ting)? (out|up|along|the|a|it|them)|snip\w*)\b/i,
    what: "scissors for toddlers",
    under: 4,
  },
  {
    re: /\b(beads?|buttons?|coins?|penn(y|ies)|marbles?|dried beans|beans|lentils?|chickpeas?|peas|seeds?|bells?|jingle bells?|rubber bands?|hair ties?|paper ?clips?|binder clips?|rice|(uncooked|dry|dried) (pasta|noodles)|pasta shapes|penne|rigatoni|macaroni|popcorn|nuts|peanuts|grapes|pom[- ]?poms?|googly eyes|sequins?|glitter|pebbles?|small (rocks?|stones?|toys?|pieces?|parts?)|bottle caps?|marshmallows?|hard candy|candies|gum|acorns?|pine nuts|cherry pits?|water beads?|bouncy balls?|crayon pieces|broken crayons)\b/i,
    what: "small parts (a choking hazard under 3)",
    under: 3,
  },
  {
    re: /\b(strings?|yarn|ribbons?|cords?|rope|twine|shoelaces?)\b/i,
    what: "cords (a strangling hazard under 3)",
    under: 3,
  },
  {
    re: /\b(glass(es)?|jars?|glass bottles?|mirrors?)\b/i,
    what: "glass and jars (under 8)",
    under: 8,
  },
  {
    re: /\b(toothpicks?|skewers?|(?<!pine )needles?|(?<!bowling )(?<!rolling )pins?|push ?pins?|thumb ?tacks?|tacks?|safety pins?|nails)\b/i,
    what: "sharp points: toothpicks, skewers, needles, pins or tacks (under 6)",
    under: 6,
  },
  {
    re: /\bballoons?\b/i,
    what: "balloons (a choking hazard under 8)",
    under: 8,
  },
  { re: /\bhoney\b/i, what: "honey (not for babies)", under: 1 },
];

/** The hazards an idea names, for its youngest age. */
export function hazardsIn(text: string, youngest: number): string[] {
  return HAZARDS.filter(
    (h) => (h.under == null || youngest < h.under) && h.re.test(text),
  ).map((h) => h.what);
}

// --- Brands and products --------------------------------------------------------

/**
 * Brands kids' activities lean on, matched anywhere: the first word of a
 * sentence too, where the capital-letter rule can't see them ("Jenga
 * blocks make a tower"). "Household items only" means none of them.
 */
const BRANDS =
  /\b(play-?doh|lego|duplo|crayola|sharpie|velcro|ziploc|ziplock|q-?tips?|kleenex|post-?its?|elmer'?s|mod ?podge|magna-?tiles|hot wheels|barbie|nerf|jell-?o|popsicles?|cheerios|goldfish crackers|m&ms?|oreos?|tupperware|solo cups?|scotch tape|saran|styrofoam|pyrex|band-?aids?|kool-?aid|frisbees?|slinky|silly putty|etch a sketch|amazon|walmart|costco|dollar tree|hobby lobby|ikea|pinterest|youtube|netflix|disney|bluey|paw patrol|cricut|kinetic sand|orbeez|squishmallows?|playmobil|fisher-?price|melissa (and|&) doug|tonies|yoto|minecraft|roblox|pokemon|spotify|alexa|jenga|twister|uno|candy ?land|chutes and ladders|connect (4|four)|monopoly|scrabble|operation|hungry hungry hippos|k'?nex|tinker ?toys?|lincoln logs|mega ?bloks|beyblades?|hatchimals|magformers|spirograph|lite-?brite|bristle blocks|perler|hama|mr\.? potato head|matchbox|tonka|little tikes|step2|cozy coupe|radio flyer|stomp rocket|crayola|sharpies?|dixie cups?|clorox|lysol|windex|elmer)\w*\b/i;

/** Capitalized words allowed mid-sentence: holidays, months, days, places. */
const PROPER_OK = new Set(
  "Thanksgiving Halloween Christmas Hanukkah Kwanzaa Diwali Easter Passover Valentine Valentine's Patrick's St. Earth Day Mother's Father's Fourth July Independence New Year Year's Eve Lunar Bend Oregon Central Redmond Sisters Sunriver Prineville Madras Culver Terrebonne La Pine Deschutes Cascades Cascade Bachelor Smith Rock Pilot Butte January February March April May June August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday I".split(
    " ",
  ),
);

/** Capitalized words after the first, not on the allowed list (brand-like). */
function properNouns(text: string): string[] {
  return text.split(/(?<=[.!?:])\s+/).flatMap((sentence) =>
    sentence
      .trim()
      .split(/\s+/)
      .slice(1)
      .map((w) => w.replace(/^[("']+|[)".,!?:;]+$/g, ""))
      .filter((w) => /^[A-Z]/.test(w) && !PROPER_OK.has(w)),
  );
}

/** Things you'd buy, print or watch: not household items. */
const NOT_HOUSEHOLD =
  /\b(buy|bought|purchas\w*|online|(?<!in )order(s|ed|ing)?|stores?|store-bought|shops?|shopping|kits?|printables?|printers?|print (it|them|this|out)|download\w*|apps?|videos?|movies?|tv|television|screens?|tablets?|websites?|qr codes?|subscriptions?)\b/i;

/**
 * The headline and the composed caption, held to the same hazard and
 * brand rules. The caption mixes every idea's words, so only the
 * any-age hazards apply to it (each idea's age rules ran on the idea).
 */
export function postTextProblems(
  headline: string,
  caption: string,
  youngest: number,
): string[] {
  const out: string[] = [];
  for (const h of hazardsIn(headline, youngest))
    out.push(`headline: not safe for these ages (${h}).`);
  for (const h of hazardsIn(caption, 99))
    if (!out.some((o) => o.includes(h))) out.push(`caption: not safe (${h}).`);
  for (const [label, text] of [
    ["headline", headline],
    ["caption", caption],
  ] as const) {
    const brand = BRANDS.exec(text);
    if (brand) out.push(`${label}: no brands or products ("${brand[0]}").`);
    if (/[™®©]/.test(text)) out.push(`${label}: no trademark signs.`);
  }
  const caps = properNouns(headline);
  if (caps.length)
    out.push(
      `headline: "${caps.join(", ")}" reads like a brand or a name. Use plain words.`,
    );
  return out;
}

// --- The payoff: every idea ends on what the kid gets out of it --------------

/** Lines that end nothing: "Have fun!", "Enjoy!", "That's it!". */
const GENERIC_PAYOFF =
  /^(and )?(now )?(have (so much |lots of |a ton of )?fun|have a (blast|ball|great time)|enjoy( it| yourselves| the (fun|time))?|that'?s it|ta-?da|done|all done|you'?re done|happy (crafting|playing|making|snow day|holidays?)|let the fun begin|fun for (all|everyone|the whole family)|great job|well done|so fun|so much fun|what fun)\b[\s!.]*$/i;

/** Prep verbs: a line that starts with one and pays off nothing is just another step. */
const PREP =
  /^(cut|fold|fill|tape|glue|mix|stir|pour|tear|trace|draw|add|put|place|set( up)?|lay|line( up)?|roll|wrap|press|stick|measure|gather|collect|sort|cover|wet|scoop|paint|color|thread|tie|stack)\b/i;

/** Words that say the payoff: what the kid ends up with, or the moment it pays off. */
const PAYOFF =
  /\b(watch\w*|see|look|race|play|hang|show|display|give|gift|wear|keep|frame|use (it|them) as|hide|hunt|bookmark|fridge|wall|window|take (it|them|turns)|cheer|win\w*|admire|glow\w*|shine\w*|sparkl\w*|light(s)? up|fly|flies|float\w*|sail\w*|spin\w*|launch\w*|crash\w*|bounce\w*|pop\w*|tumble\w*|knock\w*|topple\w*|surprise\w*|reveal\w*|appear\w*|grow\w*|sprout\w*|melt\w*|count|who|whoever|first to|your own|ends? up|get to|gets? to|treasure|keepsake|forever|tonight|tomorrow|all (day|week|winter)|for (the|a) (table|tree|door))\b/i;

/**
 * Why a payoff isn't one, or []: it must be there, end something (not a
 * bare "Have fun!"), and not be one more step (a prep verb with nothing
 * paid off, or the same words as a step).
 */
export function payoffProblems(i: {
  steps: readonly string[];
  payoff: string;
}): string[] {
  const p = i.payoff.trim();
  if (!p)
    return [
      "needs a payoff: what the kid ends up with, or the moment it pays off.",
    ];
  if (GENERIC_PAYOFF.test(p))
    return [
      `the payoff "${p}" is generic. Say what the kid ends up with or gets to do ("Hang it in a sunny window and watch the colors glow").`,
    ];
  const out: string[] = [];
  // "Now" or "Then" up front doesn't make a step a payoff: check what follows.
  const lead = /^(now|then)\b[,\s]*/i.exec(p);
  const core = lead ? p.slice(lead[0].length) : p;
  const marked =
    PAYOFF.test(core) || (!!lead && /^now/i.test(lead[0]) && !PREP.test(core));
  if (PREP.test(core) && !PAYOFF.test(core))
    out.push(
      `the payoff "${p}" reads like another step. End on what the kid gets: the moment it works, or what they keep.`,
    );
  else if (!marked)
    out.push(
      `the payoff "${p}" doesn't say what the kid gets. End with the moment it works ("Now race them down the hallway") or what they keep.`,
    );
  const words = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .replace(/[^a-z' ]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const pw = words(p);
  for (const s of i.steps) {
    const sw = words(s);
    const both = [...pw].filter((w) => sw.has(w)).length;
    if (pw.size && both / pw.size >= 0.7) {
      out.push(`the payoff repeats a step ("${s}").`);
      break;
    }
  }
  return out;
}

/** Every problem with one idea, or [] when it's fine. */
export function ideaProblems(i: AtHomeIdea): string[] {
  const label = `idea "${i.title}"`;
  const all = [i.title, ...i.need, ...i.steps, i.payoff].join(". ");
  const out: string[] = [];
  for (const h of hazardsIn(all, i.ages.from))
    out.push(`${label}: not safe for these ages (${h}).`);
  const brand = BRANDS.exec(all);
  if (brand) out.push(`${label}: no brands or products ("${brand[0]}").`);
  if (/[™®©]/.test(all)) out.push(`${label}: no trademark signs.`);
  const caps = properNouns([i.title, ...i.steps, i.payoff].join(". "));
  if (caps.length)
    out.push(
      `${label}: "${caps.join(", ")}" reads like a brand or a name. Use plain household words.`,
    );
  for (const n of i.need) {
    if (n !== n.toLowerCase())
      out.push(`${label}: need "${n}" must be lowercase household words.`);
    if (NOT_HOUSEHOLD.test(n))
      out.push(`${label}: need "${n}" isn't a household item.`);
  }
  out.push(...payoffProblems(i).map((p) => `${label}: ${p}`));
  for (const s of [...i.steps, i.payoff])
    if (NOT_HOUSEHOLD.test(s))
      out.push(
        `${label}: a step asks for something to buy, print or watch ("${NOT_HOUSEHOLD.exec(s)![0]}"). Household items only.`,
      );
  return out;
}
