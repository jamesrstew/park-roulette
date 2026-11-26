/**
 * The growth digest's metrics: one catalog, so the email, the web view
 * and the stored snapshots never drift. Every metric names where it comes
 * from and how it's counted. Pure (no server imports).
 *
 * kind:
 *   flow   happened during the week (sign-ups, stamps, clicks)
 *   level  a count at the end of the week (list size, followers)
 * live: true when it can only be read at the time (followers, listings);
 * a backfilled week has null there. Null always means "not measured",
 * never zero.
 */

export type MetricGroup =
  | "Visitors"
  | "Sign-ups"
  | "Families"
  | "Lists"
  | "Email"
  | "Texts"
  | "Instagram and Facebook"
  | "Content"
  | "Health";

export type MetricDef = {
  key: string;
  label: string;
  group: MetricGroup;
  kind: "flow" | "level";
  /** Where the number comes from, in plain words. */
  source: string;
  /** How it's counted. */
  definition: string;
  live?: boolean;
  /** Lower is better (stops, bounces, alerts). */
  lowerIsBetter?: boolean;
};

const m = (
  key: string,
  label: string,
  group: MetricGroup,
  kind: MetricDef["kind"],
  source: string,
  definition: string,
  extra: Partial<MetricDef> = {},
): MetricDef => ({ key, label, group, kind, source, definition, ...extra });

const VERCEL = "Vercel Web Analytics";
const IG = "Instagram Graph API";

export const METRICS: readonly MetricDef[] = [
  // Visitors
  m(
    "visitors",
    "Visitors",
    "Visitors",
    "flow",
    VERCEL,
    "Vercel's unique visitors for the week. Its visitor code resets daily (no cookies), so someone who comes on several days can count more than once.",
  ),
  m(
    "pageviews",
    "Page views",
    "Visitors",
    "flow",
    VERCEL,
    "Pages viewed, production only.",
  ),
  m(
    "src_bulletin",
    "From the Bulletin",
    "Visitors",
    "flow",
    VERCEL,
    "Visitors whose referrer was bendbulletin.com.",
  ),
  m(
    "src_instagram",
    "From Instagram",
    "Visitors",
    "flow",
    VERCEL,
    "Visitors whose referrer was instagram.com (in-app browsers often send none, so see Arrived from posts).",
  ),
  m(
    "src_facebook",
    "From Facebook",
    "Visitors",
    "flow",
    VERCEL,
    "Visitors whose referrer was facebook.com.",
  ),
  m(
    "src_google",
    "From Google",
    "Visitors",
    "flow",
    VERCEL,
    "Visitors whose referrer was a Google domain (search, mostly).",
  ),
  m(
    "src_other_search",
    "From other search",
    "Visitors",
    "flow",
    VERCEL,
    "Bing, DuckDuckGo, Yahoo, Brave and the like.",
  ),
  m(
    "src_other_site",
    "From other sites",
    "Visitors",
    "flow",
    VERCEL,
    "Any other referring site.",
  ),
  m(
    "src_direct",
    "Direct or unknown",
    "Visitors",
    "flow",
    VERCEL,
    "No referrer: typed, bookmarked, texts, email apps, in-app browsers.",
  ),
  m(
    "arrived_social",
    "Arrived from our posts",
    "Visitors",
    "flow",
    `${VERCEL} (Arrived event)`,
    "Landings with ?from=ig, ig_dm or fb (our bio link, DM link and Facebook posts), once per browser session.",
  ),
  m(
    "email_clicks",
    "Newsletter link taps",
    "Visitors",
    "flow",
    "news_clicks",
    "Taps on /n/ links in the issue sent this week, counted so far (no person recorded).",
  ),
  m(
    "text_clicks",
    "Weekend Pick link taps",
    "Visitors",
    "flow",
    "news_clicks",
    "Taps on the Friday text's link for this week's issue, counted so far.",
  ),

  // Sign-ups (activation)
  m(
    "families_new",
    "New families",
    "Sign-ups",
    "flow",
    "crews",
    "Families (crews) created this week.",
  ),
  m(
    "grownups_new",
    "New grown-up accounts",
    "Sign-ups",
    "flow",
    "explorers",
    "Grown-up explorers created this week (any family).",
  ),
  m(
    "kids_new",
    "Kids added",
    "Sign-ups",
    "flow",
    "explorers",
    "Kid explorers created this week.",
  ),
  m(
    "phones_verified",
    "Phones verified",
    "Sign-ups",
    "flow",
    "explorers",
    "Explorers whose number was last verified this week (a re-verify moves the date).",
  ),
  m(
    "code_requested",
    "Sign-in codes asked for",
    "Sign-ups",
    "flow",
    `${VERCEL} (Code requested)`,
    "Times someone asked for a texted code.",
  ),
  m(
    "first_stamps",
    "First stamps",
    "Sign-ups",
    "flow",
    "visits",
    "Families whose very first stamp was this week.",
  ),
  m(
    "spins",
    "Wheel spins (all visitors)",
    "Families",
    "flow",
    `${VERCEL} (Spin)`,
    "Spins of the wheel (counted in the browser; spins don't reach the server).",
  ),

  // Families (engagement)
  m(
    "families_total",
    "Families, all time",
    "Families",
    "level",
    "crews",
    "Families at the end of the week.",
  ),
  m(
    "active_families",
    "Active families",
    "Families",
    "flow",
    "visits, reviews, event_saves, event_hides, park_votes",
    "Families that stamped, reviewed, saved or hid an event, or voted on a park fact this week.",
  ),
  m(
    "returning_families",
    "Returning families",
    "Families",
    "flow",
    "visits, reviews",
    "Families created before this week that stamped or reviewed this week.",
  ),
  m("stamps", "Stamps", "Families", "flow", "visits", "Park visits logged."),
  m(
    "reviews",
    "Reviews",
    "Families",
    "flow",
    "reviews",
    "Reviews written this week (stars, tags or words).",
  ),
  m(
    "photos",
    "Photos and videos",
    "Families",
    "flow",
    "media",
    "Photos and videos saved on reviews.",
  ),
  m(
    "event_saves",
    "Events saved",
    "Families",
    "flow",
    "event_saves",
    "Event saves by signed-in families (signed-out saves stay on the phone).",
  ),
  m(
    "event_hides",
    "Events hidden",
    "Families",
    "flow",
    "event_hides",
    "Event hides by signed-in families.",
  ),

  // Lists (audience)
  m(
    "audience_total",
    "Audience reach",
    "Lists",
    "level",
    "email_subscribers, contact_consents, Instagram",
    "Email list + texts list + Instagram followers. People on two lists count twice.",
  ),
  m(
    "email_list",
    "Email list",
    "Lists",
    "level",
    "email_subscribers",
    "Confirmed addresses at the end of the week.",
  ),
  m(
    "email_new",
    "Email sign-ups",
    "Lists",
    "flow",
    "email_subscribers",
    "Addresses confirmed this week (single opt-in: confirmed at sign-up).",
  ),
  m(
    "email_stopped",
    "Email stops",
    "Lists",
    "flow",
    "email_subscribers",
    "Addresses that stopped this week, for any reason.",
    { lowerIsBetter: true },
  ),
  m(
    "email_pending",
    "Email pending",
    "Lists",
    "level",
    "email_subscribers",
    "Addresses still waiting on a confirmation tap (only from before single opt-in).",
  ),
  m(
    "texts_list",
    "Texts list",
    "Lists",
    "level",
    "contact_consents, sms_opt_outs",
    "Numbers whose latest yes or stop was a yes, minus numbers that texted STOP.",
  ),
  m(
    "texts_new",
    "Text sign-ups",
    "Lists",
    "flow",
    "contact_consents",
    "Text yeses (opt_in) recorded this week.",
  ),
  m(
    "texts_stopped",
    "Text stops",
    "Lists",
    "flow",
    "contact_consents",
    "Text stops (opt_out) recorded this week, any way.",
    { lowerIsBetter: true },
  ),
  m(
    "both_lists",
    "On both lists",
    "Lists",
    "level",
    "email_subscribers, explorers, contact_consents",
    "Accounts whose confirmed email and texted number are both on. Signed-out sign-ups can't be matched, so this is a floor.",
  ),
  m(
    "ig_followers",
    "Instagram followers",
    "Lists",
    "level",
    IG,
    "Followers when the digest ran (Meta keeps no history for small accounts, so we store it weekly).",
    { live: true },
  ),
  m(
    "fb_followers",
    "Facebook followers",
    "Lists",
    "level",
    "Facebook Graph API",
    "Page followers when the digest ran.",
    { live: true },
  ),

  // Email performance
  m(
    "email_sent",
    "Newsletter emails sent",
    "Email",
    "flow",
    "news_sends",
    "Emails sent for issues that went out this week.",
  ),
  m(
    "email_bounces",
    "Bounces",
    "Email",
    "flow",
    "contact_consents (Resend webhook)",
    "Addresses stopped by a bounce this week.",
    { lowerIsBetter: true },
  ),
  m(
    "email_complaints",
    "Spam complaints",
    "Email",
    "flow",
    "contact_consents (Resend webhook)",
    "Spam complaints this week.",
    { lowerIsBetter: true },
  ),
  m(
    "email_unsubs",
    "Unsubscribes",
    "Email",
    "flow",
    "contact_consents",
    "People who unsubscribed this week (one-click, the email link or settings).",
    { lowerIsBetter: true },
  ),

  // Texts performance
  m(
    "texts_sent",
    "Weekend Picks sent",
    "Texts",
    "flow",
    "sms_program_sends",
    "Friday texts Twilio accepted this week.",
  ),
  m(
    "texts_delivered",
    "Weekend Picks delivered",
    "Texts",
    "flow",
    "sms_program_sends",
    "Of those, Twilio reported delivered.",
  ),
  m(
    "texts_failed",
    "Weekend Picks failed",
    "Texts",
    "flow",
    "sms_program_sends",
    "Failed at send, or undelivered by the carrier.",
    { lowerIsBetter: true },
  ),
  m(
    "texts_stop_replies",
    "STOP replies",
    "Texts",
    "flow",
    "contact_consents",
    "Numbers that replied STOP this week.",
    { lowerIsBetter: true },
  ),

  // Social
  m(
    "posts_published",
    "Posts published",
    "Instagram and Facebook",
    "flow",
    "social_posts",
    "Our feed posts that went out on Instagram this week (Stories echoes not counted).",
  ),
  m(
    "fb_posts",
    "Facebook posts",
    "Instagram and Facebook",
    "flow",
    "social_posts",
    "The same posts cross-posted to the Facebook Page.",
  ),
  m(
    "ig_reach",
    "Instagram accounts reached",
    "Instagram and Facebook",
    "flow",
    IG,
    "Unique accounts that saw anything of ours this week (Meta's estimate).",
  ),
  m(
    "ig_views",
    "Instagram views",
    "Instagram and Facebook",
    "flow",
    IG,
    "Times our posts, Stories and reels were shown.",
  ),
  m(
    "ig_profile_views",
    "Profile views",
    "Instagram and Facebook",
    "flow",
    IG,
    "Visits to @park_roulette.",
  ),
  m(
    "ig_link_taps",
    "Bio link taps",
    "Instagram and Facebook",
    "flow",
    IG,
    "Taps on the link in our bio (website_clicks).",
  ),
  m(
    "ig_interactions",
    "Instagram interactions",
    "Instagram and Facebook",
    "flow",
    IG,
    "Likes, comments, saves, shares and replies.",
  ),
  m(
    "ig_saves",
    "Instagram saves",
    "Instagram and Facebook",
    "flow",
    IG,
    "Times someone saved one of our posts.",
  ),
  m(
    "dms_sent",
    "PARK DMs sent",
    "Instagram and Facebook",
    "flow",
    "social_dm_replies",
    "Keyword DMs (comment PARK, Story reply PICK) Meta accepted.",
  ),
  m(
    "dms_failed",
    "PARK DMs failed",
    "Instagram and Facebook",
    "flow",
    "social_dm_replies",
    "Keyword DMs that failed.",
    { lowerIsBetter: true },
  ),

  // Content
  m(
    "events_listed",
    "Events listed",
    "Content",
    "level",
    "kid_events",
    "Upcoming event pages on /events when the digest ran.",
    { live: true },
  ),
  m(
    "events_new",
    "New event pages",
    "Content",
    "flow",
    "kid_events",
    "Event pages created this week.",
  ),
  m(
    "guides_live",
    "Guide pages live",
    "Content",
    "level",
    "sitemap",
    "/guides pages in the sitemap (seasonal and pairing guides).",
    { live: true },
  ),
  m(
    "pairing_pages",
    "Pairing pages",
    "Content",
    "level",
    "pairing_pages",
    "Evergreen pairing pages born so far.",
  ),
  m(
    "sitemap_urls",
    "Sitemap URLs",
    "Content",
    "level",
    "sitemap",
    "Every URL the sitemap lists.",
    { live: true },
  ),

  // Health
  m(
    "alerts",
    "Alert kinds",
    "Health",
    "flow",
    "alert_log",
    "Kinds of alert that emailed James since the week began (a job that keeps failing re-emails at least daily). alert_log keeps only each kind's last email, so this is read live; rebuilt weeks show it as not measured.",
    { lowerIsBetter: true },
  ),
  m(
    "cron_errors",
    "Job failures",
    "Health",
    "flow",
    "alert_log",
    "Scheduled jobs whose failure alert emailed since the week began.",
    { lowerIsBetter: true },
  ),
  m(
    "places_requests",
    "Google Places requests",
    "Health",
    "flow",
    "places_usage",
    "Text Search and Place Details requests this week (60 and 20 a day are the caps).",
  ),
  m(
    "places_peak_pct",
    "Places requests, busiest day (% of cap)",
    "Health",
    "flow",
    "places_usage",
    "Text Search requests on the week's busiest day, as a share of the 60-a-day cap.",
    { lowerIsBetter: true },
  ),
];

/**
 * The email's short table (everything else is on the web view). A row
 * that's 0 both weeks is left out of the email.
 */
export const EMAIL_ROWS = [
  "visitors",
  "src_bulletin",
  "src_instagram",
  "src_facebook",
  "src_google",
  "families_new",
  "first_stamps",
  "active_families",
  "spins",
  "email_list",
  "texts_list",
  "ig_followers",
  "ig_reach",
  "email_clicks",
  "alerts",
] as const;

export const METRIC = Object.fromEntries(
  METRICS.map((d) => [d.key, d]),
) as Record<string, MetricDef>;

export type Metrics = Record<string, number | null>;

/** A stored week. */
export type Snapshot = {
  weekStart: string;
  metrics: Metrics;
  details: Details;
  backfilled: boolean;
};

/** The lists behind the numbers (labels and counts only). */
export type Details = {
  /** Visitors by source key (vercel.ts SourceKey). */
  sources?: Record<string, number>;
  /** Top referring hosts. */
  referrers?: { host: string; visitors: number }[];
  /** Page views by path group. */
  pathGroups?: { group: string; visitors: number; pageviews: number }[];
  /** Top individual pages. */
  topPaths?: { path: string; visitors: number; pageviews: number }[];
  /** Visitors per day (UTC days, from Vercel). */
  daily?: { day: string; visitors: number; pageviews: number }[];
  /** Custom events: name to count. */
  events?: Record<string, number>;
  askShownBy?: Record<string, number>;
  arrivedBy?: Record<string, number>;
  /** Email and text sign-ups by source (signup source label to count). */
  emailBySource?: Record<string, number>;
  textsBySource?: Record<string, number>;
  /** The week's newsletter issue: its date, recipients and link taps. */
  issue?: {
    date: string;
    sent: number;
    links: { slug: string; clicks: number }[];
  } | null;
  /** The week's posts with their lifetime numbers so far. */
  posts?: {
    id: number;
    kind: string;
    day: string;
    reach: number | null;
    views: number | null;
    saved: number | null;
    shares: number | null;
    likes: number | null;
    comments: number | null;
  }[];
  postsByKind?: Record<string, number>;
  /** Alert keys that emailed this week (key prefixes only, no details). */
  alertKeys?: string[];
  /** Gathered before the week ended. */
  partial?: boolean;
  /** Why a source wasn't read ("vercel: not connected"). */
  missing?: string[];
};

export const GROUPS: MetricGroup[] = [
  "Visitors",
  "Sign-ups",
  "Families",
  "Lists",
  "Email",
  "Texts",
  "Instagram and Facebook",
  "Content",
  "Health",
];

/** Signup source labels, in plain words. */
export const SOURCE_LABELS: Record<string, string> = {
  footer: "site footer",
  newsletter: "/newsletter page",
  issue_page: "an issue page",
  issue_text: "an issue page from a text",
  welcome_sheet: "the welcome sheet",
  settings: "settings",
  texts_page: "/texts page",
  confirm_page: "the confirm page",
  next_pick: "the next-pick ask",
  rainy_spin: "the rainy-day ask",
  weekend_spin: "the weekend ask",
  ig_bio: "Instagram bio link",
  ig_dm: "Instagram DM link",
  fb: "Facebook",
  email_footer: "the email footer",
  site_footer: "the site footer card",
  held_until_live: "held until texts went live",
  stop: "a STOP reply",
};

export const SOURCE_NAMES: Record<string, string> = {
  bulletin: "the Bulletin",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  other_search: "other search engines",
  other_site: "other sites",
  direct: "direct visits",
};
