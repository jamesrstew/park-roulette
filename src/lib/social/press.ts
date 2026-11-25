import { SITE } from "./model";

/**
 * One-off press posts: the copy, the files and the captions for a post
 * about a news story that covered us. The pictures are drawn once by
 * scripts/render-press.tsx into public/press/ (feed slides and one Story
 * frame per slide) (committed, so Meta can
 * fetch them from parkroulette.quest), and scripts/publish-press.mts posts
 * them. No photos and no publication logos: the outlet is named in text.
 */

export type PressPost = {
  /** File stem under public/press/ ("bulletin-2026-11"). */
  id: string;
  outlet: string;
  /** The day the story ran, as printed ("November 24, 2026"). */
  date: string;
  byline: string;
  /** The story's headline, verbatim. */
  headline: string;
  url: string;
  /** Quotes from the story, verbatim, with who said them. */
  quotes: { text: string; who: string }[];
  /** The feed carousel's alt text, one per slide. */
  feedAlts: string[];
  igCaption: string;
  fbCaption: string;
};

export const BULLETIN_2026_11: PressPost = {
  id: "bulletin-2026-11",
  outlet: "The Bulletin",
  date: "November 24, 2026",
  byline: "Sydney Seymour",
  headline:
    "Can’t pick a park? Bend-built ‘Park Roulette’ lets Central Oregonians spin wheel of 110 options",
  url: "https://bendbulletin.com/2026/11/24/bend-built-park-roulette-lets-central-oregonians-spin-wheel-for-110-local-parks/",
  quotes: [
    {
      text: "We choose parks that we’ve never been to. It’s allowed us to experience and see different parts of our community that we never would have seen otherwise.",
      who: "James Stewart",
    },
    {
      text: "I want other people to experience what we’ve experienced. If it helps other people, that’s really why we made it.",
      who: "James Stewart",
    },
  ],
  feedAlts: [
    "A hand-drawn card that reads: We made the paper. As seen in The Bulletin. A clipping of the November 24, 2026 story by Sydney Seymour: Can’t pick a park? Bend-built ‘Park Roulette’ lets Central Oregonians spin wheel of 110 options.",
    "A hand-drawn card with a quote from James Stewart in The Bulletin: We choose parks that we’ve never been to. It’s allowed us to experience and see different parts of our community that we never would have seen otherwise. Below it: 110 parks across Central Oregon, free. Spin the wheel, link in bio.",
  ],
  igCaption: [
    "This week we made the paper. Sydney Seymour at The Bulletin wrote about Park Roulette, the free park wheel that James Stewart, a Bend dad, built after one too many trips to the same three parks. It started when our usual spot, Harmon Park (the boat park), began renovations and lost its boat.",
    "James told The Bulletin: “We choose parks that we’ve never been to. It’s allowed us to experience and see different parts of our community that we never would have seen otherwise.”",
    "The wheel now covers 110 parks across Central Oregon, from Bend and Redmond to Sunriver, La Pine and Madras. Spin it, find the park on the map, and collect stamps and badges in your family passport. You can filter by distance, splash pads, playgrounds and dog-friendly spots.",
    "Thank you, Sydney Seymour and The Bulletin, for telling our story.",
    "Spin the wheel for free: link in bio.",
    "#BendOregon #CentralOregon #BendKids",
  ].join("\n\n"),
  fbCaption: [
    "This week we made the paper. Sydney Seymour at The Bulletin wrote about Park Roulette, the free park wheel that James Stewart, a Bend dad, built after one too many trips to the same three parks. It started when our usual spot, Harmon Park (the boat park), began renovations and lost its boat.",
    "James told The Bulletin: “I want other people to experience what we’ve experienced. If it helps other people, that’s really why we made it.”",
    "The wheel now covers 110 parks across Central Oregon, from Bend and Redmond to Sunriver, La Pine and Madras. Spin it, find the park on the map, and collect stamps and badges in your family passport.",
    "Thank you, Sydney Seymour and The Bulletin, for telling our story. Read it here:",
    "https://bendbulletin.com/2026/11/24/bend-built-park-roulette-lets-central-oregonians-spin-wheel-for-110-local-parks/",
    `Spin the wheel for free: ${SITE}/?from=fb`,
  ].join("\n\n"),
};

/**
 * The post's files under public/press/: the feed slides, then one Story
 * frame per slide (the same content re-laid out for 9:16), in order.
 */
export function pressFiles(p: PressPost): {
  feed: string[];
  stories: string[];
} {
  return {
    feed: p.feedAlts.map((_, i) => `${p.id}-feed-${i + 1}.jpg`),
    stories: p.feedAlts.map((_, i) => `${p.id}-story-${i + 1}.jpg`),
  };
}

/** A file's public address (Meta fetches it from here). */
export function pressUrl(file: string): string {
  return `${SITE}/press/${file}`;
}
