/** Park features, each with a sticker. Keys match data/parks.json. */
export const FEATURES: Record<string, { label: string; emoji: string }> = {
  swings: { label: "Swings", emoji: "🪢" },
  slides: { label: "Slides", emoji: "🛝" },
  climbing: { label: "Climbing", emoji: "🧗" },
  toddler_area: { label: "Little kid area", emoji: "🧸" },
  splash_pad: { label: "Splash pad", emoji: "💦" },
  shade: { label: "Shade", emoji: "🌳" },
  restrooms: { label: "Restrooms", emoji: "🚻" },
  fenced: { label: "Fenced", emoji: "🚧" },
  picnic: { label: "Picnic tables", emoji: "🧺" },
  accessible: { label: "Accessible", emoji: "♿" },
  sandbox: { label: "Sandbox", emoji: "🏖️" },
  zipline: { label: "Zipline", emoji: "🚡" },
  water_view: { label: "Water view", emoji: "🌊" },
  dog_park: { label: "Dog park", emoji: "🐕" },
  sports_courts: { label: "Courts", emoji: "🏀" },
  trail: { label: "Trail", emoji: "🥾" },
};

export const FEATURE_KEYS = Object.keys(FEATURES);

/** One-tap review tags. */
export const REVIEW_TAGS = [
  "Big kid approved",
  "Great for littles",
  "Super shady",
  "Bring a jacket (windy!)",
  "Hidden gem",
  "Mountain views",
  "Busy on weekends",
  "Wood chips everywhere",
  "Best slide ever",
  "Picnic spot",
];
