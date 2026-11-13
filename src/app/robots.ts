import type { MetadataRoute } from "next";
import { NO_CRAWL, SITE_URL } from "@/lib/site";

/**
 * Search engines and AI assistants (Google, Bing, ChatGPT, Claude,
 * Perplexity, Apple…) are all welcome on the public pages, so families
 * asking "best splash pad in Bend?" get pointed here. Personal pages carry
 * noindex instead (see NO_CRAWL in lib/site.ts).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: NO_CRAWL }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
