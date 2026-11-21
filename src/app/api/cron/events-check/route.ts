import { alertLater } from "@/lib/alerts";
import { recheckEvents } from "@/lib/events/store";
import { pingIndexNow } from "@/lib/indexnow";
import { pacific } from "@/lib/news/time";
import { recheckProfiles } from "@/lib/park-profiles-check";
import { bearerOk } from "@/lib/news/tokens";
import { SITE_URL } from "@/lib/site";

/**
 * The nightly re-check of every upcoming kids' event (vercel.json, 3:20
 * am Pacific in winter). A page that loaded without the quote two nights
 * in a row (or a 404 or 410) turns the event to "couldn't confirm":
 * off the listing, noindex, no Event markup. Timeouts, 5xx and bot walls
 * count as unknown and change nothing.
 *
 * First, the monthly re-check of park signature-trait evidence: at most
 * 5 pages a night over days 1 to 28, fetched in parallel and cut off at
 * PROFILE_BUDGET_MS, so the events check always keeps most of the run
 * (lib/park-profiles-check.ts).
 */
export const maxDuration = 300;
const PROFILE_BUDGET_MS = 45_000;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  // Never let the trait check fail (or starve) the events check.
  const profiles = await recheckProfiles(
    Number(pacific(new Date()).date.slice(8, 10)),
    { deadline: Date.now() + PROFILE_BUDGET_MS },
  ).catch((e) => {
    console.error("[profiles] re-check failed", (e as Error)?.message);
    return null;
  });
  if (profiles)
    console.info(
      `[profiles] checked ${profiles.checked}, missing ${profiles.missing.length}, unknown ${profiles.unknown.length}`,
    );
  try {
    const r = await recheckEvents();
    console.info(`[events] checked ${r.checked}, changed ${r.changed.length}`);
    if (r.changed.length)
      await pingIndexNow([
        `${SITE_URL}/events`,
        ...r.changed.map((s) => `${SITE_URL}/events/${s}`),
      ]);
    return Response.json({ ...r, profiles });
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
