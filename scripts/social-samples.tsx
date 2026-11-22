/**
 * Render sample Instagram slides of every post type to a folder, for
 * design review (no database, no Meta). Photos are fetched from BPRD and
 * used only when their sha256 matches the one given here, as in production.
 *
 *   pnpm exec tsx --conditions react-server scripts/social-samples.tsx <out-dir>
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Issue } from "../src/lib/news/issue";
import { ageTags } from "../src/lib/events/ages";
import type { EventRow } from "../src/lib/events/model";
import {
  composeEventsWeek,
  composeParkPost,
  composeStory,
  composeTeaser,
  composeUnpack,
  type ParkInfo,
} from "../src/lib/social/compose";
import { AtHomeDraft, slotFor } from "../src/lib/social/model";
import { CATALOG } from "../src/lib/news/catalog";
import { validateAtHome } from "../src/lib/social/validate";
import { photosFor, renderPost } from "../src/lib/social/render";
import { pickWeekEvents, roundupWindow } from "../src/lib/social/roundup";

const out = process.argv[2] ?? "/tmp/social-samples";
/** Optional: only these posts ("at_home,events_week"). */
const only = process.argv[3]?.split(",");

/** A sample kids' event, as kid_events stores it (sample data, not real listings). */
function sampleEvent(e: {
  slug: string;
  title: string;
  day: string;
  start: string;
  end?: string;
  more?: string[];
  venue: string;
  town: string;
  ages: string | null;
  cost: { text: string; free?: boolean; kids?: number } | null;
  host?: string;
  kids?: boolean;
}): EventRow {
  const ages = ageTags(e.ages);
  return {
    id: 1,
    slug: e.slug,
    kind: "series",
    status: "scheduled",
    confirm: "ok",
    lastSeenAt: null,
    factsChangedAt: new Date(),
    stateChangedAt: null,
    data: {
      title: e.title,
      dates: [e.day, ...(e.more ?? [])].map((day) => ({
        day,
        start: e.start,
        ...(e.end ? { end: e.end } : {}),
      })),
      venue: { name: e.venue, town: e.town },
      ...(e.cost
        ? {
            cost: {
              text: e.cost.text,
              free: !!e.cost.free,
              prices: e.cost.kids
                ? [{ label: "kids", amount: e.cost.kids }]
                : [],
            },
          }
        : {}),
      ...(e.ages ? { ages_text: e.ages } : {}),
      ages: e.kids === false ? { tags: [], kids: false, range: null } : ages,
      what: "A sample event for the design review, not a real listing.",
      url: "https://example.org/event",
      ...(e.host
        ? { organizer: { name: e.host, url: "https://example.org" } }
        : {}),
      evidence: [
        { url: "https://example.org/event", quote: "sample quote here" },
      ],
      point: null,
      checkQuote: "sample",
    },
  };
}

const SAMPLE_EVENTS: EventRow[] = [
  sampleEvent({
    slug: "baby-storytime-east-bend",
    title: "Baby Storytime",
    day: "2026-11-25",
    start: "10:00",
    end: "10:30",
    venue: "East Bend Library",
    town: "Bend",
    ages: "Ages 0 to 2",
    cost: { text: "Free", free: true },
    host: "Deschutes Public Library",
  }),
  sampleEvent({
    slug: "toddler-storytime-downtown-bend",
    title: "Toddler Storytime",
    day: "2026-11-25",
    start: "10:30",
    end: "11:00",
    venue: "Downtown Bend Library",
    town: "Bend",
    ages: "Ages 1 to 3",
    cost: { text: "Free", free: true },
    host: "Deschutes Public Library",
  }),
  sampleEvent({
    slug: "no-school-open-rec-swim-madras",
    title: "No School Open Rec Swim",
    day: "2026-11-25",
    start: "13:00",
    end: "15:00",
    venue: "Madras Aquatic Center",
    town: "Madras",
    ages: "All ages",
    cost: { text: "$4 kids", kids: 4 },
  }),
  sampleEvent({
    slug: "family-skate-pavilion",
    title: "Family Skate",
    day: "2026-11-27",
    start: "13:00",
    end: "15:00",
    more: ["2026-11-28", "2026-11-29"],
    venue: "The Pavilion",
    town: "Bend",
    ages: "All ages",
    cost: { text: "$8 kids", kids: 8 },
    host: "Bend Park & Recreation District",
  }),
  sampleEvent({
    slug: "sisters-tree-lighting",
    title: "Holiday Tree Lighting",
    day: "2026-11-27",
    start: "17:00",
    venue: "Fir Street Park",
    town: "Sisters",
    ages: "All ages",
    cost: { text: "Free", free: true },
    host: "Sisters Area Chamber of Commerce",
  }),
  sampleEvent({
    slug: "kids-craft-saturday-la-pine",
    title: "Kids Craft Saturday",
    day: "2026-11-28",
    start: "10:00",
    end: "11:00",
    venue: "La Pine Library",
    town: "La Pine",
    ages: "Ages 3 to 8",
    cost: { text: "Free", free: true },
    host: "Deschutes Public Library",
  }),
  sampleEvent({
    slug: "build-it-club-redmond",
    title: "Build It Club",
    day: "2026-11-28",
    start: "11:00",
    end: "12:00",
    venue: "Redmond Library",
    town: "Redmond",
    ages: "Ages 5 to 10",
    cost: { text: "Free", free: true },
    host: "Deschutes Public Library",
  }),
  sampleEvent({
    slug: "winter-wildlife-walk",
    title: "Winter Wildlife Walk for Families",
    day: "2026-11-29",
    start: "11:00",
    venue: "High Desert Museum",
    town: "Bend",
    ages: "Ages 6 and up",
    cost: { text: "$15 kids", kids: 15 },
  }),
  sampleEvent({
    slug: "family-movie-prineville",
    title: "Family Movie Afternoon",
    day: "2026-11-30",
    start: "15:30",
    end: "17:30",
    venue: "Crook County Library",
    town: "Prineville",
    ages: "All ages",
    cost: { text: "Free", free: true },
    host: "Crook County Library",
  }),
  // Left out: outside the window, no printed ages, not a kids' event.
  sampleEvent({
    slug: "preschool-science-sunriver",
    title: "Preschool Science",
    day: "2026-12-01",
    start: "10:00",
    venue: "Sunriver Nature Center",
    town: "Sunriver",
    ages: "Ages 3 to 5",
    cost: { text: "$5", kids: 5 },
  }),
  sampleEvent({
    slug: "holiday-market-bend",
    title: "Holiday Market",
    day: "2026-11-28",
    start: "10:00",
    venue: "Old Mill",
    town: "Bend",
    ages: null,
    cost: { text: "Free", free: true },
  }),
  sampleEvent({
    slug: "teen-night-redmond",
    title: "Teen Night",
    day: "2026-11-27",
    start: "18:00",
    venue: "Redmond Library",
    town: "Redmond",
    ages: "Ages 13 to 18",
    cost: { text: "Free", free: true },
    kids: false,
  }),
];

/**
 * The worst case the roundup can meet: long titles, the longest short
 * lines, long venues and hosts, a week of repeats and a price range, on
 * every slide.
 */
function worstSample() {
  const long = [
    [
      "Winter Wildlife Walk for Families with the Naturalists",
      "Families follow a naturalist on a snowy trail to spot animal tracks",
      "Deschutes Public Library, Downtown Bend Branch",
      "Bend",
      "Bend Park & Recreation District Youth Programs",
    ],
    [
      "Hydro Dipping Ornaments and Cards Playshop for Families",
      "Kids and a grown-up dip ornaments and cards into swirly floating paint",
      "TEAL Tea + Art Lounge",
      "Bend",
      "Tea, Explore and Art Learning Studio Collective",
    ],
    [
      "Gingerbread Junction: A Holiday House Tour for Families",
      "Kids wander a room full of gingerbread houses built by local families",
      "High Desert Museum Brooks Hall",
      "Bend",
      "Central Oregon Builders Association Foundation",
    ],
    [
      "Creativebug Workshop: DIY Gifts, Wrapping Paper and Cards",
      "Kids make handmade presents, decorate wrapping paper and craft cards",
      "Redmond Public Library Community Room",
      "Redmond",
      "Deschutes Public Library Youth Services Team",
    ],
  ];
  const rows = long.map(([title, , venue, town, host], i) =>
    sampleEvent({
      slug: `worst-${i}`,
      title,
      day: `2026-11-2${5 + i}`,
      start: "13:15",
      end: "14:45",
      more: ["2026-11-28", "2026-11-29", "2026-11-30"].filter(
        (d) => d > `2026-11-2${5 + i}`,
      ),
      venue,
      town,
      ages: "Ages 10 to 18",
      cost: { text: "$12.50 to $20 kids", kids: 12.5 },
      host,
    }),
  );
  rows.forEach((r, i) => {
    r.data.short = long[i][1];
    r.data.what = `${long[i][1]}.`;
    r.data.cost = {
      text: "$12.50 to $20 kids",
      free: false,
      prices: [
        { label: "kids", amount: 12.5 },
        { label: "kids", amount: 20 },
      ],
    };
  });
  const tue = slotFor("events_week", "2026-11-23");
  const w = roundupWindow(tue.date, tue.publishAt);
  const now = new Date(tue.publishAt.getTime() - 45 * 60_000);
  const pick = pickWeekEvents(rows, w, now);
  console.log("worst case left out:", pick.left.join("; ") || "(none)");
  return composeEventsWeek(pick.events, w, false);
}

function roundupSample() {
  const tue = slotFor("events_week", "2026-11-23");
  const w = roundupWindow(tue.date, tue.publishAt);
  const now = new Date(tue.publishAt.getTime() - 45 * 60_000);
  const pick = pickWeekEvents(SAMPLE_EVENTS, w, now);
  console.log("roundup left out:", pick.left.join("; ") || "(none)");
  return composeEventsWeek(pick.events, w, false);
}

const larkspur: ParkInfo = {
  slug: "larkspur-park-bend",
  name: "Larkspur Park",
  city: "Bend",
  address: "1600 SE Reed Market Rd, Bend, OR 97701",
  status: "active",
  approved: true,
  play: "playground",
  features: ["accessible", "shade", "picnic", "trail"],
};
const harvest: ParkInfo = {
  slug: "harvest-park-bend",
  name: "Harvest Park",
  city: "Bend",
  address: "63240 NW Lavacrest St, Bend, OR 97703",
  status: "active",
  approved: true,
  play: "playground",
  features: ["shade", "picnic"],
};
/** Looked at for this sample: a playground, no person visible. */
const harvestPhoto = {
  src: "https://www.bendparksandrec.org/wp-content/uploads/2015/05/Harvest-Park-11-1024x685.jpg",
  sha256: "5af5895fc4b874a1caa00e2a8d97bd4c5a68f9ea177ced301b8c68499f25c941",
  credit: "Photo: Bend Park & Recreation District",
};

const issue: Issue = {
  issue_date: "2026-11-26",
  subject: "A cold, sunny weekend",
  preview:
    "Bundle up: Saturday is clear and crisp, and Harvest Park gets the sun first.",
  hello: {
    text: "Happy Thanksgiving! A short one this week so you can get back to the pie.",
  },
  weekend_ahead: {
    days: [
      {
        date: "2026-11-27",
        label: "Friday",
        condition: "Mostly sunny",
        icon: "sun",
        high: 41,
        low: 19,
        precip: null,
      },
      {
        date: "2026-11-28",
        label: "Saturday",
        condition: "Sunny",
        icon: "sun",
        high: 44,
        low: 21,
        precip: null,
      },
      {
        date: "2026-11-29",
        label: "Sunday",
        condition: "Snow showers",
        icon: "snow",
        high: 36,
        low: 22,
        precip: 40,
      },
    ],
  },
  wheel_pick: {
    park: "harvest-park-bend",
    why_now:
      "The morning sun hits the slides first, and the paths stay dry after a frost.",
    who_for: "Ages 2 to 10.",
    bring: "Mittens and a thermos.",
  },
  passport: { challenge_id: "challenge-snow-stamp", text: "Stamp it." },
  signoff: { text: "Spotted a closure? Hit reply." },
};

/**
 * A Saturday "at home" carousel, built through the real validator (the
 * Saturday after the plan's week starts), so the sample proves its copy
 * passes every rule: hazards by age, brands, the payoff.
 */
async function atHomeSample() {
  const week = "2026-11-30";
  const draft: AtHomeDraft = {
    type: "at_home",
    headline: "Snowy Saturday: 4 cozy ideas",
    highlight: "cozy",
    theme: "first-snow",
    ideas: [
      {
        title: "Snow paint",
        ages: { from: 2, to: 8 },
        need: ["spray bottles", "water", "food coloring"],
        steps: [
          "Fill each bottle with water and food coloring",
          "Spray stripes and letters on clean snow",
        ],
        payoff: "Watch the whole yard turn into a rainbow",
        icon: "snow",
      },
      {
        title: "Window color catchers",
        ages: { from: 3, to: 8 },
        need: ["tissue paper scraps", "clear tape"],
        steps: [
          "Tear tissue paper into small bright pieces",
          "Stick them on a strip of tape, sticky side up",
        ],
        payoff: "Hang it in a sunny window and watch the colors glow",
        icon: "sun",
      },
      {
        title: "Paper snowflakes",
        ages: { from: 5, to: 10 },
        need: ["paper", "scissors"],
        steps: [
          "Fold a square of paper in half three times",
          "Snip small shapes along the folded edges",
        ],
        payoff: "Unfold it and hang a blizzard in the window",
        icon: "sparkles",
      },
      {
        title: "Sock snowball fight",
        ages: { from: 3, to: 10 },
        need: ["rolled-up socks", "couch pillows"],
        steps: [
          "Roll pairs of socks into soft snowballs",
          "Build a pillow wall on each side of the room",
        ],
        payoff: "Now let the indoor snowball battle begin",
        icon: "party",
      },
    ],
    hashtags: ["#BendKids", "#CentralOregon", "#BendOregon"],
  };
  const r = await validateAtHome(AtHomeDraft.parse(draft), week, {
    now: new Date("2026-11-29T02:00:00Z"),
    catalog: CATALOG,
    parks: new Map(),
    profiles: new Map(),
    events: new Map(),
    recent: [],
    planParks: [],
    cooling: new Set(),
    photoFor: () => null,
    dms: false,
    recentIdeas: [],
  });
  console.log(
    `at_home validator: ${r.ok ? "ok" : "FAILED"}${r.errors.length ? `\n  ${r.errors.join("\n  ")}` : ""}`,
  );
  return r.spec!;
}

async function main() {
  await mkdir(out, { recursive: true });
  const posts = {
    park_crayon: composeParkPost(
      {
        type: "park_post",
        park: larkspur.slug,
        story:
          "This week we're featuring Larkspur Park, a Bend playground for all abilities. Three play zones sit side by side, at the Larkspur Trail trailhead.",
        who: "kids of every age and ability, side by side",
        bring: "mittens, and a snack for the picnic tables",
        hashtags: ["#BendOregon", "#CentralOregon", "#BendKids"],
      },
      larkspur,
      null,
      false,
    ),
    park_photo: composeParkPost(
      {
        type: "park_post",
        park: harvest.slug,
        story:
          "This week we're featuring Harvest Park, a sunny Bend playground for little legs. Slides, shade trees and picnic tables, all close together.",
        who: "toddlers to big kids",
        bring: "snacks for the picnic tables",
        hashtags: ["#BendOregon"],
      },
      harvest,
      harvestPhoto,
      false,
    ),
    unpack: composeUnpack(
      {
        type: "unpack",
        slot: "sun",
        headline: "No school this week: 5 warm spots",
        highlight: "warm",
        break_id: "break-bls-fall",
        items: [],
        hashtags: ["#BendOregon", "#CentralOregon", "#BendKids"],
      },
      [
        {
          ref: "venue:venue-juniper-swim",
          name: "Juniper Swim & Fitness Center",
          what: "Rec swim in the warm pool, with a slide for bigger kids.",
          icon: "splash_pad",
          facts: ["Open daily", "All ages", "Under $10", "Bend"],
        },
        {
          ref: "venue:venue-pavilion",
          name: "The Pavilion: Family Skate",
          what: "Skate together under the big roof. Kids skate with a grown-up.",
          icon: "sparkles",
          facts: ["Open daily", "All ages", "Under $10", "Bend"],
        },
        {
          ref: "venue:venue-high-desert-museum",
          name: "High Desert Museum",
          what: "Indoor exhibits, a porcupine and a hands-on volcano.",
          icon: "mountains",
          facts: [
            "Holiday hours: 10 am to 4 pm",
            "All ages",
            "Paid entry",
            "Bend",
          ],
        },
        {
          ref: "venue:venue-deschutes-historical-museum",
          name: "Deschutes Historical Museum",
          what: "Old schoolhouse rooms and pioneer toys to look at up close.",
          icon: "home",
          facts: ["Open Tue to Sat", "All ages", "Under $10", "Bend"],
        },
        {
          ref: "event:no-school-open-rec-swim@2026-11-25",
          name: "No School Open Rec Swim",
          what: "An afternoon swim with the whole pool open for kids.",
          icon: "calendar",
          facts: [
            "Wed, Nov 25 · 1 pm to 3 pm",
            "All ages",
            "$4 kids",
            "Madras",
          ],
        },
      ],
      { parks: [], events: [], venues: [], issue: null },
      false,
    ),
    teaser: composeTeaser(issue, harvest, false),
    story: composeStory(issue, harvest, false),
    at_home: await atHomeSample(),
    events_week: roundupSample(),
    events_worst: worstSample(),
  };
  for (const [name, spec] of Object.entries(posts)) {
    if (only && !only.includes(name)) continue;
    const files = await renderPost(spec, await photosFor(spec));
    let n = 0;
    for (const f of files) {
      n++;
      const file = `${name}-${n}-${f.file.role}.${f.file.ext}`;
      await writeFile(join(out, file), f.bytes);
      console.log(
        file,
        f.file.width,
        "x",
        f.file.height,
        f.bytes.length,
        "bytes",
      );
    }
    await writeFile(
      join(out, `${name}-caption.txt`),
      spec.caption ?? "(Story: no caption)",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
