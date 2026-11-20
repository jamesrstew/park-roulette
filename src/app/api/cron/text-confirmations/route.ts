import { alertLater } from "@/lib/alerts";
import { bearerOk } from "@/lib/news/tokens";
import { sendPendingConfirmations } from "@/lib/texts-store";

/**
 * Held confirmation texts (vercel.json: hourly, 8 am to about 4 pm
 * Pacific). Each goes only inside 8 am to 5 pm Pacific and the number's
 * own 8 am to 8 pm, and only with TEXTS_CONFIRMATIONS_ENABLED=1.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  try {
    const r = await sendPendingConfirmations();
    if (r.sent || r.failed || r.retry)
      console.info(
        `[texts] confirmations: ${r.sent} sent, ${r.failed} failed, ${r.retry} to retry, ${r.waiting} waiting`,
      );
    if (r.retry)
      alertLater({
        key: "texts:confirmations-retry",
        subject: "Confirmation texts are being retried",
        text: `${r.retry} confirmation text(s) couldn't reach Twilio (down or slow). They're retried every hour in the daytime; nobody gets a Weekend Pick before theirs.`,
        everyMinutes: 12 * 60,
      });
    return Response.json(r);
  } catch (e) {
    console.error("[texts] confirmations failed", (e as Error)?.message);
    alertLater({
      key: "error:cron-text-confirmations",
      subject: "Confirmation texts failed to send",
      text: "The hourly confirmation-text job threw an error. It runs again next hour. Check the Vercel logs for [texts].",
      everyMinutes: 6 * 60,
    });
    return new Response("Failed", { status: 500 });
  }
}
