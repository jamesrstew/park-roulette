/**
 * US phone numbers: parse what people type, show them nicely.
 * Pure functions, shared by the browser and the server.
 */

/** Just the digits of what someone typed, without a leading US "1". */
function nationalDigits(input: string): string {
  const d = input.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/**
 * +1 area codes that aren't the 50 states: Canada, the Caribbean and the
 * Pacific islands share the US country code, and some are classic SMS-fraud
 * targets. Twilio is set to US-only too; this catches them before we try.
 */
const NOT_US = new Set(
  (
    "204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 403 416 418 " +
    "428 431 437 438 450 460 468 474 506 514 519 548 579 581 584 587 600 604 " +
    "613 622 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 " +
    "879 902 905 942 " + // Canada
    "242 246 264 268 284 340 345 441 473 649 658 664 670 671 684 721 758 767 " +
    "784 787 809 829 849 868 869 876 939"
  ) // Caribbean, Atlantic, Pacific
    .split(" "),
);

/**
 * "(541) 555-1234", "541.555.1234", "+1 541 555 1234", "15415551234"
 * → "+15415551234". Null for anything that isn't a real US number
 * (area code and exchange can't start with 0 or 1, and no N11 like 911).
 */
export function normalizeUSPhone(input: string): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  // A "+" means an international number; only +1 is the US.
  const t = input.trim();
  if (t.startsWith("+") && !/^\+\s*1/.test(t)) return null;
  const d = nationalDigits(t);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  if (/^[2-9]11/.test(d) || /^\d{3}[2-9]11/.test(d)) return null; // 911, 411…
  if (NOT_US.has(d.slice(0, 3))) return null;
  return `+1${d}`;
}

/** "+15415550123" → "(541) 555-0123". */
export function formatPhone(e164: string): string {
  const d = nationalDigits(e164);
  if (d.length !== 10) return e164;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** "+15415550123" → "(•••) •••-0123". */
export function maskPhone(e164: string): string {
  return `(•••) •••-${e164.slice(-4)}`;
}

/**
 * Format as you type: "5415" → "(541) 5", "5415550123" → "(541) 555-0123".
 * Keeps up with iOS contact autofill ("+1 (541) 555-0123").
 */
export function typePhone(input: string): string {
  const d = nationalDigits(input).slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** The digits of a typed or pasted code ("123 456." → "123456"), max 6. */
export function codeDigits(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}

/**
 * Where to go after signing in: only paths on this site ("/parks/x"). Never
 * "//evil.com", "https://…", or "/\t/evil.com" (browsers drop tabs and
 * newlines from URLs, which turns that into "//evil.com").
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string" || next.length > 200) return "/";
  if (!next.startsWith("/") || /[\u0000-\u0020\u007f\\]/.test(next)) return "/";
  try {
    const base = "https://parkroulette.invalid";
    const u = new URL(next, base);
    if (u.origin !== base) return "/";
    // "/.//evil.com" resolves to the path "//evil.com", which a browser
    // treats as another site: never hand back a path that starts with "//".
    if (u.pathname.startsWith("//")) return "/";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/";
  }
}
