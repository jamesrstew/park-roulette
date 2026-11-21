import type { ForecastDay, Issue } from "@/lib/news/issue";
import {
  bioLink,
  COPY,
  ctaLine,
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
};

const strip = (s: string) => s.trim().replace(/[\s.:;,!-]+$/u, "");

/** The Facebook caption: the same words, with the live link (no bio there). */
function forFacebook(caption: string, ctaText: string): string {
  return caption.replace(
    ctaText,
    `Free park picks every Thursday: ${bioLink("fb")}`,
  );
}

const hashtagLine = (tags: readonly string[]) => tags.join(" ");

// --- A. The park post (Monday) ----------------------------------------------

export function composeParkPost(
  d: ParkPostDraft,
  park: ParkInfo,
  photo: PhotoRef | null,
  dms: boolean,
): PostSpec {
  const cta = ctaLine(dms);
  const hook = strip(d.hook);
  const caption = [
    `${hook}: ${park.name}`,
    "",
    d.who.trim(),
    d.what.trim(),
    d.bring.trim(),
    "",
    park.address ?? `${park.name}, ${park.city}, Oregon`,
    ...(photo?.credit ? [photo.credit] : []),
    "",
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
    fbCaption: forFacebook(caption, cta),
    headline: hook,
    modelText: [hook, d.who, d.what, d.bring].join("\n"),
    facts: { parks: [park.slug], events: [], venues: [], issue: null },
  };
}

// --- B. Unpack carousel (Wednesday) ---------------------------------------

export function composeUnpack(
  d: UnpackDraft,
  items: ResolvedItem[],
  facts: PostFacts,
  dms: boolean,
): PostSpec {
  const cta = ctaLine(dms);
  const headline = d.headline.trim();
  const slides: SlideSpec[] = [
    {
      t: "headline",
      words: headline,
      highlight: d.highlight.trim(),
      kicker: "Central Oregon kids",
      swipe: true,
    },
    ...items.map((it, i): SlideSpec => ({
      t: "item",
      n: i + 1,
      of: items.length,
      icon: it.icon,
      name: it.name,
      what: it.what.trim(),
      facts: it.facts,
    })),
    { t: "cta", line: COPY.thursday, cta, sub: COPY.free },
  ];
  const caption = [
    headline,
    "",
    ...items.map(
      (it, i) =>
        `${i + 1}. ${it.name}: ${strip(it.what)} (${it.facts.join(" • ")})`,
    ),
    "",
    COPY.thursday,
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
    fbCaption: forFacebook(caption, cta),
    headline,
    modelText: [headline, ...items.map((i) => i.what)].join("\n"),
    facts,
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
): PostSpec {
  const cta = ctaLine(dms);
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
    `This week's pick: ${park.name}, ${park.city}. ${issue.wheel_pick.why_now}`,
    "",
    `${COPY.readFree}. ${cta}`,
    "",
    hashtagLine(["#BendOregon", "#CentralOregon", "#BendKids"]),
  ].join("\n");
  return {
    kind: "teaser",
    size: "feed",
    slides,
    alts: slides.map(slideAlt),
    caption,
    fbCaption: forFacebook(caption, cta),
    headline,
    modelText: headline,
    facts: {
      parks: [park.slug],
      events: [],
      venues: [],
      issue: issue.issue_date,
    },
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
      return `${s.words}.${s.swipe ? " Swipe for more." : ""}`;
    case "item":
      return `${s.n} of ${s.of}: ${s.name}. ${strip(s.what)}. ${s.facts.join(", ")}.`;
    case "cta":
      return [s.line, s.sub, s.cta].filter(Boolean).join(" ");
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
