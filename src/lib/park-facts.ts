import { ATTRIBUTES, attributeScores, playOf } from "./features";
import { formatStars } from "./rating";

/**
 * Plain-English facts about a park, built from its data: what it is, where,
 * what families say it has, heads-ups, and its stars. Used on the park page
 * ("About this park"), town pages, search snippets and llms.txt, so search
 * engines and AI assistants can quote one clear paragraph.
 */
export type FactsInput = {
  name: string;
  city: string;
  play: string;
  status: string;
  features: string[];
  reports: Record<string, number>;
  avgTenths: number | null;
  reviewCount: number;
};

/** "a, b and c" */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Words that read better in a sentence than the sticker labels do. */
const SAY: Record<string, string> = {
  great_slides: "great slides",
  trail: "a walking trail",
  dog_park: "a dog park",
  zipline: "a zipline",
  parking: "parking",
  shade: "shade",
  sandbox: "a sandbox",
  splash_pad: "a splash pad",
  toddler_area: "a toddler area",
  fenced: "a fence around the play area",
  messy: "litter or geese",
  open_water: "open water nearby",
  busy_road: "a busy road close by",
  no_shade: "no shade",
  no_restrooms: "no restrooms",
  hot_slides: "slides that get hot",
  broken: "some broken equipment",
  old_equipment: "older equipment",
};

const say = (key: string, label: string) =>
  SAY[key] ??
  label
    .replace(/\s*\(.*\)$/, "")
    .replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());

export function parkFacts(p: FactsInput) {
  const scores = attributeScores(p.features, p.reports);
  const has = (k: string) => (scores[k] ?? 0) > 0;
  const good = Object.entries(ATTRIBUTES)
    // "great slides" says "slides" already
    .filter(([k, a]) => a.kind === "good" && has(k))
    .filter(([k]) => !(k === "slides" && has("great_slides")))
    .map(([k, a]) => ({ key: k, label: a.label }));
  const headsUp = Object.entries(ATTRIBUTES)
    .filter(([k, a]) => a.kind === "heads_up" && has(k))
    .map(([k, a]) => ({ key: k, label: a.label }));
  const play = playOf(p);
  const what =
    p.status === "closed"
      ? "a closed park"
      : p.status === "private"
        ? "a private park (not open to everyone)"
        : play === "nature"
          ? "a nature play area (no play structure)"
          : play === "none"
            ? "a park without a playground"
            : "a playground";
  const parts = [`${p.name} is ${what} in ${p.city}, Oregon.`];
  if (good.length)
    parts.push(
      `It has ${listWords(good.slice(0, 8).map((g) => say(g.key, g.label)))}.`,
    );
  if (headsUp.length)
    parts.push(
      `Heads up: ${listWords(headsUp.slice(0, 4).map((h) => say(h.key, h.label)))}.`,
    );
  if (p.avgTenths != null && p.reviewCount > 0)
    parts.push(
      `Rated ${formatStars(p.avgTenths)} out of 5 stars from ${p.reviewCount} ${p.reviewCount === 1 ? "review" : "reviews"} on Park Roulette.`,
    );
  return { summary: parts.join(" "), what, good, headsUp, has };
}
