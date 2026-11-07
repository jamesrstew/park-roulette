import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { ParkView } from "@/components/park/ParkView";
import { getMe, getParkDetail } from "@/lib/data";
import { getParkMeta } from "@/lib/data-park";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const park = await getParkMeta(slug);
  if (!park) return { title: "Lost park" };
  return {
    title: `${park.name}, ${park.city}`,
    description: `Stars, photos, and the report card for ${park.name} in ${park.city}, Oregon.`,
  };
}

async function ParkLoader({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const me = await getMe();
  const detail = await getParkDetail(slug, me?.crew.id ?? null);
  if (!detail) notFound();
  return <ParkView detail={detail} me={me} justAdded={sp.added === "1"} />;
}

export default function ParkPage(props: Props) {
  return (
    <Suspense fallback={<CrayonLoading label="Unfolding the map…" />}>
      <ParkLoader {...props} />
    </Suspense>
  );
}
