import "server-only";
import { CATALOG, type WeatherLabel } from "./catalog";
import { cooldownState, freeItems, planBVenues, wheelPick } from "./cooldowns";
import {
  getStoredPlan,
  lastSentAt,
  loadDeltas,
  loadHistory,
  loadParks,
  storePlan,
} from "./data";
import type { Plan } from "./plan-types";
import { SITE_URL } from "@/lib/site";
import { addDays, calendarFlags, weekendOf } from "./time";
import { LIMITS } from "./validate";
import { daysFrom, fetchForecast, weekendForecast } from "./weather";
import { discoverCandidates } from "./universe-store";

/**
 * GET /api/news/plan: everything code decides, so the writer only writes.
 * Made once per issue date and stored; `fresh` rebuilds it (a new forecast
 * can change the Wheel Pick, so only do that before a draft exists).
 */
export async function getPlan(
  issueDate: string,
  opts: { fresh?: boolean; now?: Date; picks?: string[] } = {},
): Promise<Plan> {
  if (!opts.fresh) {
    const stored = await getStoredPlan(issueDate);
    if (stored) return stored;
  }
  const plan = await buildPlan(
    issueDate,
    opts.now ?? new Date(),
    opts.picks ?? [],
  );
  await storePlan(plan);
  return plan;
}

async function buildPlan(
  issueDate: string,
  now: Date,
  picks: string[],
): Promise<Plan> {
  const [parks, history, since, forecast] = await Promise.all([
    loadParks(),
    loadHistory(issueDate),
    lastSentAt(issueDate),
    fetchForecast(),
  ]);
  const corner = await discoverCandidates({ issueDate, now, history, picks });
  const deltas = await loadDeltas(
    since ?? new Date(now.getTime() - 14 * 86_400_000),
  );

  const days = daysFrom(issueDate, forecast);
  const wk = weekendOf(issueDate);
  const weekend = days.filter((d) => d.date >= wk.from && d.date <= wk.to);
  const labels = [
    ...new Set(weekend.flatMap((d) => d.labels)),
  ] as WeatherLabel[];
  const badDays = weekend.filter((d) => d.labels.length).map((d) => d.date);

  // A park families just marked closed is never the pick.
  const closed = new Set(
    deltas.changes
      .filter((c) => c.topic === "status" && c.value !== "active")
      .map((c) => c.park),
  );
  const pick = wheelPick(
    parks,
    history,
    issueDate,
    labels,
    CATALOG.parks,
    closed,
  );
  const venues = planBVenues(
    CATALOG,
    history,
    issueDate,
    badDays.length ? labels : [],
  );
  const tips = freeItems(CATALOG.tips, history, issueDate, "tip").filter((t) =>
    badDays.length ? t.weather.some((w) => labels.includes(w)) : true,
  );

  return {
    issue_date: issueDate,
    generated_at: now.toISOString(),
    calendar: calendarFlags(issueDate, CATALOG),
    weather: {
      ok: Object.keys(forecast).length > 0,
      source: "api.weather.gov",
      days,
      bad_days: badDays,
      labels,
    },
    forecast: (() => {
      const days = weekendForecast(issueDate, forecast.Bend);
      return days ? { source: "National Weather Service, Bend", days } : null;
    })(),
    wheel_pick: pick
      ? {
          slug: pick.park.slug,
          name: pick.park.name,
          city: pick.park.city,
          url: `${SITE_URL}/parks/${pick.park.slug}`,
          features: pick.park.features,
          reasons: pick.reasons,
          eligible_count: pick.eligible,
          photo:
            CATALOG.parks.find((h) => h.slug === pick.park.slug)?.photo ?? null,
        }
      : null,
    plan_b: {
      mode: badDays.length ? "venue" : "window",
      relaxed_to_weeks: venues.weeks,
      venues: venues.eligible.map((v) => ({
        id: v.id,
        name: v.name,
        town: v.town,
        address: v.address,
        kind: v.kind,
        fit: v.fit,
        what: v.what,
        url: v.url,
        story_time: v.story_time,
      })),
      tips: tips.map((t) => ({ id: t.id, text: t.text })),
    },
    deltas,
    cooldowns: cooldownState(history, issueDate),
    challenges: freeItems(
      CATALOG.challenges,
      history,
      issueDate,
      "challenge",
    ).map(({ id, title, text }) => ({ id, title, text })),
    event_series: freeItems(
      CATALOG.event_series,
      history,
      issueDate,
      "series",
    ).map(({ id, name, town, what, url }) => ({ id, name, town, what, url })),
    seasonal_defaults: CATALOG.seasonal_defaults,
    parents_corner: {
      candidates: corner.candidates,
      universe: corner.report,
      rules:
        'Candidates come from our universe of parent-humor accounts, best first by how far each post beats its author\'s usual numbers (score), plus any roundup picks you passed as ?picks=. Pick at most one, or none: kind, no identifiable child in a humiliating spot, nothing political, sexual, medical-scare, brand-run or cruel. Look at the media too. Send {platform: "x", url, postId}; code fetches and draws it. A TikTok video may be sent as {platform: "tiktok", url, postId}. Nothing clears the bar: leave the section out. Report accounts that turned political, commercial or adult to POST /api/news/universe.',
    },
    rules: {
      subject_max_chars: LIMITS.subjectMax,
      words: LIMITS.wordsTarget,
      words_max: LIMITS.wordsMax,
      exclamation_points_max: LIMITS.exclamations,
      weekend_dates: wk,
      link_domains: CATALOG.link_domains,
      evidence:
        "Every event, closure or price carries {url, quote}; the quote holds the date, time or price exactly as printed on the page.",
      next_issue: addDays(issueDate, 7),
    },
  };
}
