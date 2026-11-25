import { refreshPairingGuides } from "@/lib/pairing-guides-data";
import { bearerOk } from "@/lib/news/tokens";

/**
 * Daily (vercel.json, 2:50 am Pacific in winter): refresh the park
 * pairings guides in rotation, a few pages a run within the Places budget
 * (lib/pairing-guides-data.ts), and purge pairs older than 30 days.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  const r = await refreshPairingGuides(new Date());
  console.info(
    `[pairing-guides] refreshed ${r.refreshed.length}, skipped ${r.skipped.length}, purged ${r.purged}`,
  );
  return Response.json(r);
}
