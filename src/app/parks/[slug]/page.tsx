import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { ParkView } from "@/components/park/ParkView";
import { getMe, getParkDetail } from "@/lib/data";
import { getParkShare } from "@/lib/data-park";
import { pendingFixes } from "@/lib/park-votes";
import { isCrossedOff } from "@/lib/features";
import { formatStars } from "@/lib/rating";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const park = await getParkShare(slug);
  if (!park) return { title: "Lost park" };
  const title = `${park.name}, ${park.city}`;
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
  const fixes = await pendingFixes(detail.park.id, me?.crew.id ?? null);
  return (
    <ParkView
      detail={detail}
      fixes={fixes}
      me={me}
      justAdded={sp.added === "1"}
    />
  );
}

export default function ParkPage(props: Props) {
  return (
    <Suspense fallback={<CrayonLoading label="Unfolding the map…" />}>
      <ParkLoader {...props} />
    </Suspense>
  );
}
