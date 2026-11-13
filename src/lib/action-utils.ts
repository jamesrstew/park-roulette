import "server-only";
import { z } from "zod";
import { getMe } from "./data";
import { SmsError } from "./sms";

/**
 * Helpers for the server actions. They live here, not in a "use server"
 * file, because every export of a "use server" file is a public endpoint.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

/** An error whose message is written for people, safe to show in the UI. */
export class UserError extends Error {}

export async function requireMe() {
  const me = await getMe();
  if (!me) throw new UserError("Hop in first! Sign in or join a family.");
  return me;
}

/** Words, photos, new parks: grown-ups only (kids give stars and tags). */
export async function requireGrownUp() {
  const me = await requireMe();
  if (me.isKid) throw new UserError("Ask a grown-up to do this one!");
  return me;
}

/**
 * Park fixes count from grown-ups who sign in with a number, so nobody can
 * out-vote the town with throwaway families.
 */
export async function requireVoter() {
  const me = await requireGrownUp();
  if (!me.phone || !me.trusted)
    throw new UserError(
      "Add your number in Family & settings (tap your name on the Passport) so your park fixes count!",
    );
  return me;
}

/** Moderation: an admin, signed in with a code (or joined) on this phone. */
export async function requireAdmin() {
  const me = await requireMe();
  if (!me.isAdmin || !me.trusted) throw new UserError("That's for admins.");
  return me;
}

/**
 * Turn any failure into a friendly result. Validation, UserError and SmsError
 * messages are shown as-is; anything else (DB, network) is logged on the
 * server and the person sees a gentle retry message, never SQL.
 */
export function fail(action: string, e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError)
    return {
      ok: false,
      error: e.issues[0]?.message ?? "Hmm, that didn't work",
    };
  if (e instanceof UserError || e instanceof SmsError)
    return { ok: false, error: e.message };
  console.error(`[action:${action}]`, redact(e));
  return { ok: false, error: "Hmm, that didn't work. Try again in a sec?" };
}

export function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Which unique constraint a 23505 tripped, if any. */
export function uniqueConstraint(e: unknown): string | null {
  if (!isUniqueViolation(e)) return null;
  const err = e as {
    constraint_name?: string;
    cause?: { constraint_name?: string };
  };
  return err.constraint_name ?? err.cause?.constraint_name ?? null;
}

/**
 * An error, safe for logs: the database driver's own message (not drizzle's,
 * which repeats the query parameters), with anything that looks like a phone
 * number or an IP address blanked out.
 */
export function redact(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: unknown };
  const inner = (err?.cause as { message?: string } | undefined)?.message;
  const msg = String(inner ?? err?.message ?? e);
  return `${err?.name ?? "Error"}: ${msg
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[ip]")
    .replace(/\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}\b/gi, "[ip]")
    .slice(0, 300)}`;
}
