import { alertLater } from "@/lib/alerts";
import { bearerOk } from "@/lib/news/tokens";
import { runSocial } from "@/lib/social/store";

/**
 * Instagram's publisher (vercel.json: every 15 minutes in each post's
 * window, in UTC). Makes Thursday's teaser and Friday's Story from the
 * sent issue, creates each due post's container 30 minutes ahead, and
 * publishes it in a later run once Meta says FINISHED, then echoes each
 * feed post that went out as one Story (lib/social/echo.ts). Kill switch,
 * SOCIAL_PUBLISH=off and dry run (the default) are checked in code.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  try {
    const r = await runSocial();
    console.info(`[social] ${r.action}: ${r.notes.join("; ")}`);
    return Response.json(r);
  } catch (e) {
    console.error("[social] run failed", (e as Error)?.message);
    alertLater({
      key: "error:cron-social",
      subject: "The Instagram publisher failed",
      text: "The social cron threw an error. It runs again in 15 minutes and never publishes a post twice. Check the Vercel logs for [social].",
    });
    return new Response("Failed", { status: 500 });
  }
}
