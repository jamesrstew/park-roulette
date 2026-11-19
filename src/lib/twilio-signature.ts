import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio signs every webhook (X-Twilio-Signature): base64 HMAC-SHA1, keyed
 * with the account's Auth Token, of the full URL Twilio called followed by
 * each POST parameter's name and value, sorted by name. Pure, so tests can
 * sign and check.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilio(
  authToken: string | undefined,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!authToken || !signature) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(signature);
  return got.length === want.length && timingSafeEqual(got, want);
}
