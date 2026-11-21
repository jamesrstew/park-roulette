import { previewKeyOk } from "@/lib/social/key";
import type { PostSpec } from "@/lib/social/model";
import { loadPhoto, slidePng } from "@/lib/social/render";
import { postById } from "@/lib/social/store";

/**
 * A slide as next/og draws it (/social/<id>/<n>.png?k=...), for the dry-run
 * email and the routine's own look. Keyed (lib/social/key.ts); Meta never
 * uses this route, it gets the stored JPEGs from /social/m/.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; slide: string }> },
) {
  const { id, slide } = await params;
  const m = /^(\d{1,3})\.png$/.exec(slide);
  const postId = /^\d{1,9}$/.test(id) ? Number(id) : NaN;
  const notFound = () => new Response("Not found", { status: 404 });
  if (!m || !Number.isFinite(postId)) return notFound();
  if (!previewKeyOk(postId, new URL(req.url).searchParams.get("k")))
    return notFound();
  const post = await postById(postId);
  const spec = post?.spec as PostSpec | undefined;
  const i = Number(m[1]) - 1;
  if (!spec || i < 0 || i >= spec.slides.length) return notFound();
  const s = spec.slides[i];
  const photo = await loadPhoto("photo" in s ? s.photo : null);
  const png = await slidePng(spec.slides, i, photo);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
    },
  });
}
