import { get } from "@vercel/blob";
import { mediaPath } from "@/lib/social/model";
import { mediaAllowed } from "@/lib/social/store";

/**
 * Our Instagram media, for Meta to fetch when it makes a container
 * (parkroulette.quest/social/m/<sha256>.jpg). Only files of posts
 * that passed the checks (queued, being published, published or dry run)
 * stream, unless a photo in them has since been flagged; anything else is
 * a 404. Cached a day.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const m = /^([0-9a-f]{64})\.jpg$/.exec(file);
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  if (!m || !(await mediaAllowed(m[1], "jpg"))) return notFound();
  const blob = await get(mediaPath({ sha: m[1], ext: "jpg" }), {
    access: "private",
  }).catch(() => null);
  if (!blob?.stream) return notFound();
  return new Response(blob.stream, {
    headers: {
      "content-type": "image/jpeg",
      ...(blob.blob?.size ? { "content-length": String(blob.blob.size) } : {}),
      // A day, not forever: a slide taken down (mediaAllowed) stops
      // being served from caches within a day.
      "cache-control": "public, max-age=86400",
      "x-robots-tag": "noindex",
    },
  });
}
