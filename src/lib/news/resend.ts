/**
 * Resend's email API, for Bend Playground Passport and its confirmation
 * emails (alerts have their own sender in lib/alerts.ts). With no
 * RESEND_API_KEY nothing is sent: the email goes to the server log.
 * Open and click tracking are off on the news.parkroulette.quest domain in
 * Resend's dashboard; we never add pixels or tracked links ourselves.
 */

export const NEWS_FROM = () =>
  process.env.NEWS_FROM ||
  "James at Bend Playground Passport <james@news.parkroulette.quest>";
export const NEWS_REPLY_TO = () =>
  process.env.NEWS_REPLY_TO || "james@parkroulette.quest";

export type OutEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
};

/**
 * What a send attempt means for the next step. Resend doesn't document
 * whether a request that failed keeps its Idempotency-Key, so a key is
 * only reused when Resend may have taken it, and changed (the chunk's
 * next attempt) only when Resend clearly didn't.
 *
 *   sent          2xx
 *   accepted      409 invalid_idempotent_request: an earlier request with
 *                 this key went through (the payload has changed since)
 *   later         429, 409 concurrent_idempotent_requests or
 *                 resource_locked, or no answer (a timeout: it may have
 *                 gone through, so retry with the SAME key)
 *   invalid       400 or 422: something in the batch is malformed; send
 *                 that chunk one email at a time to find it
 *   server        5xx: Resend didn't take it; retry with a NEW key
 *   fatal         any other 4xx (bad key, unverified domain, other 409s):
 *                 retrying won't help
 */
export type SendOutcome =
  "sent" | "accepted" | "later" | "invalid" | "server" | "fatal";

export type SendResult =
  | { ok: true; outcome: "sent"; ids: string[]; logged?: boolean }
  | {
      ok: false;
      outcome: Exclude<SendOutcome, "sent">;
      status: number;
      error: string;
    };

export function classify(status: number, name: string): SendOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 0) return "later";
  if (status === 409 && name === "invalid_idempotent_request")
    return "accepted";
  if (
    status === 429 ||
    (status === 409 &&
      (name === "concurrent_idempotent_requests" || name === "resource_locked"))
  )
    return "later";
  if (status === 400 || status === 422) return "invalid";
  if (status >= 500) return "server";
  return "fatal";
}

export async function post(
  path: string,
  body: unknown,
  idempotencyKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  let res: Response;
  try {
    res = await fetchImpl(`https://api.resend.com${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, outcome: "later", status: 0, error: (e as Error).name };
  }
  const json = (await res.json().catch(() => null)) as {
    id?: string;
    data?: { id: string }[];
    name?: string;
  } | null;
  if (res.ok) {
    const ids = json?.data
      ? json.data.map((d) => d.id)
      : json?.id
        ? [json.id]
        : [];
    return { ok: true, outcome: "sent", ids };
  }
  const name = json?.name ?? `http_${res.status}`;
  const outcome = classify(res.status, name) as Exclude<SendOutcome, "sent">;
  return { ok: false, outcome, status: res.status, error: name };
}

function logOnly(emails: OutEmail[], why: string): SendResult {
  for (const e of emails)
    console.info(
      `[news] ${why}: would send "${e.subject}" to ${e.to.length} address(es)`,
    );
  return {
    ok: true,
    outcome: "sent",
    ids: emails.map(() => "log-only"),
    logged: true,
  };
}

/** One email (confirmations, dry runs, a chunk sent one at a time). */
export async function sendOne(
  email: OutEmail,
  idempotencyKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) return logOnly([email], "no RESEND_API_KEY");
  return post("/emails", email, idempotencyKey, fetchImpl);
}

/** Up to 100 emails in one request, safe to retry with the same key. */
export async function sendBatch(
  emails: OutEmail[],
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (emails.length > 100) throw new Error("Resend batches hold 100 emails");
  if (!process.env.RESEND_API_KEY) return logOnly(emails, "no RESEND_API_KEY");
  return post("/emails/batch", emails, idempotencyKey, fetchImpl);
}
