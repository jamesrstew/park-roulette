/**
 * Park news by email: the words people agree to, and email helpers.
 * Pure (no server imports), so the browser and tests can use it too.
 */

/** Bump the version whenever the words people see change. */
export const CONSENT_VERSION = "email-2026-11-18";

export const PARK_NEWS = {
  headline: "Want park news?",
  body: "New playgrounds, closures and splash pad openings. About once a month.",
  fine: "Unsubscribe anytime. We never sell your email.",
  button: "Count us in!",
  decline: "No thanks",
  success: "You're on the list!",
} as const;

export type ParkNewsSource = "stamp_card" | "passport_card" | "settings";

/** Lowercased and trimmed, or null if it doesn't look like an email. */
export function cleanEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (e.length > 254) return null;
  // Printable ASCII only, no quotes or brackets, sane domain labels.
  const m = e.match(
    /^([a-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/,
  );
  if (!m) return null;
  const [, user, domain] = m;
  if (user.startsWith(".") || user.endsWith(".") || user.includes(".."))
    return null;
  const labels = domain.split(".");
  if (labels.some((l) => !l || l.startsWith("-") || l.endsWith("-")))
    return null;
  return /^[a-z]{2,}$/.test(labels.at(-1)!) ? e : null;
}

const COMMON = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "comcast.net",
  "bendbroadband.com",
  // Real domains that look like typos of the ones above.
  "ymail.com",
  "mail.com",
  "email.com",
  "mac.com",
  "me.com",
  "aim.com",
  "msn.com",
  "live.com",
  "proton.me",
  "protonmail.com",
];

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}

/** "jane@gmial.com" -> "jane@gmail.com"; null when it looks fine. */
export function suggestEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return null;
  const user = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (!domain || COMMON.includes(domain)) return null;
  domain = domain.replace(/\.(con|cmo|cm|om|comm)$/, ".com");
  let best: string | null = null;
  let bestD = 3;
  for (const c of COMMON) {
    const dd = distance(domain, c);
    if (dd < bestD) [best, bestD] = [c, dd];
  }
  const fixed = best ?? domain;
  return fixed !== e.slice(at + 1) && (best || domain !== e.slice(at + 1))
    ? `${user}@${fixed}`
    : null;
}
