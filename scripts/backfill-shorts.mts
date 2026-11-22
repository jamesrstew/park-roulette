/**
 * Backfill each stored event's `short` line from a reviewed JSON file
 * ([{slug, title, what, short}], e.g. /tmp/pr-news/batch7/shorts.json).
 *
 * Check only (default): every line through lib/events/short.ts against
 * the `what` and title in the file. No network.
 *
 *   pnpm exec tsx scripts/backfill-shorts.mts /tmp/pr-news/batch7/shorts.json
 *
 * Apply (after deploy): PATCH /api/events/<slug>/short for each, one at a
 * time. The server checks each line again against the event as stored and
 * changes only `short`. A 404 (no such event) or 422 (the stored `what`
 * changed since the file was written) is reported and skipped.
 *
 *   NEWS_INGEST_TOKEN=... pnpm exec tsx scripts/backfill-shorts.mts \
 *     /tmp/pr-news/batch7/shorts.json --apply [--site https://parkroulette.quest]
 */
import { readFileSync } from "node:fs";
import { shortProblems } from "../src/lib/events/short";

type Entry = { slug: string; title: string; what: string; short: string };

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("Give the shorts JSON file.");
const apply = args.includes("--apply");
const siteAt = args.indexOf("--site");
const site = (
  siteAt >= 0 ? args[siteAt + 1] : "https://parkroulette.quest"
).replace(/\/$/, "");

const entries = JSON.parse(readFileSync(file, "utf8")) as Entry[];

async function main() {
  let bad = 0;
  for (const e of entries) {
    const problems = shortProblems(e.short, e);
    if (problems.length) {
      bad++;
      console.log(
        `FAIL ${e.slug}: "${e.short}"\n     ${problems.join("\n     ")}`,
      );
    }
  }
  console.log(
    `${entries.length - bad} of ${entries.length} lines pass the checks.`,
  );
  if (!apply) return;
  if (bad) throw new Error("Fix the failing lines before --apply.");
  const token = process.env.NEWS_INGEST_TOKEN;
  if (!token) throw new Error("Set NEWS_INGEST_TOKEN to apply.");
  const tally = { set: 0, unchanged: 0, missing: 0, refused: 0, error: 0 };
  for (const e of entries) {
    const res = await fetch(
      `${site}/api/events/${encodeURIComponent(e.slug)}/short`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ short: e.short }),
      },
    ).catch((err: Error) => ({ ok: false, status: 0, err }) as const);
    if ("err" in res) {
      tally.error++;
      console.log(`ERROR ${e.slug}: ${res.err.message}`);
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as {
      previous?: string | null;
      problems?: string[];
      error?: string;
    };
    if (res.status === 200) {
      if (body.previous === e.short) tally.unchanged++;
      else tally.set++;
    } else if (res.status === 404) {
      tally.missing++;
      console.log(`MISSING ${e.slug} (no such event any more)`);
    } else if (res.status === 422) {
      tally.refused++;
      console.log(`REFUSED ${e.slug}: ${(body.problems ?? []).join(" ")}`);
    } else {
      tally.error++;
      console.log(`ERROR ${e.slug}: ${res.status} ${body.error ?? ""}`);
    }
  }
  console.log(JSON.stringify(tally));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
