/**
 * Read-only: list every stored event's upcoming dates that today's rules
 * can no longer prove (lib/events/state.ts unprovableTargets): a check
 * target on a page of many programs that doesn't name the event at its
 * venue (FIX), or its line for another start that day (note). Run it
 * after any change to how evidence is judged, before that change ships,
 * against production:
 *
 *   DATABASE_URL=<url> pnpm exec tsx --conditions react-server \
 *     scripts/scan-unprovable-targets.mts
 *
 * Each date it lists is fixed before the deploy: a re-hand (POST
 * /api/events) with the event's own line, or the date's own page, when
 * the date is real; scripts/trim-event-dates.mts when it never was. Exits
 * 1 when it finds any.
 */
import postgres from "postgres";
import { CATALOG } from "../src/lib/news/catalog";
import { isLocalDb } from "../src/lib/local-db";
import { pacificToday, type StoredEvent } from "../src/lib/events/model";
import { unprovableTargets } from "../src/lib/events/state";

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("Set DATABASE_URL on the command line.");
const sql = postgres(url, {
  max: 1,
  ssl: isLocalDb(url) ? false : "require",
  prepare: false,
  connection: { default_transaction_read_only: true },
});
const today = pacificToday(new Date());
const rows = await sql<{ id: number; slug: string; data: StoredEvent }[]>`
  select id, slug, data from kid_events order by id`;
let found = 0;
for (const r of rows) {
  const bad = unprovableTargets(r.data, CATALOG.shared_calendar_pages, today);
  if (!bad.length) continue;
  console.log(
    `\n${r.slug} (id ${r.id}): "${r.data.title}" at ${r.data.venue.name}`,
  );
  for (const b of bad) {
    console.log(
      `  ${b.why === "other_program" ? "FIX " : "note"} ${b.occurrence}: ${b.quote.slice(0, 100)}`,
    );
    if (b.why === "other_program") found++;
  }
}
console.log(
  `\n${found} date(s) checked on another program's line (FIX before deploying); "note" lines are a second showing on a day whose check line is the first.`,
);
await sql.end();
process.exit(found ? 1 : 0);
