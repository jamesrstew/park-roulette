import "server-only";
import { issueForEvidence } from "@/lib/inbox/store";
import { CATALOG } from "@/lib/news/catalog";
import { fetchPage } from "@/lib/news/fetcher";
import { publicParks } from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";
import type { EventsContext } from "./validate";

/** Everything the events validator needs (public parks for venue pins). */
export async function eventsContext(opts: {
  network: boolean;
  now?: Date;
}): Promise<EventsContext> {
  const parks = await publicParks();
  return {
    catalog: CATALOG,
    parks: new Map(
      parks.map((p) => [p.slug, { lat: p.lat, lng: p.lng, name: p.name }]),
    ),
    fetcher: opts.network ? fetchPage : undefined,
    // Newsletter issues in our inbox ("issue:<id>" evidence).
    issue: opts.network ? issueForEvidence : undefined,
    ownHost: new URL(SITE_URL).hostname.replace(/^www\./, ""),
    now: opts.now ?? new Date(),
  };
}
