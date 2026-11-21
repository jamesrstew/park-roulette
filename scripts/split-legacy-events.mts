/**
 * One-time repair: split legacy merged event rows (keyed series:<id>
 * alone) by their own stored per-date targets. Each date's target page is
 * read (its JSON-LD names the program, branch and town); dates of another
 * program or branch move to their own page through the same splitEvent()
 * the /admin button uses, so every move is logged in kid_event_edits with
 * the whole source row. Dates whose page can't be read stay and are
 * listed.
 *
 *   DATABASE_URL=<local copy> npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/split-legacy-events.mts [--apply]
 *
 * Local databases only (a copy): production is repaired in /admin, with
 * James's go. Without --apply it only prints the plan.
 */
import { asc, sql } from "drizzle-orm";
import { isLocalDb } from "../src/lib/local-db";
import { UA } from "../src/lib/news/ua";

const url = process.env.DATABASE_URL ?? "";
if (!isLocalDb(url)) {
  console.error(
    "Refusing: DATABASE_URL must be a local copy. Repair production in /admin.",
  );
  process.exit(1);
}
const apply = process.argv.includes("--apply");

const { db } = await import("../src/db");
const { kidEvents } = await import("../src/db/schema");
const { LEGACY_SERIES_KEY } = await import("../src/lib/events/model");
const { planLegacySplit, resolveFromJsonLd } =
  await import("../src/lib/events/legacy-split");
const { rowKey, splitEvent } = await import("../src/lib/events/store");
const { eq } = await import("drizzle-orm");
type Resolved = import("../src/lib/events/legacy-split").Resolved;
type StoredEvent = import("../src/lib/events/model").StoredEvent;

async function resolve(u: string): Promise<Resolved | null> {
  try {
    const r = await fetch(u, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    return resolveFromJsonLd(await r.text());
  } catch {
    return null;
  } finally {
    await new Promise((res) => setTimeout(res, 500)); // one host, politely
  }
}

const rows = (
  await db.select().from(kidEvents).orderBy(asc(kidEvents.id))
).filter((r) => LEGACY_SERIES_KEY.test(r.seriesKey));
console.log(`${rows.length} legacy rows.${apply ? "" : " (dry run)"}`);
for (const r of rows) {
  const e = r.data as StoredEvent;
  const resolved: Record<string, Resolved | null> = {};
  for (const d of e.dates) {
    const t = e.targets?.[d.day]?.url;
    resolved[d.day] = t ? await resolve(t) : null;
  }
  const plan = planLegacySplit(e, resolved);
  console.log(
    `\n${r.slug} (${e.title} at ${e.venue.name}): ${e.dates.length} dates`,
  );
  for (const g of plan.groups)
    console.log(
      `  move ${g.occurrences.length} to "${g.title}" at ${g.venue}, ${g.town}: ${g.occurrences.join(", ")}`,
    );
  if (plan.unknown.length)
    console.log(`  unread, staying: ${plan.unknown.join(", ")}`);
  if (!apply) continue;
  for (const g of plan.groups) {
    const res = await splitEvent(
      r.id,
      g.occurrences,
      { title: g.title, venueName: g.venue, venueTown: g.town },
      null,
    );
    console.log(
      res.ok ? `  moved to ${res.newSlug}` : `  failed: ${res.error}`,
    );
  }
}
// Every legacy row left now holds only its own program's dates: give it
// the key its data makes (unless that page already exists).
if (apply)
  for (const r of rows) {
    const [now] = await db
      .select()
      .from(kidEvents)
      .where(eq(kidEvents.id, r.id));
    if (!now) continue;
    const key = rowKey(now);
    const [taken] = await db
      .select({ id: kidEvents.id })
      .from(kidEvents)
      .where(eq(kidEvents.seriesKey, key));
    if (taken) console.log(`${now.slug}: ${key} is taken, left as is`);
    else {
      await db
        .update(kidEvents)
        .set({ seriesKey: key })
        .where(eq(kidEvents.id, r.id));
      console.log(`${now.slug}: re-keyed to ${key}`);
    }
  }
await db.execute(sql`select 1`);
process.exit(0);
