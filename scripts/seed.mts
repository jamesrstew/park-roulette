/**
 * Loads data/parks.json into the database (upsert by slug) and makes sure the
 * first crew exists. Safe to re-run against a live database:
 *
 *  - never touches visits, reviews, media, crews or explorers
 *  - never touches a park's status / statusNote (cross-offs people made)
 *  - seeded parks count for everyone (approved_at), like curated ones
 *  - keeps play when a person corrected it (sources has "crowd:play")
 *  - keeps features when a person fixed them (sources has "crowd")
 *  - keeps confidence once "confirmed"
 *  - merges sources, so those markers (and "explorer:<id>") survive
 *  - never deletes rows: parks in the DB but not in the JSON are reported only
 *
 *   pnpm db:seed               # uses .env.local
 *   pnpm db:seed --dry-run     # show what would change, then roll back
 *   tsx --env-file=.env.railway scripts/seed.mts --dry-run
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { inviteCode } from "../src/lib/codes";

type SeedPark = {
  slug: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  address?: string | null;
  kind?: string;
  play?: string;
  features?: string[];
  confidence?: string;
  sources?: string[];
  notes?: string | null;
};

const DRY = process.argv.includes("--dry-run");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const host = new URL(url).host;

const file = existsSync("data/parks.json")
  ? "data/parks.json"
  : "data/dev-sample-parks.json";
if (!local && file !== "data/parks.json") {
  throw new Error(
    "Refusing to seed a non-local database from dev sample data.",
  );
}
const parks = JSON.parse(readFileSync(file, "utf8")) as SeedPark[];
const slugs = new Set<string>();
for (const p of parks) {
  if (slugs.has(p.slug))
    throw new Error(`Duplicate slug in ${file}: ${p.slug}`);
  slugs.add(p.slug);
  if (!["playground", "nature", "none", undefined].includes(p.play))
    throw new Error(`Bad play value for ${p.slug}: ${p.play}`);
}

const sql = postgres(url, { max: 1, ssl: local ? false : "require" });
console.log(
  `${DRY ? "[dry run] " : ""}Seeding ${parks.length} parks from ${file} into ${host}`,
);

const COLS = [
  "name",
  "city",
  "lat",
  "lng",
  "address",
  "kind",
  "play",
  "features",
  "confidence",
] as const;
type Row = Record<(typeof COLS)[number] | "slug", unknown>;
const snap = async (tx: postgres.TransactionSql) =>
  new Map(
    (
      await tx<
        Row[]
      >`select slug, ${tx(COLS as unknown as string[])} from parks`
    ).map((r) => [r.slug as string, r]),
  );

class DryRun extends Error {}

try {
  await sql.begin(async (tx) => {
    const before = await snap(tx);

    for (const p of parks) {
      await tx`
        insert into parks (slug, name, city, lat, lng, address, kind, play, features, confidence, sources, notes, approved_at)
        values (${p.slug}, ${p.name}, ${p.city}, ${p.lat}, ${p.lng}, ${p.address ?? null}, ${p.kind ?? "park"},
                ${p.play ?? "playground"}, ${p.features ?? []}, ${p.confidence ?? "unverified"},
                ${p.sources ?? []}, ${p.notes ?? null}, now())
        on conflict (slug) do update set
          name = excluded.name,
          city = excluded.city,
          lat = excluded.lat,
          lng = excluded.lng,
          address = excluded.address,
          kind = excluded.kind,
          notes = excluded.notes,
          approved_at = coalesce(parks.approved_at, now()),
          play = case when parks.sources @> array['crowd:play'] then parks.play else excluded.play end,
          features = case when parks.sources @> array['crowd'] then parks.features else excluded.features end,
          confidence = case when parks.confidence = 'confirmed' then parks.confidence else excluded.confidence end,
          sources = array(
            select distinct s from unnest(
              excluded.sources ||
              array(select x from unnest(parks.sources) x where x like 'crowd%' or x like 'explorer:%')
            ) s
          )`;
    }

    const after = await snap(tx);
    let inserted = 0;
    let updated = 0;
    for (const [slug, row] of after) {
      const old = before.get(slug);
      if (!old) {
        if (slugs.has(slug)) inserted++;
        continue;
      }
      const changed = COLS.filter(
        (c) => JSON.stringify(old[c]) !== JSON.stringify(row[c]),
      );
      if (changed.length) {
        updated++;
        console.log(
          `  ~ ${slug}: ${changed.map((c) => `${c} ${JSON.stringify(old[c])} → ${JSON.stringify(row[c])}`).join("; ")}`,
        );
      }
    }
    console.log(
      `  ${inserted} new, ${updated} changed, ${parks.length - inserted - updated} unchanged`,
    );

    const stale = await tx`
      select p.slug, p.status,
        (select count(*) from visits v where v.park_id = p.id)::int as visits,
        (select count(*) from reviews r where r.park_id = p.id)::int as reviews,
        p.added_by is not null as added_in_app
      from parks p where not (p.slug = any(${[...slugs]}))
      order by p.slug`;
    if (stale.length) {
      console.log(
        `  ${stale.length} park(s) in the DB are not in ${file} (left alone):`,
      );
      for (const s of stale)
        console.log(
          `    ? ${s.slug} (${s.status}${s.added_in_app ? ", added in app" : ""}; ${s.visits} visits, ${s.reviews} reviews)`,
        );
    }

    if (DRY) throw new DryRun();
  });
} catch (e) {
  if (!(e instanceof DryRun)) throw e;
  console.log("[dry run] rolled back; nothing was written.");
}

if (!DRY) {
  let [crew] = await sql`select * from crews order by id limit 1`;
  if (!crew) {
    [crew] = await sql`insert into crews (name, color, join_code, friend_code)
      values (${process.env.CREW_NAME ?? "Team Stewart"}, 'red', ${inviteCode()}, ${inviteCode()}) returning *`;
    console.log(`Created crew "${crew.name}"`);
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const links = `Join "${crew.name}": ${site}/join/${crew.join_code}\nInvite a friend: ${site}/join/${crew.friend_code}\n`;
  if (local) {
    console.log(`\n${links}`);
  } else {
    // Invite links are the keys to the crew: keep them out of logs and terminals.
    const out = ".crew-links.local";
    writeFileSync(out, links, { mode: 0o600 });
    console.log(
      `Crew invite links written to ${out} (gitignored, owner-only).`,
    );
  }
}
await sql.end();
