/**
 * Google Places (New) for data/park-profiles.json: an INPUT only.
 *
 *   GOOGLE_PLACES_KEY=... node scripts/park-profiles/google-places.mjs
 *   node scripts/park-profiles/google-places.mjs --facts
 *
 * The first form looks up each park in data/parks.json (searchText near
 * its point, the nearest match within 700 m) and saves Place Details
 * (reviews, reviewSummary, editorialSummary, generativeSummary, rating,
 * goodForChildren, allowsDogs, restroom, accessibilityOptions,
 * parkingOptions) to data/.google-cache/<slug>.json, gitignored and
 * vercelignored: Google's text never enters the repo or a deploy. Parks
 * already cached are skipped; about 1.4 seconds between calls.
 *
 * --facts copies only the place id and the boolean facts into
 * data/park-profiles.json.
 *
 * --check scans every trait and one-liner for a 4-word run shared with
 * the cached Google text and exits 1 if it finds one. Run it after any
 * hand edit of the traits (the same scan runs in vitest when the cache
 * is there). Traits are written by hand, in our own words,
 * from the review summary (hints only for the other summaries); the
 * local-only test in src/lib/park-profiles.test.ts fails on any 4-word
 * run shared with the cached Google text.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PARKS = "data/parks.json";
const PROFILES = "data/park-profiles.json";
const DIR = "data/.google-cache";
const FIELDS =
  "id,displayName,formattedAddress,location,reviews,reviewSummary,editorialSummary,generativeSummary,rating,userRatingCount,goodForChildren,allowsDogs,restroom,accessibilityOptions,parkingOptions";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const meters = (a, b, c, d) => {
  const r = Math.PI / 180;
  const x = (d - b) * r * Math.cos(((a + c) / 2) * r);
  return Math.hypot(x, (c - a) * r) * 6_371_000;
};

async function fetchAll() {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) throw new Error("Set GOOGLE_PLACES_KEY (never commit it).");
  mkdirSync(DIR, { recursive: true });
  for (const p of JSON.parse(readFileSync(PARKS, "utf8"))) {
    const file = `${DIR}/${p.slug}.json`;
    if (existsSync(file)) continue;
    const s = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.displayName,places.location",
        },
        body: JSON.stringify({
          textQuery: `${p.name}, ${p.city}, Oregon`,
          locationBias: {
            circle: {
              center: { latitude: p.lat, longitude: p.lng },
              radius: 1000,
            },
          },
          maxResultCount: 5,
        }),
      },
    ).then((r) => r.json());
    await sleep(700);
    if (s.error) {
      console.log("search failed", p.slug, s.error.status);
      continue;
    }
    const best = (s.places ?? [])
      .map((c) => ({
        ...c,
        m: meters(p.lat, p.lng, c.location.latitude, c.location.longitude),
      }))
      .sort((a, b) => a.m - b.m)
      .find((c) => c.m < 700);
    if (!best) {
      writeFileSync(
        file,
        JSON.stringify({ slug: p.slug, match: null }, null, 1),
      );
      console.log("no match", p.slug);
      continue;
    }
    const d = await fetch(
      `https://places.googleapis.com/v1/places/${best.id}`,
      {
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
      },
    ).then((r) => r.json());
    await sleep(700);
    if (d.error) {
      console.log("details failed", p.slug, d.error.status);
      continue;
    }
    writeFileSync(
      file,
      JSON.stringify(
        {
          slug: p.slug,
          match: { id: best.id, m: Math.round(best.m) },
          details: d,
        },
        null,
        1,
      ),
    );
    console.log("ok", p.slug);
  }
}

function copyFacts() {
  const profiles = JSON.parse(readFileSync(PROFILES, "utf8"));
  for (const [slug, prof] of Object.entries(profiles)) {
    const file = `${DIR}/${slug}.json`;
    if (!existsSync(file)) continue;
    const d = JSON.parse(readFileSync(file, "utf8")).details;
    if (!d) continue;
    const a = d.accessibilityOptions ?? {};
    const k = d.parkingOptions ?? {};
    const facts = {};
    const put = (name, v) => {
      if (typeof v === "boolean") facts[name] = v;
    };
    put("restroom", d.restroom);
    put("allows_dogs", d.allowsDogs);
    put("good_for_children", d.goodForChildren);
    put("wheelchair_accessible_entrance", a.wheelchairAccessibleEntrance);
    put("wheelchair_accessible_parking", a.wheelchairAccessibleParking);
    put("wheelchair_accessible_restroom", a.wheelchairAccessibleRestroom);
    put("free_parking_lot", k.freeParkingLot);
    put("free_street_parking", k.freeStreetParking);
    prof.place_id = d.id ?? prof.place_id ?? null;
    prof.facts = facts;
  }
  writeFileSync(PROFILES, `${JSON.stringify(profiles, null, 2)}\n`);
}

const words = (t) =>
  String(t)
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter(Boolean);
const runs = (t) => {
  const w = words(t);
  const out = new Set();
  for (let i = 0; i + 3 < w.length; i++) out.add(w.slice(i, i + 4).join(" "));
  return out;
};
const flat = (x) =>
  typeof x === "string"
    ? x
    : x && typeof x === "object"
      ? Object.values(x).map(flat).join(" \n ")
      : "";

function check() {
  if (!existsSync(DIR)) {
    console.log(`No ${DIR}: nothing to compare against.`);
    return;
  }
  const profiles = JSON.parse(readFileSync(PROFILES, "utf8"));
  const bad = [];
  for (const [slug, p] of Object.entries(profiles)) {
    const file = `${DIR}/${slug}.json`;
    if (!existsSync(file)) continue;
    const d = JSON.parse(readFileSync(file, "utf8")).details ?? {};
    const g = runs(
      [d.reviewSummary, d.editorialSummary, d.generativeSummary, d.reviews]
        .map(flat)
        .join(" \n "),
    );
    for (const text of [p.one_liner ?? "", ...p.traits.map((t) => t.text)])
      for (const r of runs(text)) if (g.has(r)) bad.push(`${slug}: "${r}"`);
  }
  if (bad.length) {
    console.log(
      `Shared 4-word runs with Google's text (reword these):\n${bad.join("\n")}`,
    );
    process.exit(1);
  }
  console.log("No shared 4-word runs with Google's text.");
}

if (process.argv.includes("--facts")) copyFacts();
else if (process.argv.includes("--check")) check();
else await fetchAll();
