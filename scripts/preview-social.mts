/**
 * Preview the next Tuesday's "Family events this week" roundup from a real
 * database, READ-ONLY. It reads kid_events in a read-only transaction (and a
 * read-only session), picks and draws the post exactly as the Tuesday cron
 * would, and writes the slides as JPEGs plus the caption to a folder.
 * Nothing is stored, uploaded or published, and Meta is never called.
 *
 *   DATABASE_URL=<url> pnpm exec tsx --conditions react-server \
 *     scripts/preview-social.mts <out-dir> [<a Tuesday, YYYY-MM-DD>]
 *
 * DATABASE_URL must be given on the command line (.env.local isn't read).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import type { EventRow } from "../src/lib/events/model";
import { addDays, pacific } from "../src/lib/news/time";
import { composeEventsWeek } from "../src/lib/social/compose";
import { mondayOf, slotFor } from "../src/lib/social/model";
import { renderPost } from "../src/lib/social/render";
import { pickWeekEvents, roundupWindow } from "../src/lib/social/roundup";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL on the command line.");
const out = process.argv[2];
if (!out) throw new Error("Give an output folder.");
const asked = process.argv[3];
if (asked && !/^\d{4}-\d{2}-\d{2}$/.test(asked))
  throw new Error("The day must be YYYY-MM-DD (a Tuesday).");

/** The Monday of the week whose Tuesday slot is next (or the one asked for). */
function weekToPreview(now: Date): string {
  if (asked) {
    const week = mondayOf(asked);
    if (slotFor("events_week", week).date !== asked)
      throw new Error(`${asked} isn't a Tuesday.`);
    return week;
  }
  const week = mondayOf(pacific(now).date);
  return slotFor("events_week", week).publishAt > now ? week : addDays(week, 7);
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, {
  max: 1,
  ssl: local ? false : "require",
  connection: {
    application_name: "preview-social (read-only)",
    default_transaction_read_only: true,
  },
});

type Raw = {
  id: number;
  slug: string;
  kind: string;
  data: unknown;
  status: string;
  confirm: string;
  last_seen_at: Date | null;
  facts_changed_at: Date;
  state_changed_at: Date | null;
};

async function main() {
  const now = new Date();
  const week = weekToPreview(now);
  const { date, publishAt } = slotFor("events_week", week);
  const raws = await sql.begin(
    "read only",
    async (tx) =>
      tx<Raw[]>`select id, slug, kind, data, status, confirm, last_seen_at,
      facts_changed_at, state_changed_at from kid_events`,
  );
  const rows: EventRow[] = raws.map((r) => ({
    id: r.id,
    slug: r.slug,
    kind: r.kind as EventRow["kind"],
    data: r.data as EventRow["data"],
    status: r.status as EventRow["status"],
    confirm: r.confirm as EventRow["confirm"],
    lastSeenAt: r.last_seen_at,
    factsChangedAt: r.facts_changed_at,
    stateChangedAt: r.state_changed_at,
  }));
  // Pick as the cron would: an hour before the slot (or now, if later).
  const at = new Date(
    Math.max(now.getTime(), publishAt.getTime() - 60 * 60_000),
  );
  const window = roundupWindow(date, publishAt);
  const pick = pickWeekEvents(rows, window, at);
  console.log(`Tuesday ${date} (${window.label}): ${rows.length} events read.`);
  console.log(`Left out (${pick.left.length}):`);
  for (const l of pick.left) console.log(`  - ${l}`);
  if (pick.skip) {
    console.log(`No roundup this week: ${pick.skip}`);
    return;
  }
  console.log(`In (${pick.events.length}):`);
  for (const e of pick.events)
    console.log(
      `  - ${e.weekday} ${e.date} ${e.time}: ${e.title} (${e.town})${e.desc ? `\n      ${e.desc}` : ""}`,
    );
  const spec = composeEventsWeek(pick.events, window, false);
  await mkdir(out, { recursive: true });
  const files = await renderPost(spec, []);
  for (const [i, f] of files.entries()) {
    const name = `events_week-${date}-${i + 1}.jpg`;
    await writeFile(join(out, name), f.bytes);
    console.log(`  wrote ${name}`);
  }
  await writeFile(join(out, `events_week-${date}-caption.txt`), spec.caption!);
  console.log("Nothing was saved to the database or published.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
