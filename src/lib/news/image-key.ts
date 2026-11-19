import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Draft images (an issue's weather card and post card before its send
 * starts) need this key in ?k=, so nobody can read next Thursday's issue
 * early by guessing /newsletter/<date>/weather.png. The dry-run email
 * carries it; once a send starts the images are public and need none.
 */
export function draftImageKey(issueDate: string): string {
  const secret = process.env.CRON_SECRET || process.env.SESSION_SECRET || "";
  return createHmac("sha256", `draft-images:${secret}`)
    .update(issueDate)
    .digest("hex")
    .slice(0, 32);
}

export function draftImageKeyOk(issueDate: string, k: string | null): boolean {
  if (!k || !(process.env.CRON_SECRET || process.env.SESSION_SECRET))
    return false;
  const a = Buffer.from(draftImageKey(issueDate));
  const b = Buffer.from(k);
  return a.length === b.length && timingSafeEqual(a, b);
}
