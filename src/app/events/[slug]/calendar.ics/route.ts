import { icsFile, statusOn } from "@/lib/events/model";
import { eventBySlug } from "@/lib/events/store";
import { SITE_URL } from "@/lib/site";

/** Add to calendar: one date of an event (?d=YYYY-MM-DD, default the first). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const row = await eventBySlug(slug);
  const sp = new URL(req.url).searchParams;
  const want = sp.get("d");
  const at = sp.get("t");
  // Two showtimes on one day: ?t=HH:MM picks the one.
  const d =
    row?.data.dates.find((x) => x.day === want && (!at || x.start === at)) ??
    row?.data.dates[0];
  if (!row || !d) return new Response("Not found", { status: 404 });
  const body = icsFile(
    row.data,
    d,
    `${SITE_URL}/events/${slug}`,
    new Date(),
    statusOn(row.data, d.day, row.status),
  );
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-${d.day}.ics"`,
      "cache-control": "public, max-age=300",
    },
  });
}
