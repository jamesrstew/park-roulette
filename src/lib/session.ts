import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";

const COOKIE = "pr_explorer";
const PHONE_COOKIE = "pr_phone";
const TWO_YEARS = 60 * 60 * 24 * 365 * 2;
/** How long a just-verified number waits to be attached (join or claim). */
const PHONE_TTL_S = 15 * 60;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16)
    throw new Error("SESSION_SECRET is missing or too short");
  return s;
}

const mac = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

function sameMac(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * How this phone signed in:
 *  j  joined (made this explorer here)
 *  c  proved the explorer's number with a texted code
 *  l  tapped "That's me!" on a family link, or switched on a shared phone,
 *     to someone with no number
 *  legacy  a cookie from before phone sign-in (the people who were already in)
 * Only trusted ways (everything but "l") may add or change a phone number:
 * otherwise anyone holding the family link could claim a grown-up who has no
 * number yet, add their own, and lock the real person out.
 */
export type SignedInBy = "j" | "c" | "l" | "legacy";
export type SessionToken = { id: number; epoch: number; by: SignedInBy };

export const trusted = (by: SignedInBy) => by !== "l";

/**
 * Cookie: "<id>.<epoch>.<by>.<mac>". The epoch is the explorer's
 * sessionEpoch at sign-in; bumping it in the DB signs that explorer out
 * everywhere. Cookies from before phone sign-in ("<id>.<mac>") are epoch 0.
 */
export function sign(
  id: number,
  epoch = 0,
  by: Exclude<SignedInBy, "legacy"> = "c",
): string {
  return `${id}.${epoch}.${by}.${mac(`explorer:${id}:${epoch}:${by}`)}`;
}

export function verify(token: string | undefined): SessionToken | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length === 2) {
    const [idStr, m] = parts;
    const id = Number(idStr);
    if (!Number.isSafeInteger(id) || id <= 0 || !m) return null;
    return sameMac(m, mac(`explorer:${id}`))
      ? { id, epoch: 0, by: "legacy" }
      : null;
  }
  if (parts.length !== 4) return null;
  const [idStr, epochStr, by, m] = parts;
  const id = Number(idStr);
  const epoch = Number(epochStr);
  if (!Number.isSafeInteger(id) || id <= 0 || !m) return null;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || String(epoch) !== epochStr)
    return null;
  if (by !== "j" && by !== "c" && by !== "l") return null;
  return sameMac(m, mac(`explorer:${id}:${epoch}:${by}`))
    ? { id, epoch, by }
    : null;
}

/**
 * The cookie's claim, NOT yet checked against the explorer's current epoch.
 * Use getMe() (src/lib/data.ts), which does that check.
 */
export async function readSession(): Promise<SessionToken | null> {
  return verify((await cookies()).get(COOKIE)?.value);
}

export async function setExplorer(
  id: number,
  epoch: number,
  by: Exclude<SignedInBy, "legacy">,
) {
  (await cookies()).set(COOKIE, sign(id, epoch, by), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TWO_YEARS,
    path: "/",
  });
}

export async function clearExplorer() {
  (await cookies()).delete(COOKIE);
}

// ---------- a just-verified phone number ----------
// When someone proves they own a number that isn't on any explorer yet, we
// remember it for a few minutes, so the join or "That's me!" that follows can
// attach it without texting a second code.

export function signPhone(e164: string, expires: number): string {
  return `${e164}.${expires}.${mac(`phone:${e164}:${expires}`)}`;
}

export function verifyPhone(
  token: string | undefined,
  now = Date.now(),
): string | null {
  if (!token || token.length > 200) return null;
  const [phone, expStr, m] = token.split(".");
  const exp = Number(expStr);
  if (!/^\+1\d{10}$/.test(phone ?? "") || !Number.isSafeInteger(exp) || !m)
    return null;
  if (exp < now) return null;
  return sameMac(m, mac(`phone:${phone}:${exp}`)) ? phone : null;
}

export async function rememberVerifiedPhone(e164: string) {
  (await cookies()).set(
    PHONE_COOKIE,
    signPhone(e164, Date.now() + PHONE_TTL_S * 1000),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: PHONE_TTL_S,
      path: "/",
    },
  );
}

export async function verifiedPhone(): Promise<string | null> {
  const token = (await cookies()).get(PHONE_COOKIE)?.value;
  await connection(); // the expiry check reads the clock: request time only
  return verifyPhone(token);
}

export async function forgetVerifiedPhone() {
  (await cookies()).delete(PHONE_COOKIE);
}
