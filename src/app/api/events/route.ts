import { eventsContext } from "@/lib/events/context";
import { upsertEvents } from "@/lib/events/store";
import { validateEvents } from "@/lib/events/validate";
import { pingIndexNow } from "@/lib/indexnow";
import { ingestOk, json, nope } from "@/lib/news/http";
import { SITE_URL } from "@/lib/site";

export const maxDuration = 300;

/**
 * The writer hands in kids' events (bearer NEWS_INGEST_TOKEN):
 * {events: [...]} (lib/events/model.ts EventInput). Each one is checked
 * on its own with the shared rules, official pages fetched; good ones are
 * stored (a series keeps its page), bad ones come back with the reasons.
 * ?network=0 is a quick check that stores nothing. Local development only
 * (SMS_FAKE=1, never on Vercel): ?network=0&store=1 stores sample events
 * without fetching their pages.
 */
export async function POST(req: Request) {
  if (!ingestOk(req)) return nope();
  const text = await req.text();
  if (text.length > 512 * 1024)
    return json({ error: "Too big: 512 KB at most." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Send JSON: {events: [...]}." }, 400);
  }
  const url = new URL(req.url);
  const network = url.searchParams.get("network") !== "0";
  const report = await validateEvents(body, await eventsContext({ network }));
  if (report.error) return json(report, 400);
  const devStore =
    !network &&
    url.searchParams.get("store") === "1" &&
    process.env.SMS_FAKE === "1" &&
    !process.env.VERCEL;
  const stored =
    network || devStore ? await upsertEvents(report.events, { network }) : [];
  const changed = stored.filter((s) => s.changed);
  if (changed.length)
    await pingIndexNow([
      `${SITE_URL}/events`,
      ...changed.map((s) => `${SITE_URL}/events/${s.slug}`),
    ]);
  return json({
    stored,
    ...(network ? {} : { quick: true, storedLocally: devStore }),
    cut: report.events
      .filter((e) => !e.ok)
      .map((e) => ({ index: e.index, title: e.title, problems: e.problems })),
    warnings: report.events.flatMap((e) =>
      e.warnings.map((w) => ({ index: e.index, warning: w })),
    ),
  });
}
