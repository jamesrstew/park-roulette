import { alertLater } from "@/lib/alerts";
import { runNewsSend } from "@/lib/news/sender";
import { bearerOk } from "@/lib/news/tokens";

/**
 * Thursday's sender (vercel.json: every 15 minutes, 14:00 to 19:45 UTC).
 * The code decides the rest: new sends only start 7:00 to 9:00 Pacific
 * (later runs only finish one), the kill switch, dry runs, re-validation
 * and resuming. See lib/news/sender.ts.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  try {
    const result = await runNewsSend();
    console.info(`[news] ${result.action}: ${result.why.split("\n")[0]}`);
    return Response.json(result);
  } catch (e) {
    console.error(
      "[news] sender failed",
      (e as Error)?.name,
      (e as Error)?.message,
    );
    alertLater({
      key: "error:cron-news-send",
      subject: "The park news sender failed",
      text: "The Thursday sender threw an error. It runs again in 15 minutes and resumes where it stopped. Check the Vercel logs for [news].",
    });
    return new Response("Failed", { status: 500 });
  }
}
