import { knownEvents } from "@/lib/events/store";
import { pacificToday } from "@/lib/events/model";
import { ingestOk, json, nope } from "@/lib/news/http";

/**
 * What's already stored, for the daily events harvest (bearer
 * NEWS_INGEST_TOKEN, read-only): every event with a date from today to
 * ?days= out (default 60, at most 120), confirmed or not, with its slug,
 * series key, venue, dates and the pages its dates are checked on, and
 * the facts it was stored with (venue in full, setting, cost, ages_text,
 * signup, parking). The harvest skips any event whose (venue, day, start)
 * or page is here, except to add dates or the printed ages and cost a page
 * lacks: a hand-in for a stored page replaces those facts, so it hands
 * them in again.
 */
export async function GET(req: Request) {
  if (!ingestOk(req)) return nope();
  const raw = new URL(req.url).searchParams.get("days");
  const days = raw == null ? 60 : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 120)
    return json({ error: "days is a whole number from 1 to 120." }, 400);
  const now = new Date();
  const events = await knownEvents(now, days);
  return json({
    today: pacificToday(now),
    days,
    count: events.length,
    dates: events.reduce((n, e) => n + e.dates.length, 0),
    events: events.map((e) => ({
      slug: e.slug,
      key: e.key,
      kind: e.kind,
      confirm: e.confirm,
      status: e.status,
      title: e.title,
      ...e.facts,
      url: e.url,
      target_urls: e.targetUrls,
      dates: e.dates,
    })),
  });
}
