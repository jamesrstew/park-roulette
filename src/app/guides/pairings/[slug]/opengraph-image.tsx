import { connection } from "next/server";
import { OG_SIZE, ogCard } from "@/components/me/og-card";
import { loadPairingPage } from "@/lib/pairing-pages-data";

export const alt = "A Park Roulette park pairings guide";
export const size = OG_SIZE;
export const contentType = "image/png";

/** A pairing page's link preview: its name (our words) and one line. */
export default async function PairingPageImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  await connection();
  const v = await loadPairingPage(slug, new Date()).catch(() => null);
  return ogCard({
    kicker: v ? "Park pairings" : "Spin the crayon wheel!",
    title: v?.name ?? "Park Roulette",
    subtitle: v
      ? `${v.pairs.length} stops for you, each near somewhere fun for the kids.`
      : "Every playground in Central Oregon, one spin at a time.",
  });
}
