import { refreshPairingGuides } from "@/lib/pairing-guides-data";
import {
  birthPairingPages,
  refreshPairingPlaces,
} from "@/lib/pairing-pages-data";
import { bearerOk } from "@/lib/news/tokens";

/**
 * Daily (vercel.json, 2:50 am Pacific in winter): refresh the park
 * pairings guides in rotation, a few pages a run within the Places budget
 * (lib/pairing-guides-data.ts), and purge pairs older than 30 days. Then
 * the pairing pages (lib/pairing-pages-data.ts): any published post
 * without its page gets one (the social cron's backstop), and their
 * businesses' names are re-read by place id or purged at 30 days. Each
 * step's trouble stays its own.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  const now = new Date();
  const r = await refreshPairingGuides(now).catch((e) => ({
    error: (e as Error).message,
  }));
  const born = await birthPairingPages(now).catch((e) => ({
    error: (e as Error).message,
  }));
  const pages = await refreshPairingPlaces(now).catch((e) => ({
    error: (e as Error).message,
  }));
  console.info(`[pairing-guides] ${JSON.stringify({ r, born, pages })}`);
  // Any step that threw still fails the run, so it shows in Vercel's log.
  const failed = [r, born, pages].some((x) => "error" in x);
  return Response.json({ ...r, born, pages }, { status: failed ? 500 : 200 });
}
