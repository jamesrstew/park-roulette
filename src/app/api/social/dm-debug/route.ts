import { bearerOk } from "@/lib/news/tokens";
import { dmDebug } from "@/lib/social/dm";

/**
 * Read-only keyword-DM diagnostic for James (CRON_SECRET bearer, like the
 * cron routes; SOCIAL_TOKEN is not enough). For the latest
 * social_dm_replies rows it asks Meta for the comment and our conversation
 * with its author. Usernames and words are in the answer only: never
 * stored, never logged. ?limit=1..20 (default 5).
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET))
    return new Response("Nope", { status: 401 });
  const n = Number(new URL(req.url).searchParams.get("limit") ?? 5);
  const body = await dmDebug(Number.isFinite(n) ? Math.trunc(n) : 5);
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  });
}
