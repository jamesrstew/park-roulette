import { z } from "zod";
import raw from "../../../data/x-universe.json";
import type { SentIssue } from "./cooldowns";
import { daysBetween } from "./time";
import { ACCOUNT_COOLDOWN_WEEKS } from "./xapi";

/**
 * Parents' corner v4: the X account universe. The seed list
 * (data/x-universe.json, 76 accounts from 12 months of human-curated
 * roundups) is stored by permanent user id. Pure helpers live here; the
 * database side is universe-store.ts.
 */

const SeedAccount = z.object({
  id: z.string().regex(/^\d{1,25}$/),
  username: z.string().regex(/^\w{1,15}$/),
  name: z.string(),
  followers: z.number().int().nonnegative(),
  appearances: z.number().int().nonnegative(),
  sources: z.array(z.string()),
  notes: z.string().optional(),
});
export type SeedAccount = z.infer<typeof SeedAccount>;

/** The seed, most-featured first (the order queries are packed in). */
export const SEED: readonly SeedAccount[] = z
  .array(SeedAccount)
  .parse(raw)
  .sort((a, b) => b.appearances - a.appearances);

/** Out for good after this long with nothing over the likes floor. */
export const INACTIVE_DAYS = 90;

/** Why an account is out of this week's search, or null if it's in. */
export function accountOut(
  a: {
    flaggedReason: string | null;
    droppedReason: string | null;
    lastFloorAt: Date | null;
    createdAt: Date;
  },
  now: Date,
): string | null {
  if (a.droppedReason) return `dropped: ${a.droppedReason}`;
  if (a.flaggedReason) return `flagged: ${a.flaggedReason}`;
  const since = a.lastFloorAt ?? a.createdAt;
  if (now.getTime() - since.getTime() > INACTIVE_DAYS * 86_400_000)
    return "inactive: nothing over the floor in 3 months";
  return null;
}

/**
 * Author ids featured in Parents' corner within the account cooldown
 * (8 weeks), from sent issues only.
 */
export function coolingAuthors(
  history: readonly SentIssue[],
  issueDate: string,
): Set<string> {
  const out = new Set<string>();
  for (const h of history) {
    const s = h.body.meme?.snapshot;
    if (s?.kind !== "x") continue;
    const days = daysBetween(h.issueDate, issueDate);
    if (days >= 0 && days < ACCOUNT_COOLDOWN_WEEKS * 7)
      out.add(s.authorId ?? `@${s.username.toLowerCase()}`);
  }
  return out;
}
