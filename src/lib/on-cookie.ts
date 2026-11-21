import { cookies } from "next/headers";

/**
 * pr_on: what this browser already gets, so the footer, the welcome sheet
 * and the ask moments stop offering it to people who aren't signed in.
 * "e" (the Thursday email), "t" (the Weekend Pick), or "et". Set by any
 * yes and by arriving from an email link (/n/), cleared by a stop here.
 * It holds no address or number, only those letters. 180 days. Signed in,
 * the account is the truth; this is the only signed-out source.
 */
export const ON_COOKIE = "pr_on";
export const ON_COOKIE_DAYS = 180;

export type On = { email: boolean; texts: boolean };
export type OnLetter = "e" | "t";

/** "et" → both; anything else odd → neither. */
export function parseOn(raw: string | null | undefined): On {
  const v = raw && /^[et]{1,2}$/.test(raw) ? raw : "";
  return { email: v.includes("e"), texts: v.includes("t") };
}

/** {email, texts} → "e", "t", "et" or "" (cleared). */
export function formatOn(on: On): string {
  return `${on.email ? "e" : ""}${on.texts ? "t" : ""}`;
}

/** The cookie's options (also used by the /n/ redirect's response). */
export const onCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: ON_COOKIE_DAYS * 86_400,
  path: "/",
};

/** What this browser already gets (server components and actions). */
export async function readOn(): Promise<On> {
  return parseOn((await cookies()).get(ON_COOKIE)?.value);
}

/** Add or remove a letter (server actions only: they can set cookies). */
export async function markOn(letter: OnLetter, on: boolean): Promise<void> {
  const jar = await cookies();
  const now = parseOn(jar.get(ON_COOKIE)?.value);
  const next = { ...now, [letter === "e" ? "email" : "texts"]: on };
  const v = formatOn(next);
  // A yes renews the 180 days; a stop with nothing left clears it.
  if (v) jar.set(ON_COOKIE, v, onCookieOptions);
  else if (jar.has(ON_COOKIE)) jar.delete(ON_COOKIE);
}
