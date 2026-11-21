import { addDays } from "@/lib/news/time";
import type { EventDate } from "./model";

/**
 * How well /events covers the community (events-coverage, November 2026):
 * library programs had crowded out the holiday events, tree lightings,
 * parades and museum nights families look for. Pure: the known endpoint
 * reports it, and the daily harvest's alarm reads it instead of counting.
 */

/** At least this many one-off or annual pages with a date this soon. */
export const COMMUNITY_TARGET = { events: 10, days: 30 } as const;

/** Library sites: their programs are recurring by nature. */
export const LIBRARY_HOSTS = [
  "deschuteslibrary.org",
  "crooklibraryor.gov",
  "jcld.org",
] as const;

const onHost = (url: string, hosts: readonly string[]) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return hosts.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
};

export type Coverage = {
  window_days: number;
  /** Listed pages with a date in the window. */
  listed: number;
  /** Listed one-off or annual pages with a date in the window. */
  community: number;
  community_target: number;
  community_met: boolean;
  /** Listed library pages with a date in the window. */
  library: number;
};

export function coverage(
  events: readonly {
    slug?: string;
    kind: string;
    confirm: string;
    url: string;
    dates: readonly EventDate[];
    /** False when the printed ages aren't kids' (never counted). */
    kids?: boolean;
    /** A date's status when it isn't scheduled (canceled, postponed...). */
    statusByDay?: Readonly<Record<string, string>>;
  }[],
  today: string,
): Coverage {
  const until = addDays(today, COMMUNITY_TARGET.days);
  const seen = new Set<string>();
  const inWindow = events.filter((e, i) => {
    if (e.confirm !== "ok" || e.kids === false) return false;
    // One page counts once.
    const id = e.slug ?? `#${i}`;
    if (seen.has(id)) return false;
    const live = e.dates.some(
      (d) =>
        (d.end_day ?? d.day) >= today &&
        d.day <= until &&
        (e.statusByDay?.[d.day] ?? "scheduled") === "scheduled",
    );
    if (live) seen.add(id);
    return live;
  });
  const community = inWindow.filter(
    (e) => e.kind === "one_off" || e.kind === "annual",
  ).length;
  return {
    window_days: COMMUNITY_TARGET.days,
    listed: inWindow.length,
    community,
    community_target: COMMUNITY_TARGET.events,
    community_met: community >= COMMUNITY_TARGET.events,
    library: inWindow.filter((e) => onHost(e.url, LIBRARY_HOSTS)).length,
  };
}
