import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import { SITE_URL } from "@/lib/site";
import { classifyReply, TEXTS } from "@/lib/texts";
import {
  noteTextSent,
  optOut,
  startFromPhone,
  textedStop,
} from "@/lib/texts-store";
import { verifyTwilio } from "@/lib/twilio-signature";

/**
 * Replies to the Weekend Pick number (Twilio's messaging webhook). Signed
 * with TWILIO_AUTH_TOKEN; each message is handled once (by MessageSid,
 * recorded in the same transaction as what it changes, so a failure rolls
 * both back and Twilio's retry is handled afresh).
 *
 * Twilio's Advanced Opt-Out answers its own keywords and tells us so with
 * OptOutType (STOP, START or HELP): then we only record, never reply. With
 * no OptOutType, Twilio didn't treat it as a keyword ("Stop.", "STOP ALL",
 * "Don't text me"), so the reply is ours:
 *   stop or a stop in plain words: off now, and TEXTS.stop.
 *   help: TEXTS.help.
 *   start, from a number on our STOP list: back on, and TEXTS.start.
 *     From anyone else it's just a reply (the yes is in the app).
 *   Anything else: James hears about it; no reply.
 */
const twiml = (message?: string) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${
      message
        ? `<Message>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message>`
        : ""
    }</Response>`,
    { headers: { "content-type": "text/xml; charset=utf-8" } },
  );

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return new Response("Bad request", { status: 400 });
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });
  // Twilio signs the public URL it called (not whatever a proxy hands us).
  const url = `${SITE_URL}/api/texts/inbound`;
  if (
    !verifyTwilio(
      process.env.TWILIO_AUTH_TOKEN,
      url,
      params,
      req.headers.get("x-twilio-signature"),
    )
  ) {
    // Either TWILIO_AUTH_TOKEN or the webhook URL in Twilio is wrong (or
    // someone is poking the endpoint): a STOP could be going unheard.
    console.warn("[texts] inbound webhook: bad Twilio signature");
    alertLater({
      key: "texts:bad-signature",
      subject: "Park texts replies are being refused",
      text: `A text reply reached ${url} with a Twilio signature that didn't check out, so it was refused (403). If that was Twilio, STOP replies aren't being recorded: check that the Messaging Service's incoming webhook is exactly ${url} (POST) and that TWILIO_AUTH_TOKEN matches the account.`,
      everyMinutes: 60,
    });
    return new Response("Bad signature", { status: 403 });
  }
  const from = params.From ?? "";
  const sid = params.MessageSid ?? params.SmsSid ?? "";
  if (!/^\+1\d{10}$/.test(from) || !sid) return twiml();
  const body = params.Body ?? "";
  const optOutType = (params.OptOutType ?? "").toUpperCase();
  const kind = classifyReply(body);
  let out: { reply?: string; alert?: "stop_like" | "other" };
  try {
    out = await db.transaction(async (tx) => {
      const fresh = await tx
        .insert(webhookEvents)
        .values({ id: `twilio:${sid}`, type: "sms.inbound" })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (!fresh.length) return {};
      // Twilio handled a keyword (and replied): record only.
      if (optOutType === "STOP") {
        await optOut(from, "stop", null, {}, tx);
        return {};
      }
      if (optOutType === "START") {
        if (await textedStop(from, tx)) await startFromPhone(from, tx);
        return {};
      }
      if (optOutType === "HELP") return {};
      // Twilio didn't: the reply is ours.
      if (kind === "stop" || kind === "stop_like") {
        await optOut(
          from,
          kind === "stop" ? "stop" : "stop_reply",
          null,
          {},
          tx,
        );
        return {
          reply: TEXTS.stop,
          alert: kind === "stop_like" ? ("stop_like" as const) : undefined,
        };
      }
      if (kind === "help") return { reply: TEXTS.help };
      // START only means something from a number on our STOP list: anyone
      // else says yes in the app, with a code and the checked box.
      if (kind === "start") {
        if (!(await textedStop(from, tx))) return {};
        await startFromPhone(from, tx);
        return { reply: TEXTS.start };
      }
      return { alert: "other" as const };
    });
  } catch (e) {
    // Nothing was recorded (one transaction): a 500 makes Twilio retry.
    console.error("[texts] inbound failed", (e as Error)?.message);
    alertLater({
      key: "error:texts-inbound",
      subject: "A reply to the Weekend Pick number failed",
      text: `Handling a reply from …${from.slice(-4)} threw an error, so nothing was recorded. Twilio retries; if it was a stop, check the Twilio console and the STOP list (sms_opt_outs) today. Vercel logs: [texts].`,
      everyMinutes: 30,
    });
    return new Response("Failed", { status: 500 });
  }
  if (out.alert === "stop_like")
    alertLater({
      key: `texts:stop-like:${from.slice(-4)}`,
      subject: "A Weekend Pick reply read like stop",
      text: `A reply to the Weekend Pick number from …${from.slice(-4)} read like a stop, so texts to it are off now. Read it in the Twilio console to be sure.`,
    });
  if (out.alert === "other")
    alertLater({
      key: `texts:reply:${from.slice(-4)}`,
      subject: "Someone replied to a park text",
      text: `A reply came in from …${from.slice(-4)}. Read it in the Twilio console. If it asks to stop in words we did not catch, add the number to the STOP list (sms_opt_outs) the same day.`,
      everyMinutes: 30,
    });
  if (out.reply) await noteTextSent(from).catch(() => {});
  return twiml(out.reply);
}
