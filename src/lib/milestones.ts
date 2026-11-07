import type { IconName } from "@/components/icons";
import { hasPlayground, isCrossedOff, tally } from "./features";

export type Milestone = {
  emoji: string;
  icon: IconName;
  title: string;
  line: string;
};

type P = {
  id: number;
  city: string;
  play: string;
  status: string;
  lastVisit: string | null;
};

/**
 * Did stamping this park just hit a big moment? First stamp ever, the last
 * playground in a town, or the last playground of all. Checked before the
 * server refresh lands, so `parks` is the list as it was before the stamp.
 */
export function stampMilestone(parks: P[], parkId: number): Milestone | null {
  const park = parks.find((p) => p.id === parkId);
  if (!park || park.lastVisit) return null;
  const visited = (p: P) => p.id === parkId || !!p.lastVisit;

  if (!parks.some((p) => p.lastVisit))
    return {
      emoji: "🎟️",
      icon: "ticket",
      title: "Your first stamp!",
      line: "The quest is officially on.",
    };
  if (!hasPlayground(park) || isCrossedOff(park)) return null;

  const playgrounds = parks.filter(hasPlayground);
  const all = tally(playgrounds, visited);
  if (all.done === all.total)
    return {
      emoji: "🏆",
      icon: "trophy",
      title: "Every playground!",
      line: `All ${all.total} of them. You did it!`,
    };

  const town = tally(
    playgrounds.filter((p) => p.city === park.city),
    visited,
  );
  if (town.done === town.total)
    return {
      emoji: "👑",
      icon: "crown",
      title: `${park.city}: all done!`,
      line:
        town.total === 1
          ? `The only playground in ${park.city}.`
          : `Every playground in ${park.city}. ${all.total - all.done} to go.`,
    };
  return null;
}
