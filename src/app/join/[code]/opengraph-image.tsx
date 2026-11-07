import { OG_SIZE, ogCard } from "@/components/me/og-card";

// Deliberately does not read the code: the crew name stays out of public
// unfurls.
export const alt = "You're invited to Park Roulette!";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function InviteImage() {
  return ogCard({
    kicker: "Psst! You're invited!",
    title: "Come play!",
    subtitle: "Join our quest to visit every playground in Central Oregon.",
  });
}
