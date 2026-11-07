/**
 * The park vocabulary. One list serves three jobs:
 *  - park.features: what a park has (seeded from maps, crowd-fixed on the park page)
 *  - review tags: what an explorer noticed (good stuff AND heads-ups)
 *  - filters on the wheel and the bucket list
 * Keys are stored in the DB. Never rename a key, only add new ones.
 */
export type AttrKind = "good" | "heads_up";
export type AttrGroup = "play" | "littles" | "comfort" | "dogs" | "heads_up";
export type Attr = {
  label: string;
  emoji: string;
  kind: AttrKind;
  group: AttrGroup;
};

export const ATTRIBUTES: Record<string, Attr> = {
  // Play
  slides: { label: "Slides", emoji: "🛝", kind: "good", group: "play" },
  great_slides: {
    label: "Great slides",
    emoji: "🤩",
    kind: "good",
    group: "play",
  },
  swings: { label: "Swings", emoji: "🪢", kind: "good", group: "play" },
  climbing: {
    label: "Big kid climbing",
    emoji: "🧗",
    kind: "good",
    group: "play",
  },
  zipline: { label: "Zipline", emoji: "🚡", kind: "good", group: "play" },
  splash_pad: { label: "Splash pad", emoji: "💦", kind: "good", group: "play" },
  sandbox: {
    label: "Sand or dirt digging",
    emoji: "🏖️",
    kind: "good",
    group: "play",
  },
  spinny: { label: "Spinny things", emoji: "🌀", kind: "good", group: "play" },
  accessible: {
    label: "Accessible play",
    emoji: "♿",
    kind: "good",
    group: "play",
  },
  sports_courts: {
    label: "Courts and fields",
    emoji: "🏀",
    kind: "good",
    group: "play",
  },
  // Littles
  toddler_area: {
    label: "Little kid area",
    emoji: "🧸",
    kind: "good",
    group: "littles",
  },
  baby_swings: {
    label: "Baby swings",
    emoji: "👶",
    kind: "good",
    group: "littles",
  },
  fenced: { label: "Fenced in", emoji: "🚧", kind: "good", group: "littles" },
  stroller_friendly: {
    label: "Stroller friendly",
    emoji: "🛒",
    kind: "good",
    group: "littles",
  },
  // Comfort
  shade: { label: "Shade", emoji: "🌳", kind: "good", group: "comfort" },
  restrooms: {
    label: "Restrooms",
    emoji: "🚻",
    kind: "good",
    group: "comfort",
  },
  picnic: {
    label: "Picnic tables",
    emoji: "🧺",
    kind: "good",
    group: "comfort",
  },
  parking: {
    label: "Easy parking",
    emoji: "🅿️",
    kind: "good",
    group: "comfort",
  },
  water_view: {
    label: "Pretty views",
    emoji: "🏔️",
    kind: "good",
    group: "comfort",
  },
  trail: {
    label: "Trail for a walk",
    emoji: "🥾",
    kind: "good",
    group: "comfort",
  },
  quiet: {
    label: "Quiet and calm",
    emoji: "🤫",
    kind: "good",
    group: "comfort",
  },
  // Dogs
  dog_friendly: {
    label: "Good for the dog",
    emoji: "🐕",
    kind: "good",
    group: "dogs",
  },
  dog_park: { label: "Dog park", emoji: "🦴", kind: "good", group: "dogs" },
  // Heads up
  busy_road: {
    label: "Close to a busy road",
    emoji: "🚗",
    kind: "heads_up",
    group: "heads_up",
  },
  open_water: {
    label: "Open water nearby",
    emoji: "🌊",
    kind: "heads_up",
    group: "heads_up",
  },
  no_shade: {
    label: "No shade",
    emoji: "🥵",
    kind: "heads_up",
    group: "heads_up",
  },
  hot_slides: {
    label: "Slides get hot",
    emoji: "🔥",
    kind: "heads_up",
    group: "heads_up",
  },
  no_restrooms: {
    label: "No restrooms",
    emoji: "🙅",
    kind: "heads_up",
    group: "heads_up",
  },
  goatheads: {
    label: "Goatheads or stickers",
    emoji: "🌵",
    kind: "heads_up",
    group: "heads_up",
  },
  windy: { label: "Windy", emoji: "💨", kind: "heads_up", group: "heads_up" },
  crowded: {
    label: "Gets crowded",
    emoji: "👥",
    kind: "heads_up",
    group: "heads_up",
  },
  broken: {
    label: "Something's broken",
    emoji: "🔧",
    kind: "heads_up",
    group: "heads_up",
  },
  messy: {
    label: "Messy (litter, geese…)",
    emoji: "🪿",
    kind: "heads_up",
    group: "heads_up",
  },
  old_equipment: {
    label: "Old or tired equipment",
    emoji: "🧓",
    kind: "heads_up",
    group: "heads_up",
  },
};

export const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES);

export const ATTR_GROUPS: { key: AttrGroup; label: string }[] = [
  { key: "play", label: "Play" },
  { key: "littles", label: "For littles" },
  { key: "comfort", label: "Comfy grown-ups" },
  { key: "dogs", label: "Dogs" },
  { key: "heads_up", label: "Heads up" },
];

/** Back-compat aliases: everything is an attribute now. */
export const FEATURES = ATTRIBUTES;
export const FEATURE_KEYS = ATTRIBUTE_KEYS;
export const REVIEW_TAGS = ATTRIBUTE_KEYS;

/**
 * Smart filters for the wheel and bucket list. A park matches when its
 * features + explorer reports say so (heads-ups count against).
 */
export const SMART_FILTERS: {
  key: string;
  label: string;
  emoji: string;
  any?: string[];
  none?: string[];
}[] = [
  {
    key: "littles",
    label: "Toddler-friendly",
    emoji: "🧸",
    any: ["toddler_area", "baby_swings", "fenced"],
  },
  { key: "splash", label: "Splash pad", emoji: "💦", any: ["splash_pad"] },
  {
    key: "dogs",
    label: "Bring the dog",
    emoji: "🐕",
    any: ["dog_friendly", "dog_park"],
  },
  {
    key: "potty",
    label: "Restrooms",
    emoji: "🚻",
    any: ["restrooms"],
    none: ["no_restrooms"],
  },
  {
    key: "shade",
    label: "Shady",
    emoji: "🌳",
    any: ["shade"],
    none: ["no_shade"],
  },
  { key: "safe", label: "Away from roads", emoji: "🛡️", none: ["busy_road"] },
];

/** Signal per attribute: a mapped feature counts once, each explorer report counts once. */
export function attributeScores(
  features: string[],
  reportCounts: Record<string, number>,
) {
  const scores: Record<string, number> = { ...reportCounts };
  for (const f of features) scores[f] = (scores[f] ?? 0) + 1;
  return scores;
}

export function matchesSmartFilter(
  key: string,
  scores: Record<string, number>,
): boolean {
  const f = SMART_FILTERS.find((s) => s.key === key);
  if (!f) return true;
  if (f.none?.some((k) => (scores[k] ?? 0) > 0)) return false;
  if (f.any && !f.any.some((k) => (scores[k] ?? 0) > 0)) return false;
  return true;
}

/**
 * Ways to fix the bucket list. no_playground keeps the park (as a park
 * without a playground); closed and private cross it off.
 */
export const CROSS_OFF_REASONS = {
  no_playground: { label: "No playground (just a park)", emoji: "🌳" },
  closed: { label: "Closed or torn down", emoji: "🚧" },
  private: { label: "Private (HOA, school…)", emoji: "🔒" },
} as const;
export type ParkStatus = "active" | keyof typeof CROSS_OFF_REASONS;

export const PLAY_TYPES = {
  playground: { label: "Playground", emoji: "🛝" },
  nature: { label: "Nature play", emoji: "🪵" },
  none: { label: "Park, no playground", emoji: "🌳" },
} as const;
export type PlayType = keyof typeof PLAY_TYPES;

/**
 * The one rule for "what kind of park is this?" Older rows may still carry the
 * retired status "no_playground"; read those as a park without a playground.
 */
export function playOf(p: { play?: string | null; status: string }): PlayType {
  if (p.status === "no_playground") return "none";
  return p.play && p.play in PLAY_TYPES ? (p.play as PlayType) : "playground";
}

/** Counts toward the playground quest (nature play counts, plain parks don't). */
export const hasPlayground = (p: { play?: string | null; status: string }) =>
  playOf(p) !== "none";

/** Off the list for good: closed or private. A park without a playground isn't. */
export const isCrossedOff = (p: { status: string }) =>
  p.status === "closed" || p.status === "private";

/** Ways to cross a park off the list (the real cross-offs only). */
export const CROSS_OFF_KEYS = ["closed", "private"] as const;
export type CrossOffKey = (typeof CROSS_OFF_KEYS)[number];

/** A park's play type and status, with legacy rows cleaned up. */
export function normalizePlay<T extends { play: string; status: string }>(
  p: T,
): T {
  if (p.status !== "no_playground") return p;
  return { ...p, play: "none", status: "active" };
}

export type Tally = {
  total: number;
  /** Visited and still on the list. */
  coloredIn: number;
  /** Closed or private. Still counts as done. */
  crossedOff: number;
  /** coloredIn + crossedOff. */
  done: number;
};

/** The bucket-list rule: done = visited + crossed off (closed/private). */
export function tally<T extends { status: string }>(
  parks: T[],
  visited: (p: T) => boolean,
): Tally {
  let coloredIn = 0;
  let crossedOff = 0;
  for (const p of parks) {
    if (isCrossedOff(p)) crossedOff++;
    else if (visited(p)) coloredIn++;
  }
  return {
    total: parks.length,
    coloredIn,
    crossedOff,
    done: coloredIn + crossedOff,
  };
}
