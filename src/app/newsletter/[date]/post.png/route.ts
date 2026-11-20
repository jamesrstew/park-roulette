import { get } from "@vercel/blob";
import { weatherIssue } from "@/lib/news/data";
import { draftImageKeyOk } from "@/lib/news/image-key";
import { snapshotTakenDown } from "@/lib/news/takedowns";
import { isIsoDate } from "@/lib/news/time";

/**
 * Parents' corner: the post as our own image. The card was rendered once,
 * when code fetched the post, and stored in our private Blob store; this
 * streams that file, so every reader sees the same bytes and nothing
 * loads from X or TikTok. Frozen once a send starts, the latest checked
 * draft before that, 404 otherwise.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const found = isIsoDate(date) ? await weatherIssue(date) : null;
  // A draft's images need the dry-run key; a started send's are public.
  const keyed =
    found?.frozen ||
    draftImageKeyOk(date, new URL(req.url).searchParams.get("k"));
  const card = found?.issue.meme?.snapshot?.card;
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  const snap = found?.issue.meme?.snapshot;
  if (!found || !keyed || !card || (snap && snapshotTakenDown(snap)))
    return notFound();
  const blob = await get(card.path, { access: "private" }).catch(() => null);
  if (!blob?.stream) return notFound();
  return new Response(blob.stream, {
    headers: {
      "content-type": "image/png",
      // A day at most: a takedown has to stop showing within a day.
      "cache-control": found.frozen
        ? "public, max-age=86400"
        : "public, max-age=300",
    },
  });
}
