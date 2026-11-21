import { draftImageKeyOk } from "@/lib/news/image-key";
import { draftPreview, sentPreview } from "@/lib/news/preview-store";
import { isIsoDate } from "@/lib/news/time";

/**
 * The issue's link preview (its og:image) and the Friday Weekend Pick's
 * MMS picture: a 1200 x 630 JPEG rendered once and kept in Blob
 * (lib/news/preview-store.ts). Only for an issue that went out, cached for
 * good by browsers and the CDN; a draft's needs the dry-run key and is
 * never cached long. Skipped weeks and unknown dates get a 404.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  if (!isIsoDate(date)) return notFound();
  const sent = await sentPreview(date);
  if (sent) {
    // Not stored (a photo that didn't load, or local): a short cache, so
    // the complete picture replaces it.
    const forever = "public, max-age=31536000, s-maxage=31536000, immutable";
    const cache = sent.stored ? forever : "public, max-age=300, s-maxage=300";
    return new Response(new Uint8Array(sent.jpeg), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": cache,
        "cdn-cache-control": sent.stored
          ? "public, max-age=31536000, immutable"
          : "public, max-age=300",
      },
    });
  }
  if (!draftImageKeyOk(date, new URL(req.url).searchParams.get("k")))
    return notFound();
  const draft = await draftPreview(date);
  if (!draft) return notFound();
  return new Response(new Uint8Array(draft), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, no-store",
    },
  });
}
