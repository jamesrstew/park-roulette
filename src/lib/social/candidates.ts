import { createHash } from "node:crypto";
import { CATALOG, type Catalog, isClosedPark } from "@/lib/news/catalog";
import {
  MIN_POST_TRAITS,
  type ParkProfile,
  postKinds,
} from "@/lib/park-profiles";
import type { ParkInfo } from "./compose";

/**
 * Parks the plan offers for Unpack items: open on the map, with play,
 * not closed for now in the catalog, outside the Instagram cooldown.
 */
export function listableParks(
  all: ReadonlyMap<string, ParkInfo>,
  catalog: Catalog,
  cooling: ReadonlySet<string>,
): ParkInfo[] {
  return [...all.values()].filter(
    (p) =>
      p.approved &&
      p.status === "active" &&
      p.play !== "none" &&
      !isClosedPark(p.slug, catalog) &&
      !cooling.has(p.slug),
  );
}

/**
 * Up to 3 park-post parks, code-picked: open, outside cooldowns, with
 * live, in-season signature traits of at least 2 kinds (nearby and
 * history aside) for the post's month, checked photo first.
 */
export function postCandidates(
  all: ReadonlyMap<string, ParkInfo>,
  cooling: ReadonlySet<string>,
  exclude: ReadonlySet<string>,
  hasPhoto: (slug: string) => boolean,
  seed: string,
  profiles: ReadonlyMap<string, ParkProfile>,
  month: number,
): string[] {
  const kinds = (slug: string) => postKinds(profiles.get(slug), month);
  const noPick = new Set(
    CATALOG.parks.filter((p) => p.no_pick || p.closed).map((p) => p.slug),
  );
  const score = (slug: string) =>
    createHash("sha256").update(`${seed}:${slug}`).digest().readUInt32BE(0);
  return [...all.values()]
    .filter(
      (p) =>
        p.approved &&
        p.status === "active" &&
        (p.play === "playground" || p.play === "nature") &&
        !noPick.has(p.slug) &&
        !cooling.has(p.slug) &&
        !exclude.has(p.slug) &&
        kinds(p.slug) >= MIN_POST_TRAITS,
    )
    .sort(
      (a, b) =>
        Number(hasPhoto(b.slug)) - Number(hasPhoto(a.slug)) ||
        kinds(b.slug) - kinds(a.slug) ||
        b.features.length - a.features.length ||
        score(a.slug) - score(b.slug),
    )
    .slice(0, 3)
    .map((p) => p.slug);
}
