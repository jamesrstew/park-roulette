import type { SeasonThemes } from "@/lib/news/catalog";
import { addDays, holidays } from "@/lib/news/time";
import { IDEA_SIMILAR, type AtHomeIdea } from "./model";

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

/** Jaccard similarity of two titles' content words (0 to 1). */
export function titleSimilarity(a: string, b: string): number {
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** The recent title an idea repeats, or null. */
export function repeatOf(
  title: string,
  recent: readonly string[],
): string | null {
  return recent.find((r) => titleSimilarity(title, r) >= IDEA_SIMILAR) ?? null;
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
    re: /\b(stoves?|stovetop|ovens?|burners?|bak(e|es|ed|ing)|boil(s|ed|ing)?|microwav\w*|toaster|griddle|grill(s|ed|ing)?|fry(ing)?|simmer\w*|melt(ed|ing)? (the |some )?(wax|crayons?|chocolate|butter)|hot (water|cocoa|chocolate|oil|pan|pot|plate|tea|wax)|irons?|ironing)\b/i,
    what: "heat (stove, oven, hot water, irons)",
  },
  {
    re: /\b(candles?|matches|matchsticks?|lighters?|fires?|firepit|fire pit|campfires?|sparklers?|fireworks?|flames?|torch(es)?)\b/i,
    what: "fire and flames",
  },
  {
    re: /\b(bleach|ammonia|cleaners?|cleaning (spray|products?)|detergents?|laundry pods?|dishwasher pods?|borax|solvents?|paint thinner|turpentine|acetone|nail polish( remover)?|super ?glue|spray ?paint|essential oils?|medicines?|pills?|chemicals?|drain cleaners?)\b/i,
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
    re: /\b(overnight|the night before|the day before|a day ahead|(let|leave)\b[^.]{0,30}\bfor (a few |several |two |three |\d+ )?(hours|a day)|freeze[^.]{0,30}\b(solid|hours))\b/i,
    what: "prep the night before (the post goes out Saturday morning)",
  },
  {
    re: /\b(scissors|cut(s|ting)? (out|up|along|the|a|it|them)|snip\w*)\b/i,
    what: "scissors for toddlers",
    under: 4,
  },
  {
    re: /\b(beads?|buttons?|coins?|marbles?|dried beans|beans|rice|uncooked pasta|dry pasta|macaroni|popcorn|nuts|peanuts|grapes|pom[- ]?poms?|googly eyes|sequins?|glitter|pebbles?|small (rocks?|stones?|toys?|pieces?|parts?)|bottle caps?|marshmallows?|hard candy|candies|gum|acorns?|pine nuts|cherry pits?|water beads?|bouncy balls?|crayon pieces|broken crayons)\b/i,
    what: "small parts (a choking hazard under 3)",
    under: 3,
  },
  {
    re: /\b(strings?|yarn|ribbons?|cords?|rope|twine|shoelaces?)\b/i,
    what: "cords (a strangling hazard under 3)",
    under: 3,
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

/** Brands kids' activities lean on. "Household items only" means none of them. */
const BRANDS =
  /\b(play-?doh|lego|duplo|crayola|sharpie|velcro|ziploc|ziplock|q-?tips?|kleenex|post-?its?|elmer'?s|mod ?podge|magna-?tiles|hot wheels|barbie|nerf|jell-?o|popsicles?|cheerios|goldfish crackers|m&ms?|oreos?|tupperware|solo cups?|scotch tape|saran|styrofoam|pyrex|band-?aids?|kool-?aid|frisbees?|slinky|silly putty|etch a sketch|amazon|walmart|costco|dollar tree|hobby lobby|ikea|pinterest|youtube|netflix|disney|bluey|paw patrol|cricut|kinetic sand|orbeez|squishmallows?|playmobil|fisher-?price|melissa (and|&) doug|tonies|yoto|minecraft|roblox|pokemon|spotify|alexa)\b/i;

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
  /\b(buy|bought|purchas\w*|online|store-bought|(from|at) (the|a) (store|shop)|craft stores?|kits?|printables?|printers?|print (it|them|this|out)|download\w*|apps?|videos?|tablets?|websites?|qr codes?|subscriptions?)\b/i;

/** Every problem with one idea, or [] when it's fine. */
export function ideaProblems(i: AtHomeIdea): string[] {
  const label = `idea "${i.title}"`;
  const all = [i.title, ...i.need, ...i.steps].join(". ");
  const out: string[] = [];
  for (const h of hazardsIn(all, i.ages.from))
    out.push(`${label}: not safe for these ages (${h}).`);
  const brand = BRANDS.exec(all);
  if (brand) out.push(`${label}: no brands or products ("${brand[0]}").`);
  if (/[™®©]/.test(all)) out.push(`${label}: no trademark signs.`);
  const caps = properNouns([i.title, ...i.steps].join(". "));
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
  for (const s of i.steps)
    if (NOT_HOUSEHOLD.test(s))
      out.push(
        `${label}: a step asks for something to buy, print or watch ("${NOT_HOUSEHOLD.exec(s)![0]}"). Household items only.`,
      );
  return out;
}
