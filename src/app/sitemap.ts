import type { MetadataRoute } from "next";
import { connection } from "next/server";
import {
  FEATURE_PAGE_MIN,
  FEATURE_PAGES,
  hasOwnPage,
  newest,
  publicParks,
  townsOf,
} from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";
import { sentIssues } from "@/lib/news/data";
import {
  allEvents,
  eventLastmod,
  listed,
  listingChangedAt,
  townEventsChangedAt,
} from "@/lib/events/store";
import { townSlug } from "@/lib/towns";
import { guidePath } from "@/lib/guides";
import { allGuides } from "@/lib/guides-data";
import { pairingGuidePath } from "@/lib/pairing-guides";
import { allPairingGuides } from "@/lib/pairing-guides-data";

/**
 * Every public page. lastmod is when its data really changed (a park added,
 * or its newest public-facing review), never the build time.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection(); // fresh data, not a build-time snapshot
  const now = new Date();
  const [parks, issues, events, guides, pairings] = await Promise.all([
    publicParks(),
    sentIssues(),
    allEvents(),
    allGuides(now),
    allPairingGuides(now),
  ]);
  // Upcoming event pages only: lastmod is when their facts last changed
  // (a status change counts), never the nightly check.
  const liveEvents = events.filter((e) => listed(e, now));
  const eventsChanged = listingChangedAt(events, now);
  /** A town page: the later of its parks' and its events' changes. */
  const townChanged = (slug: string, parkDay: string) => {
    // Listed events, plus ones in the town that passed or dropped off.
    const t = townEventsChangedAt(
      events,
      (e) => townSlug(e.data.venue.town),
      slug,
      now,
    );
    const park = parkDay ? new Date(parkDay).getTime() : 0;
    const latest = Math.max(park, ...t);
    return latest ? new Date(latest) : undefined;
  };
  const towns = townsOf(parks);
  const at = (iso: string) => (iso ? new Date(iso) : undefined);
  return [
    { url: `${SITE_URL}/`, lastModified: at(newest(parks)) },
    { url: `${SITE_URL}/towns`, lastModified: at(newest(parks)) },
    ...towns.filter(hasOwnPage).map((t) => ({
      url: `${SITE_URL}/towns/${t.slug}`,
      lastModified: townChanged(t.slug, newest(t.parks)),
    })),
    ...FEATURE_PAGES.map((f) => ({ f, ps: parks.filter(f.matches) }))
      .filter((x) => x.ps.length >= FEATURE_PAGE_MIN)
      .map(({ f, ps }) => ({
        url: `${SITE_URL}/playgrounds/${f.slug}`,
        lastModified: at(newest(ps)),
      })),
    // Seasonal guides: lastmod is the newest change in what each one lists.
    {
      url: `${SITE_URL}/guides`,
      lastModified: at(
        guides.reduce((a, g) => (g.updated > a ? g.updated : a), ""),
      ),
    },
    // Park pairings guides that exist now: lastmod is their refresh.
    ...pairings.map((g) => ({
      url: `${SITE_URL}${pairingGuidePath(g.def.slug)}`,
      lastModified: new Date(g.changed),
    })),
    ...guides.map((g) => ({
      url: `${SITE_URL}${guidePath(g.def.slug)}`,
      lastModified: at(g.updated),
    })),
    ...parks.map((p) => ({
      url: `${SITE_URL}/parks/${p.slug}`,
      lastModified: at(p.updated),
    })),
    { url: `${SITE_URL}/list`, lastModified: at(newest(parks)) },
    // The weekly email: its page changes when an issue goes out.
    {
      url: `${SITE_URL}/newsletter`,
      lastModified: issues[0]?.sentAt,
    },
    ...issues.map((i) => ({
      url: `${SITE_URL}/newsletter/${i.issueDate}`,
      lastModified: i.sentAt,
    })),
    { url: `${SITE_URL}/texts` },
    // Kids' events: the listing changes when the listed set does.
    { url: `${SITE_URL}/events`, lastModified: eventsChanged ?? undefined },
    ...liveEvents.map((e) => ({
      url: `${SITE_URL}/events/${e.slug}`,
      // Facts, or the day it entered the 60-day listing.
      lastModified: eventLastmod(e, now),
    })),
    { url: `${SITE_URL}/map` },
    { url: `${SITE_URL}/start` },
    { url: `${SITE_URL}/privacy` },
    { url: `${SITE_URL}/terms` },
  ];
}
