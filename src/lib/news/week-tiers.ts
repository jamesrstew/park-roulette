import type { Catalog, WeatherLabel } from "./catalog";
import type { AirQuality } from "./airnow";
import {
  type Alert,
  bestSlot,
  type DayTier,
  dayTier,
  type Hazard,
  type TextPeriod,
} from "./tiers";
import { addDays } from "./time";

/**
 * The week's tiers for the plan (pure): which days count, each town's
 * tier per counted day, and what Bend's days add up to. Counted days are
 * Saturday and Sunday, plus Friday when any district in catalog.breaks has
 * no school that Friday. Bend gates the Indoor pick; Redmond, Sisters and
 * La Pine are computed and shown only.
 */

const LABEL: Record<Hazard, WeatherLabel> = {
  snow: "snow",
  ice: "snow",
  rain: "rain",
  wind: "wind",
  smoke: "smoke",
  heat: "hot",
  cold: "cold",
  thunder: "storm",
};

export function countedDays(
  issueDate: string,
  breaks: Pick<Catalog["breaks"][number], "from" | "to" | "verified">[],
): string[] {
  const friday = addDays(issueDate, 1);
  const noSchool = breaks.some(
    (b) => b.verified && b.from <= friday && b.to >= friday,
  );
  return [
    ...(noSchool ? [friday] : []),
    addDays(issueDate, 2),
    addDays(issueDate, 3),
  ];
}

export function weekTiers(input: {
  issueDate: string;
  catalog: Pick<Catalog, "breaks">;
  forecast: Record<string, readonly TextPeriod[]>;
  alerts: Record<string, readonly Alert[]>;
  air: AirQuality;
}) {
  const counted = countedDays(input.issueDate, input.catalog.breaks);
  const towns: Record<string, DayTier[]> = {};
  for (const town of new Set([
    ...Object.keys(input.forecast),
    ...Object.keys(input.alerts),
  ]))
    towns[town] = counted.map((date) =>
      dayTier({
        date,
        periods: input.forecast[town] ?? [],
        alerts: input.alerts[town] ?? [],
        // AirNow is Bend's reporting area; it stands for the region.
        aqi: {
          forecast: input.air.forecast[date] ?? null,
          observed: input.air.observed,
        },
      }),
    );
  const bend = towns.Bend ?? [];
  const disruptive = bend.filter((d) => d.tier === "disruptive");
  const first = disruptive[0];
  const planAround = [
    ...new Set(
      bend
        .filter((d) => d.tier === "plan_around")
        .flatMap((d) => d.plan_around.map((f) => f.hazard)),
    ),
  ];
  const labels = [
    ...new Set(
      bend.flatMap((d) =>
        [...d.disruptive, ...d.plan_around].map((f) => LABEL[f.hazard]),
      ),
    ),
  ];
  return {
    counted,
    towns,
    labels,
    disruptiveDays: disruptive.map((d) => d.date),
    forDayHazards: first
      ? [...new Set(first.disruptive.map((f) => f.hazard))]
      : [],
    planAround,
    bestSlot: bestSlot(bend, Number(input.issueDate.slice(5, 7))),
  };
}
