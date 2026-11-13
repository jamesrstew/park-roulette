import { del, list } from "@vercel/blob";
import { inArray } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { media } from "@/db/schema";
import { sweep } from "@/lib/sms";

/**
 * Daily (vercel.json): delete sign-in rate-limit rows older than two days
 * (they hold phone numbers and IPs), and photo files nobody saved. A photo uploads the
 * moment it's picked, so a closed tab or a removed thumbnail leaves a file
 * with no review. Anything over a day old with no `media` row goes.
 */
const DAY = 24 * 60 * 60 * 1000;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return (
    !!secret &&
    got.length === want.length &&
    timingSafeEqual(Buffer.from(got), Buffer.from(want))
  );
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Nope", { status: 401 });
  await sweep();
  let cursor: string | undefined;
  let checked = 0;
  let deleted = 0;
  const cutoff = Date.now() - DAY;
  do {
    const page = await list({ prefix: "reviews/", cursor, limit: 1000 });
    cursor = page.hasMore ? page.cursor : undefined;
    const old = page.blobs.filter((b) => b.uploadedAt.getTime() < cutoff);
    checked += page.blobs.length;
    if (!old.length) continue;
    const kept = await db
      .select({ url: media.url })
      .from(media)
      .where(
        inArray(
          media.url,
          old.map((b) => b.url),
        ),
      );
    const keep = new Set(kept.map((k) => k.url));
    const orphans = old.filter((b) => !keep.has(b.url)).map((b) => b.url);
    if (orphans.length) {
      await del(orphans);
      deleted += orphans.length;
    }
  } while (cursor);
  console.info(`[cleanup] checked ${checked} files, deleted ${deleted}`);
  return Response.json({ checked, deleted });
}
