import { alertLater } from "@/lib/alerts";
import { bearerOk } from "@/lib/news/tokens";
import { runWeekendPick } from "@/lib/weekend-pick-store";

/**
 * The Friday Weekend Pick (vercel.json: every 15 minutes, Friday 2:00 pm
 * to 6:45 pm Pacific in PST or 3:00 to 6:45 pm in PDT, in UTC). Code
 * decides the rest: sends from 3:30 pm to 5 pm Pacific (5 pm Pacific is
 * 8 pm Eastern), the kill switch, dry run, the monthly cap and the
 * STOP-rate guardrail.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  try {
    const r = await runWeekendPick();
    console.info(`[texts] weekend pick ${r.action}: ${r.why}`);
    return Response.json(r);
  } catch (e) {
    console.error("[texts] weekend pick failed", (e as Error)?.message);
    alertLater({
      key: "error:cron-weekend-pick",
      subject: "The Weekend Pick sender failed",
      text: "The Friday text sender threw an error. It runs again in 15 minutes and never texts a number twice. Check the Vercel logs for [texts].",
    });
    return new Response("Failed", { status: 500 });
  }
}
