import { handleReceived } from "@/lib/inbox/inbound";
import { readCapped } from "@/lib/news/http";
import { svixHeaders, verifySvix } from "@/lib/news/svix";

export const maxDuration = 60;

/**
 * Resend's inbound webhook (email.received) for the private newsletter
 * inbox, Svix-signed with RESEND_INBOUND_SECRET and checked on the raw
 * body. The delivery holds only metadata; the email itself is read from
 * Resend and kept only when it's one of the two newsletters, forwarded
 * by the owner's Gmail (lib/inbox/accept.ts). Everything else is
 * dropped and logged. A Message-ID is stored once, so retries are no-ops.
 */
type Delivery = { type?: string; data?: { email_id?: unknown } };

/** Said once per server: every delivery is refused until it's set. */
let warnedNoSecret = false;

export async function POST(req: Request) {
  const raw = await readCapped(req, 256 * 1024);
  if (raw == null) return new Response("Too big", { status: 413 });
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret && !warnedNoSecret) {
    warnedNoSecret = true;
    console.error(
      "[inbox] RESEND_INBOUND_SECRET isn't set: every inbound email is refused",
    );
  }
  const h = svixHeaders(req.headers);
  if (!verifySvix(secret, h, raw))
    return new Response("Bad signature", { status: 401 });
  let event: Delivery;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (
    event.type !== "email.received" ||
    typeof event.data?.email_id !== "string"
  )
    return new Response("ignored");
  const r = await handleReceived(event.data.email_id);
  return Response.json(
    { outcome: r.outcome, ...(r.reason ? { reason: r.reason } : {}) },
    { status: r.status },
  );
}
