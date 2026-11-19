import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { stopByAddress } from "@/lib/news/audience";
import { svixHeaders, verifySvix } from "@/lib/news/svix";

/**
 * Resend's webhook (Svix-signed, checked on the raw body with
 * RESEND_WEBHOOK_SECRET). Only a permanent bounce or a spam complaint opts
 * an address out, matched against the address on file now. Each delivery
 * is handled once (by svix-id): the record and the opt-out commit
 * together, so a failure is retried by Svix and a retry of a success is a
 * no-op.
 */
type ResendEvent = {
  type?: string;
  data?: { to?: string[] | string; bounce?: { type?: string } };
};

export async function POST(req: Request) {
  const raw = await req.text();
  const h = svixHeaders(req.headers);
  if (!verifySvix(process.env.RESEND_WEBHOOK_SECRET, h, raw))
    return new Response("Bad signature", { status: 401 });
  let event: ResendEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const type = String(event.type ?? "");
  const permanent =
    type === "email.complained" ||
    (type === "email.bounced" &&
      String(event.data?.bounce?.type ?? "").toLowerCase() === "permanent");
  const to = event.data?.to;
  const addresses = (Array.isArray(to) ? to : to ? [to] : []).map(String);
  await db.transaction(async (tx) => {
    const fresh = await tx
      .insert(webhookEvents)
      .values({ id: h.id!, type })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!fresh.length || !permanent) return;
    let stopped = 0;
    for (const a of addresses)
      stopped += await stopByAddress(
        a,
        type === "email.complained" ? "complaint" : "bounce",
        tx,
      );
    console.info(`[news] ${type}: stopped ${stopped} account(s)`);
  });
  return new Response("ok");
}
