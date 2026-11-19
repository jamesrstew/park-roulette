import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend signs webhooks with Svix: an HMAC-SHA256 of
 * "<svix-id>.<svix-timestamp>.<raw body>" with the endpoint's secret
 * ("whsec_" + base64). The svix-signature header lists one or more
 * "v1,<base64>" signatures (several during a secret rotation). The
 * timestamp must be within 5 minutes, so an old delivery can't be replayed.
 */

export const TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export function svixHeaders(h: Headers): SvixHeaders {
  return {
    id: h.get("svix-id"),
    timestamp: h.get("svix-timestamp"),
    signature: h.get("svix-signature"),
  };
}

export function signSvix(secret: string, id: string, ts: string, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
}

export function verifySvix(
  secret: string | undefined,
  h: SvixHeaders,
  rawBody: string,
  now: Date = new Date(),
): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  if (!/^\d+$/.test(h.timestamp)) return false;
  const age = Math.abs(now.getTime() / 1000 - Number(h.timestamp));
  if (age > TOLERANCE_SECONDS) return false;
  const want = Buffer.from(signSvix(secret, h.id, h.timestamp, rawBody));
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
