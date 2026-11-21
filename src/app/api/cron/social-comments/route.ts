import { alertLater } from "@/lib/alerts";
import { bearerOk } from "@/lib/news/tokens";
import { dailySocialCheck, runKeywordDms } from "@/lib/social/dm";

/**
 * Keyword DMs (vercel.json: every 15 minutes): a PARK comment on our
 * posts or a PICK reply to our Story gets one code-written DM with the
 * /ig link. Polled (see lib/social/dm.ts for why not a webhook). Once a
 * day it also checks the token and mails James the comment counts.
 */
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  try {
    const r = await runKeywordDms();
    const daily = await dailySocialCheck();
    console.info(
      `[social] dms ${r.action}: ${r.replies} replies, ${r.comments} comments read; daily ${daily}`,
    );
    return Response.json({ ...r, daily });
  } catch (e) {
    console.error("[social] dms failed", (e as Error)?.message);
    alertLater({
      key: "error:cron-social-comments",
      subject: "Instagram keyword DMs failed",
      text: "The comment poller threw an error. It runs again in 15 minutes and never DMs anyone twice. Check the Vercel logs for [social].",
    });
    return new Response("Failed", { status: 500 });
  }
}
