import "server-only";
import type { ReceivedEmail } from "./accept";

/**
 * Resend's receiving API. The email.received webhook carries only
 * metadata; the body and headers come from GET /emails/receiving/{id},
 * and the raw MIME message from its signed raw.download_url (we count its
 * From headers and read its DKIM-Signature and List-Unsubscribe headers
 * there). Reading received mail needs a full-access key:
 * RESEND_INBOUND_API_KEY, from a separate Resend team that holds only the
 * inbound domain, so the key can't send as or read anything else.
 * html_format=cid keeps inline images as cid: references instead of
 * inlining them as base64 (we never keep images anyway).
 */

export const RECEIVED_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The raw message at most (a newsletter is ~150 KB). */
export const MAX_RAW_BYTES = 1024 * 1024;
/** Resend's JSON for one email at most (html and text, cid images). */
export const MAX_JSON_BYTES = 3 * 1024 * 1024;

/** Hosts Resend's raw download link may point at. */
const RAW_HOSTS = [
  "cloudfront.net",
  "amazonaws.com",
  "resend.com",
  "resend.app",
];

export type FetchReceived =
  | { ok: true; email: ReceivedEmail }
  | { ok: false; status: number; error: string };

/** A response body as bytes, or null past `max` bytes. */
async function cappedBytes(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export async function fetchReceived(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchReceived> {
  const key = process.env.RESEND_INBOUND_API_KEY;
  if (!key) return { ok: false, status: 0, error: "no RESEND_INBOUND_API_KEY" };
  if (!RECEIVED_ID.test(id)) return { ok: false, status: 0, error: "bad id" };
  let res: Response;
  try {
    res = await fetchImpl(
      `https://api.resend.com/emails/receiving/${id}?html_format=cid`,
      {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).name };
  }
  const body = (await cappedBytes(res, MAX_JSON_BYTES))?.toString("utf8");
  if (body == null) return { ok: false, status: res.status, error: "too_big" };
  let json: (ReceivedEmail & { name?: string }) | null = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  if (!res.ok || !json)
    return {
      ok: false,
      status: res.status,
      error: json?.name ?? `http_${res.status}`,
    };
  return { ok: true, email: json };
}

export type FetchRaw =
  /** The exact bytes (DKIM is verified on them). */
  { ok: true; raw: Buffer } | { ok: false; error: string; retry: boolean };

/** The raw MIME message, at most 1 MB, from Resend's own download link. */
export async function fetchRaw(
  url: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchRaw> {
  let u: URL;
  try {
    u = new URL(url ?? "");
  } catch {
    return { ok: false, error: "no raw link", retry: false };
  }
  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.port ||
    !RAW_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))
  )
    return { ok: false, error: `raw link on ${host || "?"}`, retry: false };
  let res: Response;
  try {
    res = await fetchImpl(u.toString(), {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { ok: false, error: (e as Error).name, retry: true };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, error: `raw_http_${res.status}`, retry: true };
  }
  const raw = await cappedBytes(res, MAX_RAW_BYTES);
  if (raw == null) return { ok: false, error: "raw over 1 MB", retry: false };
  return { ok: true, raw };
}
