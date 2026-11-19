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
 * Replies to the park texts number (Twilio's messaging webhook). Signed
 * with TWILIO_AUTH_TOKEN; each message is handled once (by MessageSid).
 *   STOP and friends, or anything that reads like stop: off now, and one
 *     reply (the STOP text).
 *   START, from a number on our STOP list: back on (after a STOP the yes
 *     has to come from the phone). From anyone else it's just a reply.
 *   HELP: the HELP text.
 *   Anything else: James hears about it; no reply.
 * With Twilio's Advanced Opt-Out on, Twilio has already answered STOP,
 * START and HELP (it says so in OptOutType), so we only record.
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
  const fresh = await db
    .insert(webhookEvents)
    .values({ id: `twilio:${sid}`, type: "sms.inbound" })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (!fresh.length) return twiml();

  const handled = !!params.OptOutType; // Twilio already replied
  const kind = classifyReply(params.Body ?? "");
  if (kind === "stop" || kind === "stop_like") {
    await optOut(from, kind === "stop" ? "stop" : "stop_reply");
    if (kind === "stop_like")
      alertLater({
        key: `texts:stop-like:${from.slice(-4)}`,
        subject: "A park texts reply read like stop",
        text: `A reply to the park texts number from …${from.slice(-4)} read like a stop, so texts to it are off now. Read it in the Twilio console to be sure.`,
      });
    if (handled) return twiml();
    await noteTextSent(from);
    return twiml(TEXTS.stop);
  }
  // START only means something from a number on our STOP list: anyone
  // else says yes in the app, with a code and the checked box.
  if (kind === "start" && (await textedStop(from))) {
    await startFromPhone(from);
    if (handled) return twiml();
    await noteTextSent(from);
    return twiml(TEXTS.start);
  }
  if (kind === "help") {
    if (handled) return twiml();
    await noteTextSent(from);
    return twiml(TEXTS.help);
  }
  alertLater({
    key: `texts:reply:${from.slice(-4)}`,
    subject: "Someone replied to a park text",
    text: `A reply came in from …${from.slice(-4)}. Read it in the Twilio console. If it asks to stop in words we did not catch, add the number to the STOP list (sms_opt_outs) the same day.`,
    everyMinutes: 30,
  });
  return twiml();
}
