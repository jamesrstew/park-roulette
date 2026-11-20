import { alertLater } from "@/lib/alerts";
import { recheckEvents } from "@/lib/events/store";
import { pingIndexNow } from "@/lib/indexnow";
import { bearerOk } from "@/lib/news/tokens";
import { SITE_URL } from "@/lib/site";

/**
 * The nightly re-check of every upcoming kids' event (vercel.json, 3:20
 * am Pacific in winter). A page that loaded without the quote two nights
 * in a row (or a 404 or 410) turns the event to "couldn't confirm":
 * off the listing, noindex, no Event markup. Timeouts, 5xx and bot walls
 * count as unknown and change nothing.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  try {
    const r = await recheckEvents();
    console.info(`[events] checked ${r.checked}, changed ${r.changed.length}`);
    if (r.changed.length)
      await pingIndexNow([
        `${SITE_URL}/events`,
        ...r.changed.map((s) => `${SITE_URL}/events/${s}`),
      ]);
    return Response.json(r);
  } catch (e) {
    console.error("[events] re-check failed", (e as Error)?.message);
    alertLater({
      key: "error:cron-events-check",
      subject: "The nightly kids' events check failed",
      text: "The nightly re-check of kids' event pages threw an error. Events keep their last state until it runs cleanly. Check the Vercel logs for [events].",
    });
    return new Response("Failed", { status: 500 });
  }
}
