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
import {
  composeParkPost,
  composeStory,
  composeTeaser,
  composeUnpack,
  type ParkInfo,
} from "../src/lib/social/compose";
import { photosFor, renderPost } from "../src/lib/social/render";

const out = process.argv[2] ?? "/tmp/social-samples";

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

async function main() {
  await mkdir(out, { recursive: true });
  const posts = {
    park_crayon: composeParkPost(
      {
        type: "park_post",
        park: larkspur.slug,
        hook: "A Bend playground built for every kid",
        who: "Universal-design play for all ages and abilities.",
        what: "Picnic tables for grown-ups and a walking trail around it.",
        bring: "Mittens, and a snack for the picnic tables.",
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
        hook: "A sunny Bend playground for little legs",
        who: "Good for toddlers to big kids.",
        what: "Slides, shade trees and picnic tables.",
        bring: "Snacks for the picnic tables.",
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
  };
  for (const [name, spec] of Object.entries(posts)) {
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
