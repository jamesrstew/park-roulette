/**
 * Loads data/parks.json into the database (upsert by slug) and makes sure the
 * first crew exists. Safe to re-run: never touches status flags, visits or reviews.
 *
 *   pnpm db:seed                      # uses .env.local
 *   CREW_NAME="Team Stewart" pnpm db:seed
 */
import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import postgres from "postgres";

type SeedPark = {
  slug: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  address?: string | null;
  kind?: string;
  features?: string[];
  confidence?: string;
  sources?: string[];
  notes?: string | null;
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { max: 1, ssl: local ? false : "require" });

const file = existsSync("data/parks.json")
  ? "data/parks.json"
  : "data/dev-sample-parks.json";
const parks = JSON.parse(readFileSync(file, "utf8")) as SeedPark[];
console.log(
  `Seeding ${parks.length} parks from ${file} into ${new URL(url).host}`,
);

for (const p of parks) {
  await sql`
    insert into parks (slug, name, city, lat, lng, address, kind, play, features, confidence, sources, notes)
    values (${p.slug}, ${p.name}, ${p.city}, ${p.lat}, ${p.lng}, ${p.address ?? null}, ${p.kind ?? "park"}, ${p.play ?? "playground"},
            ${p.features ?? []}, ${p.confidence ?? "unverified"}, ${p.sources ?? []}, ${p.notes ?? null})
    on conflict (slug) do update set
      name = excluded.name, city = excluded.city, lat = excluded.lat, lng = excluded.lng,
      address = excluded.address, kind = excluded.kind, play = excluded.play, sources = excluded.sources, notes = excluded.notes,
      -- keep crowd-fixed features/confidence once a human has confirmed them
      features = case when parks.confidence = 'confirmed' and parks.sources @> array['crowd'] then parks.features else excluded.features end,
      confidence = case when parks.confidence = 'confirmed' then parks.confidence else excluded.confidence end`;
}

const ADJ = [
  "wobbly",
  "giggly",
  "bouncy",
  "sparkly",
  "zippy",
  "sneaky",
  "fuzzy",
  "loopy",
];
const NOUN = [
  "crayon",
  "slide",
  "swing",
  "sandbox",
  "pinecone",
  "otter",
  "rocket",
  "marmot",
];
const code = () =>
  `${ADJ[randomInt(ADJ.length)]}-${NOUN[randomInt(NOUN.length)]}-${randomInt(10000, 99999)}${randomInt(100, 999)}`;

let [crew] = await sql`select * from crews order by id limit 1`;
if (!crew) {
  [crew] = await sql`insert into crews (name, color, join_code, friend_code)
    values (${process.env.CREW_NAME ?? "Team Stewart"}, 'red', ${code()}, ${code()}) returning *`;
  console.log(`Created crew "${crew.name}"`);
}
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
console.log(`\n  Join "${crew.name}":   ${site}/join/${crew.join_code}`);
console.log(`  Invite a friend:      ${site}/join/${crew.friend_code}\n`);
await sql.end();
