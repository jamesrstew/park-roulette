import { z } from "zod";
import raw from "../../../data/takedowns.json";

/**
 * Same-day takedowns (data/takedowns.json): a post someone asked us to
 * remove stops showing in issue pages and its card stops serving; its
 * account is never offered again. Edit the file, commit, deploy.
 */
const Takedowns = z.object({
  accounts: z.array(
    z.object({
      platform: z.enum(["x", "instagram", "tiktok"]),
      handle: z.string(),
      /** X: the permanent user id (a handle can be renamed or reused). */
      id: z.string().optional(),
      reason: z.string().optional(),
      date: z.string().optional(),
    }),
  ),
  posts: z.array(
    z.object({
      platform: z.enum(["x", "instagram", "tiktok"]),
      id: z.string(),
      date: z.string().optional(),
    }),
  ),
});
const T = Takedowns.parse(raw);

export type Platform = "x" | "instagram" | "tiktok";

export function blockedAccounts(platform: Platform): Set<string> {
  return new Set(
    T.accounts
      .filter((a) => a.platform === platform)
      .map((a) => a.handle.replace(/^@/, "").toLowerCase()),
  );
}

export function takenDown(platform: Platform, id: string): boolean {
  return T.posts.some((p) => p.platform === platform && p.id === id);
}

/** X author ids blocked by id (renames can't slip past). */
export function blockedIds(platform: Platform): Set<string> {
  return new Set(
    T.accounts.filter((a) => a.platform === platform && a.id).map((a) => a.id!),
  );
}

/** Is a snapshot's post or account taken down? (Hides it from the archive.) */
export function snapshotTakenDown(
  s:
    | { kind: "x"; id: string; username: string; authorId?: string }
    | { kind: "tiktok"; id: string; handle: string }
    | { kind: "instagram"; id: string; username: string },
): boolean {
  if (takenDown(s.kind, s.id)) return true;
  const handle = s.kind === "tiktok" ? s.handle : s.username;
  if (blockedAccounts(s.kind).has(handle.toLowerCase())) return true;
  return s.kind === "x" && !!s.authorId && blockedIds("x").has(s.authorId);
}
