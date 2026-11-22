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

export const WEEKDAYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const Venue = z.object({
  id: z.string().regex(/^venue-[a-z0-9-]+$/),
  name: z.string(),
  /**
   * What a 160-character text and the link-preview picture call it: no
   * parenthetical, at most 26 characters ("SHARC", "Central Library").
   */
  short_name: z.string().min(2).max(26),
  town: z.string(),
  address: z.string().nullable().default(null),
  kind: z.string(),
  /** A roof over the main activity (Sunriver Nature Center is mostly outdoors). */
  covered: z.boolean(),
  /**
   * indoor: a closed building. covered: a roof with open sides (The
   * Pavilion). A covered venue never fits smoke, wind, ice or extreme cold.
   */
  enclosure: z.enum(["indoor", "covered"]),
  /** "All ages", "Ages 2 to 12" (the Indoor pick's Ages line). */
  ages_label: z.string(),
  /** A typical family visit (the Indoor pick's How long line). */
  visit_minutes: z.number().int().min(15).max(480),
  /** Days it's normally open (its own hours page). */
  open_days: z.array(z.enum(WEEKDAYS)),
  /** Driving minutes from downtown Bend (Wall St and Oregon Ave). */
  drive_minutes_from_downtown: z.number().int().min(0).max(120),
  /** free (libraries), low (under about $10 a child) or paid: free first. */
  cost: z.enum(["free", "low", "paid"]),
  /** From its own page: step-free entrance, stroller parking, sensory hours. */
  access_note: z.string().nullable().default(null),
  /** Its own hours page (where the Indoor pick's Open quote comes from). */
  hours_url: Url.nullable().default(null),
  /** Why it's unverified or limited (never shown). */
  note: z.string().optional(),
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
  /**
   * The venues this series runs at (venue.name exactly). When present, a
   * hand-in with this series_id at any other venue is refused.
   */
  venues: z.array(z.string()).optional(),
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

/**
 * One line for a plan-around weekend (spec section 2): "Dress for it"
 * when the trigger is about clothes (cold, snow, wind, rain), "Good to
 * know" for heat, moderate air or thunder. 120 characters at most.
 */
const DressTip = z.object({
  id: z.string().regex(/^(dress|know)-[a-z0-9-]+$/),
  text: z.string().max(120),
  label: z.enum(["Dress for it", "Good to know"]),
  triggers: z.array(
    z.enum(["snow", "ice", "rain", "wind", "smoke", "heat", "cold", "thunder"]),
  ),
  months: z.array(Month),
  source: Url.nullable().default(null),
  verified: z.boolean(),
});

/** The seasonal calendar (spec section 4): the month's theme and tip. */
const SeasonMonth = z.object({
  month: Month,
  theme: z.string(),
  /** The expected state ("never news"), in words for the writer. */
  normal: z.array(z.string()),
  tip: z.string(),
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

/** One "at home" theme (the Saturday Instagram post): id, label, a hint for the writer. */
const Theme = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  hint: z.string(),
});

/**
 * A holiday the "at home" post may theme to, for `before` days ahead of it
 * and `after` days after. `on` is "MM-DD" or "holiday:<a holidays() name>";
 * `dates` lists the years of a moving one (Lunar New Year).
 */
const ThemeHoliday = Theme.extend({
  on: z
    .string()
    .regex(/^(\d{2}-\d{2}|holiday:.+)$/)
    .optional(),
  dates: z.array(Day).default([]),
  before: z.number().int().min(0).max(21),
  after: z.number().int().min(0).max(7),
}).refine((h) => h.on || h.dates.length, "A holiday needs on or dates.");

/** The season calendar for the "at home" post: month to themes, plus holidays. */
const SeasonThemes = z.object({
  months: z
    .array(z.object({ month: Month, themes: z.array(Theme).min(1) }))
    .length(12),
  holidays: z.array(ThemeHoliday),
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
  /**
   * Closed for now (construction, a renovation): never a post or a pick,
   * and the park page shows the note.
   */
  closed: z.boolean().default(false),
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
  /**
   * Leads only: listings sites (often behind a bot check) and other
   * newsletters. Allowed as a discovery_url (never stored, shown or
   * linked); refused as a link or evidence everywhere (issues and events).
   * The organizer's own page is the primary source. Competitors' names are
   * also refused in any text (COMPETITOR_NAMES, styleProblems).
   */
  lead_domains: z
    .array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))
    .default([]),
  /**
   * Data hosts that are evidence only (never a link): an organizer's page
   * loads its facts from them (Sunriver Resort's experience catalog). Each
   * is a site_aliases entry, and usually an alias_paths one.
   */
  evidence_domains: z
    .array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))
    .default([]),
  /**
   * Calendar pages that link many programs (the library's): two events
   * sharing one of these as their link are not the same page.
   */
  shared_calendar_pages: z.array(z.string().url()).default([]),
  /**
   * The two local family newsletters' own pages (issues and web calendar):
   * a discovery source, and, for an event whose organizer's site keeps the
   * checker out, its evidence (verified_via "listing"). Never an event's
   * link, never shown, never named.
   */
  listing_domains: z
    .array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))
    .default([]),
  /**
   * Ticket resellers and booking platforms: never an event's link, even
   * when a newsletter links one. Use the organizer's own page.
   */
  not_organizer_domains: z
    .array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))
    .default([]),
  /**
   * A host that is the same organization as an allowlisted site (the
   * library's calendar on dpl.libnet.info is deschuteslibrary.org): a link
   * and its evidence on either count as one site.
   */
  site_aliases: z
    .record(
      z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
      z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
    )
    .default({}),
  /**
   * Query values an alias host's evidence URL must carry (hdm.mux.earth's
   * CMS serves any site: site= pins it to the museum's).
   */
  alias_pins: z
    .record(z.string(), z.record(z.string(), z.string()))
    .default({}),
  /**
   * The organizer's own paths on an alias host that serves many
   * organizations by path (Sunriver Resort's experience catalogs on
   * api.live.onaws.letsway.com: /v1/catalogs/<one of the resort's ids>/).
   * Evidence must be exactly <prefix>items (aliasPathProblem).
   */
  alias_paths: z
    .record(z.string(), z.array(z.string().regex(/^\//)).min(1))
    .default({}),
  /**
   * Other names for one venue (a library branch printed three ways), so a
   * program there keys one page. Catalog venues match by their own name
   * too.
   */
  venue_aliases: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        town: z.string(),
        names: z.array(z.string()).min(1),
      }),
    )
    .default([]),
  /**
   * Hosts behind a firewall or bot check (403, a challenge, a dropped
   * connection). The nightly check treats their refusals as unknown, never
   * a miss. We report walls; we never get past them.
   */
  walled_hosts: z
    .array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))
    .default([]),
  skip_dates: z.array(z.object({ date: Day, reason: z.string() })),
  breaks: z.array(Break),
  parks: z.array(ParkHint),
  venues: z.array(Venue),
  event_series: z.array(Series),
  tips: z.array(Tip),
  challenges: z.array(Challenge),
  seasonal_defaults: z.array(SeasonalDefault),
  dress_tips: z.array(DressTip),
  season_calendar: z.array(SeasonMonth).length(12),
  season_themes: SeasonThemes,
});

export type Catalog = z.infer<typeof CatalogSchema>;
export type Venue = z.infer<typeof Venue>;
export type Tip = z.infer<typeof Tip>;
export type Challenge = z.infer<typeof Challenge>;
export type Series = z.infer<typeof Series>;
export type SeasonalDefault = z.infer<typeof SeasonalDefault>;
export type DressTip = z.infer<typeof DressTip>;
export type SeasonMonth = z.infer<typeof SeasonMonth>;
export type SeasonThemes = z.infer<typeof SeasonThemes>;

export const CATALOG: Catalog = CatalogSchema.parse(raw);

/** Parks closed for now (construction, a renovation): never in a post or a pick. */
export const isClosedPark = (slug: string, catalog: Catalog = CATALOG) =>
  catalog.parks.some((p) => p.slug === slug && p.closed);

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

/** The domain (or a parent) of this link on a list, or null. */
export function onList(url: string, list: readonly string[]): string | null {
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return list.find((d) => h === d || h.endsWith(`.${d}`)) ?? null;
}

/** The refusal for a lead (listings site or newsletter) as a link or evidence. */
export const leadMessage = (d: string) =>
  `${d} is a lead only: never a link or evidence. Find the organizer's own page.`;

/** A site, as the organization it belongs to (its alias, if any). */
export function aliasSite(
  site: string,
  aliases: Readonly<Record<string, string>> = {},
): string {
  return aliases[site] ?? site;
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

/**
 * Evidence on an alias host that serves many organizations by path: only
 * exactly <allowed prefix>items (a query is fine), and never an encoded
 * slash, backslash or dot, or "..", in the raw URL. Null when fine, or
 * when the host has no path rule. Returns the allowed catalog id too.
 */
export function aliasPathProblem(
  url: string,
  aliasPaths: Readonly<Record<string, readonly string[]>> = {},
): { problem: string | null; prefix?: string } {
  const a = onList(url, Object.keys(aliasPaths));
  if (!a) return { problem: null };
  const fail = {
    problem: `Evidence on ${a} must be the organizer's own data: ${aliasPaths[a].map((x) => `${x}items`).join(" or ")}.`,
  };
  const raw = url.split(/[?#]/)[0];
  if (/%2f|%5c|%2e|\.\.|\\/i.test(raw)) return fail;
  const path = new URL(url).pathname;
  const prefix = aliasPaths[a].find(
    (x) => path === `${x}items` || path === `${x}items/`,
  );
  return prefix ? { problem: null, prefix } : fail;
}
