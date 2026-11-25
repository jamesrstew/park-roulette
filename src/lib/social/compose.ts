import type { ForecastDay, Issue } from "@/lib/news/issue";
import {
  commonBody,
  eventFit,
  ideaFit,
  itemFit,
} from "@/components/social/fit";
import { ideaText } from "./at-home";
import { mentionLines, type Tag, usedTags, withoutMentions } from "./handles";
import { eventsWeekPath, fbLink, PENDING_POST_LINK } from "./links";
import {
  type AtHomeDraft,
  COPY,
  ctaLine,
  HASHTAGS,
  type ItemIcon,
  type ParkPostDraft,
  type PhotoRef,
  type PostFacts,
  type PostSpec,
  type SlideSpec,
  storyCta,
  type UnpackDraft,
} from "./model";

/**
 * Turning a post into slides and a caption. Pure. The model's words go in
 * as written (after the validator grounded them); every fact (name, day,
 * ages, cost, town, address, weather) comes from code, and every call to
 * action is fixed copy.
 */

export type ParkInfo = {
  slug: string;
  name: string;
  city: string;
  address: string | null;
  status: string;
  approved: boolean;
  play: string;
  features: string[];
};

/** One Unpack item as code resolved it from its ID. */
export type ResolvedItem = {
  ref: string;
  name: string;
  what: string;
  icon: ItemIcon;
  /** The item's facts as chips (missing ones left out). */
  facts: string[];
  /** An event's venue line ("At Central Library, Bend"). */
  place?: string;
  /** An event's organizer, when it isn't the venue. */
  host?: string | null;
  /** The venue as a chip, used when the venue line doesn't fit. */
  venueChip?: string;
};

const strip = (s: string) => s.trim().replace(/[\s.:;,!-]+$/u, "");

const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * The Facebook caption: the same words without the Instagram tag lines,
 * with the post's own link in place of "Link in bio." (a Page has no bio
 * link). `path` is where the post
 * leads (lib/social/links.ts): the park, the issue, the week's events, or
 * the pending link that storing the post turns into its own page.
 */
function forFacebook(
  caption: string,
  ctaText: string,
  path: string | null,
): string {
  const link = path ? fbLink(path) : PENDING_POST_LINK;
  // Instagram handles mean nothing on Facebook: the tag lines stay off it.
  return withoutMentions(caption).replace(ctaText, `${COPY.fbDetails} ${link}`);
}

/** A model fragment as a labeled line ("Bring: warm layers"): no end period. */
const fragment = (s: string) => s.trim().replace(/[\s.;,]+$/u, "");

/**
 * A text's sentences, never split after an abbreviation or an initial
 * ("Dr. Seuss", "St. Francis"). Pure; the validator counts them.
 */
export function sentencesOf(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  for (const m of t.matchAll(/[.!?]+(?=\s+["'‘“(]?[A-Z0-9])/g)) {
    const head = t.slice(start, m.index + m[0].length);
    if (
      /(?:\b(?:Dr|Mr|Mrs|Ms|St|Mt|Ft|No|vs|Jr|Sr|Ave|Rd|Blvd)|(?:^|\s)[A-Z])\.$/.test(
        head,
      )
    )
      continue;
    out.push(head.trim());
    start = m.index + m[0].length;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** "a, b and c" (no serial comma, as the rest of our copy). */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const hashtagLine = (tags: readonly string[]) => tags.join(" ");

// --- A. The park post (Monday) ----------------------------------------------

export function composeParkPost(
  d: ParkPostDraft,
  park: ParkInfo,
  photo: PhotoRef | null,
  dms: boolean,
  /** The park's operator, when its handle is verified (handles.ts parkTag). */
  tags: readonly Tag[] = [],
): PostSpec {
  const cta = ctaLine(dms, "park_post");
  const mentions = mentionLines("park_post", tags);
  const story = d.story.replace(/\s+/g, " ").trim();
  const caption = [
    // The story opens the caption: its first sentence names the park and
    // a signature trait (the validator holds it).
    story,
    "",
    `Best for: ${fragment(d.who)}`,
    `Bring: ${fragment(d.bring)}`,
    `Where: ${park.address ?? `${park.name}, ${park.city}, Oregon`}`,
    "",
    // The photo credit stays plain words (Facebook keeps it, and a
    // crayon redraw takes it out); the operator's tag is its own line.
    ...(photo?.credit ? [photo.credit] : []),
    ...mentions,
    COPY.captionClose.park_post,
    cta,
    "",
    hashtagLine(d.hashtags),
  ].join("\n");
  const slide: SlideSpec = {
    t: "parkcard",
    park: park.name,
    town: park.city,
    photo,
  };
  return {
    kind: "park_post",
    size: "feed",
    slides: [slide],
    alts: [slideAlt(slide)],
    caption,
    fbCaption: forFacebook(caption, cta, `/parks/${park.slug}`),
    headline: sentencesOf(story)[0] ?? park.name,
    modelText: [story, d.who, d.bring].join("\n"),
    facts: { parks: [park.slug], events: [], venues: [], issue: null },
    ...tagsField("park_post", tags),
  };
}

// --- B. Unpack carousel (Wednesday) ---------------------------------------

export function composeUnpack(
  d: UnpackDraft,
  items: ResolvedItem[],
  facts: PostFacts,
  dms: boolean,
  /** The items' verified hosts, places and park operators, in item order. */
  tags: readonly Tag[] = [],
): PostSpec {
  const cta = ctaLine(dms, "unpack");
  const headline = d.headline.trim();
  const slides: SlideSpec[] = [
    {
      t: "headline",
      words: headline,
      highlight: d.highlight.trim(),
      kicker: "Central Oregon kids",
      swipe: true,
    },
    ...items.map((it, i): SlideSpec => {
      const base = {
        name: it.name,
        what: it.what.trim(),
        facts: it.facts,
      };
      const where = itemWhere(base, it.place, it.host ?? null);
      return {
        t: "item",
        n: i + 1,
        of: items.length,
        icon: it.icon,
        ref: it.ref,
        ...base,
        // No room for the venue line: the venue goes back in as a chip.
        ...(it.place && !where.place && it.venueChip
          ? { facts: [...base.facts, it.venueChip] }
          : {}),
        ...(where.place
          ? { place: where.place, host: where.host ?? null }
          : {}),
      };
    }),
    {
      t: "cta",
      line: COPY.thursday,
      cta: ctaLine(dms, "unpack", { slide: true }),
      sub: COPY.free,
    },
  ];
  const intro = d.intro?.replace(/\s+/g, " ").trim();
  const caption = [
    headline,
    "",
    ...(intro ? [intro, ""] : []),
    ...items.flatMap((it, i) => [
      `${i + 1}. ${it.name}`,
      sentence(it.what),
      ...(it.place
        ? [`${it.place}${it.host ? `. Hosted by ${it.host}` : ""}.`]
        : []),
      it.facts.join(" · "),
      "",
    ]),
    ...mentionLines("unpack", tags),
    COPY.captionClose.unpack,
    cta,
    "",
    hashtagLine(d.hashtags),
  ].join("\n");
  return {
    kind: "unpack",
    size: "feed",
    slides,
    alts: slides.map(slideAlt),
    caption,
    fbCaption: forFacebook(caption, cta, null),
    headline,
    modelText: [
      headline,
      ...(intro ? [intro] : []),
      ...items.map((i) => i.what),
    ].join("\n"),
    facts,
    ...tagsField("unpack", tags),
  };
}

/** The spec's tags: the ones its caption prints (none: no field). */
function tagsField(kind: PostSpec["kind"], tags: readonly Tag[]) {
  const used = usedTags(kind, tags);
  return used.length ? { tags: used } : {};
}

// --- E. At home (Saturday) -------------------------------------------------

/** "Ages 2 to 6" ("ages 2 to 6" in the caption). */
export function agesLabel(a: { from: number; to: number }): string {
  return a.from === 0 ? `Under ${a.to + 1}` : `Ages ${a.from} to ${a.to}`;
}

const WATER =
  /\b(water|tub|bathtub|sprinklers?|hose|kiddie pool|wading pool|puddles?|buckets? of water|splash\w*)\b/i;

/** Code's safety line for an idea: water play with kids under 6. */
export function ideaSafety(i: AtHomeDraft["ideas"][number]): string | null {
  const text = [i.title, ...i.need, ...i.steps, i.payoff].join(" ");
  return i.ages.from < 6 && WATER.test(text) ? COPY.waterSafety : null;
}

export function composeAtHome(d: AtHomeDraft, dms: boolean): PostSpec {
  const cta = ctaLine(dms, "at_home");
  const headline = d.headline.trim();
  const ideas = d.ideas.map((i) => ({
    ...i,
    title: i.title.trim(),
    need: i.need.map((n) => n.trim()),
    steps: i.steps.map(sentence),
    payoff: sentence(i.payoff),
  }));
  const ideaBody = commonBody(
    ideas.map((i) =>
      ideaFit({
        title: i.title,
        need: i.need.join(", "),
        steps: i.steps,
        payoff: i.payoff,
        safety: ideaSafety(i),
      }),
    ),
  );
  const slides: SlideSpec[] = [
    {
      t: "headline",
      words: headline,
      highlight: d.highlight.trim(),
      kicker: COPY.atHomeKicker,
      swipe: true,
      icon: "home",
    },
    ...ideas.map((i, n): SlideSpec => ({
      t: "idea",
      n: n + 1,
      of: ideas.length,
      icon: i.icon ?? "home",
      title: i.title,
      ages: agesLabel(i.ages),
      need: i.need.join(", "),
      steps: i.steps,
      payoff: i.payoff,
      body: ideaBody,
      safety: ideaSafety(i),
    })),
    { t: "cta", line: COPY.thursday, cta, sub: COPY.free },
  ];
  const intro = d.intro?.replace(/\s+/g, " ").trim();
  const caption = [
    headline,
    "",
    ...(intro ? [intro, ""] : []),
    ...ideas.flatMap((i, n) => [
      `${n + 1}. ${i.title} (${agesLabel(i.ages).toLowerCase()})`,
      `You need ${andList(i.need)}.`,
      ...i.steps.map((s) => `- ${s}`),
      `${COPY.payoffLabel}: ${i.payoff}`,
      ...(ideaSafety(i) ? [ideaSafety(i)!] : []),
      "",
    ]),
    COPY.save,
    COPY.captionClose.at_home,
    cta,
    "",
    hashtagLine(d.hashtags),
  ].join("\n");
  return {
    kind: "at_home",
    size: "feed",
    slides,
    alts: slides.map(slideAlt),
    caption,
    fbCaption: forFacebook(caption, cta, null),
    headline,
    modelText: [
      headline,
      ...(intro ? [intro] : []),
      ...ideas.flatMap((i) => [
        i.title,
        i.need.join(", "),
        ...i.steps,
        i.payoff,
      ]),
    ].join("\n"),
    facts: {
      parks: [],
      events: [],
      venues: [],
      issue: null,
      ideas: ideas.map((i) => i.title),
      ideaTexts: ideas.map(ideaText),
    },
  };
}

// --- F. Family events this week (Tuesday, code only) -----------------------

/**
 * A title as the slide prints it: a spaced dash between two parts reads
 * as a colon ("Pop-Up Exhibits - Sisters" → "Pop-Up Exhibits: Sisters"),
 * or a space after a period ("B.U.R.S.T. - Wonderful Winter!" →
 * "B.U.R.S.T. Wonderful Winter!"), so it never hangs alone at a line's end.
 */
export function slideTitle(title: string): string {
  return title.replace(/\s+[-–—]\s+/, (_m, offset: number) =>
    // Already punctuated ("B.U.R.S.T." or "Story Time:"): a space will do.
    /[.:!?]$/.test(title.slice(0, offset)) ? " " : ": ",
  );
}

/**
 * Where an event is, with its town: "At Fir Street Park, Sisters", or
 * "At Redmond Library" when the venue's name already says the town.
 */
/**
 * An Unpack event item's where and who, when they fit: the host line gives
 * way first, then the venue line, so nothing ever overflows the card.
 */
export function itemWhere(
  base: { name: string; what: string; facts: readonly string[] },
  place: string | undefined,
  host: string | null,
): { place?: string; host?: string | null } {
  if (!place) return {};
  if (itemFit({ ...base, place, host }).fits) return { place, host };
  if (host && itemFit({ ...base, place, host: null }).fits)
    return { place, host: null };
  return {};
}

/**
 * Who runs an event, when that's worth saying: the organizer's name unless
 * it is (or names) the venue itself, or the venue names it ("Central
 * Library" hosted by "Deschutes Public Library" is said; "The Pavilion"
 * hosted by "The Pavilion" isn't). The caller has screened the name
 * (newsletters never get here: validate.ts eventTextProblem).
 */
export function hostOf(
  venue: string,
  organizer: { name: string } | undefined,
): string | null {
  // Trailing punctuation goes: the caption adds its own period ("Foo Inc."
  // must not print "Foo Inc..").
  const host = organizer?.name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,;:!]+$/, "");
  if (!host) return null;
  const a = host.toLowerCase();
  const b = venue.toLowerCase().trim();
  return a === b || b.includes(a) || a.includes(b) ? null : host;
}

export function placeLine(venue: string, town: string): string {
  const named = new RegExp(
    `\\b${town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i",
  );
  return named.test(venue) ? `At ${venue}` : `At ${venue}, ${town}`;
}

/** One roundup event, resolved from kid_events by code. */
export type WeekEvent = {
  slug: string;
  day: string;
  start: string;
  title: string;
  weekday: string;
  date: string;
  time: string;
  venue: string;
  town: string;
  ages: string[];
  /** What kids do there, from the stored `what` (null: no clean short line). */
  desc: string | null;
  /** The printed cost's chip ("Free", "$8 kids"); null when none is printed. */
  cost: string | null;
  host: string | null;
  also: string | null;
  /**
   * The host's verified Instagram account (handles.ts), from its organizer
   * domain; tagged in the Instagram caption only.
   */
  tag?: Tag | null;
};

const NUMBER_WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];
const count = (n: number) => NUMBER_WORDS[n] ?? String(n);

const WEEKDAYS: Record<string, string> = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};

/**
 * The events' printed ages as one clause: "for ages 5 and up" when some
 * chip is open-ended, else the overall range ("for ages 2 to 10"), and
 * nothing when any event is for all ages or a chip doesn't read.
 */
function agesClause(events: Pick<WeekEvent, "ages">[]): string {
  let lo = Infinity;
  let hi = -Infinity;
  let open = false;
  for (const e of events)
    for (const chip of e.ages) {
      const m = /^Ages? (\d+)(?: to (\d+)| (and up))?$/.exec(chip);
      if (!m) return "";
      lo = Math.min(lo, Number(m[1]));
      if (m[3]) open = true;
      else hi = Math.max(hi, Number(m[2] ?? m[1]));
    }
  if (!Number.isFinite(lo)) return "";
  if (open) return `, for ages ${lo} and up`;
  return lo === hi ? `, for age ${lo}` : `, for ages ${lo} to ${hi}`;
}

/**
 * The roundup caption's opening, from the events alone: how many, where
 * (one venue, one town, or the towns, Bend first), the printed ages and
 * how many are free. "Four events, all at TEAL Tea + Art Lounge in Bend,
 * for ages 5 and up." No prices beyond "free": the chips carry them, and
 * an event with no printed cost never reads as free.
 */
export function eventsIntro(
  events: Pick<WeekEvent, "venue" | "town" | "cost" | "ages">[],
): string {
  const n = events.length;
  const venues = [...new Set(events.map((e) => e.venue))];
  const towns = [...new Set(events.map((e) => e.town))].sort(
    (a, b) => Number(b === "Bend") - Number(a === "Bend"),
  );
  // "at Redmond Library" when the venue names its town, else "at X in Bend".
  const at = (v: string, t: string) =>
    placeLine(v, t) === `At ${v}` ? `at ${v}` : `at ${v} in ${t}`;
  const where =
    venues.length === 1 && towns.length === 1 && n > 1
      ? `, all ${at(venues[0], towns[0])}`
      : towns.length === 1
        ? `, all in ${towns[0]}`
        : ` in ${andList(towns)}`;
  const ages = agesClause(events);
  const free = events.filter((e) => e.cost === "Free").length;
  const freeLine =
    free === 0
      ? ""
      : free === n
        ? n === 2
          ? " Both are free."
          : " All are free."
        : ` ${count(free)} ${free === 1 ? "is" : "are"} free.`;
  return `${count(n)} event${n === 1 ? "" : "s"}${where}${ages}.${freeLine}`;
}

/**
 * The roundup's events under day headings ("Wednesday, Dec 2"), one line
 * each: title, time, where (only when the venues differ), what kids do,
 * ages, price, host and repeats. Ends with a blank line.
 */
export function eventsByDay(events: WeekEvent[]): string[] {
  const oneVenue =
    events.length > 1 &&
    new Set(events.map((e) => `${e.venue}|${e.town}`)).size === 1;
  const out: string[] = [];
  let day = "";
  for (const e of events) {
    if (e.day !== day) {
      if (day) out.push("");
      out.push(`${WEEKDAYS[e.weekday] ?? e.weekday}, ${e.date}`);
      day = e.day;
    }
    const where = oneVenue
      ? ""
      : ` ${placeLine(e.venue, e.town).replace(/^At /, "at ")}`;
    out.push(
      [
        `${e.title}, ${e.time.replace(/^Starts /, "starts ")}${where}.`,
        ...(e.desc ? [`${e.desc}.`] : []),
        `${e.ages.join(", ")}.${e.cost ? ` ${e.cost}.` : ""}`,
        ...(e.host ? [`Hosted by ${e.host}.`] : []),
        ...(e.also ? [`${e.also}.`] : []),
      ].join(" "),
    );
  }
  if (out.length) out.push("");
  return out;
}

export function composeEventsWeek(
  events: WeekEvent[],
  range: { label: string; caption: string; firstDay: string },
  dms: boolean,
): PostSpec {
  // The hosts' verified handles, in event order, once each (at most 10).
  const tags = events.map((e) => e.tag ?? null).filter((t): t is Tag => !!t);
  const mentions = mentionLines("events_week", tags);
  const cta = ctaLine(dms, "events_week");
  const headline = COPY.eventsHeadline;
  // One body and one title size for the whole carousel, so its slides
  // read as a set: the largest that fit every slide.
  const copies = events.map((e) => ({
    title: slideTitle(e.title),
    desc: e.desc,
    place: placeLine(e.venue, e.town),
    chips: [...e.ages, ...(e.cost ? [e.cost] : [])],
    host: e.host,
    also: e.also,
  }));
  const eventBody = commonBody(copies.map((c) => eventFit(c)));
  const eventTitle =
    eventBody === undefined
      ? undefined
      : Math.min(...copies.map((c) => eventFit(c, [eventBody]).title));
  const towns = [...new Set(events.map((e) => e.town))].sort(
    (a, b) => Number(b === "Bend") - Number(a === "Bend"),
  );
  const slides: SlideSpec[] = [
    {
      t: "headline",
      words: headline,
      highlight: COPY.eventsHighlight,
      kicker: range.label,
      swipe: true,
      icon: "calendar",
      sub: towns,
    },
    ...events.map((e, i): SlideSpec => ({
      t: "event",
      n: i + 1,
      of: events.length,
      weekday: e.weekday,
      date: e.date,
      time: e.time,
      title: slideTitle(e.title),
      desc: e.desc,
      body: eventBody,
      titleSize: eventTitle,
      venue: e.venue,
      town: e.town,
      ages: e.ages,
      cost: e.cost,
      host: e.host,
      also: e.also,
    })),
    {
      t: "cta",
      line: COPY.eventsDetailsLine,
      url: COPY.eventsUrl,
      sub: COPY.thursday,
      fine: COPY.eventsFine,
      cta,
      icon: "calendar",
    },
  ];
  const caption = [
    `${headline} (${range.caption})`,
    "",
    eventsIntro(events),
    "",
    ...eventsByDay(events),
    COPY.eventsFineCaption,
    "",
    ...(mentions.length ? [...mentions, ""] : []),
    COPY.captionClose.events_week,
    cta,
    "",
    hashtagLine(HASHTAGS),
  ].join("\n");
  return {
    kind: "events_week",
    size: "feed",
    slides,
    alts: slides.map(slideAlt),
    caption,
    fbCaption: forFacebook(caption, cta, eventsWeekPath(range.firstDay)),
    headline,
    modelText: "",
    facts: {
      parks: [],
      events: events.map((e) => ({
        slug: e.slug,
        day: e.day,
        start: e.start,
        ages: e.ages,
        cost: e.cost,
      })),
      venues: [],
      issue: null,
    },
    ...tagsField("events_week", tags),
  };
}

// --- C. Issue teaser (Thursday) and D. Weekend Pick Story (Friday) --------

/** One word or two for the weekend, from the issue's own forecast icon. */
export function weatherWord(icon: string | undefined): string | null {
  const words: Record<string, string> = {
    sun: "Sunshine",
    partly: "Sun and clouds",
    cloudy: "Clouds",
    rain: "Rain",
    snow: "Snow",
    mixed: "Rain and snow",
    storm: "Storms",
    fog: "Fog",
    wind: "Wind",
    smoke: "Smoke",
  };
  return icon ? (words[icon] ?? null) : null;
}

/** The issue's Saturday (else Sunday), with a real forecast. */
function weekendDay(issue: Issue): ForecastDay | null {
  const days = (issue.weekend_ahead?.days ?? []).filter(
    (d) => !d.missing && d.high != null,
  );
  return (
    days.find((d) => d.label === "Saturday") ??
    days.find((d) => d.label === "Sunday") ??
    null
  );
}

const usable = (issue: Issue) =>
  (issue.weekend_ahead?.days ?? []).filter((d) => !d.missing && d.high != null)
    .length >= 2;

/**
 * The teaser and the Story draw the crayon park card: nobody looks at
 * their rendered slides before they go out (review M3), so they never
 * carry a photo.
 */
export function composeTeaser(
  issue: Issue,
  park: ParkInfo,
  dms: boolean,
  /** The featured park's operator, when its handle is verified. */
  tags: readonly Tag[] = [],
): PostSpec {
  const cta = ctaLine(dms, "teaser");
  const word = weatherWord(weekendDay(issue)?.icon);
  const headline = word
    ? `This weekend: ${word} + ${park.name}`
    : `This weekend: ${park.name}`;
  const slides: SlideSpec[] = [
    {
      t: "headline",
      words: headline,
      highlight: word ?? park.name.split(" ")[0],
      kicker: "Bend Playground Passport",
      swipe: true,
    },
    ...(usable(issue)
      ? [
          {
            t: "weather",
            title: "The weekend ahead",
            days: issue.weekend_ahead!.days!.map((d) => ({ ...d })),
          } satisfies SlideSpec,
        ]
      : []),
    {
      t: "park",
      park: park.name,
      town: park.city,
      why: issue.wheel_pick.why_now,
      photo: null,
    },
    { t: "cta", line: COPY.readFree, cta, sub: COPY.thursday },
  ];
  const caption = [
    headline,
    "",
    issue.preview,
    "",
    `This week's pick is ${park.name} in ${park.city}. ${issue.wheel_pick.why_now}`,
    ...mentionLines("teaser", tags),
    "",
    COPY.teaserClose,
    cta,
    "",
    hashtagLine(["#BendOregon", "#CentralOregon", "#BendKids"]),
  ].join("\n");
  return {
    kind: "teaser",
    size: "feed",
    slides,
    alts: slides.map(slideAlt),
    caption,
    fbCaption: forFacebook(caption, cta, `/newsletter/${issue.issue_date}`),
    headline,
    modelText: headline,
    facts: {
      parks: [park.slug],
      events: [],
      venues: [],
      issue: issue.issue_date,
    },
    ...tagsField("teaser", tags),
  };
}

export function composeStory(
  issue: Issue,
  park: ParkInfo,
  dms: boolean,
): PostSpec {
  const days = (issue.weekend_ahead?.days ?? [])
    .filter((d) => d.label === "Saturday" || d.label === "Sunday")
    .map((d) => ({ ...d }));
  return {
    kind: "story",
    size: "story",
    slides: [
      {
        t: "story",
        park: park.name,
        town: park.city,
        days,
        photo: null,
        cta: storyCta(dms),
      },
    ],
    alts: [],
    caption: null,
    fbCaption: null,
    headline: `${COPY.storyKicker}: ${park.name}`,
    modelText: "",
    facts: {
      parks: [park.slug],
      events: [],
      venues: [],
      issue: issue.issue_date,
    },
  };
}

// --- Alt text ---------------------------------------------------------------

function dayWords(d: {
  label: string;
  condition: string;
  high: number | null;
  low: number | null;
  missing?: boolean;
}): string {
  if (d.missing || d.high == null) return `${d.label}: no forecast yet`;
  return `${d.label}: ${d.condition}, high ${d.high}${d.low != null ? `, low ${d.low}` : ""}`;
}

/** Each slide's words, as its alt text. */
export function slideAlt(s: SlideSpec): string {
  switch (s.t) {
    case "headline":
      return `${s.kicker}: ${s.words}.${s.sub?.length ? ` ${s.sub.join(", ")}.` : ""}${s.swipe ? " Swipe for more." : ""}`;
    case "item":
      return `${s.n} of ${s.of}: ${s.name}. ${strip(s.what)}.${s.place ? ` ${s.place}.` : ""}${s.place && s.host ? ` Hosted by ${s.host}.` : ""} ${s.facts.join(", ")}.`;
    case "idea":
      return `${s.n} of ${s.of}: ${s.title}. ${s.ages}. You need: ${s.need}. ${s.steps.map((x, i) => `${i + 1}. ${x}`).join(" ")}${s.payoff ? ` ${COPY.payoffLabel}: ${s.payoff}` : ""}${s.safety ? ` ${s.safety}` : ""}`;
    case "event":
      return `${s.n} of ${s.of}: ${s.title}.${s.desc ? ` ${s.desc}.` : ""} ${s.weekday}, ${s.date}, ${s.time}. At ${s.venue}, ${s.town}. ${s.ages.join(", ")}.${s.cost ? ` ${s.cost}.` : ""}${s.host ? ` Hosted by ${s.host}.` : ""}${s.also ? ` ${s.also}.` : ""}`;
    case "cta":
      return [s.url ? `${s.line} ${s.url}.` : s.line, s.sub, s.fine, s.cta]
        .filter(Boolean)
        .join(" ");
    case "parkcard":
      return s.photo
        ? `${s.park}, ${s.town}, Oregon, on a taped crayon label over a photo of the park.${s.photo.credit ? ` ${s.photo.credit}.` : ""}`
        : `${s.park}, ${s.town}, Oregon, on a taped crayon label over a crayon drawing of a playground.`;
    case "weather":
      return `${s.title}. ${s.days.map(dayWords).join(". ")}.`;
    case "park":
      return `This week's pick: ${s.park}, ${s.town}. ${strip(s.why)}.${s.photo?.credit ? ` ${s.photo.credit}.` : ""}`;
    case "story":
      return `${COPY.storyKicker}: ${s.park}, ${s.town}. ${s.days.map(dayWords).join(". ")}. ${COPY.story} ${s.cta}.`;
  }
}
