import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "pr_explorer";
const TWO_YEARS = 60 * 60 * 24 * 365 * 2;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16)
    throw new Error("SESSION_SECRET is missing or too short");
  return s;
}

export function sign(id: number): string {
  const mac = createHmac("sha256", secret())
    .update(`explorer:${id}`)
    .digest("base64url");
  return `${id}.${mac}`;
}

export function verify(token: string | undefined): number | null {
  if (!token) return null;
  const [idStr, mac] = token.split(".");
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0 || !mac) return null;
  const expected = sign(id).split(".")[1];
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** The signed-in explorer's id, or null. */
export async function currentExplorerId(): Promise<number | null> {
  return verify((await cookies()).get(COOKIE)?.value);
}

export async function setExplorer(id: number) {
  (await cookies()).set(COOKIE, sign(id), {
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
