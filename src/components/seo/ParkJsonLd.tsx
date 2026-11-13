import { JsonLd } from "@/components/seo/JsonLd";
import type { ReviewView } from "@/lib/data";
import { playOf } from "@/lib/features";
import { parkFacts } from "@/lib/park-facts";
import { dayOf, MIN_RATINGS } from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";

/**
 * schema.org data for a park page: Playground or Park, where it is, what
 * families say it has, and its stars. Only "Everyone" reviews are marked up
 * (never anything private), and stars only once there are 3 ratings.
 */
export function ParkJsonLd({
  park,
  ratings,
  tags,
  reviews,
  town,
}: {
  park: {
    slug: string;
    name: string;
    city: string;
    lat: number;
    lng: number;
    play: string;
    status: string;
    features: string[];
  };
  ratings: number[];
  tags: string[][];
  reviews: ReviewView[];
  town: { name: string; url: string };
}) {
  const reports: Record<string, number> = {};
  for (const t of tags)
    for (const k of new Set(t)) reports[k] = (reports[k] ?? 0) + 1;
  const avg = ratings.length
    ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) / 10
    : null;
  const facts = parkFacts({
    ...park,
    reports,
    avgTenths: avg == null ? null : Math.round(avg * 10),
    reviewCount: ratings.length,
  });
  const url = `${SITE_URL}/parks/${park.slug}`;
  const open = park.status !== "closed" && park.status !== "private";
  const publicReviews = reviews
    .filter((r) => r.visibility === "public" && !r.hidden)
    .slice(0, 5);
  return (
    <JsonLd
      data={[
        {
          "@context": "https://schema.org",
          "@type": playOf(park) === "none" ? "Park" : "Playground",
          "@id": `${url}#place`,
          name: park.name,
          url,
          description: facts.summary,
          address: {
            "@type": "PostalAddress",
            addressLocality: park.city,
            addressRegion: "OR",
            addressCountry: "US",
          },
          geo: {
            "@type": "GeoCoordinates",
            latitude: park.lat,
            longitude: park.lng,
          },
          hasMap: `https://www.google.com/maps/search/?api=1&query=${park.lat},${park.lng}`,
          containedInPlace: { "@type": "City", name: `${park.city}, Oregon` },
          ...(open ? { isAccessibleForFree: true, publicAccess: true } : {}),
          amenityFeature: facts.good.map((g) => ({
            "@type": "LocationFeatureSpecification",
            name: g.label,
            value: true,
          })),
          ...(avg != null && ratings.length >= MIN_RATINGS
            ? {
                aggregateRating: {
                  "@type": "AggregateRating",
                  ratingValue: avg,
                  bestRating: 5,
                  worstRating: 0,
                  ratingCount: ratings.length,
                },
              }
            : {}),
          ...(publicReviews.length
            ? {
                review: publicReviews.map((r) => ({
                  "@type": "Review",
                  author: { "@type": "Person", name: r.explorer.name },
                  datePublished: dayOf(new Date(r.createdAt)),
                  reviewRating: {
                    "@type": "Rating",
                    ratingValue: r.ratingTenths / 10,
                    bestRating: 5,
                    worstRating: 0,
                  },
                  ...(r.body ? { reviewBody: r.body } : {}),
                })),
              }
            : {}),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Park Roulette",
              item: SITE_URL,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: town.name,
              item: town.url,
            },
            { "@type": "ListItem", position: 3, name: park.name, item: url },
          ],
        },
      ]}
    />
  );
}
