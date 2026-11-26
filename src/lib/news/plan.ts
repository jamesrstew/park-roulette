import "server-only";
import { CATALOG, type WeatherLabel } from "./catalog";
import {
  closerToHome,
  cooldownState,
  freeItems,
  indoorVenues,
  twoIndoorInARow,
  wheelPick,
} from "./cooldowns";
import { airQuality } from "./airnow";
import { weekTiers } from "./week-tiers";
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
import { planProfile } from "@/lib/park-profiles";
import { currentProfiles } from "@/lib/park-profiles-check";
import { addDays, calendarFlags, weekendOf } from "./time";
import { LIMITS } from "./validate";
import {
  daysFrom,
  fetchAlerts,
  fetchForecast,
  weekendForecast,
} from "./weather";
import { discoverCandidates } from "./universe-store";
import { igCandidatesWithStatus } from "./igapi";
import { type PlanLesson, planLessons } from "./lessons-store";
import { blockedAccounts, blockedIds, takenDown } from "./takedowns";
import { igCooling } from "./universe";
import { SUGGESTION_SENDERS, withSuggestionsFirst } from "./suggest";
import { suggestedCandidates } from "./suggestions";
import { allEvents } from "@/lib/events/store";
import { planEvents } from "@/lib/events/plan-events";
import { eventDomains } from "@/lib/events/validate";

/**
 * GET /api/news/plan: everything code decides, so the writer only writes.
 * Made once per issue date and stored; `fresh` rebuilds it (a new forecast
 * can change the Wheel Pick, so only do that before a draft exists).
 */
export async function getPlan(
  issueDate: string,
  opts: { fresh?: boolean; now?: Date; picks?: string[] } = {},
): Promise<Plan> {
  const now = opts.now ?? new Date();
  let plan = opts.fresh ? null : await getStoredPlan(issueDate);
  if (!plan) {
    plan = await buildPlan(issueDate, now, opts.picks ?? []);
    await storePlan(plan);
  }
  // The open lessons ride along live, never frozen into the stored plan.
  return { ...plan, lessons: await lessonsForPlan(now) };
}

/** The plan's lessons; a failure here never costs the writer its plan. */
async function lessonsForPlan(now: Date): Promise<PlanLesson[]> {
  try {
    return await planLessons(now);
  } catch (e) {
    console.error("[news] lessons failed", (e as Error).message);
    return [];
  }
}

async function buildPlan(
  issueDate: string,
  now: Date,
  picks: string[],
): Promise<Plan> {
  const [parks, history, since, forecast, alerts, air] = await Promise.all([
    loadParks(),
    loadHistory(issueDate),
    lastSentAt(issueDate),
    fetchForecast(),
    fetchAlerts(),
    airQuality(issueDate),
  ]);
  const corner = await discoverCandidates({ issueDate, now, history, picks });
  const xBlocked = blockedAccounts("x");
  const xIds = blockedIds("x");
  const xCandidates = corner.candidates.filter(
    (c) =>
      !xBlocked.has(c.username.toLowerCase()) &&
      !xIds.has(c.authorId) &&
      !takenDown("x", c.id),
  );
  const cooling = igCooling(history, issueDate);
  const [ig, suggested] = await Promise.all([
    igCandidatesWithStatus({
      now,
      token: process.env.IG_ACCESS_TOKEN,
      igUserId: process.env.IG_USER_ID,
      appSecret: process.env.IG_APP_SECRET || undefined,
      blocked: blockedAccounts("instagram"),
      cooling,
    }),
    // Posts James shared by DM: first in line, under the same checks.
    suggestedCandidates({ now, history, cooling }).catch((e) => {
      console.error("[news] suggestions failed", (e as Error)?.message);
      return {
        candidates: [],
        report: [],
        status: "api_error" as const,
      };
    }),
  ]);
  const instagram = withSuggestionsFirst(suggested.candidates, ig.candidates);
  const wkEnd = weekendOf(issueDate);
  // The next 14 days of stored events: the writer picks outings from
  // these (it no longer discovers events; the daily harvest does).
  const upcomingEvents = planEvents(await allEvents(), issueDate, wkEnd, now);
  const deltas = await loadDeltas(
    since ?? new Date(now.getTime() - 14 * 86_400_000),
  );

  const days = daysFrom(issueDate, forecast);
  const wk = weekendOf(issueDate);
  // The tiers decide the week: labels and bad days now come from them
  // (a 35°F dry day is fine, not "cold"), not from every NWS adjective.
  const week = weekTiers({
    issueDate,
    catalog: CATALOG,
    forecast,
    alerts,
    air,
  });
  const labels = week.labels as WeatherLabel[];
  const badDays = week.disruptiveDays;

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
  const forDay = badDays[0] ?? null;
  const venues = forDay
    ? indoorVenues(CATALOG, history, issueDate, forDay, week.forDayHazards)
    : { weeks: null, repeat: false, eligible: [] };
  const tips = freeItems(CATALOG.tips, history, issueDate, "tip").filter((t) =>
    badDays.length ? t.weather.some((w) => labels.includes(w)) : true,
  );
  const dressTips = week.planAround.length
    ? freeItems(CATALOG.dress_tips, history, issueDate, "dress").filter((t) =>
        t.triggers.some((h) => week.planAround.includes(h)),
      )
    : [];
  const month = Number(issueDate.slice(5, 7));

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
      tiers: {
        counted: week.counted,
        towns: week.towns,
        air: air.source === "airnow" ? "airnow" : "nws_alerts",
      },
      best_slot: badDays.length ? week.bestSlot : null,
    },
    weather_mode: badDays.length
      ? "indoor"
      : week.planAround.length
        ? "plan_around"
        : "fine",
    indoor: {
      open: badDays.length > 0,
      for_day: forDay,
      hazards: week.forDayHazards,
      relaxed_to_weeks: venues.weeks,
      repeat: venues.repeat,
      short: badDays.length > 0 && twoIndoorInARow(history),
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
        enclosure: v.enclosure,
        ages_label: v.ages_label,
        visit_minutes: v.visit_minutes,
        drive_minutes_from_downtown: v.drive_minutes_from_downtown,
        cost: v.cost,
        hours_url: v.hours_url,
        access_note: v.access_note,
      })),
      closer_to_home:
        forDay && week.forDayHazards.some((h) => h === "snow" || h === "ice")
          ? closerToHome(CATALOG, forDay)
          : [],
    },
    dress: dressTips.length
      ? {
          triggers: week.planAround,
          tips: dressTips.map((t) => ({
            id: t.id,
            text: t.text,
            label: t.label,
          })),
        }
      : null,
    season: CATALOG.season_calendar.find((m) => m.month === month),
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
          // Lead with the signature trait (data/park-profiles.json).
          profile: planProfile(
            (await currentProfiles(new Date())).get(pick.park.slug),
            month,
          ),
          reasons: pick.reasons,
          eligible_count: pick.eligible,
          photo:
            CATALOG.parks.find((h) => h.slug === pick.park.slug)?.photo ?? null,
        }
      : null,
    plan_b: {
      // venue only when the gate is open (the Indoor pick).
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
    events: upcomingEvents,
    parents_corner: {
      candidates: xCandidates,
      instagram,
      instagram_status:
        suggested.candidates.length && ig.status !== "ok" ? "ok" : ig.status,
      suggestions: {
        status: suggested.status,
        senders: [...SUGGESTION_SENDERS],
        posts: suggested.report,
      },
      universe: corner.report,
      rules:
        'Candidates come from our universe of parent-humor accounts, best first by how far each post beats its author\'s usual numbers (score), plus any roundup picks you passed as ?picks=. Pick at most one, or none: kind, no identifiable child in a humiliating spot, nothing political, sexual, medical-scare, brand-run or cruel. Look at the media too. Send {platform: "x", url, postId}; code fetches and draws it. A TikTok video may be sent as {platform: "tiktok", url, postId}. Nothing clears the bar: leave the section out. Report accounts that turned political, commercial or adult to POST /api/news/universe. Instagram candidates (instagram[]) are scored the same way against each page\'s median likes, and only original posts are offered: when an Instagram and an X post are about as good, pick Instagram; with no Instagram candidates, use X. Send an Instagram pick as {platform: "instagram", url: permalink, postId: id, account: username}. Posts with suggested_by were shared by James by DM: they lead instagram[] and passed every check a found post passes; use the first one that clears your own safety bar (look at the media) before anything else, and say in your report which suggestion you used or why you passed on it.',
    },
    rules: {
      subject_max_chars: LIMITS.subjectMax,
      words: LIMITS.wordsTarget,
      words_max: LIMITS.wordsMax,
      exclamation_points_max: LIMITS.exclamations,
      weekend_dates: wk,
      link_domains: CATALOG.link_domains,
      // Leads (listings sites, other newsletters): a discovery_url only,
      // never a link or evidence.
      lead_domains: CATALOG.lead_domains,
      // Kids' events: never our own site, TripCheck or the weather service.
      event_domains: eventDomains(CATALOG.link_domains),
      evidence:
        "Every event, closure or price carries {url, quote}; the quote holds the date, time or price exactly as printed on the page.",
      next_issue: addDays(issueDate, 7),
    },
  };
}
