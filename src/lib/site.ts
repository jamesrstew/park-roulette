/** The public address of the site, for absolute links (sitemap, JSON-LD). */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://parkroulette.quest"
).replace(/\/$/, "");

/**
 * Never crawled: photos (they 404 without a signed-in family anyway) and
 * API routes. Personal pages (/me, /passport, /admin, family links) stay
 * crawlable on purpose: they say "noindex", and a crawler has to fetch a
 * page to see that, or a shared family link could still be listed.
 */
export const NO_CRAWL = ["/photos/", "/api/"];

/** Spread into a page's metadata to keep it out of search engines. */
export const NOINDEX = { robots: { index: false, follow: true } } as const;
