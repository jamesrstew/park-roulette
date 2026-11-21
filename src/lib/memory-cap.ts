import { createHash } from "node:crypto";

/**
 * A per-address cap held in memory only (per server instance), keyed by a
 * hash: no address is ever stored. The tap beacon allows 20 an hour.
 */
export function memoryCap(limit: number, windowMs: number) {
  const seen = new Map<string, { n: number; until: number }>();
  /** Over the cap? Counts this one. */
  return (address: string, now = Date.now()): boolean => {
    const key = createHash("sha256")
      .update(address)
      .digest("base64url")
      .slice(0, 16);
    if (seen.size > 5_000)
      for (const [k, v] of seen) if (v.until <= now) seen.delete(k);
    const e = seen.get(key);
    if (!e || e.until <= now) {
      seen.set(key, { n: 1, until: now + windowMs });
      return false;
    }
    e.n++;
    return e.n > limit;
  };
}
