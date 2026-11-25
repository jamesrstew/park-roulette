import { OG_SIZE, ogCard } from "@/components/me/og-card";
import { guideDef } from "@/lib/guides";
import { pairingGuideDef } from "@/lib/pairing-guides";

export const alt = "A Park Roulette guide";
export const size = OG_SIZE;
export const contentType = "image/png";

/** A guide's link preview: its name and one line (no live data needed). */
export default async function GuideImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  const g = guideDef(slug) ?? pairingGuideDef(slug);
  return ogCard({
    kicker: g ? "A Park Roulette guide" : "Spin the crayon wheel!",
    title: g?.name ?? "Park Roulette",
    subtitle:
      g?.blurb ?? "Every playground in Central Oregon, one spin at a time.",
  });
}
