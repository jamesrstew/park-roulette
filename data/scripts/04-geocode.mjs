// Nominatim fallback geocoding for curated/official parks that OSM has no polygon or playground for.
// Reads raw/build-report.json (entries with loc "NONE"), geocodes "<address>, <city>, OR", caches in raw/geocode-cache.json.
// Polite: 1 request/sec, identifying User-Agent. Usage: node scripts/03-build.mjs && node scripts/04-geocode.mjs && node scripts/03-build.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cachePath = join(root, "raw", "geocode-cache.json");
const cache = existsSync(cachePath)
  ? JSON.parse(readFileSync(cachePath, "utf8"))
  : {};
const report = JSON.parse(
  readFileSync(join(root, "raw", "build-report.json"), "utf8"),
);
const bucket = JSON.parse(
  readFileSync(join(root, "sources", "bucket-list-2026-11.json"), "utf8"),
);
const other = JSON.parse(
  readFileSync(join(root, "sources", "official-other.json"), "utf8"),
).parks;
const queries = [];
for (const u of report.unmatched.filter((u) => u.loc === "NONE")) {
  const b = bucket.find((x) => x.name === u.name);
  if (b) queries.push(`${b.address}, ${b.city}, OR`);
  const o = other.find((x) => x.name === u.name);
  if (o) queries.push(o.address);
}
// Accept only address-level hits. Nominatim first; then the US Census geocoder (address-range interpolation),
// accepted only when its matched address keeps the same house number and street direction (e.g. NW vs SW).
async function census(q) {
  const u =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" +
    encodeURIComponent(q);
  const j = await (await fetch(u)).json();
  const m = j.result.addressMatches[0];
  if (!m) return null;
  const want = q.toUpperCase().match(/^(\d+)\s+(N|S|E|W|NE|NW|SE|SW)?\b/);
  const got = m.matchedAddress.match(/^(\d+)\s+(N|S|E|W|NE|NW|SE|SW)?\b/);
  if (!want || !got || want[1] !== got[1] || (want[2] || "") !== (got[2] || ""))
    return null;
  return {
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    display_name: m.matchedAddress,
    type: "census-interpolated",
    osm: null,
  };
}
for (const q of queries) {
  if (cache[q] && cache[q].lat) continue;
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" +
    encodeURIComponent(q);
  const r = await fetch(url, {
    headers: { "User-Agent": "park-roulette-seed/0.1 (family hobby project)" },
  });
  const j = await r.json();
  let hit =
    j[0] &&
    ["house", "park", "playground", "recreation_ground"].includes(j[0].type)
      ? {
          lat: +j[0].lat,
          lon: +j[0].lon,
          display_name: j[0].display_name,
          type: "nominatim-" + j[0].type,
          osm: `${j[0].osm_type}/${j[0].osm_id}`,
        }
      : null;
  if (!hit) hit = await census(q);
  cache[q] = hit || {
    lat: null,
    rejected: j[0]
      ? `nominatim ${j[0].type}: ${j[0].display_name}`
      : "not found",
  };
  console.log(
    q,
    "->",
    hit
      ? `${hit.type}: ${hit.display_name}`
      : "NO ADDRESS-LEVEL MATCH (" + cache[q].rejected + ")",
  );
  await new Promise((res) => setTimeout(res, 1100));
}
writeFileSync(cachePath, JSON.stringify(cache, null, 1));
