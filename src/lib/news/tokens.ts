import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Random tokens for email links (confirm, unsubscribe): 32 bytes, base64url.
 * Confirmation tokens are stored only as a sha256; unsubscribe tokens are
 * stored as-is (they must be put back into every email).
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The shape newToken() makes. Anything else is rejected before the DB. */
export function isToken(t: unknown): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** An address as we store it: every space out, lowercase. */
export function normalizeEmail(email: string): string {
  return email.replace(/\s+/g, "").toLowerCase();
}

/** The same fingerprint the consent scrub stores ("sha256:<hex>"). */
export function addressHash(email: string): string {
  return `sha256:${sha256(normalizeEmail(email))}`;
}

/**
 * Constant-time "Authorization: Bearer <secret>" check. Compares sha256
 * digests, so the time taken says nothing about the secret, not even its
 * length. A missing or too short secret refuses everyone.
 */
export function bearerOk(
  req: Request,
  secret: string | undefined,
  minLength = 1,
): boolean {
  if (!secret || secret.length < minLength) return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(
    digest(req.headers.get("authorization") ?? ""),
    digest(`Bearer ${secret}`),
  );
}

/** "jane@example.com" -> "j***@example.com", for pages a token opens. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "your email";
  return `${email[0]}***${email.slice(at)}`;
}
