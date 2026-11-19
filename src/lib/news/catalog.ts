import { z } from "zod";
import raw from "../../../data/news-catalog.json";
import { PhotoSchema } from "./issue";

/**
 * The curated catalog for Bend Playground Passport (data/news-catalog.json):
 * indoor backups, tips, passport challenges, event series, the calendar
 * file and the link allowlist. Issues refer to items by id only, so a
 * cooldown can't be dodged with new wording. Entries marked
 * "verified": false are never offered or accepted.
 */

export const WEATHER = [
  "rain",
  "snow",
  "storm",
  "wind",
  "cold",
  "hot",
  "smoke",
] as const;
export type WeatherLabel = (typeof WEATHER)[number];

const Weather = z.enum(WEATHER);
const Month = z.number().int().min(1).max(12);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Fit = z.enum(["toddler", "big_kid", "both"]);
const Url = z.url({ protocol: /^https$/ });

const Venue = z.object({
  id: z.string().regex(/^venue-[a-z0-9-]+$/),
  name: z.string(),
  town: z.string(),
  address: z.string().nullable().default(null),
  kind: z.string(),
  covered: z.boolean(),
  fit: Fit,
  what: z.string(),
  weather: z.array(Weather),
  months: z.array(Month),
  story_time: z.boolean().default(false),
  url: Url,
  source: Url.nullable().default(null),
  verified: z.boolean(),
});

const Series = z.object({
  id: z.string().regex(/^series-[a-z0-9-]+$/),
  name: z.string(),
  town: z.string(),
  what: z.string(),
  months: z.array(Month),
  url: Url,
  source: Url.nullable().default(null),
  verified: z.boolean(),
});

const Tip = z.object({
  id: z.string().regex(/^tip-[a-z0-9-]+$/),
  text: z.string(),
  /** Empty: a clear-week tip ("best window"). */
  weather: z.array(Weather),
  months: z.array(Month),
  source: Url.nullable().default(null),
  verified: z.boolean(),
});

const Challenge = z.object({
  id: z.string().regex(/^challenge-[a-z0-9-]+$/),
  title: z.string(),
  text: z.string(),
  months: z.array(Month),
  verified: z.boolean(),
});

/**
 * The expected seasonal state, which is never news: an item matching any
 * `match` word (and any `with` word, when given) in these months is cut
 * from Heads up.
 */
const SeasonalDefault = z.object({
  id: z.string(),
  label: z.string(),
  match: z.array(z.string()).min(1),
  with: z.array(z.string()).default([]),
  months: z.array(Month),
});

const Break = z.object({
  id: z.string(),
  label: z.string(),
  district: z.string().optional(),
  from: Day,
  to: Day,
  source: Url.nullable().default(null),
  verified: z.boolean(),
});

const ParkHint = z.object({
  slug: z.string(),
  /** Paths get cleared after snow (a good Wheel Pick on a snowy week). */
  snow_ok: z.boolean().default(false),
  /** Never the Wheel Pick (say, a park that's mostly a ball field). */
  no_pick: z.boolean().default(false),
  note: z.string().optional(),
  /**
   * A photo the plan can offer for this park (bendparksandrec.org's own
   * image for the park, or Wikimedia Commons). Checked again at send time.
   */
  photo: PhotoSchema.optional(),
});

export const CatalogSchema = z.object({
  version: z.number().int(),
  link_domains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)),
  skip_dates: z.array(z.object({ date: Day, reason: z.string() })),
  breaks: z.array(Break),
  parks: z.array(ParkHint),
  venues: z.array(Venue),
  event_series: z.array(Series),
  tips: z.array(Tip),
  challenges: z.array(Challenge),
  seasonal_defaults: z.array(SeasonalDefault),
});

export type Catalog = z.infer<typeof CatalogSchema>;
export type Venue = z.infer<typeof Venue>;
export type Tip = z.infer<typeof Tip>;
export type Challenge = z.infer<typeof Challenge>;
export type Series = z.infer<typeof Series>;
export type SeasonalDefault = z.infer<typeof SeasonalDefault>;

export const CATALOG: Catalog = CatalogSchema.parse(raw);

/** Is this https link on a domain we allow (the domain or a subdomain)? */
export function allowedLink(url: string, domains: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    return false;
  const host = u.hostname.toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Does Heads up text describe the expected seasonal state this month? */
export function seasonalDefault(
  text: string,
  month: number,
  defaults: readonly SeasonalDefault[],
): SeasonalDefault | null {
  const t = text.toLowerCase();
  return (
    defaults.find(
      (d) =>
        d.months.includes(month) &&
        d.match.some((m) => t.includes(m.toLowerCase())) &&
        (d.with.length === 0 ||
          d.with.some((w) => t.includes(w.toLowerCase()))),
    ) ?? null
  );
}
