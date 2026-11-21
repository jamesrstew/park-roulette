import { addDays } from "@/lib/news/time";
import { costChip, type EventRow, isFree, statusOn } from "./model";
import { listed } from "./state";

/** Days of stored events the Thursday plan offers (the issue date on). */
export const PLAN_EVENT_DAYS = 14;

/** One stored event as the writer sees it in plan.events. */
export type PlanEvent = {
  slug: string;
  title: string;
  /** Its days in the window, soonest first. */
  days: string[];
  dates: { day: string; start?: string; end?: string; end_day?: string }[];
  /** Has a date this issue's weekend (Friday to Sunday). */
  weekend: boolean;
  setting: "indoor" | "outdoor" | null;
  /** Code's age tags ("Ages 0-3") and the words as printed. */
  ages: string[];
  ages_text: string | null;
  /** The cost chip ("Free", "$13 kids"), or null when none is printed. */
  cost: string | null;
  free: boolean;
  venue: string;
  town: string;
  park: string | null;
  url: string;
  /** Stored evidence for its first date here: reuse it, never re-find it. */
  evidence: { url: string; quote: string };
};

/**
 * plan.events: listed events (confirmed, kids', within 60 days) with a
 * scheduled date from the issue date through 14 days out, soonest first.
 * The writer picks outings from these instead of discovering events.
 * Events verified only on a newsletter's listing are left out.
 */
export function planEvents(
  rows: readonly EventRow[],
  from: string,
  weekend: { from: string; to: string },
  now: Date,
): PlanEvent[] {
  const to = addDays(from, PLAN_EVENT_DAYS - 1);
  const out: PlanEvent[] = [];
  for (const e of rows) {
    if (!listed(e, now)) continue;
    // Verified on a newsletter's listing: its evidence can't go in an
    // issue (the issue checker refuses newsletters), so the writer can't
    // reuse it. It stays on /events.
    if (e.data.verified_via === "listing") continue;
    const dates = [...e.data.dates]
      .filter(
        (d) =>
          (d.end_day ?? d.day) >= from &&
          d.day <= to &&
          statusOn(e.data, d.day, e.status) === "scheduled",
      )
      .sort((a, b) =>
        `${a.day}${a.start ?? ""}`.localeCompare(`${b.day}${b.start ?? ""}`),
      );
    if (!dates.length) continue;
    const first = dates[0];
    const t = e.data.targets?.[first.day];
    out.push({
      slug: e.slug,
      title: e.data.title,
      days: [...new Set(dates.map((d) => d.day))],
      dates: dates.map((d) => ({
        day: d.day,
        ...(d.start ? { start: d.start } : {}),
        ...(d.end ? { end: d.end } : {}),
        ...(d.end_day ? { end_day: d.end_day } : {}),
      })),
      weekend: dates.some(
        (d) => (d.end_day ?? d.day) >= weekend.from && d.day <= weekend.to,
      ),
      setting: e.data.setting ?? null,
      ages: e.data.ages?.tags ?? [],
      ages_text: e.data.ages_text ?? null,
      cost: costChip(e.data),
      free: isFree(e.data),
      venue: e.data.venue.name,
      town: e.data.venue.town,
      park: e.data.venue.park ?? null,
      url: e.data.url,
      evidence: {
        url: t?.url ?? e.data.url,
        quote: t?.quote ?? e.data.checkQuote,
      },
    });
  }
  return out.sort((a, b) =>
    `${a.dates[0].day}${a.dates[0].start ?? ""}`.localeCompare(
      `${b.dates[0].day}${b.dates[0].start ?? ""}`,
    ),
  );
}
