/**
 * Age tags (James's decision): every kids' event shows exactly one of
 * "Ages 0-3", "Ages 4-7", "Ages 8-12" or "All ages", or several of the
 * first three when the printed range spans them. Never "both", never a
 * vague label. Code maps them only from ages printed on the official
 * page (the writer copies the age words, and they must appear in an
 * evidence quote); no printed ages, no tag. Pure, so the email, /events
 * and tests share it.
 */

export const AGE_BRACKETS = [
  { tag: "Ages 0-3", lo: 0, hi: 3, key: "0-3" },
  { tag: "Ages 4-7", lo: 4, hi: 7, key: "4-7" },
  { tag: "Ages 8-12", lo: 8, hi: 12, key: "8-12" },
] as const;
export const ALL_AGES = "All ages";

export type AgeTag = (typeof AGE_BRACKETS)[number]["tag"] | typeof ALL_AGES;
export type AgeKey = (typeof AGE_BRACKETS)[number]["key"];
export const AGE_KEYS: readonly AgeKey[] = AGE_BRACKETS.map((b) => b.key);

export type Ages = {
  /** In order: All ages alone, or brackets youngest first. */
  tags: AgeTag[];
  /** False for grown-up or teen events: never in kids' listings. */
  kids: boolean;
  /** The printed range in whole years (null for "all ages"). */
  range: [number, number] | null;
};

/** The oldest age we count as a kid. */
const KID_MAX = 12;
const OPEN_TOP = 99;
/** "Ages 7 thru teens": the last teen year a youth program counts. */
const TEEN_TOP = 18;

/**
 * Printed age words ("Ages 5 and under", "Grades K-5", "18+") to tags.
 * Null when the words hold no age we can read: then no tag is shown.
 */
export function ageTags(printed: string | null | undefined): Ages | null {
  if (!printed) return null;
  let t = printed
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/(\d)\s*½/g, "$1.5")
    .replace(/&/g, " and ")
    .replace(/\bthrough\b|\bthru\b/g, "to")
    // Spanish, as the library prints it ("niños de 0-5 años", "para todas
    // las edades"): read as the English words.
    .replace(/\btodas las edades\b/g, "all ages")
    .replace(/\bedad(es)?\b/g, "ages")
    .replace(/\bni[ñn][oa]s\b/g, "children")
    .replace(/\ba[ñn]os?\b/g, "years")
    .replace(/\bmes(es)?\b/g, "months")
    .replace(/(\d)\s+a\s+(\d)/g, "$1 to $2")
    .replace(/\s+/g, " ")
    .trim();
  // Times and clocks are never ages: strip them ("10:30-11 am", "3:30").
  t = t
    .replace(
      /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*(-|to)\s*\d{1,2}(:\d{2})?\s*(a\.?m\b\.?|p\.?m\b\.?)/g,
      " ",
    )
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s*(a\.?m\b\.?|p\.?m\b\.?)|\bnoon\b/g, " ");
  // Words about who may come or who's free, not who it's for: no tag.
  // ("Not recommended for children under 5", "Children under 3 free",
  // "under 18 must be accompanied").
  if (
    /\bnot (recommended|suitable|appropriate|allowed|for)\b|\bmust be accompanied\b|\baccompanied by\b|\bmust be with\b|\bneeds? an? (adult|grown-?up)\b|\bsupervis|\bfree\b|\$|\badmission\b|\bcost\b/.test(
      t,
    )
  )
    return null;
  if (/\b(adults?|grown-?ups?) only\b|\b21\+|\bno (kids|children)\b/.test(t))
    return { tags: [], kids: false, range: [18, OPEN_TOP] };
  // A grown-up's age is about the chaperone, not the kids ("with a grown-up 18+").
  t = t.replace(
    /\b(with|and|plus)? ?(a |an |one )?(grown-?ups?|adults?|parents?|caregivers?|guardians?)( \(?\d{1,2}\s*(\+|and (up|over|older))\)?)?/g,
    " ",
  );
  if (/\ball ages\b|\bany age\b|\bevery age\b/.test(t))
    return { tags: [ALL_AGES], kids: true, range: null };
  // Ages must be named, not guessed from a stray number.
  if (
    !/\b(ages?|aged|grades?|graders?|kindergarten(ers)?|years?|yrs?|months?|mos?|year-olds?|kids|children|toddlers|babies|infants|preschoolers?)\b|\bunder \d|\d\s*\+/.test(
      t,
    )
  )
    return null;

  const N = "(\\d{1,2}(?:\\.\\d+)?)";
  const spans: [number, number][] = [];
  const years = (n: string, unit?: string) =>
    Math.floor(unit && /^mo/.test(unit) ? Number(n) / 12 : Number(n));
  const grade = (g: string) =>
    g === "k" || g === "kindergarten" ? 5 : Number(g) + 5;
  let m: RegExpExecArray | null;
  let rest = t;
  const take = (re: RegExp, f: (m: RegExpExecArray) => [number, number]) => {
    const g = new RegExp(re.source, "g");
    while ((m = g.exec(rest))) spans.push(f(m));
    rest = rest.replace(g, " ");
  };
  const UNIT = "(months?|mos?\\.?|years?|yrs?\\.?)";
  const ORD = "(?:st|nd|rd|th)?";
  // Grades: "grades K-5", "1st-5th grade", "grades 3 to 5", "grade 3".
  take(
    new RegExp(
      `\\bgrades? (k|kindergarten|\\d{1,2})${ORD}\\s*(?:-|to)\\s*(\\d{1,2})${ORD}\\b`,
    ),
    (x) => [grade(x[1]), grade(x[2]) + 1],
  );
  take(
    new RegExp(
      `\\b(k|\\d{1,2})${ORD}\\s*(?:-|to)\\s*(\\d{1,2})${ORD} grade(?:s|rs)?\\b`,
    ),
    (x) => [grade(x[1]), grade(x[2]) + 1],
  );
  take(/\b(?:grade (\d{1,2})|(\d{1,2})(?:st|nd|rd|th) grade(?:rs)?)\b/, (x) => {
    const g = grade(x[1] ?? x[2]);
    return [g, g + 1];
  });
  take(/\bkindergarten(?:ers)?\b/, () => [5, 6]);
  // "at least 6 years old", "6 and up", "6+", "6 and older".
  take(new RegExp(`\\bat least ${N}\\s*${UNIT}?`), (x) => [
    years(x[1], x[2]),
    OPEN_TOP,
  ]);
  take(
    new RegExp(
      `\\b${N}\\s*${UNIT}?(?: old)?(?: (?:and|or) (?:up|older|over|above)|\\s*\\+)`,
    ),
    (x) => [years(x[1], x[2]), OPEN_TOP],
  );
  // "5 and under", "5 or younger"; "under 5" means 4 and younger.
  take(
    new RegExp(
      `\\b${N}\\s*${UNIT}?(?: old)? (?:and|or) (?:under|younger|below)\\b`,
    ),
    (x) => [0, years(x[1], x[2])],
  );
  take(new RegExp(`\\b(?:under|younger than|below) ${N}\\s*${UNIT}?`), (x) => [
    0,
    Math.max(0, x[2] && /^mo/.test(x[2]) ? 0 : Math.ceil(Number(x[1])) - 1),
  ]);
  // Ranges, only next to an age word: "ages 3-10", "kids 8 to 12", or
  // with a unit, "18 months to 3 years". A bare "1-2" (sessions, rooms,
  // class sizes, Mon-Fri 9-3) is never an age.
  const range = (x: RegExpExecArray): [number, number] => {
    const unit2 = x[4];
    const unit1 = x[2] ?? unit2;
    return [years(x[1], unit1), years(x[3], unit2)];
  };
  take(
    new RegExp(
      `\\b(?:ages?|aged|kids|children|toddlers|babies|for)\\s+(?:from\\s+)?${N}\\s*${UNIT}?\\s*(?:-|to)\\s*${N}\\s*${UNIT}?`,
    ),
    range,
  );
  take(
    new RegExp(
      `\\b${N}\\s*${UNIT}?\\s*(?:-|to)\\s*${N}\\s*(months?|mos?\\.?|years?|yrs?\\.?)`,
    ),
    range,
  );
  take(new RegExp(`\\bages? ${N}(?:, ${N})*,? and ${N}\\b`), (x) => [
    years(x[1]),
    years(x[3]),
  ]);
  // "7 thru teens": teens end with high school, at 18.
  take(new RegExp(`\\b${N}\\s*(?:-|to)\\s*(?:the )?teens\\b`), (x) => [
    years(x[1]),
    TEEN_TOP,
  ]);
  // "3-5-year-olds", "8 to 12 year olds".
  take(
    new RegExp(`\\b${N}\\s*(?:-|to)\\s*${N}[- ](?:year|yr)s?[- ]olds?\\b`),
    (x) => [years(x[1]), years(x[2])],
  );
  // "3-year-olds", "3 year olds".
  take(new RegExp(`\\b${N}[- ](?:year|yr)[- ]olds?\\b`), (x) => [
    years(x[1]),
    years(x[1]),
  ]);
  // A single age: "age 4", "4 years old", "ages 6".
  take(new RegExp(`\\bages? ${N}\\b|\\b${N} ${UNIT} old\\b`), (x) => {
    const n = x[1] ? years(x[1]) : years(x[2], x[3]);
    return [n, n];
  });
  if (!spans.length) return null;
  // Separate ranges that don't overlap ("ages 7-12, siblings 5-6"): unclear.
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i][0] > sorted[i - 1][1]) return null;
  const lo = Math.min(...spans.map((s) => s[0]));
  const hi = Math.max(...spans.map((s) => s[1]));
  if (lo > hi) return null;
  if (lo > KID_MAX) return { tags: [], kids: false, range: [lo, hi] };
  const tags = AGE_BRACKETS.filter(
    (b) => b.lo <= Math.min(hi, KID_MAX) && b.hi >= lo,
  ).map((b) => b.tag);
  return { tags, kids: true, range: [lo, hi] };
}

/** The tags an age filter key matches ("0-3" matches "Ages 0-3" and All ages). */
export function matchesAge(tags: readonly AgeTag[], key: AgeKey): boolean {
  const b = AGE_BRACKETS.find((x) => x.key === key)!;
  return tags.includes(b.tag) || tags.includes(ALL_AGES);
}

/** "3-10" for schema.org typicalAgeRange; null for all ages or none. */
export function typicalAgeRange(a: Ages | null): string | null {
  if (!a?.range || !a.kids) return null;
  const [lo, hi] = a.range;
  return hi >= OPEN_TOP ? `${lo}-` : `${lo}-${hi}`;
}
