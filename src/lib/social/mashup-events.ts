import { type EventRow, statusOn } from "@/lib/events/model";
import { listed } from "@/lib/events/state";
import { hostDomain, sameName } from "./handles";
import { INDOOR } from "./indoor";
import { type EventAnchorInput, weekendOf } from "./mashup";
import { eventDescriptor } from "./roundup";

/**
 * This weekend's events as anchors' inputs: listed, confirmed, going
 * ahead that day, with a start time and a point (the venue's own, from
 * its park or the writer's pin), Friday to Sunday after the post.
 */
export function eventInputs(
  rows: Iterable<EventRow>,
  wed: string,
  now: Date,
): EventAnchorInput[] {
  const days = new Set(weekendOf(wed));
  const out: EventAnchorInput[] = [];
  for (const e of rows) {
    if (e.confirm !== "ok" || !listed(e, now) || !e.data.point) continue;
    for (const d of e.data.dates) {
      if (!days.has(d.day) || !d.start) continue;
      if (statusOn(e.data, d.day, e.status) !== "scheduled") continue;
      out.push({
        slug: e.slug,
        title: e.data.title,
        day: d.day,
        start: d.start,
        town: e.data.venue.town,
        lat: e.data.point.lat,
        lng: e.data.point.lng,
        regular: e.kind === "series",
        // Indoors as the listing records it, or at an indoor registry place.
        indoor:
          e.data.setting === "indoor" ||
          INDOOR.some(
            (x) =>
              x.town === e.data.venue.town &&
              sameName(x.name, e.data.venue.name),
          ),
        // What it is: its checked short, or its own first sentence (as the
        // roundup prints it); none: no anchor.
        short: eventDescriptor(e.data)?.text ?? null,
        venue: e.data.venue.name,
        host: hostDomain(e.data),
      });
    }
  }
  return out;
}
