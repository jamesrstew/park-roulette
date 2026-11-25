/**
 * Render sample park pairings carousels with every kind of anchor (parks,
 * indoor places, this weekend's events), from REAL Google Places data, our
 * real parks and indoor registry, and our real events listing, for design
 * review. Nothing is stored, uploaded or published.
 *
 *   GOOGLE_PLACES_KEY=... pnpm exec tsx --conditions react-server \
 *     scripts/anchor-samples.tsx <out-dir> <name> [--theme coffee] \
 *     [--wed 2026-12-02] [--weather good|wet|cold] [--thin N] \
 *     [--cache <dir>] [--via search|autocomplete]
 *
 * --weather simulates the weekend's forecast; --thin N keeps only the N
 * best park anchors (a short supply). --cache keeps Places results and
 * hours outside the repo for at most 30 days (Google's limit), so re-renders
 * spend no quota. --via autocomplete finds the cafes with Places
 * Autocomplete and Place Details instead of Text Search (another quota).
 *
 * The weekend's events come from parkroulette.quest's own event pages
 * (their schema.org data); a venue's point is our park's or indoor place's
 * when the name matches, else OpenStreetMap's for its street address, and
 * an event counts as indoors only at a library, a museum or a registry
 * place (the
 * production make uses each event's own setting and pin).
 */
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CATALOG } from "../src/lib/news/catalog";
import { UA } from "../src/lib/news/ua";
import { PROFILES } from "../src/lib/park-profiles";
import { renderFrame } from "../src/lib/social/echo-render";
import { siteDomain } from "../src/lib/social/handles";
import { INDOOR } from "../src/lib/social/indoor";
import { makeMashup } from "../src/lib/social/mashup-make";
import {
  type EventAnchorInput,
  eventAnchors,
  type Hours,
  indoorAnchors,
  type MashupTheme,
  miles,
  type Place,
  postableParks,
  type Weather,
  weekendOf,
} from "../src/lib/social/mashup";
import {
  PLACE_FIELDS,
  placeHours,
  placesKey,
  themePlaces,
  toPlace,
} from "../src/lib/social/places";
import { renderPost } from "../src/lib/social/render";
import postgres from "postgres";
import { toRow } from "../src/lib/events/store";
import { eventInputs } from "../src/lib/social/mashup-events";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = process.argv[2] ?? "/tmp/pr-news/batch12/anchors";
const name = process.argv[3] ?? "normal";
const theme = (arg("--theme") ?? "coffee") as MashupTheme;
const wed = arg("--wed") ?? "2026-12-02";
const weatherArg = arg("--weather") ?? "good";
const thin = arg("--thin") ? Number(arg("--thin")) : null;
const cacheDir = arg("--cache") ?? null;
const via = arg("--via") ?? "search";
/** A local copy of the events table (never production): the real make's rules. */
const eventsDb = arg("--events-db") ?? null;
const CACHE_MS = 30 * 86_400_000;
const month = Number(wed.slice(5, 7));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cached<T>(file: string, make: () => Promise<T>): Promise<T> {
  if (!cacheDir) return make();
  const path = join(cacheDir, file);
  try {
    const got = JSON.parse(await readFile(path, "utf8")) as {
      at: number;
      v: T;
    };
    if (Date.now() - got.at < CACHE_MS) return got.v;
  } catch {
    // Not cached yet.
  }
  const v = await make();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, JSON.stringify({ at: Date.now(), v }));
  return v;
}

const parks = (
  JSON.parse(readFileSync("data/parks.json", "utf8")) as {
    slug: string;
    name: string;
    city: string;
    lat: number;
    lng: number;
    play: string;
  }[]
).map((p) => ({ ...p, approved: true, status: "active" }));

/** Cafes by Autocomplete near each park, then Place Details for each. */
async function viaAutocomplete(
  key: string,
  centers: { lat: number; lng: number }[],
): Promise<Place[]> {
  const ids = new Set<string>();
  for (const c of centers)
    for (const input of ["coffee", "cafe"]) {
      const res = await fetch(
        "https://places.googleapis.com/v1/places:autocomplete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            input,
            includedPrimaryTypes: ["coffee_shop", "cafe", "tea_house"],
            locationRestriction: {
              circle: {
                center: { latitude: c.lat, longitude: c.lng },
                radius: 2500,
              },
            },
          }),
        },
      );
      const j = (await res.json()) as {
        suggestions?: { placePrediction?: { placeId?: string } }[];
      };
      for (const s of j.suggestions ?? [])
        if (s.placePrediction?.placeId) ids.add(s.placePrediction.placeId);
    }
  const out: Place[] = [];
  for (const id of ids) {
    const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
      headers: {
        "x-goog-api-key": key,
        "x-goog-fieldmask": PLACE_FIELDS.join(","),
      },
    });
    const p = toPlace(await res.json());
    if (p) out.push(p);
  }
  return out;
}

/** This weekend's events from our own site's event pages. */
async function siteEvents(): Promise<EventAnchorInput[]> {
  const days = new Set(weekendOf(wed));
  const list = await (
    await fetch("https://parkroulette.quest/events", {
      headers: { "user-agent": UA },
    })
  ).text();
  const slugs = [
    ...new Set(
      [...list.matchAll(/href="\/events\/([a-z0-9-]+)"/g)].map((m) => m[1]),
    ),
  ];
  const out: EventAnchorInput[] = [];
  const known = [
    ...INDOOR.map((x) => ({
      name: x.name,
      lat: x.lat,
      lng: x.lng,
      indoor: true,
    })),
    ...parks.map((p) => ({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      indoor: false,
    })),
  ];
  for (const slug of slugs) {
    const html = await (
      await fetch(`https://parkroulette.quest/events/${slug}`, {
        headers: { "user-agent": UA },
      })
    ).text();
    const blocks = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ]
      .flatMap((m) => {
        try {
          const v = JSON.parse(m[1]);
          return Array.isArray(v) ? v : [v];
        } catch {
          return [];
        }
      })
      .filter((v) => v["@type"] === "Event");
    for (const e of blocks) {
      const day = String(e.startDate).slice(0, 10);
      if (!days.has(day) || !/T\d{2}:\d{2}/.test(e.startDate)) continue;
      if (!/EventScheduled/.test(e.eventStatus ?? "")) continue;
      const venue = String(e.location?.name ?? "");
      const town = String(e.location?.address?.addressLocality ?? "");
      const street = e.location?.address?.streetAddress;
      let at = known.find(
        (k) => venue.includes(k.name) || k.name.includes(venue),
      );
      if (!at && street) {
        await sleep(1_100);
        const q = new URLSearchParams({
          q: `${street}, ${town}, OR`,
          format: "json",
          limit: "1",
        });
        const g = (await (
          await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
            headers: { "user-agent": UA },
          })
        ).json()) as { lat: string; lon: string }[];
        if (g[0])
          at = {
            name: venue,
            lat: Number(g[0].lat),
            lng: Number(g[0].lon),
            indoor: /library|museum|theat(re|er)/i.test(venue),
          };
      }
      if (!at) continue;
      const desc = String(e.description ?? "")
        .split(/(?<=\.)\s/)[0]
        .replace(/\.$/, "");
      out.push({
        slug,
        title: String(e.name),
        day,
        start: String(e.startDate).slice(11, 16),
        town,
        lat: at.lat,
        lng: at.lng,
        regular: blocks.length > 2,
        indoor: at.indoor || /library|museum|theat(re|er)/i.test(venue),
        short: desc.length <= 70 ? desc : null,
        venue,
        host: siteDomain(e.organizer?.url),
      });
    }
  }
  return out;
}

/** This weekend's events from a LOCAL copy of kid_events, by the make's own rules. */
async function dbEvents(url: string): Promise<EventAnchorInput[]> {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url))
    throw new Error("--events-db must be a local database.");
  const sql = postgres(url, { max: 1 });
  const rows = await sql`select * from kid_events`;
  await sql.end();
  return eventInputs(
    rows.map((r) =>
      toRow({
        id: r.id,
        slug: r.slug,
        kind: r.kind,
        data: r.data,
        status: r.status,
        confirm: r.confirm,
        lastSeenAt: r.last_seen_at,
        factsChangedAt: r.facts_changed_at,
        stateChangedAt: r.state_changed_at,
      } as never),
    ),
    wed,
    new Date(),
  );
}

async function main() {
  const key = placesKey();
  let vetted = postableParks(parks, PROFILES, CATALOG, month);
  const events = eventAnchors(
    eventsDb
      ? await dbEvents(eventsDb)
      : await cached(`events-${wed}.json`, siteEvents),
    wed,
  );
  const indoor = indoorAnchors();
  const places = await cached(`${theme}-m${month}-${via}.json`, () =>
    via === "autocomplete"
      ? viaAutocomplete(
          key,
          vetted.filter(
            (p, i, all) => all.findIndex((q) => miles(p, q) < 1.2) === i,
          ),
        )
      : themePlaces(theme, [...vetted, ...indoor, ...events], month, { key }),
  );
  if (thin != null) {
    // A short supply: only the parks of the N best pairs today.
    const best = vetted
      .map((p) => ({ p, d: Math.min(...places.map((c) => miles(c, p))) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, thin)
      .map((x) => x.p);
    vetted = best;
  }
  const weather: Weather =
    weatherArg === "good"
      ? { bad: false }
      : { bad: true, kind: weatherArg === "cold" ? "cold" : "wet" };
  const made = await makeMashup({
    month,
    slotDate: wed,
    parks: [...vetted, ...indoor, ...events],
    history: [],
    recent: [],
    dms: true,
    only: theme,
    weather,
    places: async () => places,
    indoorHours: (id) =>
      cached<Hours | null>(`hours-${id}.json`, () => placeHours(id, { key })),
  });
  if (!made.ok) {
    console.log(name, "not made:", made.tried, made.fatal ?? "");
    return;
  }
  await mkdir(join(out, "story"), { recursive: true });
  const files = await renderPost(made.spec, []);
  for (const [i, f] of files.entries())
    await writeFile(join(out, `${name}-${i + 1}.jpg`), f.bytes);
  for (let i = 0; i < made.spec.slides.length; i++) {
    const f = await renderFrame(made.spec.slides, i, null);
    await writeFile(join(out, "story", `${name}-story-${i + 1}.jpg`), f.bytes);
  }
  await writeFile(
    join(out, `${name}-caption.txt`),
    `${made.spec.caption}\n\n--- Facebook ---\n\n${made.spec.fbCaption}\n`,
  );
  // The facts behind each slide, for checking (outside the repo).
  await writeFile(
    join(out, `${name}-data.json`),
    JSON.stringify(
      {
        wed,
        weekend: weekendOf(wed),
        weather,
        mix: made.mix,
        pairs: made.pairs.map((p) => ({
          place: p.place.name,
          placeId: p.place.placeId,
          town: p.place.town,
          anchor: p.park.name,
          anchorKind: p.park.kind,
          label: p.park.label,
          line: p.park.trait,
          indoor: p.park.sheltered,
          straightLineMiles: Number(miles(p.place, p.park).toFixed(3)),
          apart: p.apart,
          event: p.park.event ?? null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(
    `${name}: ${made.spec.headline} (${made.mix}, ${made.pairs.length} pairs)`,
  );
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
