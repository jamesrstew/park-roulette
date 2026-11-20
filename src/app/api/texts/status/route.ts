import { alertLater } from "@/lib/alerts";
import { SITE_URL } from "@/lib/site";
import { recordDelivery } from "@/lib/texts-store";
import { verifyTwilio } from "@/lib/twilio-signature";

/**
 * Twilio's delivery reports for park texts (the StatusCallback each send
 * names). Signed with TWILIO_AUTH_TOKEN, checked against the fixed public
 * URL, like the inbound route. Records the status on the Weekend Pick row
 * and acts on error codes (recordDelivery).
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return new Response("Bad request", { status: 400 });
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });
  const url = `${SITE_URL}/api/texts/status`;
  if (
    !verifyTwilio(
      process.env.TWILIO_AUTH_TOKEN,
      url,
      params,
      req.headers.get("x-twilio-signature"),
    )
  ) {
    console.warn("[texts] status callback: bad Twilio signature");
    return new Response("Bad signature", { status: 403 });
  }
  const sid = params.MessageSid ?? params.SmsSid ?? "";
  const to = params.To ?? "";
  const status = params.MessageStatus ?? params.SmsStatus ?? "";
  if (!sid || !/^\+1\d{10}$/.test(to) || !status)
    return new Response(null, { status: 204 });
  const code = Number(params.ErrorCode);
  try {
    await recordDelivery({
      sid,
      status,
      to,
      errorCode: Number.isInteger(code) && code > 0 ? code : null,
    });
  } catch (e) {
    console.error("[texts] status callback failed", (e as Error)?.message);
    alertLater({
      key: "error:texts-status",
      subject: "Park texts delivery reports are failing",
      text: "Recording a Twilio delivery report threw an error (Twilio retries). Numbers that can't get texts may stay on until it works. Vercel logs: [texts].",
      everyMinutes: 60,
    });
    return new Response("Failed", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
