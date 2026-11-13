import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { redact } from "@/lib/action-utils";
import { getMe } from "@/lib/data";

const MB = 1024 * 1024;

/** A reason we can show people (anything else could carry SQL). */
class UploadError extends Error {}

/** Issues short-lived tokens so phones upload photos/videos straight to Vercel Blob. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const me = await getMe(); // checks the session epoch too
        if (!me) throw new UploadError("Hop in to upload");
        if (me.isKid)
          throw new UploadError(
            "Photos are for grown-ups. Ask one to add them!",
          );
        // Each family uploads into its own folder; saving checks it.
        if (!pathname.startsWith(`reviews/${me.crew.id}/`))
          throw new UploadError("Bad upload path");
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
            "image/gif",
            "video/mp4",
            "video/quicktime",
            "video/webm",
          ],
          maximumSizeInBytes: 100 * MB,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ explorerId: me.id }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    if (!(error instanceof UploadError))
      console.error("[upload]", redact(error));
    return NextResponse.json(
      {
        error:
          error instanceof UploadError
            ? error.message
            : "Couldn't start that upload. Try again?",
      },
      { status: 400 },
    );
  }
}
