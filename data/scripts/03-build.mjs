// Build parks.json from:
//   sources/bucket-list-2026-11.json  (curated family list: backbone, source of truth for membership + play status)
//   raw/bprd.json                     (Bend Park & Recreation District park pages, from 02-fetch-bprd.mjs)
//   sources/official-other.json       (CCPRD Prineville + La Pine Park & Rec pages, transcribed)
//   raw/osm.json, raw/counties.json   (OpenStreetMap via 01-fetch-osm.mjs)
//   sources/overrides.json            (hand decisions for OSM playgrounds: names, exclusions)
//   raw/geocode-cache.json            (Nominatim fallbacks, from 04-geocode.mjs)
// Usage: node scripts/03-build.mjs   (writes parks.json and raw/build-report.json)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  polygonOf,
  inPoly,
  distToPoly,
  areaM2,
  centerOf,
  dist,
} from "./geo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const rd = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const rdOpt = (p, d) => (existsSync(join(root, p)) ? rd(p) : d);

const osm = rd("raw/osm.json").elements;
const counties = rd("raw/counties.json").elements.map(polygonOf);
const bprd = rd("raw/bprd.json").filter((p) => !p.error);
const bucket = rd("sources/bucket-list-2026-11.json");
const other = rd("sources/official-other.json").parks;
const overrides = rdOpt("sources/overrides.json", {
  playgrounds: {},
  parks: {},
});
const geocache = rdOpt("raw/geocode-cache.json", {});

const ref = (e) => `osm:${e.type}/${e.id}`;
const T = (e) => e.tags || {};
const inRegion = (c) => counties.some((p) => inPoly(c, p));
const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'.]/g, "")
    .replace(
      /\b(park|parks|the|and|site|natural area|nature reserve|state|sports complex|athletic fields)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const kebab = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[’'.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const r5 = (x) => Math.round(x * 1e5) / 1e5;

// ---------- index OSM ----------
const withGeo = (e) => ({ e, c: centerOf(e), poly: polygonOf(e) });
const all = osm.map(withGeo).filter((x) => x.c);
// Park-like areas; historic districts (protected_area / heritage polygons) are not parks.
const isParkLike = (t) =>
  (["park", "recreation_ground", "nature_reserve", "dog_park"].includes(
    t.leisure,
  ) ||
    (t.boundary === "protected_area" &&
      t.name &&
      !t.heritage &&
      !t.historic)) &&
  !/historic district/i.test(t.name || "");
const parks = all.filter((x) => isParkLike(T(x.e)) && x.poly);
const playgrounds = all.filter(
  (x) => T(x.e).leisure === "playground" && inRegion(x.c),
);
const equipment = all.filter(
  (x) => T(x.e).playground && T(x.e).leisure !== "playground",
);
const schools = all.filter((x) => T(x.e).amenity === "school" && x.poly);
const exclAreas = all.filter((x) => {
  const t = T(x.e);
  return (
    x.poly &&
    (["place_of_worship", "childcare", "kindergarten", "fast_food"].includes(
      t.amenity,
    ) ||
      ["camp_site", "caravan_site", "hotel", "motel", "resort"].includes(
        t.tourism,
      ) ||
      t.leisure === "resort" ||
      t.building === "apartments")
  );
});
const toilets = all.filter(
  (x) =>
    T(x.e).amenity === "toilets" &&
    !["private", "customers"].includes(T(x.e).access),
);
const picnic = all.filter(
  (x) =>
    T(x.e).leisure === "picnic_table" ||
    T(x.e).tourism === "picnic_site" ||
    T(x.e).shelter_type === "picnic_shelter",
);
const shelters = all.filter((x) => T(x.e).amenity === "shelter");
const dogParks = all.filter((x) => T(x.e).leisure === "dog_park");
const splash = all.filter(
  (x) => T(x.e).leisure === "splash_pad" || T(x.e).playground === "splash_pad",
);
const courts = all.filter(
  (x) =>
    T(x.e).leisure === "pitch" &&
    /basketball|tennis|pickleball|volleyball|soccer|baseball|softball|multi/.test(
      T(x.e).sport || "",
    ),
);
const places = all.filter(
  (x) =>
    ["city", "town", "village", "hamlet"].includes(T(x.e).place) &&
    x.e.type === "node",
);

function nearestPlace(c) {
  let best = null;
  for (const p of places) {
    const d = dist(c, p.c);
    if (!best || d < best.d) best = { d, name: T(p.e).name };
  }
  return best;
}
// City: incorporated-city polygon first, else nearest place node.
const cityPolys = rd("raw/cities.json").elements.map((e) => ({
  name: e.tags.name,
  poly: polygonOf(e),
}));
function cityOf(c) {
  const hit = cityPolys.find((p) => inPoly(c, p.poly));
  if (hit) return hit.name;
  const n = nearestPlace(c);
  const map = {
    Deschutes: "Bend",
    Cloverdale: "Sisters",
    "Odell Lake": "Crescent Lake",
  };
  return n ? map[n.name] || n.name : null;
}

// Containing / nearby named park for a point (smallest containing first, else nearest within 75 m).
function parkFor(c) {
  const named = parks.filter(
    (p) => T(p.e).name && T(p.e).leisure !== "dog_park",
  );
  const cont = named
    .filter((p) => inPoly(c, p.poly))
    .sort((a, b) => areaM2(a.poly) - areaM2(b.poly));
  if (cont.length) return cont[0];
  let best = null;
  for (const p of named) {
    const d = distToPoly(c, p.poly);
    if (d < 75 && (!best || d < best.d)) best = { p, d };
  }
  return best ? best.p : null;
}

// ---------- features ----------
const EQUIP = [
  [/^(swing|basketswing|baby_swing)$/, "swings"],
  [/^slide$/, "slides"],
  [
    /^(climbingframe|climbing_wall|climbing_net|rope_net|climbing_slope|climbing_pole|rope_traverse|structure|activitycenter|ladder|horizontal_ladder|monkey_bars|climbing)$/,
    "climbing",
  ],
  [/^zipwire$/, "zipline"],
  [/^sandpit$/, "sandbox"],
  [
    /^(roundabout|spinner|spinning_disk|spinning_bowl|spinning_circle|aerialrotator)$/,
    "spinny",
  ],
  [/^(splash_pad|water|pump|waterplay)$/, "splash_pad"],
];
function osmPlayFeatures(pg, f, evidence) {
  const t = T(pg.e);
  if (t.wheelchair === "yes") f.add("accessible");
  if (t.barrier === "fence" || t.fenced === "yes") f.add("fenced");
  if (t.covered === "yes" || t.shade === "yes") f.add("shade");
  if (t.max_age && parseInt(t.max_age, 10) <= 5) f.add("toddler_area");
  if (/toddler|tot\b/i.test(t.name || "")) f.add("toddler_area");
  for (const q of equipment) {
    const inside = pg.poly
      ? inPoly(q.c, pg.poly) || distToPoly(q.c, pg.poly) < 5
      : dist(q.c, pg.c) < 30;
    if (!inside) continue;
    const kind = T(q.e).playground;
    if (
      kind === "baby_swing" ||
      T(q.e)["baby"] === "yes" ||
      /baby/.test(T(q.e)["swing:seat"] || "")
    )
      f.add("baby_swings");
    for (const [re, key] of EQUIP) if (re.test(kind)) f.add(key);
    evidence.add(ref(q.e));
  }
}
function osmParkFeatures(park, anchor, f) {
  const within = (x, slack) =>
    park ? distToPoly(x.c, park.poly) <= slack : dist(x.c, anchor) <= 60;
  if (toilets.some((x) => within(x, 15) || dist(x.c, anchor) < 100))
    f.add("restrooms");
  if (picnic.some((x) => within(x, 10))) f.add("picnic");
  if (
    shelters.some(
      (x) => within(x, 10) && T(x.e).shelter_type === "picnic_shelter",
    )
  ) {
    f.add("picnic");
    f.add("shade");
  }
  if (shelters.some((x) => dist(x.c, anchor) < 40)) f.add("shade");
  if (dogParks.some((x) => within(x, 50))) f.add("dog_park");
  if (splash.some((x) => within(x, 10))) f.add("splash_pad");
  if (courts.some((x) => within(x, 10))) f.add("sports_courts");
}
function bprdFeatures(b, f) {
  const L = new Set(b.features);
  const has = (...k) => k.some((x) => L.has(x));
  if (has("Restroom - Year Round", "Restroom - Seasonal")) f.add("restrooms");
  if (has("Picnic Shelter")) {
    f.add("picnic");
    f.add("shade");
  }
  if (
    has(
      "Basketball",
      "Tennis",
      "Pickleball",
      "Ball Field",
      "Sports Field",
      "Volleyball",
      "Bocce",
    )
  )
    f.add("sports_courts");
  if (
    has(
      "Dog Off-Leash Areas",
      "Dog Off-Leash Area",
      "Off-Leash Dog Area",
      "Dog Off Leash Area",
    )
  )
    f.add("dog_park");
  if (has("River Access")) f.add("water_view");
  if (has("Trails", "Paths Unpaved", "Deschutes River Trail")) f.add("trail");
  if (has("Bouldering")) f.add("climbing");
}
const BUCKET_TAGS = {
  "Splash pad": ["splash_pad"],
  "Water play": ["splash_pad"],
  "Accessible playground": ["accessible"],
  River: ["water_view"],
  "Dog off-leash": ["dog_park"],
  "Sports fields": ["sports_courts"],
  "Climbing wall": ["climbing"],
  Picnic: ["picnic"],
};
// Her tags that have no feature key are kept as words in the note (e.g. "Wildside play", "New 2024").
const TAG_PHRASE = {
  "Wildside play": "Wildside play area",
  "Natural play": "Natural play area",
  "Skate park": "Skate park",
  Fishing: "Fishing",
};
function bucketNotes(b) {
  const extra = [];
  for (const t of b.tags) {
    if (BUCKET_TAGS[t]) continue;
    const m = t.match(/^New (\d{4})$/);
    if (m) extra.push(`New in ${m[1]}.`);
    else if (
      TAG_PHRASE[t] &&
      !(b.note || "")
        .toLowerCase()
        .includes(TAG_PHRASE[t].toLowerCase().split(" ")[0])
    )
      extra.push(`${TAG_PHRASE[t]}.`);
  }
  const s = [b.note, ...extra].filter(Boolean).join(" ");
  return s || null;
}
function bucketFeatures(b, f) {
  for (const t of b.tags) for (const k of BUCKET_TAGS[t] || []) f.add(k);
  const n = b.note || "";
  if (/toddler/i.test(n)) f.add("toddler_area");
  if (/swings/i.test(n)) f.add("swings");
  if (/spinning/i.test(n)) f.add("spinny");
  if (/climb/i.test(n)) f.add("climbing");
  if (/trail/i.test(n)) f.add("trail");
  if (/picnic/i.test(n)) f.add("picnic");
  if (/covered picnic/i.test(n)) f.add("shade");
  if (/quiet/i.test(n)) f.add("quiet");
}
const FEATURE_ORDER = [
  "slides",
  "swings",
  "baby_swings",
  "climbing",
  "zipline",
  "spinny",
  "sandbox",
  "splash_pad",
  "toddler_area",
  "accessible",
  "fenced",
  "shade",
  "restrooms",
  "picnic",
  "parking",
  "water_view",
  "trail",
  "sports_courts",
  "quiet",
  "dog_friendly",
  "dog_park",
];
const sortFeatures = (f) => FEATURE_ORDER.filter((k) => f.has(k));

// ---------- playground classification ----------
const report = {
  excluded: [],
  unnamedDropped: [],
  schoolDropped: [],
  disagreements: [],
  unmatched: [],
  geocoded: [],
};
const pgInfo = playgrounds.map((pg) => {
  const t = T(pg.e);
  const ov = overrides.playgrounds[ref(pg.e)] || {};
  const info = {
    pg,
    ref: ref(pg.e),
    park: null,
    school: null,
    excluded: null,
    name: null,
  };
  if (ov.exclude) info.excluded = ov.exclude;
  else if (["private", "customers", "no"].includes(t.access))
    info.excluded = `access=${t.access}`;
  else if (
    /academy|daycare|preschool|child ?care|montessori|church/i.test(
      `${t.operator || ""} ${t.name || ""}`,
    )
  )
    info.excluded = "operator/name is a daycare, school business or church";
  else {
    const ex = exclAreas.find((x) => inPoly(pg.c, x.poly));
    if (ex)
      info.excluded = `inside ${T(ex.e).amenity || T(ex.e).tourism || T(ex.e).leisure || "building=" + T(ex.e).building} ${T(ex.e).name || ref(ex.e)}`;
  }
  if (ov.park_ref)
    info.park = parks.find((p) => ref(p.e) === ov.park_ref) || null;
  else {
    // A playground inside school grounds belongs to the school unless a named park polygon actually contains it
    // (the 75 m "near a park" rule must not pull school playgrounds into an adjacent park).
    const school = schools.find((s) => inPoly(pg.c, s.poly));
    const park = parkFor(pg.c);
    const nearSchool =
      school || schools.find((s) => distToPoly(pg.c, s.poly) < 30);
    if (nearSchool && park && !inPoly(pg.c, park.poly))
      info.school = nearSchool;
    else info.park = park;
  }
  if (!info.park && !info.school)
    info.school = schools.find((s) => distToPoly(pg.c, s.poly) < 15) || null;
  info.name = ov.name || null;
  return info;
});

// ---------- bucket list (backbone) ----------
const bprdByNorm = new Map(bprd.map((b) => [norm(b.name), b]));
const TOWN_CENTER = {};
for (const p of places) TOWN_CENTER[T(p.e).name] = p.c;
const out = [];
const usedPg = new Set();
const usedParkRefs = new Set();

const tokens = (s) => norm(s).split(" ").filter(Boolean);
// Match cascade: exact normalized name -> all name tokens contained -> same house number -> polygon containing official pin.
function matchOsmPark(name, near, maxD, opts = {}) {
  const n = norm(name);
  const named = parks.filter(
    (p) =>
      T(p.e).name && T(p.e).leisure !== "dog_park" && dist(p.c, near) < maxD,
  );
  const big = (arr) =>
    arr.sort((a, b) => areaM2(b.poly) - areaM2(a.poly))[0] || null;
  let hit = big(
    named.filter((p) => norm(T(p.e).name) === n || norm(T(p.e).alt_name) === n),
  );
  if (hit) return hit;
  const tk = tokens(name);
  if (tk.length)
    hit = big(
      named.filter((p) => {
        const o = new Set(tokens(T(p.e).name));
        return tk.every((t) => o.has(t));
      }),
    );
  if (hit) return hit;
  const num = (opts.address || "").match(/^(\d+)\s/);
  if (num)
    hit = big(
      parks.filter(
        (p) =>
          T(p.e)["addr:housenumber"] === num[1] &&
          dist(p.c, near) < 3000 &&
          T(p.e).leisure !== "dog_park",
      ),
    );
  if (hit) return hit;
  if (opts.pin) {
    const cont = parks.filter(
      (p) =>
        T(p.e).name &&
        T(p.e).leisure &&
        T(p.e).leisure !== "dog_park" &&
        inPoly(opts.pin, p.poly),
    );
    hit = cont.sort((a, b) => areaM2(a.poly) - areaM2(b.poly))[0] || null;
  }
  return hit;
}
function playgroundsIn(park) {
  return pgInfo.filter(
    (i) => i.park && ref(i.park.e) === ref(park.e) && !i.excluded,
  );
}
function pickMain(list) {
  // main playground = largest polygon (nodes count as 0 m2)
  return list.slice().sort((a, b) => areaM2(b.pg.poly) - areaM2(a.pg.poly))[0];
}

for (const b of bucket) {
  const bp = b.city === "Bend" ? bprdByNorm.get(norm(b.name)) : null;
  const ov = overrides.parks[b.name] || {};
  const anchor =
    bp && bp.lat
      ? { lat: bp.lat, lon: bp.lng }
      : TOWN_CENTER[b.city] || TOWN_CENTER.Bend;
  let park = ov.osm
    ? parks.find((p) => ref(p.e) === ov.osm)
    : matchOsmPark(ov.osm_name || b.name, anchor, bp ? 1500 : 12000, {
        address: b.address,
        pin: bp && bp.lat ? anchor : null,
      });
  const sources = ["bucket-list-2026-11"];
  if (bp) sources.push(bp.url);
  const f = new Set();
  bucketFeatures(b, f);
  if (bp) bprdFeatures(bp, f);
  let pgs = park ? playgroundsIn(park) : [];
  // playgrounds mapped standalone but carrying the park's name (e.g. a new park with only the playground mapped)
  const btk = tokens(b.name);
  for (const i of pgInfo) {
    if (
      i.excluded ||
      !T(i.pg.e).name ||
      pgs.includes(i) ||
      dist(i.pg.c, anchor) > (bp ? 3000 : 12000)
    )
      continue;
    const o = new Set(tokens(T(i.pg.e).name).filter((t) => t !== "playground"));
    if (btk.length && btk.every((t) => o.has(t)) && o.size === btk.length)
      pgs.push(i);
  }
  // her classification wins; record disagreements with OSM
  const play = b.section;
  if (play === "none" && pgs.length)
    report.disagreements.push({
      name: b.name,
      hers: "none",
      osm: `${pgs.length} playground(s) mapped: ${pgs.map((i) => i.ref).join(", ")}`,
    });
  if (play === "playground" && park && !pgs.length)
    report.disagreements.push({
      name: b.name,
      hers: play,
      osm: "park mapped but no leisure=playground inside it",
    });
  if (bp && play === "playground" && !bp.features.includes("Playground"))
    report.disagreements.push({
      name: b.name,
      hers: play,
      bprd: "BPRD page does not list Playground",
    });
  if (
    bp &&
    play === "none" &&
    bp.features.some((x) => /^(Playground|Natural Play Area)$/.test(x))
  )
    report.disagreements.push({
      name: b.name,
      hers: "none",
      bprd: "BPRD lists play area",
    });
  let loc = null;
  if (play !== "none" && pgs.length) {
    const main = pickMain(pgs);
    loc = main.pg.c;
    for (const i of pgs) {
      usedPg.add(i.ref);
      sources.push(i.ref);
      osmPlayFeatures(i.pg, f, new Set());
    }
    if (
      pgs.length >= 2 &&
      pgs.some((i) => T(i.pg.e).max_age && +T(i.pg.e).max_age <= 5)
    )
      f.add("toddler_area");
  }
  if (park) {
    usedParkRefs.add(ref(park.e));
    sources.push(ref(park.e));
    osmParkFeatures(park, loc || park.c, f);
    // also mark any playgrounds in the park as used even if "none" (so they don't reappear as extras)
    for (const i of playgroundsIn(park)) usedPg.add(i.ref);
  }
  let locNote = null;
  if (!loc && park) loc = park.c;
  if (!loc && bp && bp.lat) {
    loc = { lat: bp.lat, lon: bp.lng };
    locNote = "bprd-pin";
  }
  if (!loc) {
    const g = geocache[`${b.address}, ${b.city}, OR`];
    if (g && g.lat) {
      loc = { lat: g.lat, lon: g.lon };
      sources.push(
        g.type.startsWith("census") ? "census-geocoder" : "nominatim",
      );
      report.geocoded.push(`${b.name} (${g.type})`);
    }
  }
  if (!loc && ov.lat) {
    loc = { lat: ov.lat, lon: ov.lng };
    report.geocoded.push(`${b.name} (override: ${ov.loc_note})`);
  }
  if (!park)
    report.unmatched.push({
      name: b.name,
      city: b.city,
      loc: loc ? "fallback" : "NONE",
    });
  // single-ZIP towns get their ZIP; Bend has three, so it comes from the OSM park or an override
  const TOWN_ZIP = {
    Redmond: "97756",
    Sunriver: "97707",
    Terrebonne: "97760",
    Prineville: "97754",
    "La Pine": "97739",
    Sisters: "97759",
    Madras: "97741",
    Culver: "97734",
  };
  const zipStr =
    (park && T(park.e)["addr:postcode"]) || ov.zip || TOWN_ZIP[b.city] || null;
  const zip = zipStr ? [zipStr] : null;
  out.push({
    slug: null,
    name: b.name,
    city: b.city,
    lat: loc ? r5(loc.lat) : null,
    lng: loc ? r5(loc.lon) : null,
    address: `${b.address}, ${b.city}, OR${zip ? " " + zip[0] : ""}`,
    kind: "park",
    play,
    features: sortFeatures(f),
    confidence: "confirmed",
    sources: [...new Set(sources)],
    notes: bucketNotes(b),
    _loc: locNote,
  });
}

// ---------- other official parks (Prineville, La Pine) ----------
for (const o of other) {
  const anchor = TOWN_CENTER[o.city];
  const park = matchOsmPark(o.osm_name || o.name, anchor, 8000, {
    address: o.address || "",
  });
  const pgs = park ? playgroundsIn(park) : [];
  const f = new Set(o.features);
  const sources = [o.url, ...(o.extra_sources || [])];
  let loc = null;
  if (pgs.length) {
    loc = pickMain(pgs).pg.c;
    for (const i of pgs) {
      usedPg.add(i.ref);
      sources.push(i.ref);
      osmPlayFeatures(i.pg, f, new Set());
    }
  }
  if (park) {
    usedParkRefs.add(ref(park.e));
    sources.push(ref(park.e));
    osmParkFeatures(park, loc || park.c, f);
    if (!loc) loc = park.c;
  }
  if (!loc) {
    const g = o.address ? geocache[o.address] : null;
    if (g && g.lat) {
      loc = { lat: g.lat, lon: g.lon };
      sources.push(
        g.type.startsWith("census") ? "census-geocoder" : "nominatim",
      );
      report.geocoded.push(`${o.name} (${g.type})`);
    }
  }
  if (!park)
    report.unmatched.push({
      name: o.name,
      city: o.city,
      loc: loc ? "fallback" : "NONE",
    });
  out.push({
    slug: null,
    name: o.name,
    city: o.city,
    lat: loc ? r5(loc.lat) : null,
    lng: loc ? r5(loc.lon) : null,
    address: o.address,
    kind: "park",
    play: "playground",
    features: sortFeatures(f),
    confidence: o.confidence || "confirmed",
    sources: [...new Set(sources)],
    notes: o.note || null,
  });
}

// ---------- remaining OSM playgrounds (grouped by park) ----------
const groups = new Map();
for (const i of pgInfo) {
  if (usedPg.has(i.ref)) continue;
  if (i.excluded) {
    report.excluded.push({
      ref: i.ref,
      why: i.excluded,
      near: i.park ? T(i.park.e).name : null,
    });
    continue;
  }
  let key,
    name,
    kind,
    park = i.park;
  if (park && !usedParkRefs.has(ref(park.e))) {
    key = ref(park.e);
    name = T(park.e).name;
    kind = "park";
  } else if (park) {
    // inside a park already covered by the bucket list (e.g. a second playground) – already merged
    continue;
  } else if (i.school) {
    const ov = overrides.playgrounds[i.ref] || {};
    if (!ov.include_school) {
      report.schoolDropped.push({
        ref: i.ref,
        school: T(i.school.e).name || ref(i.school.e),
      });
      continue;
    }
    key = ref(i.school.e);
    name = ov.name || T(i.school.e).name;
    kind = "school";
  } else {
    name = i.name || T(i.pg.e).name;
    if (!name) {
      report.unnamedDropped.push({
        ref: i.ref,
        lat: r5(i.pg.c.lat),
        lng: r5(i.pg.c.lon),
        city: cityOf(i.pg.c),
      });
      continue;
    }
    key = (overrides.playgrounds[i.ref] || {}).group || i.ref;
    kind = (overrides.playgrounds[i.ref] || {}).kind || "standalone";
  }
  if (!groups.has(key)) groups.set(key, { key, name, kind, park, items: [] });
  groups.get(key).items.push(i);
}
for (const g of groups.values()) {
  const ovp = overrides.parks[g.name] || {};
  if (ovp.exclude) {
    report.excluded.push({ ref: g.key, why: ovp.exclude, near: g.name });
    continue;
  }
  const main = pickMain(g.items);
  const f = new Set();
  const sources = [];
  for (const i of g.items) {
    sources.push(i.ref);
    osmPlayFeatures(i.pg, f, new Set());
  }
  if (g.park) {
    sources.push(ref(g.park.e));
    osmParkFeatures(g.park, main.pg.c, f);
  } else osmParkFeatures(null, main.pg.c, f);
  const pt = T(g.park ? g.park.e : main.pg.e);
  const addr =
    pt["addr:housenumber"] && pt["addr:street"]
      ? `${pt["addr:housenumber"]} ${pt["addr:street"]}, ${pt["addr:city"] || cityOf(main.pg.c)}, OR${pt["addr:postcode"] ? " " + pt["addr:postcode"] : ""}`
      : null;
  const operator = pt.operator || T(main.pg.e).operator || null;
  // confidence: OSM playground mapped inside a named public park = confirmed per brief; else likely/unverified
  let confidence =
    g.kind === "park" ? "confirmed" : g.kind === "school" ? "likely" : "likely";
  if ((overrides.parks[g.name] || {}).confidence)
    confidence = overrides.parks[g.name].confidence;
  out.push({
    slug: null,
    name: ovp.name || g.name,
    city: ovp.city || cityOf(main.pg.c),
    lat: r5(main.pg.c.lat),
    lng: r5(main.pg.c.lon),
    address: ovp.address || addr,
    kind: g.kind,
    play: "playground",
    features: sortFeatures(new Set([...f, ...(ovp.features || [])])),
    confidence,
    sources: [...new Set([...sources, ...(ovp.sources || [])])],
    notes:
      ovp.note ||
      (operator && !/^(city of|bend park)/i.test(operator)
        ? `Operated by ${operator}.`
        : null),
  });
}

// ---------- finalize ----------
for (const p of out) delete p._loc;
out.sort(
  (a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name),
);
const seen = new Set();
for (const p of out) {
  let s = `${kebab(p.name)}-${kebab(p.city)}`;
  for (let k = 2; seen.has(s); k++)
    s = `${kebab(p.name)}-${kebab(p.city)}-${k}`;
  seen.add(s);
  p.slug = s;
}
const ordered = out.map((p) => ({
  slug: p.slug,
  name: p.name,
  city: p.city,
  lat: p.lat,
  lng: p.lng,
  address: p.address,
  kind: p.kind,
  play: p.play,
  features: p.features,
  confidence: p.confidence,
  sources: p.sources,
  notes: p.notes,
}));
writeFileSync(
  join(root, "parks.json"),
  JSON.stringify(ordered, null, 2) + "\n",
);
writeFileSync(
  join(root, "raw", "build-report.json"),
  JSON.stringify(report, null, 2),
);
const by = {};
for (const p of ordered)
  by[`${p.city} | ${p.play}`] = (by[`${p.city} | ${p.play}`] || 0) + 1;
console.log("total", ordered.length);
console.log(by);
console.log(
  "report:",
  Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])),
);
