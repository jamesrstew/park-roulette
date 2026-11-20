import type { SeasonalDefault, WeatherLabel } from "./catalog";
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
  };
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
    new_parks: { slug: string; name: string; city: string; at: string }[];
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
   * Kids' events on /events with a date this weekend: an outing that is one
   * of them names it in weekend[].event (issue pages link its page).
   */
  events?: {
    slug: string;
    title: string;
    days: string[];
    url: string;
    ages_text: string | null;
  }[];
  parents_corner?: {
    candidates: Candidate[];
    /** Instagram candidates (Parents' corner v5); empty when Meta access fails. */
    instagram?: IgCandidate[];
    universe?: UniverseReport;
    rules: string;
  };
  rules: Record<string, unknown>;
};
