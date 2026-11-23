/**
 * Redraw a queued Instagram post with the current layout (store.ts
 * redrawQueued): its stored draft is validated again against today's
 * facts, drawn again, and, with --apply, its spec, media and caption are
 * replaced in place while it's still queued (never once the publisher has
 * claimed it). Writer posts only (park post, Unpack, at home).
 *
 * Dry run (the default): nothing is stored or uploaded. The new slides go
 * to --out (default /tmp/redraw-<id>) with the caption, for review.
 *
 *   DATABASE_URL=<url> pnpm exec tsx --conditions react-server \
 *     scripts/redraw-social.mts <id> [--out <dir>]
 *
 * Apply (needs BLOB_READ_WRITE_TOKEN too, to store the new JPEGs):
 *
 *   DATABASE_URL=<url> BLOB_READ_WRITE_TOKEN=<token> pnpm exec tsx \
 *     --conditions react-server scripts/redraw-social.mts <id> --apply
 *
 * DATABASE_URL must be given on the command line (.env.local isn't read).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const id = Number(args.find((a) => /^\d+$/.test(a)));
if (!Number.isInteger(id) || id < 1) throw new Error("Give the post id.");
const apply = args.includes("--apply");
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : `/tmp/redraw-${id}`;
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL on the command line.");
if (apply && !process.env.BLOB_READ_WRITE_TOKEN)
  throw new Error(
    "Set BLOB_READ_WRITE_TOKEN to --apply (the new JPEGs go to Blob).",
  );

async function main() {
  const { redrawQueued } = await import("../src/lib/social/store");
  const r = await redrawQueued(id, { apply });
  if (!r.ok) {
    console.log(`Not redrawn: ${r.error}`);
    for (const e of r.errors ?? []) console.log(`  error: ${e}`);
    for (const c of r.cut ?? []) console.log(`  cut: ${c}`);
    process.exitCode = 1;
    return;
  }
  for (const c of r.report.cut) console.log(`  cut: ${c}`);
  for (const w of r.report.warnings) console.log(`  warning: ${w}`);
  await mkdir(out, { recursive: true });
  for (const [i, f] of r.slides.entries())
    await writeFile(join(out, `post-${id}-${i + 1}.jpg`), f.bytes);
  await writeFile(join(out, `post-${id}-caption.txt`), r.caption ?? "");
  console.log(
    r.applied
      ? `Post ${id} redrawn and stored (${r.slides.length} slides). Previews:\n${(r.previews ?? []).join("\n")}`
      : `Dry run: ${r.slides.length} slides written to ${out}. Nothing was stored. Run again with --apply to replace the queued post's media.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { db } = await import("../src/db");
    await db.$client.end();
  });
