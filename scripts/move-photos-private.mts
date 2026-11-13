/**
 * One-off: move review photos from the old PUBLIC Blob store to the private
 * one, then (with --purge) delete everything left in the public store.
 *
 *   DATABASE_URL=…  BLOB_READ_WRITE_TOKEN=<private store>  \
 *   BLOB_PUBLIC_OLD_TOKEN=<old public store>  tsx scripts/move-photos-private.mts [--apply] [--purge]
 *
 * Without --apply it only lists what it would do. Copies first and checks
 * each copy can be read back before pointing the row at it; the public file
 * is only deleted by --purge, after every row has moved.
 */
import { del, get, list, put } from "@vercel/blob";
import postgres from "postgres";

const apply = process.argv.includes("--apply");
const purge = process.argv.includes("--purge");
const priv = process.env.BLOB_READ_WRITE_TOKEN;
const old = process.env.BLOB_PUBLIC_OLD_TOKEN;
if (!process.env.DATABASE_URL || !priv || !old)
  throw new Error(
    "DATABASE_URL, BLOB_READ_WRITE_TOKEN and BLOB_PUBLIC_OLD_TOKEN are required",
  );
if (priv === old)
  throw new Error("The private and old tokens are the same store");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const rows = await sql<
  { id: number; url: string; crew_id: number; park_id: number }[]
>`
  select m.id, m.url, e.crew_id, r.park_id
  from media m
  join reviews r on r.id = m.review_id
  join explorers e on e.id = r.explorer_id
  where m.url like '%.public.blob.vercel-storage.com/%'
  order by m.id`;
console.log(`${rows.length} media rows still public`);

for (const row of rows) {
  const name = new URL(row.url).pathname.split("/").pop() ?? `photo-${row.id}`;
  const path = `reviews/${row.crew_id}/${row.park_id}-${name}`;
  console.log(`media ${row.id} -> ${path}`);
  if (!apply) continue;
  const res = await fetch(row.url);
  if (!res.ok)
    throw new Error(`media ${row.id}: download failed ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const blob = await put(path, body, {
    access: "private",
    token: priv,
    contentType: res.headers.get("content-type") ?? undefined,
    addRandomSuffix: true,
  });
  const back = await get(blob.url, { access: "private", token: priv });
  if (!back || back.statusCode !== 200 || back.blob.size !== body.length)
    throw new Error(`media ${row.id}: copy didn't read back`);
  await back.stream.cancel();
  await sql`update media set url = ${blob.url} where id = ${row.id} and url = ${row.url}`;
  console.log(`  moved (${body.length} bytes)`);
}

if (purge) {
  const left =
    await sql`select count(*)::int as n from media where url like '%.public.blob.vercel-storage.com/%'`;
  if (left[0].n > 0)
    throw new Error("Some rows still point at the public store; not purging");
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await list({ token: old, cursor, limit: 1000 });
    cursor = page.hasMore ? page.cursor : undefined;
    if (page.blobs.length && apply) {
      await del(
        page.blobs.map((b) => b.url),
        { token: old },
      );
    }
    n += page.blobs.length;
  } while (cursor);
  console.log(
    `${apply ? "deleted" : "would delete"} ${n} files from the public store`,
  );
}
await sql.end();
