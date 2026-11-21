import { keyStem, occurrenceId, type StoredEvent, venueKey } from "./model";

/**
 * Splitting a legacy merged row (keyed series:<id> alone, which merged
 * ten library programs into one page on November 20) by its own stored
 * per-date targets: each date's target page says which program and branch
 * it is. Dates that belong to another program or branch move to their own
 * page; dates whose page couldn't be read stay put (and are reported).
 * Pure: the script (scripts/split-legacy-events.mts) reads the pages.
 */

/** What one date's own page says it is. */
export type Resolved = { title: string; venue: string; town: string };

export type SplitGroup = Resolved & { occurrences: string[] };

/** The groups to move off the row, and the dates nobody could read. */
export function planLegacySplit(
  e: StoredEvent,
  resolved: Readonly<Record<string, Resolved | null>>,
): { groups: SplitGroup[]; unknown: string[] } {
  const own = `${venueKey(e.venue)}|${keyStem(e.title)}`;
  const groups = new Map<string, SplitGroup>();
  const unknown: string[] = [];
  for (const d of e.dates) {
    const r = resolved[d.day];
    if (!r) {
      unknown.push(occurrenceId(d));
      continue;
    }
    const k = `${venueKey({ name: r.venue, town: r.town })}|${keyStem(r.title)}`;
    if (k === own) continue;
    const g = groups.get(k) ?? { ...r, occurrences: [] };
    g.occurrences.push(occurrenceId(d));
    groups.set(k, g);
  }
  return { groups: [...groups.values()], unknown };
}

/** The Event in a page's JSON-LD: its name, place and town. */
export function resolveFromJsonLd(html: string): Resolved | null {
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const list: unknown[] = Array.isArray(parsed)
      ? parsed
      : [
          parsed,
          ...(((parsed as { "@graph"?: unknown[] })?.["@graph"] as unknown[]) ??
            []),
        ];
    for (const o of list as Record<string, unknown>[]) {
      if (!o || !/Event$/.test(String(o["@type"] ?? ""))) continue;
      const loc = (o.location ?? {}) as Record<string, unknown>;
      const addr = (loc.address ?? {}) as Record<string, unknown>;
      const title = typeof o.name === "string" ? o.name : null;
      const venue = typeof loc.name === "string" ? loc.name : null;
      const town =
        typeof addr.addressLocality === "string" ? addr.addressLocality : null;
      if (title && venue && town) return { title, venue, town };
    }
  }
  return null;
}
