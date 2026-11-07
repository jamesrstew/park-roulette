import { OG_SIZE, ogCard } from "@/components/me/og-card";

export const alt =
  "Park Roulette: every playground in Central Oregon, one spin at a time";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function TwitterImage() {
  return ogCard({
    kicker: "Spin the crayon wheel!",
    title: "Park Roulette",
    subtitle: "Every playground in Central Oregon, one spin at a time.",
  });
}
