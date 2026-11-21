/**
 * Park news by email: the words people agree to, and email helpers.
 * Pure (no server imports), so the browser and tests can use it too.
 */

/** Bump the version whenever the words people see change. */
export const CONSENT_VERSION = "email-2026-11-21";

/** What an email yes looked like on its surface (frozen per version). */
export type EmailConsentWords = {
  /** The box's title, when there's a box. */
  title?: string;
  body?: string;
  /** The fine print ({date} is the first issue's day). */
  fine: string;
  /** The fine print when the first issue's day isn't known. */
  fineNoDate?: string;
  /** The button that said yes. */
  button: string;
  /** The box was checked before they saw it (opt-out email, CAN-SPAM). */
  prechecked: boolean;
};

/**
 * The words behind each email consent version, so a yes can be shown
 * later as it was seen. Never edit a version: add one.
 */
export const EMAIL_CONSENT_TEXT: Record<string, EmailConsentWords> = {
  "email-2026-11-21": {
    fine: "For grown-ups. Unsubscribe anytime.",
    button: "Count us in!",
    prechecked: false,
  },
  // The welcome sheet's picks page: a pre-checked box with the field.
  "email-2026-11-22-prechecked": {
    title: "Email me Thursdays",
    body: "The weekend forecast, one park to try, and a warm backup if it pours.",
    fine: "First email: {date}. Unsubscribe anytime.",
    fineNoDate: "First email: Thursday morning. Unsubscribe anytime.",
    button: "Let's spin!",
    prechecked: true,
  },
};

/** The email consent version each surface records (the rest: CONSENT_VERSION). */
export function emailConsentVersionFor(source: string): string {
  return source === "welcome_sheet"
    ? "email-2026-11-22-prechecked"
    : CONSENT_VERSION;
}

/**
 * The glossary (one set of names everywhere): the umbrella is "the weekly
 * park picks" ("Park picks" as a card title); the email is "Bend
 * Playground Passport" ("the weekly email" only where a short label is
 * needed, never just "Passport", which is the stamps tab); the text is
 * "Weekend Pick" (its carrier name is "Park Roulette Weekend Pick").
 */
export const NEWS_NAME = "Bend Playground Passport";
export const TEXTS_NAME = "Weekend Pick";

export const PARK_NEWS = {
  title: "Park picks",
  tagline: "Central Oregon playgrounds, rain or shine.",
  cadence: "A free email every Thursday morning.",
  pitch:
    "The weekend forecast, one park to try, and a warm backup if it pours.",
  button: "Count us in!",
  pending: "One sec…",
  /** Signed-out fine print (anyone could be typing). */
  fine: "For grown-ups. Unsubscribe anytime.",
  fineFull: "For grown-ups. Unsubscribe anytime. We never sell your email.",
  success: "You're in! Look for us Thursday morning.",
  /** The per-IP and daily caps (neutral: about us, never the address). */
  busy: "Lots of sign-ups right now. Try again tomorrow?",
  failure: "That didn't go through. Try again?",
  on: "Every Thursday morning.",
  /** An address this account asked to connect, link not tapped yet. */
  connecting: "Waiting for you to connect this email (check your inbox).",
  off: "Bend Playground Passport: the weekend forecast, a park to try and a warm backup, Thursday mornings.",
} as const;

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

/** "Thursday, December 3" from "2026-12-03". */
export function issueDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * The signup success line, with the first issue's real date when the
 * action gave it ("You're in! Look for us Thursday, December 3.").
 */
export function successLine(firstIssue?: string | null): string {
  return firstIssue
    ? `You're in! Look for us ${firstIssue}.`
    : PARK_NEWS.success;
}

/** Social proof shows only from this many confirmed subscribers (James). */
export const PROOF_MIN = 50;

/** "{N}+ grown-ups already get it": 237 → 230; under 50 → null. */
export function proofCount(n: number): number | null {
  return n >= PROOF_MIN ? Math.floor(n / 10) * 10 : null;
}
