import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slide previews (/social/<id>/<n>.png) need ?k=, so nobody can read a
 * post before it goes out by guessing ids. The dry-run email and the
 * drafts response carry it.
 */
export function previewKey(postId: number): string {
  const secret = process.env.CRON_SECRET || process.env.SESSION_SECRET || "";
  return createHmac("sha256", `social-preview:${secret}`)
    .update(String(postId))
    .digest("hex")
    .slice(0, 32);
}

export function previewKeyOk(postId: number, k: string | null): boolean {
  if (!k || !(process.env.CRON_SECRET || process.env.SESSION_SECRET))
    return false;
  const a = Buffer.from(previewKey(postId));
  const b = Buffer.from(k);
  return a.length === b.length && timingSafeEqual(a, b);
}
