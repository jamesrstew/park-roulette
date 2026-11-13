import { getMe } from "@/lib/data";
import { photoUnderReview } from "@/lib/data-admin";
import { photoLink, photoRecord } from "@/lib/photos";
import { canSeeMedia, viewerOf } from "@/lib/visibility";

/**
 * The only door to a photo or video. Checks the person asking may see the
 * review it belongs to, then sends them to a link that works for an hour.
 * Anyone else gets the same "not found" as a photo that doesn't exist.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const n = Number(id);
  const missing = () =>
    new Response("Not found", {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  if (!Number.isSafeInteger(n) || n <= 0) return missing();
  try {
    const [row, me] = await Promise.all([photoRecord(n), getMe()]);
    // Admins may look at photos on a reported review, to decide on it.
    const moderating =
      !!row && !!me?.isAdmin && me.trusted && (await photoUnderReview(n));
    if (
      !row ||
      (!moderating &&
        !canSeeMedia(
          viewerOf(me),
          {
            visibility: row.visibility,
            hidden: row.hiddenAt != null,
            crewId: row.crewId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          row.kind,
        ))
    )
      return missing();
    return new Response(null, {
      status: 302,
      headers: {
        location: await photoLink(row.url),
        // Only this person's browser may reuse it, and not for long.
        "cache-control": "private, max-age=600",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (e) {
    console.error("[photos]", (e as Error)?.name);
    return new Response("Try again", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
