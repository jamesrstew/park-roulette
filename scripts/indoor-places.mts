/**
 * Build data/indoor-places.json: the park pairings' indoor anchors (lib/
 * social/indoor.ts). Run by hand, then review every entry before
 * committing:
 *
 *   GOOGLE_PLACES_KEY=... pnpm exec tsx scripts/indoor-places.mts [--dry]
 *   GOOGLE_PLACES_KEY=... pnpm exec tsx scripts/indoor-places.mts --discover
 *
 * CANDIDATES below are reviewed by hand: places for kids 0 to 10, indoors,
 * from the events catalog's venues (data/news-catalog.json) and the
 * library branches, plus any --discover turns up. For each one the script
 *
 *   1. fetches each evidence page (plainly, our honest User-Agent) and
 *      requires its quote, verbatim, grounding our line;
 *   2. finds Google's place id with Autocomplete (an id only: Google lets
 *      us keep ids; nothing else of Google's is written);
 *   3. places the address from the place's own site with OpenStreetMap's
 *      Nominatim (one request a second, as its policy asks).
 *
 * An entry that fails any step is left out and printed. --discover runs a
 * few Text Searches (library, indoor playground, children's museum, rec
 * center pool) in our towns and prints places not yet listed, for review:
 * it writes nothing.
 */
import { writeFileSync } from "node:fs";
import { fetchPage } from "../src/lib/news/fetcher";
import { UA } from "../src/lib/news/ua";
import { normalizeText } from "../src/lib/news/validate";
import { siteDomain } from "../src/lib/social/handles";
import { IndoorPlace, type IndoorType } from "../src/lib/social/indoor";
import { placesKey, searchTown } from "../src/lib/social/places";

const FILE = "data/indoor-places.json";
const dry = process.argv.includes("--dry");

type Candidate = {
  slug: string;
  name: string;
  town: string;
  type: IndoorType;
  url: string;
  line: string;
  evidence: { url: string; quote: string }[];
  address: string;
  /** Autocomplete input, and a word its first match must contain. */
  find: string;
  expect: string;
};

const DPL = "https://www.deschuteslibrary.org/about/libraries";
const CANDIDATES: Candidate[] = [
  {
    slug: "central-library-bend",
    name: "Central Library",
    town: "Bend",
    type: "library",
    url: `${DPL}/central`,
    line: "A children's discovery space on the second floor",
    evidence: [
      {
        url: `${DPL}/central`,
        quote: "a dynamic children's discovery space is on the second floor",
      },
    ],
    address: "61956 SE Santorini St, Bend, OR 97702",
    find: "Central Library Deschutes Public Library Bend",
    expect: "Central Library",
  },
  {
    slug: "redmond-library",
    name: "Redmond Library",
    town: "Redmond",
    type: "library",
    url: `${DPL}/redmond`,
    line: "A children's area, and story times in its meeting room",
    evidence: [
      {
        url: `${DPL}/redmond`,
        quote:
          "Use the interactive floor plan to find meeting rooms, computers, the children's area, restrooms, and other services.",
      },
      {
        url: `${DPL}/redmond`,
        quote:
          "A community meeting room serves as a gathering space for programs, lectures, and story times.",
      },
    ],
    address: "827 SW Deschutes Ave, Redmond, OR 97756",
    find: "Redmond Library Deschutes Public Library",
    expect: "Redmond",
  },
  {
    slug: "sisters-library",
    name: "Sisters Library",
    town: "Sisters",
    type: "library",
    url: `${DPL}/sisters`,
    line: "A children's discovery space for imaginative play",
    evidence: [
      {
        url: `${DPL}/sisters`,
        quote:
          "A children's discovery space encourages imaginative play and learning.",
      },
    ],
    address: "110 N Cedar St, Sisters, OR 97759",
    find: "Sisters Library Deschutes Public Library",
    expect: "Sisters",
  },
  {
    slug: "la-pine-library",
    name: "La Pine Library",
    town: "La Pine",
    type: "library",
    url: `${DPL}/lapine`,
    line: "A children's discovery space and a cozy reading area",
    evidence: [
      {
        url: `${DPL}/lapine`,
        quote:
          "an engaging children's discovery space, and a cozy fireplace and reading area",
      },
    ],
    address: "16425 1st St, La Pine, OR 97739",
    find: "La Pine Library Deschutes Public Library",
    expect: "La Pine",
  },
  {
    slug: "sunriver-library",
    name: "Sunriver Library",
    town: "Sunriver",
    type: "library",
    url: `${DPL}/sunriver`,
    line: "Books for kids and a children's area",
    evidence: [
      {
        url: `${DPL}/sunriver`,
        quote:
          "the library's collection of books, music and DVDs for adults, children, and teens",
      },
      {
        url: `${DPL}/sunriver`,
        quote:
          "Use the interactive floor plan to find meeting rooms, computers, the children's area, restrooms, and other services.",
      },
    ],
    address: "56855 Venture Lane, Sunriver, OR 97707",
    find: "Sunriver Library Deschutes Public Library",
    expect: "Sunriver",
  },
  {
    slug: "the-hub-redmond",
    name: "The Hub Aquatic and Recreation Center",
    town: "Redmond",
    type: "pool",
    url: "https://www.raprd.org/the-hub",
    line: "A leisure pool, a lazy river and a water slide",
    evidence: [
      {
        url: "https://www.raprd.org/the-hub",
        quote: "leisure pool, lazy river, water slide, and hot tub",
      },
    ],
    address: "3515 SW Lava Ave, Redmond, OR 97756",
    find: "RAPRD The Hub Redmond",
    expect: "The Hub, Southwest Lava",
  },
  {
    slug: "trampoline-zone-bend",
    name: "Trampoline Zone & Adventure Park",
    town: "Bend",
    type: "play_gym",
    url: "https://tzbend.com/",
    line: "Over 50 trampolines, with times for ages 6 and under",
    evidence: [
      {
        url: "https://tzbend.com/",
        quote: "With more than 50 trampoline beds",
      },
      { url: "https://tzbend.com/", quote: "10am – 12pm Ages 6 and under" },
    ],
    address: "63040 NE 18th St, Bend, OR 97701",
    find: "Trampoline Zone Bend",
    expect: "Trampoline",
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function quoted(url: string, quote: string): Promise<boolean> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const page = await fetchPage(url, [host]).catch(() => null);
  return (
    !!page &&
    page.status === 200 &&
    !page.blocked &&
    page.text.includes(normalizeText(quote))
  );
}

/** Google's place id for a name, by Autocomplete (an id and its label only). */
async function placeId(c: Candidate, key: string): Promise<string | null> {
  const res = await fetch(
    "https://places.googleapis.com/v1/places:autocomplete",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        input: c.find,
        locationRestriction: {
          rectangle: {
            low: { latitude: 43.4, longitude: -122 },
            high: { latitude: 44.9, longitude: -120.6 },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await res.json().catch(() => null)) as {
    suggestions?: {
      placePrediction?: { placeId?: string; text?: { text?: string } };
    }[];
  } | null;
  const hit = (body?.suggestions ?? [])
    .map((s) => s.placePrediction)
    .find((p) => p?.text?.text?.includes(c.expect));
  return hit?.placeId ?? null;
}

/** OpenStreetMap's point for an address (Nominatim, one a second). */
async function point(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  await sleep(1_100);
  const q = new URLSearchParams({ q: address, format: "json", limit: "1" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  const got = (await res.json().catch(() => [])) as {
    lat: string;
    lon: string;
  }[];
  return got[0] ? { lat: Number(got[0].lat), lng: Number(got[0].lon) } : null;
}

async function discover(key: string) {
  const known = new Set(CANDIDATES.map((c) => c.name.toLowerCase()));
  for (const town of ["Bend", "Redmond", "Prineville", "Madras", "Sisters"])
    for (const q of ["indoor playground", "children's museum"]) {
      for (const p of await searchTown(q, town, 1, { key }))
        if (!known.has(p.name.toLowerCase()))
          console.log(`${town} | ${q} | ${p.name} | ${p.placeId}`);
    }
}

async function main() {
  const key = placesKey();
  if (process.argv.includes("--discover")) return discover(key);
  const today = new Date().toISOString().slice(0, 10);
  const out: IndoorPlace[] = [];
  for (const c of CANDIDATES) {
    const missing = [];
    // The name, too, is the place's own: its page prints it.
    if (!(await quoted(c.url, c.name))) missing.push(`the name "${c.name}"`);
    for (const e of c.evidence)
      if (!(await quoted(e.url, e.quote))) missing.push(e.quote);
    if (missing.length) {
      console.log(`LEFT OUT ${c.slug}: quote not on the page: ${missing}`);
      continue;
    }
    const id = await placeId(c, key);
    if (!id) {
      console.log(`LEFT OUT ${c.slug}: no place id for "${c.find}"`);
      continue;
    }
    const at = await point(c.address);
    if (!at) {
      console.log(`LEFT OUT ${c.slug}: OpenStreetMap has no point`);
      continue;
    }
    const entry = IndoorPlace.parse({
      slug: c.slug,
      name: c.name,
      town: c.town,
      type: c.type,
      place_id: id,
      site: siteDomain(c.url),
      url: c.url,
      line: c.line,
      evidence: c.evidence,
      ...at,
      address: c.address,
      verified_on: today,
    });
    out.push(entry);
    console.log(`ok ${c.slug} ${id} ${at.lat},${at.lng}`);
  }
  if (!dry) writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${out.length} of ${CANDIDATES.length}${dry ? " (dry)" : ""}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
