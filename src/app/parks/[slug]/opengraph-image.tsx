import { connection } from "next/server";
import { OG_SIZE, ogCard } from "@/components/me/og-card";
import { parkShareCard } from "@/components/park/share-card";
import { getParkShare } from "@/lib/data-park";

export const alt = "A park on Park Roulette";
export const size = OG_SIZE;
export const contentType = "image/png";

/** A park's link preview: name, town, stars, a review photo. */
export default async function ParkImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection(); // live stars, not a build-time snapshot
  const { slug } = await params;
  const generic = () =>
    ogCard({
      kicker: "Spin the crayon wheel!",
      title: "Park Roulette",
      subtitle: "Every playground in Central Oregon, one spin at a time.",
    });
  let park;
  try {
    park = await getParkShare(slug);
  } catch (e) {
    // A database hiccup: the plain card, cached for a minute, not an hour.
    console.error("[share-card] park lookup failed", (e as Error)?.name);
    const res = await generic();
    const headers = new Headers(res.headers);
    headers.set("cache-control", "public, max-age=60, s-maxage=60");
    return new Response(await res.arrayBuffer(), { headers });
  }
  return park ? parkShareCard(park) : generic();
}
