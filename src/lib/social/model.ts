import { z } from "zod";
import { addDays, pacificInstant, weekdayOf } from "@/lib/news/time";
import type { Tag } from "./handles";

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
 *   Wed  7:45 pm  unpack       the Unpack carousel (@nowbam pattern), every other week
 *   Wed  7:45 pm  mashup       park pairings (code only, lib/social/mashup.ts), the other weeks
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
  "mashup",
] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** The park pairings' themes (lib/social/mashup.ts), in James's first order. */
export const MASHUP_THEMES = [
  "coffee",
  "food_trucks",
  "breweries",
  "treats",
] as const;
export type MashupTheme = (typeof MASHUP_THEMES)[number];

/** The icon a theme's slides use (components/icons). */
export const THEME_ICON: Record<MashupTheme, string> = {
  coffee: "cup",
  food_trucks: "food_truck",
  breweries: "pizza",
  treats: "cupcake",
};

/** The tile and page label for a theme's carousel. */
export const THEME_LABEL: Record<MashupTheme, string> = {
  coffee: "Coffee + park",
  food_trucks: "Food trucks + park",
  breweries: "Brewery + park",
  treats: "Treats + park",
};

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
  // Unpack's slot: the two alternate week by week (mashup.ts mashupParity).
  mashup: { weekday: 3, hh: 19, mm: 45 },
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
/**
 * The park pairings are made from this long before their slot: Wednesday
 * 6 pm Pacific, the first run of the evening window (Places at draft time).
 */
export const MASHUP_MAKE_LEAD_MIN = 105;
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
/**
 * The link-in-bio page (the grid of our posts, with the signup on top),
 * with where the visit came from. Instagram's bio still says /ig, which
 * redirects here.
 */
export function bioLink(from: "ig" | "ig_dm" | "fb"): string {
  return `${SITE}/social?from=${from}`;
}

/** Fixed copy. Code writes every call to action; the model never does. */
export const COPY = {
  /**
   * The Unpack carousel's keyword call to action (Instagram only, DMs on):
   * the caption's, then the slide's shorter one.
   */
  comment:
    "Comment PARK and we'll DM you every link. Follow us first so it reaches you.",
  commentSlide: "Comment PARK and we'll DM you every link.",
  bio: "Link in bio.",
  thursday: "Every Thursday: the weekend forecast plus one great plan.",
  /**
   * The captions' closing line, in our voice (the slides keep `thursday`).
   * One per post type, so it doesn't read the same four days a week.
   */
  captionClose: {
    park_post:
      "Every Thursday we send one park plan for the weekend. It's free.",
    events_week:
      "Every Thursday we send the weekend forecast and one good plan. It's free.",
    unpack: "Our free Thursday email has the weekend forecast and one plan.",
    at_home:
      "When you're ready to get out, our free Thursday email has a plan.",
    mashup:
      "For the weekend, our free Thursday email has the forecast and one plan.",
  },
  /** The park pairings' caption line: we print no hours, so they check. */
  mashupHours: "Hours change with the seasons, so check before you go.",
  mashupKicker: "Park pairings",
  /** The teaser's closing line (it goes out the morning the email does). */
  teaserClose: "The whole plan is in today's email. It's free.",
  /**
   * Facebook has no bio link: the caption's call to action is the post's
   * own destination (lib/social/links.ts), after this.
   */
  fbDetails: "Details and links:",
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
  eventsFine:
    "Each event is run by its host. Check times and prices before you go.",
  /** The label over an idea's payoff, on the slide and in the caption. */
  payoffLabel: "The best part",
  /** The "at home" caption's save prompt (saves drive reach on idea posts). */
  save: "Save this for the next slow morning at home.",
  /** The roundup caption's host line (the slide keeps `eventsFine`). */
  eventsFineCaption:
    "Hosts run these events, so check times and prices before you go. More at parkroulette.quest/events",
  /** Water ideas for kids under 6 (code adds it; the model never has to). */
  waterSafety: "Water play: stay within arm's reach.",
  /** The keyword DM (comments and Story replies): code-written, the same for everyone. */
  /** The keyword DM with no post to point at (a Story reply): the grid. */
  dm: dmText(bioLink("ig_dm")),
} as const;

/**
 * The call to action under a feed post. "Comment PARK" goes only on the
 * Wednesday carousel (the Unpack, or the park pairings in its place), and
 * only with keyword DMs on (James, Nov 23); every other post says "Link in
 * bio." `slide`: the slide's shorter words.
 */
export function ctaLine(
  dms: boolean,
  kind: PostKind,
  { slide = false }: { slide?: boolean } = {},
): string {
  if (!dms || (kind !== "unpack" && kind !== "mashup")) return COPY.bio;
  return slide ? COPY.commentSlide : COPY.comment;
}

/**
 * The keyword DM: one short, code-written message, the same for everyone,
 * with the commented post's own destination (lib/social/links.ts dmLink).
 */
export function dmText(url: string): string {
  // The link last, on its own line: no period stuck to the end of it.
  return `Here are the links from that post. New park picks every Thursday, free.\n${url}`;
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

export { carryFrom, igSource, igSourceOrNull, type IgSource } from "./sources";

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

/** The park post's story: its first sentence shows before "more". */
export const STORY_LIMITS = {
  min: 90,
  max: 420,
  /** The first sentence (Instagram shows about 125 characters). */
  first: 130,
  minSentences: 2,
  sentences: 4,
} as const;
/** No sentence of a story or an intro runs longer than this. */
export const SENTENCE_MAX_WORDS = 22;
/** A carousel's intro line(s), above the items. */
export const INTRO_MAX = 200;

export const ParkPostDraft = z.strictObject({
  type: z.literal("park_post"),
  /** One of the plan's park candidates (code picked them). */
  park: Slug,
  /**
   * The narrative opening: 2 to 4 short sentences. The first names the
   * park and a signature trait ("This week we're featuring Compass Park in
   * NorthWest Crossing, where kids build their own forts."); the rest is a
   * small scene and what else is there (only what the record says).
   */
  story: Words(STORY_LIMITS.max, STORY_LIMITS.min),
  /** Who it fits, a fragment ("Best for: ..."). */
  who: Words(120, 8),
  /** What to bring, a fragment ("Bring: ..."). */
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
  /** 1 or 2 short sentences setting the week, above the items (caption only). */
  intro: Words(INTRO_MAX, 20).optional(),
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

/**
 * Copy limits for an idea slide, set so the longest allowed idea fits the
 * 4:5 card at the larger body type (types.test.ts renders the worst case).
 */
export const IDEA_LIMITS = {
  title: 24,
  needItem: 22,
  needItems: 4,
  /** "spray bottles, water, food coloring": the joined line. */
  needLine: 44,
  step: 52,
  /** All the steps together (3 steps: about 34 characters each). */
  steps: 104,
  payoff: 52,
} as const;

/** The idea limits in words, for the plan the routine reads (one source of truth). */
export function ideaLimitsText(): string {
  const L = IDEA_LIMITS;
  return `each a short title (${L.title} characters at most), ages {from, to}, need (1 to ${L.needItems} lowercase household items, ${L.needItem} characters each and ${L.needLine} together), 2 or 3 plain steps (8 to ${L.step} characters each, ${L.steps} all together), and a payoff (12 to ${L.payoff} characters)`;
}

export const AtHomeIdea = z.strictObject({
  /** A short name ("Snow paint"), 24 characters at most. */
  title: Words(IDEA_LIMITS.title, 3),
  /** Who it's for, in whole years ("Ages 2 to 6"). */
  ages: z
    .strictObject({
      from: z.number().int().min(0).max(10),
      to: z.number().int().min(1).max(12),
    })
    .refine((a) => a.to > a.from, "ages.to must be above ages.from"),
  /** Household items only, lowercase words ("spray bottles"). */
  need: z
    .array(Words(IDEA_LIMITS.needItem, 2))
    .min(1)
    .max(IDEA_LIMITS.needItems)
    .refine(
      (n) => n.join(", ").length <= IDEA_LIMITS.needLine,
      `need: ${IDEA_LIMITS.needLine} characters at most, all items together`,
    ),
  /** 2 or 3 plain steps. */
  steps: z
    .array(Words(IDEA_LIMITS.step, 8))
    .min(2)
    .max(3)
    .refine(
      (st) => st.join("").length <= IDEA_LIMITS.steps,
      `steps: ${IDEA_LIMITS.steps} characters at most, all steps together`,
    ),
  /**
   * The payoff: what the kid ends up with, or the moment it pays off ("Hang
   * it in a sunny window and watch the colors glow", "Now race them down
   * the hallway"). Not another step, and never a bare "Have fun!".
   */
  payoff: Words(IDEA_LIMITS.payoff, 12),
  icon: z.enum(IDEA_ICONS).optional(),
});
export type AtHomeIdea = z.infer<typeof AtHomeIdea>;

export const AtHomeDraft = z.strictObject({
  type: z.literal("at_home"),
  /** 4 to 8 words ("First snow: 4 cozy things to try"). */
  headline: Words(70, 10),
  highlight: Words(24),
  /** 1 or 2 short sentences setting the morning, above the ideas (caption only). */
  intro: Words(INTRO_MAX, 20).optional(),
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
      /** Park pairings: the icon, "+", and the playground. */
      pairIcon?: boolean;
      /** Small words under the headline (the roundup's towns), never split. */
      sub?: string[];
    }
  | {
      t: "item";
      n: number;
      of: number;
      icon: ItemIcon;
      /** The item's fact ID (venue:, event:<slug>@<day>, park:), for its links. */
      ref?: string;
      name: string;
      what: string;
      /**
       * Chips, from the IDs: an event's day, ages and cost (its venue too,
       * only when the venue line doesn't fit); a venue's days, ages, cost
       * and town; a park's features and town.
       */
      facts: string[];
      /**
       * An event item's where and who, as the roundup prints them: "At
       * Central Library, Bend", and the organizer when it isn't the venue.
       */
      place?: string;
      host?: string | null;
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
      /**
       * The ending: what the kid ends up with, or the moment it pays off.
       * Optional: posts queued before it existed have none.
       */
      payoff?: string;
      /** Body type for every idea slide of the post (fit.ts), px. */
      body?: number;
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
      /**
       * What kids do there: the event's checked `short`, else the whole
       * first sentence of its `what` (70 characters at most), else none.
       */
      desc: string | null;
      /** Body type for every event slide of the post (fit.ts), px. */
      body?: number;
      /** Title type for every event slide of the post (fit.ts), px. */
      titleSize?: number;
      venue: string;
      town: string;
      ages: string[];
      /** Null when the page prints no cost: no price chip. */
      cost: string | null;
      host: string | null;
      /** "Also Thu, Sat" when it repeats in the window. */
      also: string | null;
    }
  | {
      /**
       * One park pairing (mashup.ts): a place and a vetted park, how far
       * apart, the place's details Google marks true, and the park's own
       * trait. Our words only; no rating, hours or Google text.
       */
      t: "pair";
      n: number;
      of: number;
      /** The theme's icon (cup, food_truck, picnic, cupcake). */
      icon: string;
      place: string;
      park: string;
      town: string;
      /** "6-minute walk" or "Short drive". */
      apart: string;
      walk: boolean;
      /** "Kids' menu", "Patio", "Good for kids" (from Places, at draft time). */
      chips: string[];
      /** The park's lead in-season trait, as park-profiles has it. */
      trait: string;
      /** For the post page's links: Google's place id and our park. */
      placeId: string;
      parkSlug: string;
      /** The place's verified site (data/ig-handles.json), or null. */
      site?: string | null;
      /** Name type for every pair slide of the post (fit.ts), px. */
      nameSize?: number;
      /** The trait line's type for every pair slide of the post, px. */
      body?: number;
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
  /**
   * start: the time the post printed; ages and cost: the chips it printed
   * (null: no price shown). A change redraws or skips it.
   */
  events: {
    slug: string;
    day: string;
    start?: string;
    ages?: string[];
    cost?: string | null;
  }[];
  venues: string[];
  issue: string | null;
  /** An "at home" post's idea titles (the 12-week cooldown). */
  ideas?: string[];
  /** The same ideas' whole text (title, need, steps), in the same order. */
  ideaTexts?: string[];
  /**
   * Park pairings: the theme, its rotation cycle and each pair (Google's
   * place id, which may be kept, and our park), for the no-repeat rule.
   */
  mashup?: {
    theme: string;
    cycle: number;
    pairs: { placeId: string; park: string }[];
  };
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
  /**
   * The verified accounts the caption tags (lib/social/handles.ts),
   * checked again right before it goes out. Instagram only.
   */
  tags?: Tag[];
};

/** Words in a headline (hyphenated words count once). */
export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// --- The Story echo (lib/social/echo.ts) -----------------------------------

/** A feed post older than this (since it went out) gets no Story echo. */
export const ECHO_MAX_AGE_MIN = 6 * 60;
