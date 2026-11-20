import { z } from "zod";
import raw from "../../../data/x-universe.json";
import type { SentIssue } from "./cooldowns";
import { daysBetween } from "./time";
import { ACCOUNT_COOLDOWN_WEEKS } from "./xapi";

/**
 * Parents' corner v4: the X account universe. The seed list
 * (data/x-universe.json, 68 accounts from 12 months of human-curated
 * roundups, revamped November 19, 2026 with kind, postsPerWeek and
 * medianLikes) is stored by permanent user id. Pure helpers live here; the
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
  /** person (a parent diarist), or brand / meme page. */
  kind: z.string().default("person"),
  /** Original posts a week, measured November 19, 2026 (sizes the batches). */
  postsPerWeek: z
    .number()
    .nonnegative()
    .nullable()
    .transform((n) => n ?? 1),
  /** Typical likes then: the scoring baseline until our own stats build up. */
  medianLikes: z
    .number()
    .nonnegative()
    .nullable()
    .transform((n) => n ?? 0),
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

/** Instagram pages featured in the last 8 weeks (lowercase handles). */
export function igCooling(
  history: readonly SentIssue[],
  issueDate: string,
): Set<string> {
  const out = new Set<string>();
  for (const h of history) {
    const s = h.body.meme?.snapshot;
    if (s?.kind !== "instagram") continue;
    const days = daysBetween(h.issueDate, issueDate);
    if (days >= 0 && days < ACCOUNT_COOLDOWN_WEEKS * 7)
      out.add(s.username.toLowerCase());
  }
  return out;
}
