import { z } from "zod";
import { addDays, pacificInstant, weekdayOf } from "@/lib/news/time";

/**
 * Park Roulette on Instagram (@park_roulette): the post types, the weekly
 * calendar, the fixed copy and the shapes the Sunday routine hands in.
 * Pure (no server imports). Spec: /tmp/pr-news/batch6/social-spec.md, with
 * decisions 7, 10 and 13 of batch6-decisions.md on top (no human photo
 * review, no per-post veto, no outreach, Facebook off until
 * pages_manage_posts, no Reels, keyword DMs off until tested).
 *
 *   Mon 12:15 pm  park_post    the park post (one 4:5 image, the photo or the crayon card)
 *   Tue  7:30 am  events_week  family events this week (code only, from kid_events)
 *   Wed  7:45 pm  unpack       the Unpack carousel (@nowbam pattern)
 *   Thu  7:15 am  teaser       the issue teaser (code only, from the sent issue)
 *   Fri  4:30 pm  story        the Weekend Pick Story (code only)
 *   Sat  7:45 am  at_home      things to do at home (the Sunday routine, 6 days ahead)
 *
 * A school break may move the carousel to Sunday 7:45 pm, the day before.
 */

export const POST_KINDS = [
  "park_post",
  "unpack",
  "teaser",
  "story",
  "events_week",
  "at_home",
] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** Feed posts are 4:5; Stories 9:16. Words stay inside the center 1012 px. */
export const FEED = { width: 1080, height: 1350 } as const;
export const STORY = { width: 1080, height: 1920 } as const;
export const SAFE_WIDTH = 1012;

/** Pacific weekday (0 = Sunday) and wall time of each post type. */
export const SLOTS: Record<
  PostKind,
  { weekday: number; hh: number; mm: number }
> = {
  park_post: { weekday: 1, hh: 12, mm: 15 },
  unpack: { weekday: 3, hh: 19, mm: 45 },
  teaser: { weekday: 4, hh: 7, mm: 15 },
  story: { weekday: 5, hh: 16, mm: 30 },
  events_week: { weekday: 2, hh: 7, mm: 30 },
  at_home: { weekday: 6, hh: 7, mm: 45 },
};
/** The school-break carousel: Sunday 7:45 pm, the day before week_of. */
export const HOLIDAY_UNPACK = { weekday: 0, hh: 19, mm: 45 } as const;

/** The container is created this long before publish time. */
export const CREATE_LEAD_MIN = 30;
/** A post not out this long after its time is skipped (and James told). */
export const LATE_LIMIT_MIN = 120;
/**
 * Meta's docs say both 100 and 50 API-published posts a day; plan for 50
 * and read content_publishing_limit before every create.
 */
export const DAILY_PUBLISH_LIMIT = 50;
/** A park isn't featured again on Instagram for this many weeks. */
export const PARK_COOLDOWN_WEEKS = 8;
/** An "at home" idea isn't repeated (by title similarity) for this many weeks. */
export const IDEA_COOLDOWN_WEEKS = 12;
/** Title similarity (stemmed content-word containment) that counts as a repeat. */
export const IDEA_SIMILAR = 0.6;
/** Whole-idea word overlap (title, need, steps; Jaccard) that counts as a repeat. */
export const IDEA_TEXT_SIMILAR = 0.4;
/** The events roundup: at least this many events, or the week is skipped. */
export const EVENTS_MIN = 4;
export const EVENTS_MAX = 8;
/** The roundup is made from kid_events this long before its slot (fresh data). */
export const EVENTS_MAKE_LEAD_MIN = 60;
/** Trigram overlap is checked against this many recent posts. */
export const OVERLAP_POSTS = 8;
/** Share of a post's word trigrams found in one recent post: too close. */
export const OVERLAP_LIMIT = 0.4;
/** Dated items start at least this long after the post goes out. */
export const DATED_LEAD_HOURS = 12;

export const CAPTION_MAX = 2200;
export const HEADLINE_MAX_WORDS = 8;
export const HEADLINE_MIN_WORDS = 4;
export const HASHTAGS = ["#BendOregon", "#CentralOregon", "#BendKids"] as const;
export const MAX_HASHTAGS = 3;

export const SITE = "https://parkroulette.quest";
/** The link-in-bio page, with where the visit came from. */
export function bioLink(from: "ig" | "ig_dm" | "fb"): string {
  return `${SITE}/ig?from=${from}`;
}

/** Fixed copy. Code writes every call to action; the model never does. */
export const COPY = {
  comment: "Comment PARK and we'll DM you the link.",
  bio: "Link in bio.",
  thursday: "Every Thursday: the weekend forecast plus one great plan.",
  free: "Free, from a Bend family.",
  swipe: "Swipe",
  readFree: "Read it free",
  story: "Get this as a text every Friday.",
  storyReply: "Reply PICK",
  storyBio: "Link in bio",
  storyKicker: "Weekend Pick",
  /** Holiday hours that a venue's page doesn't print as one clear span. */
  holidayVaries: "Holiday hours vary, check before you go",
  atHomeKicker: "At home this weekend",
  eventsHeadline: "Family events this week in Central Oregon",
  eventsHighlight: "week",
  eventsDetails: "Details and more at parkroulette.quest/events",
  eventsDetailsLine: "Details and more at",
  eventsUrl: "parkroulette.quest/events",
  eventsFine: "Each event is run by its host. Check times before you go.",
  /** The "at home" caption's save prompt (saves drive reach on idea posts). */
  save: "Save this for the next morning at home.",
  /** Water ideas for kids under 6 (code adds it; the model never has to). */
  waterSafety: "Water play: stay within arm's reach.",
  /** The keyword DM (comments and Story replies): code-written, the same for everyone. */
  dm: `Here's the link: ${bioLink("ig_dm")} Free park picks for Central Oregon kids every Thursday, and the Weekend Pick by text if you want it.`,
} as const;

/**
 * The call to action under a feed post: the DM keyword, or the bio link.
 * Keyword DMs ship off (decision 13), so it's "Link in bio." until a
 * non-role test account has received a private reply.
 */
export function ctaLine(dms: boolean): string {
  return dms ? COPY.comment : COPY.bio;
}

/** The Story's button: "Reply PICK" with DMs on, else "Link in bio". */
export function storyCta(dms: boolean): string {
  return dms ? COPY.storyReply : COPY.storyBio;
}

/** The photo credit, from the catalog photo's own source fields. */
export function photoCredit(p: {
  sourceUrl: string;
  author?: string;
  license?: string;
}): string | null {
  let host = "";
  try {
    host = new URL(p.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (host === "bendparksandrec.org" || host.endsWith(".bendparksandrec.org"))
    return "Photo: Bend Park & Recreation District";
  if (host.endsWith("wikimedia.org") && p.author)
    return `Photo: ${p.author}${p.license ? `, ${p.license}` : ""}, via Wikimedia Commons`;
  return null;
}

/** /ig?from= to the signup source it records (anything else: the bio link). */
const IG_SOURCES = { ig: "ig_bio", ig_dm: "ig_dm", fb: "fb" } as const;
export function igSource(
  from: string | string[] | undefined,
): (typeof IG_SOURCES)[keyof typeof IG_SOURCES] {
  return typeof from === "string" && Object.hasOwn(IG_SOURCES, from)
    ? IG_SOURCES[from as keyof typeof IG_SOURCES]
    : "ig_bio";
}

/** The Blob path of a stored file. */
export function mediaPath(f: { sha: string; ext: string }): string {
  return `social/${f.sha}.${f.ext}`;
}

/** The Monday of the week a date is in (weeks run Monday to Sunday). */
export function mondayOf(date: string): string {
  const wd = weekdayOf(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

/**
 * When a post goes out: its Pacific day and the instant. `week_of` is the
 * Monday; a holiday carousel goes the Sunday before it.
 */
export function slotFor(
  kind: PostKind,
  weekOf: string,
  holiday = false,
): { date: string; publishAt: Date } {
  const s = kind === "unpack" && holiday ? HOLIDAY_UNPACK : SLOTS[kind];
  const date = addDays(weekOf, s.weekday === 0 ? -1 : s.weekday - 1);
  return { date, publishAt: pacificInstant(date, s.hh, s.mm) };
}

// --- What the Sunday routine hands in --------------------------------------

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Slug = z.string().regex(/^[a-z0-9-]+$/, "A park slug from the plan");
const Https = z.url({ protocol: /^https$/, error: "Use an https link" });
const Words = (max: number, min = 1) => z.string().trim().min(min).max(max);
const Hashtags = z
  .array(z.string())
  .max(MAX_HASHTAGS, `At most ${MAX_HASHTAGS} hashtags`)
  .default([...HASHTAGS]);

/** Hand-drawn icons an Unpack item may use (components/icons). */
export const ITEM_ICONS = [
  "playground",
  "slides",
  "swings",
  "climbing",
  "nature",
  "trail",
  "book",
  "ticket",
  "home",
  "mountains",
  "tree",
  "sun",
  "rain",
  "calendar",
  "star",
  "heart",
  "party",
  "trophy",
  "teddy",
  "sparkles",
  "picnic",
  "water_view",
  "splash_pad",
  "sandbox",
  "toddler_area",
] as const;
export type ItemIcon = (typeof ITEM_ICONS)[number];

/**
 * A fact ID: a catalog venue, a kids' event on one of its dates, or a park
 * on our map. Code fills the name, day, ages, cost and town from it.
 */
export const REF =
  /^(venue:venue-[a-z0-9-]+|event:[a-z0-9-]+@\d{4}-\d{2}-\d{2}|park:[a-z0-9-]+)$/;

export const ParkPostDraft = z.strictObject({
  type: z.literal("park_post"),
  /** One of the plan's park candidates (code picked them). */
  park: Slug,
  /** The keyword hook ("Bend playground for little climbers"), 8 words at most. */
  hook: Words(80, 8),
  /** Who it fits. */
  who: Words(140, 8),
  /** What's there (only what the park's record says). */
  what: Words(160, 8),
  /** What to bring. */
  bring: Words(120, 5),
  /** A catalog break, required when any line says school is out. */
  break_id: z.string().optional(),
  hashtags: Hashtags,
});
export type ParkPostDraft = z.infer<typeof ParkPostDraft>;

export const UnpackItem = z.strictObject({
  ref: z.string().regex(REF, "venue:<id>, event:<slug>@<day> or park:<slug>"),
  /** What kids do there, in the model's words (90 characters). */
  what: Words(90, 8),
  icon: z.enum(ITEM_ICONS).optional(),
  /**
   * A venue during a holiday week: the venue's own page printing its
   * holiday hours (checked live). Without it the item is cut.
   */
  holiday_evidence: z
    .strictObject({ url: Https, quote: Words(300, 12) })
    .optional(),
});
export type UnpackItem = z.infer<typeof UnpackItem>;

export const UnpackDraft = z.strictObject({
  type: z.literal("unpack"),
  /** sun: the school-break carousel, the Sunday before (needs break_id). */
  slot: z.enum(["wed", "sun"]).default("wed"),
  /** 4 to 8 words, @nowbam style ("No school this week: 5 warm spots"). */
  headline: Words(70, 10),
  /** The one highlighted word (it must be in the headline). */
  highlight: Words(24),
  break_id: z.string().optional(),
  items: z.array(UnpackItem).min(3).max(5),
  hashtags: Hashtags,
});
export type UnpackDraft = z.infer<typeof UnpackDraft>;

/** Icons an "at home" idea may use (the crayon set, plus the snow glyph). */
export const IDEA_ICONS = [
  "home",
  "crayon",
  "pencil",
  "book",
  "star",
  "heart",
  "party",
  "sparkles",
  "teddy",
  "tree",
  "sun",
  "snow",
  "rain",
  "picnic",
  "splash_pad",
  "trophy",
  "mountains",
] as const;
export type IdeaIcon = (typeof IDEA_ICONS)[number];

export const AtHomeIdea = z.strictObject({
  /** A short name ("Snow paint"), 32 characters at most. */
  title: Words(32, 3),
  /** Who it's for, in whole years ("Ages 2 to 6"). */
  ages: z
    .strictObject({
      from: z.number().int().min(0).max(10),
      to: z.number().int().min(1).max(12),
    })
    .refine((a) => a.to > a.from, "ages.to must be above ages.from"),
  /** Household items only, lowercase words ("spray bottles"). */
  need: z.array(Words(28, 2)).min(1).max(5),
  /** 2 or 3 plain steps. */
  steps: z.array(Words(80, 8)).min(2).max(3),
  icon: z.enum(IDEA_ICONS).optional(),
});
export type AtHomeIdea = z.infer<typeof AtHomeIdea>;

export const AtHomeDraft = z.strictObject({
  type: z.literal("at_home"),
  /** 4 to 8 words ("First snow: 4 cozy things to try"). */
  headline: Words(70, 10),
  highlight: Words(24),
  /** A theme id the plan offers for that Saturday (at_home.themes). */
  theme: z.string().regex(/^[a-z0-9-]+$/),
  break_id: z.string().optional(),
  ideas: z.array(AtHomeIdea).min(3).max(5),
  hashtags: Hashtags,
});
export type AtHomeDraft = z.infer<typeof AtHomeDraft>;

export const PostDraft = z.discriminatedUnion("type", [
  ParkPostDraft,
  UnpackDraft,
  AtHomeDraft,
]);
export type PostDraft = z.infer<typeof PostDraft>;

export const WeekDraft = z.strictObject({
  /** The Monday of the week the posts are for. */
  week_of: Day,
  posts: z.array(PostDraft).min(1).max(3),
});
export type WeekDraft = z.infer<typeof WeekDraft>;

/** The vision check's verdicts, as the routine reports them. */
export const PhotoCheckInput = z.strictObject({
  checks: z
    .array(
      z.strictObject({
        src: Https,
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        verdict: z.enum(["clear", "people", "unsure"]),
        note: Words(200).optional(),
      }),
    )
    .min(1)
    .max(60),
});

// --- What code makes of a post ---------------------------------------------

/**
 * A catalog photo that passed the vision check, pinned to the bytes it
 * saw, with its credit line from the photo's own source fields.
 */
export type PhotoRef = { src: string; sha256: string; credit: string | null };

export type SlideSpec =
  | {
      t: "headline";
      /** The headline as written; `highlight` is one of its words. */
      words: string;
      highlight: string;
      kicker: string;
      swipe: boolean;
      /** The top-right icon (default: the wheel). */
      icon?: string;
      /** Small words under the headline (the roundup's towns), never split. */
      sub?: string[];
    }
  | {
      t: "item";
      n: number;
      of: number;
      icon: ItemIcon;
      name: string;
      what: string;
      /** day • ages • cost • town (code, from the IDs). */
      facts: string[];
    }
  | {
      /** An "at home" idea: name, ages, what you need, 2 or 3 steps. */
      t: "idea";
      n: number;
      of: number;
      icon: IdeaIcon;
      title: string;
      ages: string;
      need: string;
      steps: string[];
      /** Code's safety line (water play), or null. */
      safety: string | null;
    }
  | {
      /** One event of the roundup: every event slide has the same weight. */
      t: "event";
      n: number;
      of: number;
      /** "Sat" and "Nov 28". */
      weekday: string;
      date: string;
      /** "10 am to noon", "Starts 6 pm". */
      time: string;
      title: string;
      venue: string;
      town: string;
      ages: string[];
      cost: string;
      host: string | null;
      /** "Also Thu, Sat" when it repeats in the window. */
      also: string | null;
    }
  | {
      t: "cta";
      line: string;
      cta: string;
      sub: string | null;
      /** A web address on its own line, never broken ("parkroulette.quest/events"). */
      url?: string;
      /** A small line under the sub (the roundup: hosts run the events). */
      fine?: string;
      /** The top icon (default: the envelope). */
      icon?: string;
    }
  | {
      /** Monday's park post: the photo or the crayon card, a taped label. */
      t: "parkcard";
      park: string;
      town: string;
      photo: PhotoRef | null;
    }
  | {
      t: "weather";
      title: string;
      days: {
        label: string;
        condition: string;
        icon: string;
        high: number | null;
        low: number | null;
        precip: number | null;
        missing?: boolean;
      }[];
    }
  | {
      t: "park";
      park: string;
      town: string;
      why: string;
      photo: PhotoRef | null;
    }
  | {
      t: "story";
      park: string;
      town: string;
      days: {
        label: string;
        condition: string;
        icon: string;
        high: number | null;
        low: number | null;
        precip: number | null;
        missing?: boolean;
      }[];
      photo: PhotoRef | null;
      /** "Reply PICK" or "Link in bio". */
      cta: string;
    };

/** The facts a post leans on: re-checked just before it goes out. */
export type PostFacts = {
  parks: string[];
  /** start: the time the post printed (a change redraws or skips it). */
  events: { slug: string; day: string; start?: string }[];
  venues: string[];
  issue: string | null;
  /** An "at home" post's idea titles (the 12-week cooldown). */
  ideas?: string[];
  /** The same ideas' whole text (title, need, steps), in the same order. */
  ideaTexts?: string[];
};

export type PostSpec = {
  kind: PostKind;
  size: "feed" | "story";
  slides: SlideSpec[];
  /** Alt text per slide (each slide's words). Stories carry none. */
  alts: string[];
  /** Instagram caption (null for a Story). */
  caption: string | null;
  /** Facebook: the same post with the live link (Pages have no bio link). */
  fbCaption: string | null;
  headline: string;
  /** Only the model's words (for the overlap check against later posts). */
  modelText: string;
  facts: PostFacts;
};

/** Words in a headline (hyphenated words count once). */
export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
