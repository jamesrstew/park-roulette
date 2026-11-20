import { connection } from "next/server";
import { allEvents, eventChanges } from "@/lib/events/store";
import { SITE_URL } from "@/lib/site";

/**
 * State changes the sitemap can't show, for the daily IndexNow run
 * (scripts/indexnow-ping.mjs): pages that left the sitemap or changed
 * state since ?since=<ISO time>. Public on purpose (the URLs are public
 * pages): kids' events that passed, couldn't be confirmed (or came
 * back), or were canceled, postponed or rescheduled.
 */
export async function GET(req: Request) {
  await connection();
  const since = Date.parse(new URL(req.url).searchParams.get("since") ?? "");
  if (!Number.isFinite(since))
    return Response.json({ error: "Pass ?since=<ISO time>." }, { status: 400 });
  const changes = eventChanges(
    await allEvents(),
    new Date(since),
    new Date(),
    SITE_URL,
  );
  return Response.json(
    { since: new Date(since).toISOString(), changes },
    { headers: { "cache-control": "no-store" } },
  );
}
