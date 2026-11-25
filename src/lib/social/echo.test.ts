import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  EVENT,
  eventFit,
  IDEA,
  ideaFit,
  STORY_CONTENT,
} from "@/components/social/fit";
import { FRAME, slideSize, storySizes } from "@/components/social/Slides";
import { placeLine } from "./compose";
import type { PhotoVerdicts } from "./links";
import { FEED, STORY, type PostSpec, type SlideSpec } from "./model";

// echo.ts reads the database; these tests only use its pure helpers.
vi.mock("@/db", () => ({ db: {} }));

/** Instagram draws its own UI over about this much of a Story's top and bottom. */
const BAND = 250;

const photo = {
  src: "https://www.bendparksandrec.org/x.jpg",
  sha256: "a".repeat(64),
  credit: "Photo: Bend Park & Recreation District",
};
const day = {
  label: "Saturday",
  condition: "Sunny",
  icon: "sun",
  high: 44,
  low: 21,
  precip: null,
};
const event = (n: number, title: string): SlideSpec => ({
  t: "event",
  n,
  of: 2,
  weekday: "Sat",
  date: "Nov 28",
  time: "10 am to noon",
  title,
  desc: "Kids make handmade presents and decorate wrapping paper",
  body: 56,
  titleSize: 80,
  venue: "Redmond Public Library Community Room",
  town: "Redmond",
  ages: ["Ages 5 to 10"],
  cost: "Free",
  host: "Deschutes Public Library",
  also: "Also Sun",
});
const idea = (n: number): SlideSpec => ({
  t: "idea",
  n,
  of: 2,
  icon: "snow",
  title: "Snow paint",
  ages: "Ages 2 to 8",
  need: "spray bottles, water, food coloring",
  steps: [
    "Fill each bottle with water and food coloring.",
    "Spray stripes and letters on clean snow.",
  ],
  payoff: "Watch the whole yard turn into a rainbow.",
  body: 52,
  safety: "Water play: stay within arm's reach.",
});

/** One slide of every kind a feed post can have. */
const EVERY: SlideSpec[] = [
  {
    t: "headline",
    words: "No school this week: 5 warm spots",
    highlight: "warm",
    kicker: "Central Oregon kids",
    swipe: true,
  },
  {
    t: "item",
    n: 1,
    of: 5,
    icon: "splash_pad",
    name: "Juniper Swim & Fitness Center",
    what: "Rec swim in the warm pool, with a slide for bigger kids.",
    facts: ["Open daily", "All ages", "Under $10", "Bend"],
  },
  idea(1),
  event(1, "Creativebug Workshop: DIY Gifts, Wrapping Paper and Cards"),
  {
    t: "cta",
    line: "Every Thursday: the weekend forecast plus one great plan.",
    cta: "Comment PARK and we'll DM you every link.",
    sub: "Free, from a Bend family.",
  },
  { t: "weather", title: "The weekend ahead", days: [day, day, day] },
  {
    t: "park",
    park: "Harvest Park",
    town: "Bend",
    why: "The morning sun hits the slides first.",
    photo,
  },
  { t: "parkcard", park: "Harvest Park", town: "Bend", photo },
];

describe("Story echo frames: layout", () => {
  it("every slide kind draws at 9:16 as a Story frame, and feed slides stay 4:5", () => {
    for (const s of EVERY) {
      expect(slideSize(s, "story")).toEqual({ ...STORY });
      expect(slideSize(s)).toEqual({ ...FEED });
    }
  });

  it("keeps the card's words and footer clear of Instagram's top and bottom bands", () => {
    const f = FRAME.story;
    expect(f.height).toBe(1920);
    // The words start below the top band, with air.
    expect(f.content.top).toBeGreaterThanOrEqual(BAND + 30);
    // The content box is the one fit.ts sizes type for.
    expect(f.height - f.content.top - f.content.bottom).toBe(
      STORY_CONTENT.height,
    );
    // The footer (the 64 px wheel and "Park Roulette") ends above the bottom band.
    expect(f.height - f.foot).toBeLessThanOrEqual(f.height - BAND - 30);
    // The content box ends above the footer.
    expect(f.height - f.content.bottom).toBeLessThanOrEqual(
      f.height - f.foot - 64 - 20,
    );
    // Taller than the feed card: the Story fills its frame.
    expect(STORY_CONTENT.height).toBeGreaterThan(
      FRAME.feed.height - FRAME.feed.content.top - FRAME.feed.content.bottom,
    );
  });

  it("sizes a carousel's type once for all its frames, never smaller than the feed's, and it fits", () => {
    const slides = [
      idea(1),
      idea(2),
      event(1, "Family Skate"),
      event(2, "Creativebug Workshop: DIY Gifts, Wrapping Paper and Cards"),
    ];
    const out = storySizes(slides);
    const ideas = out.flatMap((s) => (s.t === "idea" ? [s] : []));
    const events = out.flatMap((s) => (s.t === "event" ? [s] : []));
    expect(new Set(ideas.map((s) => s.body)).size).toBe(1);
    expect(new Set(events.map((s) => s.body)).size).toBe(1);
    expect(new Set(events.map((s) => s.titleSize)).size).toBe(1);
    for (const s of ideas) {
      expect(s.body!).toBeGreaterThanOrEqual(52);
      expect(
        ideaFit(
          { ...s, payoff: s.payoff ?? "" },
          [s.body!],
          STORY_CONTENT.height,
        ).fits,
      ).toBe(true);
    }
    for (const s of events) {
      expect(s.body!).toBeGreaterThanOrEqual(56);
      expect(s.titleSize!).toBeGreaterThanOrEqual(80);
      expect(
        eventFit(
          {
            title: s.title,
            desc: s.desc,
            place: placeLine(s.venue, s.town),
            chips: [...s.ages, ...(s.cost ? [s.cost] : [])],
            host: s.host,
            also: s.also,
          },
          [s.body!],
          [s.titleSize!],
          STORY_CONTENT.height,
        ).fits,
      ).toBe(true);
    }
    // The feed's own sizes are untouched.
    expect(slides[0]).toMatchObject({ body: 52 });
    expect(IDEA.body).toContain(52);
    expect(EVENT.body).toContain(56);
    // Other slides pass through as they are.
    expect(storySizes(EVERY.slice(0, 2))).toEqual(EVERY.slice(0, 2));
  });

  it("draws every kind at 1080 x 1920 with the bands above and below the card left bare", async () => {
    const { slidePng } = await import("./render");
    for (const [i, s] of EVERY.entries()) {
      const png = await slidePng(EVERY, i, null, "story");
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height]).toEqual([1080, 1920]);
      if (s.t === "parkcard") continue; // its picture runs to the top edge
      // Nothing but paper above the card (its top edge is at 210) and
      // below it (its bottom edge and shadow end by 1724).
      for (const [top, height] of [
        [0, 200],
        [1730, 190],
      ]) {
        // stats() reads its input: cut the band out first.
        const band = await sharp(png)
          .extract({ left: 0, top, width: 1080, height })
          .png()
          .toBuffer();
        const stats = await sharp(band).stats();
        for (const c of stats.channels.slice(0, 3))
          expect(c.max - c.min, `${s.t} rows ${top}+`).toBeLessThanOrEqual(2);
      }
    }
  }, 60_000);
});

describe("Story echo frames: which photo each frame draws", () => {
  const spec = (slides: SlideSpec[]) =>
    ({ kind: "park_post", slides }) as unknown as PostSpec;
  const verdicts = (
    clear: string[],
    flagged: string[] = [],
  ): PhotoVerdicts => ({
    clear: new Set(clear),
    flagged: new Set(flagged),
  });

  it("draws the photo only while it is clear on its exact bytes and never flagged", async () => {
    const { framePhoto } = await import("./echo");
    const s = spec([EVERY[7], EVERY[0]]);
    const ok = `${photo.src} ${photo.sha256}`;
    expect(framePhoto(s, 0, verdicts([ok]))).toEqual(photo);
    // No look yet, or a look at other bytes: the crayon card.
    expect(framePhoto(s, 0, verdicts([]))).toBeNull();
    expect(
      framePhoto(s, 0, verdicts([`${photo.src} ${"b".repeat(64)}`])),
    ).toBeNull();
    // Flagged since (any bytes): never upgraded back.
    expect(framePhoto(s, 0, verdicts([ok], [photo.src]))).toBeNull();
    // A slide with no photo, and a post that fell back to the crayon card.
    expect(framePhoto(s, 1, verdicts([ok]))).toBeNull();
    const crayon = { ...EVERY[7], photo: null } as SlideSpec;
    expect(framePhoto(spec([crayon]), 0, verdicts([ok]))).toBeNull();
  });

  it("reads frames as stored, and an echo from before frames as its one frame", async () => {
    const { framesOf } = await import("./echo");
    const stored = [
      {
        slide: 0,
        sha: "c".repeat(64),
        ext: "jpg" as const,
        width: 1080,
        height: 1920,
        photo: null,
        status: "published" as const,
        containerId: "C1",
        mediaId: "M1",
      },
    ];
    const got = framesOf({
      spec: spec([EVERY[7]]),
      echoFrames: stored,
      echoMedia: null,
      echoContainerId: null,
    });
    expect(got).toEqual(stored);
    got[0].status = "skipped";
    expect(stored[0].status).toBe("published"); // a copy
    const legacy = (photoFree: boolean) =>
      framesOf({
        spec: spec([EVERY[7]]),
        echoFrames: null,
        echoMedia: {
          sha: "e".repeat(64),
          ext: "jpg",
          width: 1080,
          height: 1920,
          photoFree,
        },
        echoContainerId: "C9",
      });
    expect(legacy(false)).toEqual([
      {
        slide: 0,
        sha: "e".repeat(64),
        ext: "jpg",
        width: 1080,
        height: 1920,
        photo: { src: photo.src, sha256: photo.sha256 },
        status: "pending",
        containerId: "C9",
        mediaId: null,
      },
    ]);
    expect(legacy(true)[0].photo).toBeNull();
    expect(
      framesOf({
        spec: spec([]),
        echoFrames: null,
        echoMedia: null,
        echoContainerId: null,
      }),
    ).toEqual([]);
  });
});
