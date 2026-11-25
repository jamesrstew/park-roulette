/**
 * Render sample park pairings carousels from REAL Google Places data and
 * our real parks, for design review. Nothing is stored, uploaded or
 * published; Places results stay in memory (the data.json written next to
 * the slides holds only the facts each slide prints, for checking).
 *
 *   GOOGLE_PLACES_KEY=... pnpm exec tsx --conditions react-server \
 *     scripts/mashup-samples.tsx <out-dir> [coffee,food_trucks,breweries,treats] [--month N] [--cache <dir>]
 *
 * Each theme is drawn for the month its first carousel goes out under the
 * alternation (coffee Dec 2, food trucks Dec 16, breweries Dec 30, treats
 * Jan 13), unless --month says otherwise. Story echo frames go in story/.
 */
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CATALOG } from "../src/lib/news/catalog";
import { PROFILES } from "../src/lib/park-profiles";
import { renderFrame } from "../src/lib/social/echo-render";
import { makeMashup } from "../src/lib/social/mashup-make";
import {
  MASHUP_THEMES,
  type MashupHistory,
  type MashupTheme,
  miles,
  type Place,
  postableParks,
} from "../src/lib/social/mashup";
import { placesKey, themePlaces } from "../src/lib/social/places";
import { renderPost } from "../src/lib/social/render";

const out = process.argv[2] ?? "/tmp/pr-news/batch10/mashups";
const only = (process.argv[3]?.startsWith("--") ? "" : (process.argv[3] ?? ""))
  .split(",")
  .filter(Boolean) as MashupTheme[];
const monthAt = process.argv.indexOf("--month");
const forced = monthAt > 0 ? Number(process.argv[monthAt + 1]) : null;
/**
 * --cache <dir>: keep each theme's Places results there (outside the repo,
 * a short-lived cache: Google allows 30 days) so a re-render doesn't spend
 * the key's small daily quota. Entries older than 30 days are fetched again.
 */
const cacheAt = process.argv.indexOf("--cache");
const cacheDir = cacheAt > 0 ? process.argv[cacheAt + 1] : null;
const CACHE_DAYS = 30;

async function cachedPlaces(
  theme: MashupTheme,
  month: number,
  fetchThem: () => Promise<Place[]>,
): Promise<Place[]> {
  if (!cacheDir) return fetchThem();
  const file = join(cacheDir, `${theme}-m${month}.json`);
  try {
    const got = JSON.parse(await readFile(file, "utf8")) as {
      at: number;
      places: Place[];
    };
    if (Date.now() - got.at < CACHE_DAYS * 86_400_000) return got.places;
  } catch {
    // Not cached yet.
  }
  const places = await fetchThem();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, JSON.stringify({ at: Date.now(), places }));
  return places;
}

/** When each theme's first carousel goes out (the alternation, from Dec 2). */
const FIRST: Record<MashupTheme, string> = {
  coffee: "2026-12-02",
  food_trucks: "2026-12-16",
  breweries: "2026-12-30",
  treats: "2027-01-13",
};

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

async function main() {
  const key = placesKey();
  const themes = only.length ? only : [...MASHUP_THEMES];
  await mkdir(join(out, "story"), { recursive: true });
  // The parks earlier samples used are on Instagram lately (the cooldown),
  // as they would be in production.
  const cooling = new Set<string>();
  for (const theme of themes) {
    const day = FIRST[theme];
    const month = forced ?? Number(day.slice(5, 7));
    const vetted = postableParks(parks, PROFILES, CATALOG, month, cooling);
    // The themes before it, as the rotation would have them.
    const history: MashupHistory[] = MASHUP_THEMES.slice(
      0,
      MASHUP_THEMES.indexOf(theme),
    ).map((t) => ({ slotDate: FIRST[t], theme: t, cycle: 1, placeIds: [] }));
    const made = await makeMashup({
      month,
      slotDate: day,
      parks: vetted,
      history,
      recent: [],
      dms: true,
      places: (t) =>
        cachedPlaces(t, month, () => themePlaces(t, vetted, month, { key })),
      only: theme,
    });
    if (!made.ok) {
      console.log(theme, "not made:", made.tried);
      continue;
    }
    for (const p of made.pairs) cooling.add(p.park.slug);
    const name = `${theme}${forced ? `-m${month}` : ""}`;
    const files = await renderPost(made.spec, []);
    for (const [i, f] of files.entries())
      await writeFile(join(out, `${name}-${i + 1}.jpg`), f.bytes);
    for (let i = 0; i < made.spec.slides.length; i++) {
      const f = await renderFrame(made.spec.slides, i, null);
      await writeFile(
        join(out, "story", `${name}-story-${i + 1}.jpg`),
        f.bytes,
      );
    }
    await writeFile(
      join(out, `${name}-caption.txt`),
      `${made.spec.caption}\n\n--- Facebook ---\n\n${made.spec.fbCaption}\n`,
    );
    // The facts behind each slide (never the rating or anything else of
    // Google's beyond the booleans each chip reads).
    const facts = made.pairs.map((p) => ({
      placeId: p.place.placeId,
      place: p.place.name,
      town: p.place.town,
      businessStatus: p.place.businessStatus,
      primaryType: p.place.primaryType,
      goodForChildren: p.place.goodForChildren,
      menuForChildren: p.place.menuForChildren,
      outdoorSeating: p.place.outdoorSeating,
      dineIn: p.place.dineIn,
      park: p.park.name,
      parkTown: p.park.city,
      parkTrait: p.park.trait,
      straightLineMiles: Number(miles(p.place, p.park).toFixed(3)),
      apart: p.apart,
    }));
    await writeFile(
      join(out, `${name}-data.json`),
      JSON.stringify(
        { theme, firstDay: day, month, pairs: facts, left_out: made.out },
        null,
        2,
      ),
    );
    console.log(`${name}: ${made.spec.headline} (${made.pairs.length} pairs)`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
