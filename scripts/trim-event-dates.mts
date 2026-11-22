/**
 * Take wrong dates off stored events through the same trim the /admin
 * button uses (lib/events/store.ts trimEventDates): the row's dates and
 * per-day targets change, and each trim is logged in kid_event_edits
 * (append-only, action "trim", with the reason), so a later hand-in can't
 * bring the dates back.
 *
 *   DATABASE_URL=<url> pnpm exec tsx --conditions react-server \
 *     scripts/trim-event-dates.mts <plan.json> [--apply] [--prod]
 *
 * plan.json: {"reason": "...", "events": [{"slug": "...", "days":
 * ["2026-11-30-1030", "2026-12-01"]}]}. An entry in days is an occurrence
 * (day and start, as /admin shows it) or a bare day (every occurrence that
 * day). Without --apply it only reads (a read-only session) and prints the
 * plan. --apply on a database that isn't local also needs --prod.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { z } from "zod";
import { isLocalDb } from "../src/lib/local-db";

const Plan = z.strictObject({
  reason: z.string().trim().min(10).max(300),
  events: z
    .array(
      z.strictObject({
        slug: z.string().min(1),
        days: z
          .array(z.string().regex(/^\d{4}-\d{2}-\d{2}(-\d{4}|-all-day)?$/))
          .min(1),
      }),
    )
    .min(1),
});

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("Set DATABASE_URL on the command line.");
const file = process.argv[2];
if (!file || file.startsWith("--")) throw new Error("Give a plan file.");
const apply = process.argv.includes("--apply");
if (apply && !isLocalDb(url) && !process.argv.includes("--prod")) {
  console.error(
    "Refusing: --apply on a database that isn't local needs --prod.",
  );
  process.exit(1);
}
const plan = Plan.parse(JSON.parse(readFileSync(file, "utf8")));

const { occurrenceId } = await import("../src/lib/events/model");
const { planTrim, trimEventDates } = await import("../src/lib/events/store");
type StoredEvent = import("../src/lib/events/model").StoredEvent;

// Reads go through a read-only session, whatever the mode.
const ro = postgres(url, {
  max: 1,
  ssl: isLocalDb(url) ? false : "require",
  prepare: false,
  connection: { default_transaction_read_only: true },
});

console.log(
  `${apply ? "APPLY" : "DRY RUN"} on ${new URL(url).hostname}. Reason: ${plan.reason}`,
);
let bad = 0;
const todo: { id: number; slug: string; occ: string[] }[] = [];
for (const p of plan.events) {
  const [row] = await ro<{ id: number; data: StoredEvent }[]>`
    select id, data from kid_events where slug = ${p.slug}`;
  if (!row) {
    console.log(`\n${p.slug}: not found`);
    bad++;
    continue;
  }
  const e = row.data;
  const want = new Set(p.days);
  const occ = e.dates
    .map(occurrenceId)
    .filter((o) => want.has(o) || want.has(o.slice(0, 10)));
  const unmatched = p.days.filter(
    (d) => !occ.some((o) => o === d || o.slice(0, 10) === d),
  );
  const r = planTrim(e, occ);
  console.log(`\n${p.slug} (id ${row.id}): "${e.title}" at ${e.venue.name}`);
  if (unmatched.length) {
    console.log(`  not on the page: ${unmatched.join(", ")}`);
    bad++;
  }
  if (!r.ok) {
    console.log(`  can't trim: ${r.error}`);
    bad++;
    continue;
  }
  console.log(
    `  take off ${r.hit.length}: ${r.hit.map(occurrenceId).join(", ")}`,
  );
  console.log(`  dates left: ${e.dates.length} -> ${r.next.dates.length}`);
  for (const d of r.hit)
    console.log(
      `    ${occurrenceId(d)} was checked on: ${(e.targets?.[d.day]?.quote ?? "(none)").slice(0, 110)}`,
    );
  todo.push({ id: row.id, slug: p.slug, occ });
}
await ro.end();

if (bad) {
  console.log(`\n${bad} problem(s) above: nothing applied.`);
  process.exit(1);
}
if (!apply) {
  console.log("\nDry run: nothing written. Add --apply to trim.");
  process.exit(0);
}
for (const t of todo) {
  const r = await trimEventDates(t.id, t.occ, null, plan.reason);
  console.log(
    r.ok
      ? `trimmed ${t.slug}: ${r.removed.join(", ")}`
      : `${t.slug}: ${r.error}`,
  );
}
process.exit(0);
