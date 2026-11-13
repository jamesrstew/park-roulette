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

/**
 * Every public page. lastmod is when its data really changed (a park added,
 * or its newest public-facing review), never the build time.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection(); // fresh data, not a build-time snapshot
  const parks = await publicParks();
  const towns = townsOf(parks);
  const at = (iso: string) => (iso ? new Date(iso) : undefined);
  return [
    { url: `${SITE_URL}/`, lastModified: at(newest(parks)) },
    { url: `${SITE_URL}/towns`, lastModified: at(newest(parks)) },
    ...towns.filter(hasOwnPage).map((t) => ({
      url: `${SITE_URL}/towns/${t.slug}`,
      lastModified: at(newest(t.parks)),
    })),
    ...FEATURE_PAGES.map((f) => ({ f, ps: parks.filter(f.matches) }))
      .filter((x) => x.ps.length >= FEATURE_PAGE_MIN)
      .map(({ f, ps }) => ({
        url: `${SITE_URL}/playgrounds/${f.slug}`,
        lastModified: at(newest(ps)),
      })),
    ...parks.map((p) => ({
      url: `${SITE_URL}/parks/${p.slug}`,
      lastModified: at(p.updated),
    })),
    { url: `${SITE_URL}/list` },
    { url: `${SITE_URL}/map` },
    { url: `${SITE_URL}/start` },
    { url: `${SITE_URL}/privacy` },
    { url: `${SITE_URL}/terms` },
  ];
}
