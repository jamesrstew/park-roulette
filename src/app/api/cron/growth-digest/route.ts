import { alertLater } from "@/lib/alerts";
import { runDigest } from "@/lib/growth/digest";
import { liveSources } from "@/lib/growth/live";
import { bearerOk } from "@/lib/news/tokens";

/**
 * The Monday growth digest (vercel.json: :12 and :42 past 14:00 to 16:00
 * UTC on Mondays, which covers 7:12 Pacific in both PST and PDT). The code
 * decides the rest: it sends only from 7:12 to 9:00 Pacific, once per
 * week (lib/growth/digest.ts); later runs retry a failed send.
 */
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  try {
    const result = await runDigest(new Date(), liveSources);
    console.info(`[growth] ${result.action}`, JSON.stringify(result));
    return Response.json(result);
  } catch (e) {
    console.error(
      "[growth] digest failed",
      (e as Error)?.name,
      (e as Error)?.message,
    );
    alertLater({
      key: "error:cron-growth-digest",
      subject: "The Monday growth digest failed",
      text: "The growth digest threw an error. It tries again every 30 minutes until 9:00 Pacific. Check the Vercel logs for [growth].",
      everyMinutes: 6 * 60,
    });
    return new Response("Failed", { status: 500 });
  }
}
