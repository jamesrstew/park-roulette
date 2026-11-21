import { CATALOG } from "./catalog";
import type { ForecastDay, Issue } from "./issue";
import type { Plan } from "./plan-types";
import type { Tier } from "./tiers";
import { addDays } from "./time";

/**
 * What an issue's link preview and its Weekend Pick text share, from the
 * frozen issue and its stored plan only (pure).
 */

/** Bend's tiers by date, from the issue's stored plan (null before v1). */
export function planTiers(
  plan: Pick<Plan, "weather"> | null | undefined,
): Partial<Record<string, Tier>> | null {
  const bend = plan?.weather?.tiers?.towns?.Bend;
  return bend?.length
    ? Object.fromEntries(bend.map((d) => [d.date, d.tier]))
    : null;
}

/** The issue's Indoor pick venue, if it ran one. */
export function indoorVenue(issue: Issue) {
  const id = issue.plan_b?.kind === "venue" ? issue.plan_b.venue_id : null;
  const v = id ? CATALOG.venues.find((x) => x.id === id) : undefined;
  return v
    ? { name: v.name, short: v.short_name, city: v.town, url: v.url }
    : null;
}

/** An Indoor week: both Saturday and Sunday disruptive, and an Indoor pick. */
export function indoorWeek(issue: Issue, plan: Pick<Plan, "weather"> | null) {
  const tiers = planTiers(plan);
  const sat = addDays(issue.issue_date, 2);
  const venue = indoorVenue(issue);
  return !!venue &&
    !!tiers &&
    [sat, addDays(sat, 1)].every((d) => tiers[d] === "disruptive")
    ? venue
    : null;
}

/** Saturday and Sunday from the card, when NWS had a forecast for them. */
export function weekendCardDays(issue: Issue): ForecastDay[] {
  const sat = addDays(issue.issue_date, 2);
  return [sat, addDays(sat, 1)].flatMap((date) => {
    const d = issue.weekend_ahead?.days?.find((x) => x.date === date);
    return d && !d.missing && d.high != null ? [d] : [];
  });
}

/** The photo credit drawn onto the picture (the photo never travels without it). */
export function photoCreditLine(p: NonNullable<Issue["wheel_pick"]["photo"]>) {
  if (new URL(p.src).hostname.endsWith("bendparksandrec.org"))
    return "Photo: Bend Park & Recreation District";
  return `Photo: ${p.author ?? "Unknown"}, ${p.license ?? ""}, via Wikimedia Commons`;
}
