import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { currentExplorerId } from "@/lib/session";

const MB = 1024 * 1024;

/** Issues short-lived tokens so phones upload photos/videos straight to Vercel Blob. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const explorerId = await currentExplorerId();
        if (!explorerId) throw new Error("Join a crew to upload");
        if (!pathname.startsWith("reviews/"))
          throw new Error("Bad upload path");
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
          maximumSizeInBytes: 300 * MB,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ explorerId }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
