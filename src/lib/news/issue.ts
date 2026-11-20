import { z } from "zod";
import type { Catalog } from "./catalog";

/**
 * The issue JSON the writer submits: one Thursday of Bend Playground
 * Passport. Structure and hard limits live here; every other rule lives in
 * validate.ts. Unknown keys are rejected, so a typo can't hide a field.
 */

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Slug = z.string().regex(/^[a-z0-9-]+$/, "A park slug from our map");
const Https = z.url({ protocol: /^https$/, error: "Use an https link" });
const Text = (max: number, min = 1) => z.string().trim().min(min).max(max);

/** Where a date, time, price or closure came from, quoted exactly as printed. */
export const Evidence = z.strictObject({
  url: Https,
  quote: Text(300, 20),
});

const Outing = z.strictObject({
  name: Text(80),
  /** A catalog event series, when this is one (cooldown: 4 weeks). */
  series_id: z.string().optional(),
  /** A park on our map, when the outing is at one (cooldown: 6 weeks). */
  park: Slug.optional(),
  day: Day,
  time: Text(60),
  /**
   * The age words exactly as printed on the official page ("Ages 5 and
   * under"); code turns them into age tags. Omit when the page prints none.
   */
  ages_text: Text(80).optional(),
  /** Old issues only (free text, before age tags). New drafts can't use it. */
  ages: Text(40).optional(),
  /** Its page on /events, when it has one (issue pages link there). */
  event: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  cost: Text(40),
  place: Text(120),
  town: Text(40),
  what: Text(240),
  url: Https,
  evidence: z.array(Evidence).min(1).max(3),
});

/**
 * A real photo of the featured park: from Bend Park & Recreation
 * District's site (credited to BPRD) or Wikimedia Commons (an open license
 * we credit). Without one, the email shows the park's crayon card.
 */
export const PhotoSchema = z.strictObject({
  src: Https,
  width: z.number().int().min(200).max(8000),
  height: z.number().int().min(100).max(8000),
  alt: Text(160),
  /** Commons photos: the author, license name and license link. */
  author: Text(100).optional(),
  license: Text(40).optional(),
  licenseUrl: Https.optional(),
  /** The Commons file page, or the park's page on bendparksandrec.org. */
  sourceUrl: Https,
});
const Photo = PhotoSchema;

/** An X post as code fetched it (lib/news/xapi.ts): what the card draws. */
/**
 * The card image, rendered once (when the post is fetched) and stored in
 * our private Blob store, so every reader and every resend sees the same
 * file. Its size and alt text go into the email.
 */
const CardFile = z.object({
  /** Pathname in our private Blob store (news/cards/...). */
  path: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string(),
});
export type CardFile = z.infer<typeof CardFile>;

const XSnapshot = z.object({
  kind: z.literal("x"),
  id: z.string(),
  /** The author's permanent user id (account cooldown, takeovers). */
  authorId: z.string().optional(),
  text: z.string(),
  /** Display URLs in the text (xDisplayText), drawn in blue. */
  links: z.array(z.string()).default([]),
  name: z.string(),
  username: z.string(),
  avatar: z.string().nullable(),
  verified: z.boolean(),
  verifiedType: z
    .enum(["blue", "business", "government"])
    .nullable()
    .default(null),
  createdAt: z.string(),
  likes: z.number(),
  replies: z.number().default(0),
  reposts: z.number().default(0),
  quotes: z.number().default(0),
  media: z.array(
    z.object({
      type: z.enum(["photo", "video", "animated_gif"]),
      url: z.string(),
      width: z.number(),
      height: z.number(),
      alt: z.string().nullable(),
    }),
  ),
  possiblySensitive: z.boolean(),
  standalone: z.boolean().default(true),
  card: CardFile.optional(),
});

/** A TikTok video's cover, copied into our private Blob store at draft time. */
const TikTokSnapshot = z.object({
  kind: z.literal("tiktok"),
  id: z.string(),
  handle: z.string(),
  title: z.string(),
  /** Pathname in our private Blob store (news/tiktok/<id>.jpg). */
  thumb: z.string(),
  width: z.number(),
  height: z.number(),
  card: CardFile.optional(),
});

/**
 * An Instagram post (Parents' corner v5), as Business Discovery returned
 * it. Its image is copied to our private Blob store (content-addressed)
 * with its pixel size; readers never load Instagram's CDN in email.
 */
const IgSnapshot = z.object({
  kind: z.literal("instagram"),
  id: z.string(),
  username: z.string(),
  permalink: z.string(),
  mediaType: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
  productType: z.enum(["FEED", "REELS", "STORY", "AD"]).nullable(),
  likes: z.number(),
  timestamp: z.string(),
  carouselCount: z.number().nullable(),
  /** The profile picture URL (fetched by our server for the card only). */
  avatar: z.string().nullable(),
  image: z.object({
    path: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    type: z.string(),
  }),
  card: CardFile.optional(),
});

export const MemeSnapshot = z.discriminatedUnion("kind", [
  XSnapshot,
  TikTokSnapshot,
  IgSnapshot,
]);
export type MemeSnapshot = z.infer<typeof MemeSnapshot>;

/**
 * Parents' corner (code name: meme): one image of a post, linked to it,
 * with no caption. The writer names the post; code fetches it (the
 * snapshot, filled in by the validator) and draws the image on our own
 * domain, so readers never load anything from X or TikTok. X posts come
 * from the plan's candidates. Instagram stays out until we have oEmbed.
 */
const Meme = z.strictObject({
  platform: z.enum(["x", "tiktok", "instagram"]),
  url: Https,
  postId: z.string().regex(/^\d{1,25}$/, "The post's numeric id"),
  /** Instagram: the page's username (from the plan's candidate). */
  account: z
    .string()
    .regex(/^[a-z0-9._]{1,30}$/)
    .optional(),
  /** Filled in by code; anything the writer sends here is replaced. */
  snapshot: MemeSnapshot.optional(),
  /**
   * Code only: for an Instagram pick, the plan's best X post with its card
   * drawn at draft time, used if the Instagram post is gone at send.
   */
  fallback: MemeSnapshot.optional(),
});

/**
 * Heads up is built from changes on our own map since the last issue, and
 * nothing else (closure pages come back once we keep snapshots of them).
 * park_change: change_id from the plan's deltas. new_park: old issues
 * only; a park joining the map isn't news, and the checker refuses it.
 */
const HeadsUp = z.strictObject({
  kind: z.enum(["park_change", "new_park"]),
  change_id: z.number().int().positive().optional(),
  park: Slug,
  text: Text(240),
});

/** The weather card's icons (components/news/WeatherCard.tsx). */
export const WEATHER_ICONS = [
  "sun",
  "partly",
  "cloudy",
  "rain",
  "snow",
  "mixed",
  "storm",
  "fog",
  "wind",
  "smoke",
] as const;

/**
 * One day of The weekend ahead (NWS, Bend), as the plan made it. A day
 * NWS hasn't forecast yet is `missing` (the card draws a placeholder).
 */
export const ForecastDay = z.strictObject({
  date: Day,
  /** "Friday" */
  label: Text(12),
  /** The card's short condition, "Snow showers" (13 characters at most). */
  condition: z.string().max(13),
  icon: z.enum(WEATHER_ICONS),
  high: z.number().int().min(-60).max(130).nullable(),
  low: z.number().int().min(-60).max(130).nullable(),
  /** Daytime chance of rain or snow, percent. */
  precip: z.number().int().min(0).max(100).nullable(),
  missing: z.boolean().optional(),
});
export type ForecastDay = z.infer<typeof ForecastDay>;

export const IssueSchema = z.strictObject({
  issue_date: Day,
  subject: Text(45, 8),
  preview: Text(110, 20),
  hello: z.strictObject({
    /** The warm opener, signed James. No "we went" or "I saw". */
    text: Text(500, 40),
  }),
  /**
   * The weekend ahead: Friday to Sunday. `days` is filled in by code from
   * the plan (the writer may leave it out; if given, it must match), and
   * stays in the issue so the archive and its weather card never change.
   */
  weekend_ahead: z
    .strictObject({
      days: z.array(ForecastDay).length(3).optional(),
      /**
       * One short line under the weather card ("Best park window: Sunday
       * morning"). Text in the email, never drawn into the image.
       */
      note: Text(80).optional(),
    })
    .optional(),
  /** Up to three short bullets: what's inside. */
  bullets: z.array(Text(90)).max(3).optional(),
  wheel_pick: z.strictObject({
    /** Must be the plan's pick: code spins the wheel, not the writer. */
    park: Slug,
    why_now: Text(300),
    who_for: Text(200),
    bring: Text(200),
    photo: Photo.optional(),
  }),
  plan_b: z
    .strictObject({
      /**
       * venue: the Indoor pick (only when the plan's gate is open).
       * window: a clear-week timing tip ("Best time to go").
       */
      kind: z.enum(["venue", "window"]),
      venue_id: z.string().optional(),
      tip_id: z.string().optional(),
      /** Window tips, and Indoor picks from before the v1 layout. */
      title: Text(80).optional(),
      text: Text(360).optional(),
      /** Indoor pick: the day it's for (a disruptive counted day). */
      for_day: Day.optional(),
      /** Indoor pick: what kids actually do there (model). */
      why_kids: Text(220).optional(),
      /** Indoor pick: that day's hours, as printed (a quote proves them). */
      hours: Text(80).optional(),
      /** Indoor pick: a printed price ("$12 for ages 3 to 12") or "Free". */
      cost: Text(100).optional(),
      /** Indoor pick: one line on parking, when to arrive or what to pack. */
      tip: Text(160).optional(),
      /** Code: "Closer to home" venues on snow and ice days. */
      closer_to_home: z.array(z.string()).max(3).optional(),
      /** Code: the third Indoor pick in a row is one short line. */
      short: z.boolean().optional(),
      evidence: z.array(Evidence).max(3).default([]),
    })
    .optional(),
  /**
   * One line on a plan-around weekend: a catalog dress tip (code renders
   * its words and its "Dress for it" or "Good to know" label).
   */
  dress: z.strictObject({ tip_id: z.string() }).optional(),
  heads_up: z.array(HeadsUp).max(4).optional(),
  weekend: z.array(Outing).min(2).max(3).optional(),
  passport: z.strictObject({
    challenge_id: z.string(),
    text: Text(300),
  }),
  meme: Meme.optional(),
  signoff: z.strictObject({
    /** The reply ask ("Spotted a closure? Hit reply."). */
    text: Text(240),
  }),
});

export type Issue = z.infer<typeof IssueSchema>;
export type IssueEvidence = z.infer<typeof Evidence>;

/**
 * An issue cut into the pieces the validator judges one at a time. A
 * required unit that fails fails the issue; any other unit is cut.
 */
export type Unit = {
  key: string;
  required: boolean;
  texts: string[];
  /** Links the writer chose (catalog and our own links are checked apart). */
  urls: string[];
  evidence: IssueEvidence[];
};

export function issueUnits(issue: Issue): Unit[] {
  const u = (
    key: string,
    required: boolean,
    texts: (string | undefined)[],
    urls: (string | undefined)[] = [],
    evidence: IssueEvidence[] = [],
  ): Unit => ({
    key,
    required,
    texts: texts.filter((t): t is string => !!t),
    urls: urls.filter((t): t is string => !!t),
    evidence,
  });
  return [
    u("subject", true, [issue.subject]),
    u("preview", true, [issue.preview]),
    u("hello", true, [issue.hello.text]),
    ...(issue.weekend_ahead?.note
      ? [u("weekend_note", false, [issue.weekend_ahead.note])]
      : []),
    ...(issue.bullets ?? []).map((b, i) => u(`bullets.${i}`, false, [b])),
    u("wheel_pick", true, [
      issue.wheel_pick.why_now,
      issue.wheel_pick.who_for,
      issue.wheel_pick.bring,
    ]),
    ...(issue.plan_b
      ? [
          u(
            "plan_b",
            false,
            [
              issue.plan_b.title,
              issue.plan_b.text,
              issue.plan_b.why_kids,
              issue.plan_b.hours,
              issue.plan_b.cost,
              issue.plan_b.tip,
            ],
            [],
            issue.plan_b.evidence,
          ),
        ]
      : []),
    ...(issue.dress ? [u("dress", false, [])] : []),
    ...(issue.heads_up ?? []).map((h, i) =>
      u(`heads_up.${i}`, false, [h.text]),
    ),
    ...(issue.weekend ?? []).map((w, i) =>
      u(
        `weekend.${i}`,
        false,
        [w.name, w.time, w.ages, w.cost, w.place, w.town, w.what],
        [w.url],
        w.evidence,
      ),
    ),
    ...(issue.wheel_pick.photo
      ? [
          u(
            "photo",
            false,
            [issue.wheel_pick.photo.alt],
            [issue.wheel_pick.photo.src, issue.wheel_pick.photo.sourceUrl],
          ),
        ]
      : []),
    u("passport", true, [issue.passport.text]),
    // No words of ours, and its link is checked through the platform's
    // API, not fetched.
    ...(issue.meme ? [u("meme", false, [])] : []),

    u("signoff", true, [issue.signoff.text]),
  ];
}

/** The issue without the cut units (empty sections drop out). */
export function withoutUnits(issue: Issue, cut: Set<string>): Issue {
  const keep = <T>(list: T[] | undefined, prefix: string) => {
    const kept = (list ?? []).filter((_, i) => !cut.has(`${prefix}.${i}`));
    return kept.length ? kept : undefined;
  };
  return {
    ...issue,
    bullets: keep(issue.bullets, "bullets"),
    wheel_pick: cut.has("photo")
      ? { ...issue.wheel_pick, photo: undefined }
      : issue.wheel_pick,
    plan_b: cut.has("plan_b") ? undefined : issue.plan_b,
    weekend_ahead:
      issue.weekend_ahead && cut.has("weekend_note")
        ? { ...issue.weekend_ahead, note: undefined }
        : issue.weekend_ahead,
    meme: cut.has("meme") ? undefined : issue.meme,
    dress: cut.has("dress") ? undefined : issue.dress,
    heads_up: keep(issue.heads_up, "heads_up"),
    weekend: keep(issue.weekend, "weekend"),
  };
}

/** Every reader-facing word, for counts and similarity. */
export function issueText(issue: Issue): string {
  return issueUnits(issue)
    .filter((u) => u.key !== "preview")
    .flatMap((u) => u.texts)
    .join(" ");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

/**
 * Every link in the issue, with a slug that's the same for every reader:
 * /n/<issue>/<slug> redirects to it and counts the click in total.
 */
export function issueLinks(
  issue: Issue,
  catalog: Catalog,
  site: string,
): { slug: string; url: string; label: string }[] {
  const links: { slug: string; url: string; label: string }[] = [
    {
      slug: "pick",
      url: `${site}/parks/${issue.wheel_pick.park}`,
      label: "Wheel Pick",
    },
  ];
  const venue = catalog.venues.find((v) => v.id === issue.plan_b?.venue_id);
  if (issue.plan_b?.kind === "venue" && venue)
    links.push({ slug: "plan-b", url: venue.url, label: venue.name });
  (issue.heads_up ?? []).forEach((h, i) => {
    links.push({
      slug: `heads-up-${i + 1}`,
      url: `${site}/parks/${h.park}`,
      label: "Heads up",
    });
  });
  (issue.weekend ?? []).forEach((w, i) =>
    links.push({ slug: `weekend-${i + 1}`, url: w.url, label: w.name }),
  );
  links.push({ slug: "passport", url: `${site}/passport`, label: "Passport" });
  if (issue.meme)
    links.push({ slug: "meme", url: issue.meme.url, label: "Parents' corner" });
  return links;
}
