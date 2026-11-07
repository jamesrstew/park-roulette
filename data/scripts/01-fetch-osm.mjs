// Fetch playgrounds, parks, schools, amenities and county boundaries for Central Oregon from Overpass.
// Uses a bbox (43.4..44.95 N, -122.0..-120.3 W); 02-build filters to Deschutes/Crook/Jefferson county polygons.
// Usage: node scripts/01-fetch-osm.mjs   (writes raw/osm.json, raw/counties.json)
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, "..", "raw");
mkdirSync(rawDir, { recursive: true });
// Pass --force to refetch files that already exist in raw/.
const force = process.argv.includes("--force");
const need = (f) => force || !existsSync(join(rawDir, f));
const BBOX = "43.4,-122.0,44.95,-120.3";
// Overpass rate-limits bursts (429/504); retry with backoff.
async function overpass(q) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await overpassOnce(q);
    } catch (e) {
      if (attempt >= 5) throw e;
      console.error("overpass retry", attempt, String(e.message).slice(0, 80));
      await new Promise((r) => setTimeout(r, 30000 * attempt));
    }
  }
}
async function overpassOnce(q) {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "park-roulette-seed/0.1 (family hobby project)",
    },
    body: "data=" + encodeURIComponent(q),
  });
  if (!res.ok)
    throw new Error(res.status + " " + (await res.text()).slice(0, 500));
  return res.json();
}
if (need("osm.json")) {
  const features = await overpass(`
[out:json][timeout:180][bbox:${BBOX}];
(
  nwr["leisure"="playground"];
  nwr["playground"];
  nwr["leisure"="park"];
  nwr["leisure"="recreation_ground"];
  nwr["leisure"="nature_reserve"]["name"];
  nwr["amenity"="school"];
  nwr["amenity"="toilets"];
  nwr["amenity"="shelter"];
  nwr["leisure"="picnic_table"];
  nwr["tourism"="picnic_site"];
  nwr["leisure"="dog_park"];
  nwr["leisure"="splash_pad"];
  nwr["leisure"="pitch"];
  nwr["landuse"="residential"];
  nwr["amenity"~"^(place_of_worship|childcare|kindergarten|fast_food|community_centre|library|townhall)$"];
  nwr["tourism"~"^(camp_site|caravan_site|hotel|motel|resort|museum|attraction)$"];
  nwr["leisure"~"^(resort|sports_centre|golf_course|water_park|swimming_pool|park_ride)$"];
  nwr["building"="apartments"];
  nwr["landuse"~"^(retail|commercial)$"];
  nwr["boundary"="protected_area"]["name"];
  nwr["place"~"^(city|town|village|hamlet|suburb|neighbourhood|locality)$"];
);
out geom;
`);
  writeFileSync(join(rawDir, "osm.json"), JSON.stringify(features));
  console.log("features", features.elements.length);
}
await new Promise((r) => setTimeout(r, 2000));
if (need("counties.json")) {
  const counties = await overpass(`
[out:json][timeout:180];
rel["boundary"="administrative"]["admin_level"="6"]["name"~"^(Deschutes|Crook|Jefferson) County$"](43.0,-122.5,45.2,-119.5);
out geom;
`);
  writeFileSync(join(rawDir, "counties.json"), JSON.stringify(counties));
  console.log(
    "counties",
    counties.elements.map((e) => e.tags.name),
  );
}
await new Promise((r) => setTimeout(r, 2000));
if (need("cities.json")) {
  const cities = await overpass(`
[out:json][timeout:180][bbox:${BBOX}];
rel["boundary"="administrative"]["admin_level"="8"];
out geom;
`);
  writeFileSync(join(rawDir, "cities.json"), JSON.stringify(cities));
  console.log(
    "cities",
    cities.elements.map((e) => e.tags.name),
  );
}
