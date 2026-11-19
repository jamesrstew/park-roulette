import { connection } from "next/server";

/**
 * State changes the sitemap can't show, for the daily IndexNow run
 * (scripts/indexnow-ping.mjs): pages that left the sitemap or changed
 * state since ?since=<ISO time>. Public on purpose (the URLs are public
 * pages). Empty until the events pages land; they add passed, couldn't
 * confirm, canceled and rescheduled events here.
 */
export async function GET(req: Request) {
  await connection();
  const since = Date.parse(new URL(req.url).searchParams.get("since") ?? "");
  if (!Number.isFinite(since))
    return Response.json({ error: "Pass ?since=<ISO time>." }, { status: 400 });
  const changes: { url: string; changedAt: string; why: string }[] = [];
  return Response.json(
    { since: new Date(since).toISOString(), changes },
    { headers: { "cache-control": "no-store" } },
  );
}
