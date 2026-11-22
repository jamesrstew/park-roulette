import { glanceFor, oneLinerFor } from "@/lib/park-profiles";
import { currentProfiles } from "@/lib/park-profiles-check";
import { pacific } from "@/lib/news/time";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { featuredIn } from "@/lib/news/data";
import { isThisWeekendsPick } from "@/lib/asks";
import { Suspense } from "react";
import { HappeningNearby } from "@/components/events/Modules";
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
  const now = new Date();
  const [fixes, all, featured, profiles] = await Promise.all([
    pendingFixes(detail.park.id, me?.crew.id ?? null),
    publicParks(),
    featuredIn(slug),
    currentProfiles(now),
  ]);
  const profile = profiles.get(detail.park.slug);
  const month = Number(pacific(now).date.slice(5, 7));
  // The traits one-liner when there is one; otherwise the at-a-glance line.
  const oneLiner = oneLinerFor(profile, month) ?? glanceFor(profile, month);
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
        weekendPick={isThisWeekendsPick(featured, new Date()) ? featured : null}
        oneLiner={oneLiner}
      />
      <HappeningNearby park={detail.park} />
      {featured ? (
        <p className="mt-4 text-sm text-ink-soft">
          Featured in{" "}
          <Link href={`/newsletter/${featured}`} className="underline">
            Bend Playground Passport,{" "}
            {new Date(`${featured}T12:00:00Z`).toLocaleDateString("en-US", {
              timeZone: "UTC",
              month: "short",
              day: "numeric",
            })}
          </Link>
          .
        </p>
      ) : null}
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
