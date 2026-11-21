import type { PlanEvent } from "@/lib/events/plan-events";
import type { SeasonalDefault, SeasonMonth, WeatherLabel } from "./catalog";
import type { DayTier, Hazard } from "./tiers";
import type { CooldownKind } from "./cooldowns";
import type { CalendarFlags } from "./time";
import type { UniverseReport } from "./universe-store";
import type { IgCandidate } from "./igapi";
import type { Candidate } from "./xapi";
import type { ForecastDay, Issue } from "./issue";

type PhotoInput = NonNullable<Issue["wheel_pick"]["photo"]>;

/**
 * The plan: everything code decides for an issue, made once per issue date
 * (GET /api/news/plan) and stored, so every later check sees the same pick.
 */

export type DayWeather = {
  date: string;
  /** "Fri" */
  day: string;
  towns: Record<
    string,
    {
      high: number | null;
      low: number | null;
      short: string;
      labels: WeatherLabel[];
    }
  >;
  /** Every label any of the three towns got that day. */
  labels: WeatherLabel[];
};

export type PlanVenue = {
  id: string;
  name: string;
  town: string;
  address: string | null;
  kind: string;
  fit: string;
  what: string;
  url: string;
  story_time: boolean;
};

/** An Indoor pick candidate, with the catalog facts code prints. */
export type PlanIndoorVenue = PlanVenue & {
  enclosure: "indoor" | "covered";
  ages_label: string;
  visit_minutes: number;
  drive_minutes_from_downtown: number;
  cost: "free" | "low" | "paid";
  hours_url: string | null;
  access_note: string | null;
};

export type Plan = {
  issue_date: string;
  generated_at: string;
  calendar: CalendarFlags;
  weather: {
    /** False when the forecast couldn't be fetched (labels are then empty). */
    ok: boolean;
    source: string;
    /** Thursday through Sunday, for Bend, Redmond and Sisters. */
    days: DayWeather[];
    /** Friday to Sunday days with any bad-weather label. */
    bad_days: string[];
    /** Every label from Friday to Sunday. */
    labels: WeatherLabel[];
    /**
     * The tiers (weather-season v1): the counted days (Saturday, Sunday,
     * and Friday when any district has no school), per town. Bend gates;
     * the others are for one "In Sisters" line, never the gate.
     */
    tiers?: {
      counted: string[];
      towns: Record<string, DayTier[]>;
      /** Where the air quality came from. */
      air: "airnow" | "nws_alerts";
    };
    /** Disruptive weekends: when to go ("Sunday, 11 am to 2 pm"). */
    best_slot?: string | null;
  };
  /**
   * Written by the Friday Weekend Pick sender, never the plan: Friday's
   * forecast flipped a weekend day into or out of disruptive, so the text
   * started "Update:" and the issue page shows this line.
   */
  friday_update?: {
    words: string;
    /** The plan the text named: the page's plan and heading follow it. */
    plan?: { kind: "park"; date: string } | { kind: "indoor" };
    at: string;
  };
  /** The week in one word: indoor (gate open), plan_around or fine. */
  weather_mode?: "indoor" | "plan_around" | "fine";
  /**
   * The Indoor pick: only when a counted Bend day is disruptive. for_day
   * is the first such day; venues are eligible for it, best first.
   */
  indoor?: {
    open: boolean;
    for_day: string | null;
    hazards: Hazard[];
    relaxed_to_weeks: number | null;
    /** Nothing was free at 4 weeks: the oldest pick repeats. */
    repeat: boolean;
    /** The third Indoor pick in a row: one short line. */
    short: boolean;
    venues: PlanIndoorVenue[];
    /** Snow and ice days: venues in Redmond, Sisters and La Pine. */
    closer_to_home: string[];
  };
  /** Plan-around weekends: the free dress tips that match. */
  dress?: {
    triggers: Hazard[];
    tips: { id: string; text: string; label: string }[];
  } | null;
  /** This month in the seasonal calendar. */
  season?: SeasonMonth;
  /**
   * The weekend ahead (Bend, NWS): Friday to Sunday, frozen into the issue
   * by the validator. Null when the forecast couldn't be fetched.
   */
  forecast?: { source: string; days: ForecastDay[] } | null;
  wheel_pick: {
    slug: string;
    name: string;
    city: string;
    url: string;
    features: string[];
    reasons: string[];
    eligible_count: number;
    /** A vetted photo to use as wheel_pick.photo, or null (crayon card). */
    photo: PhotoInput | null;
  } | null;
  plan_b: {
    /** venue when the weekend has bad weather, else window (or a venue). */
    mode: "venue" | "window";
    relaxed_to_weeks: number | null;
    venues: PlanVenue[];
    tips: { id: string; text: string }[];
  };
  deltas: {
    since: string | null;
    changes: {
      id: number;
      park: string;
      park_name: string;
      city: string;
      topic: string;
      value: string;
      line: string;
      at: string;
    }[];
  };
  cooldowns: Record<
    CooldownKind,
    { id: string; last_used: string; free_on: string }[]
  >;
  challenges: { id: string; title: string; text: string }[];
  event_series: {
    id: string;
    name: string;
    town: string;
    what: string;
    url: string;
  }[];
  seasonal_defaults: SeasonalDefault[];
  /**
   * Parents' corner: X posts from the last 7 days with 5,000+ likes, most
   * liked first (top 20). Empty without X_BEARER_TOKEN: the section drops.
   * The writer may also name a TikTok video; code fetches it.
   */
  /**
   * Kids' events on /events with a scheduled date from the issue date
   * through 14 days out (lib/events/plan-events.ts), soonest first. The
   * writer picks outings from these and names one in weekend[].event.
   */
  events?: PlanEvent[];
  parents_corner?: {
    candidates: Candidate[];
    /** Instagram candidates (Parents' corner v5); empty when Meta access fails. */
    instagram?: IgCandidate[];
    /**
     * Why instagram[] is what it is: ok, no_token (Meta keys missing),
     * api_error (Meta failed) or none_passed (no post cleared the bar).
     */
    instagram_status?: "ok" | "no_token" | "api_error" | "none_passed";
    universe?: UniverseReport;
    rules: string;
  };
  rules: Record<string, unknown>;
  /**
   * Open lessons from earlier runs (the last 8 weeks, most seen first, 20
   * at most). Read them first; cite one by id in the retro when you hit it
   * again. Added on every read, never stored with the plan.
   */
  lessons?: {
    id: number;
    category: string;
    title: string;
    detail: string;
    host: string | null;
    status: string;
    seen_count: number;
    first_seen: string;
    last_seen: string;
    regressed: boolean;
    compliance: boolean;
    pr_url: string | null;
    note: string | null;
    examples: unknown[];
  }[];
};
