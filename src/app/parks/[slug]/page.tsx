import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { ParkView } from "@/components/park/ParkView";
import { getMe, getParkDetail } from "@/lib/data";
import { getParkShare } from "@/lib/data-park";
import { pendingFixes } from "@/lib/park-votes";
import { ParkJsonLd } from "@/components/seo/ParkJsonLd";
import { publicParks, townPageHref, townsOf } from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";
import { townSlug } from "@/lib/towns";
import { isCrossedOff } from "@/lib/features";
import { formatStars } from "@/lib/rating";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const park = await getParkShare(slug);
  if (!park) return { title: "Lost park", robots: { index: false } };
  // Only parks everyone can see go to search engines: not one a family
  // added that nobody has confirmed (it could be someone's yard), nor
  // closed or private ones.
  const listed = park.approved && !isCrossedOff(park);
  const title = `${park.name} in ${park.city}, Oregon`;
  const stars =
    park.avgTenths == null
      ? "No stars yet. Be the first!"
      : `${formatStars(park.avgTenths)} stars from ${park.reviewCount} ${park.reviewCount === 1 ? "review" : "reviews"}.`;
  const description = isCrossedOff(park)
    ? `${park.name} is ${park.status === "closed" ? "closed" : "private"}, so it's off the bucket list. Every playground in Central Oregon, one spin at a time.`
    : `Let's go here! ${stars} Every playground in Central Oregon, one spin at a time.`;
  return {
    title,
    description,
    ...(listed
      ? { alternates: { canonical: `/parks/${slug}` } }
      : { robots: { index: false, follow: true } }),
    // The preview text under the park's share card (the picture comes from
    // opengraph-image.tsx next to this page).
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

async function ParkLoader({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const me = await getMe();
  const detail = await getParkDetail(slug, me);
  if (!detail) notFound();
  const [fixes, all] = await Promise.all([
    pendingFixes(detail.park.id, me?.crew.id ?? null),
    publicParks(),
  ]);
  const town = townsOf(all).find((t) => t.slug === townSlug(detail.park.city));
  const townLink = town ? townPageHref(town) : "/towns";
  return (
    <>
      {detail.park.approved && !isCrossedOff(detail.park) && (
        <ParkJsonLd
          park={detail.park}
          ratings={detail.stats.ratings}
          tags={detail.stats.tags}
          reviews={detail.reviews}
          town={{
            name: detail.park.city,
            url: `${SITE_URL}${townLink.replace(/#.*/, "")}`,
          }}
        />
      )}
      <ParkView
        detail={detail}
        fixes={fixes}
        me={me}
        townLink={townLink}
        justAdded={sp.added === "1"}
      />
    </>
  );
}

export default function ParkPage(props: Props) {
  return (
    <Suspense fallback={<CrayonLoading label="Unfolding the map…" />}>
      <ParkLoader {...props} />
    </Suspense>
  );
}
