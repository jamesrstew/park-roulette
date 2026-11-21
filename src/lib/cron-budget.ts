/**
 * The nightly events-check run's time: Vercel stops it at 300 seconds.
 * The trait re-check goes first (at most PROFILE_BUDGET_MS); the events
 * re-check gets what's left of EVENTS_UNTIL_MS, which leaves room for the
 * last checks in flight and the IndexNow ping. A check starts only inside
 * the budget and takes at most one fetch's time: 15 s for the fetch plus
 * up to 5 s of DNS per hop (lib/news/fetcher.ts), with a listing event's
 * two pages fetched at once, after at most a 500 ms per-host gap.
 */
export const MAX_DURATION_S = 300;
export const PROFILE_BUDGET_MS = 45_000;
export const EVENTS_UNTIL_MS = 230_000;

/** The events re-check's budget, given when the run started. */
export function eventsBudget(started: number, now = Date.now()): number {
  return Math.max(0, EVENTS_UNTIL_MS - (now - started));
}
