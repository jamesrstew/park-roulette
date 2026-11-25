import "server-only";
import { put } from "@vercel/blob";
import { STORY, mediaPath, type SlideSpec } from "./model";
import { sha256, slidePng, toJpeg } from "./render";

/**
 * The Story echo's pictures: each slide of the feed post, drawn again as a
 * 1080 x 1920 Story frame by the same slide components (Slides.tsx, frame
 * "story"): the same words, photo or crayon art, on a taller card that
 * keeps clear of the bands Instagram draws over a Story's top and bottom.
 * No "New post" card: the Story is the post.
 */

export type FrameFile = {
  sha: string;
  ext: "jpg";
  width: number;
  height: number;
};

/**
 * Slide `i` as a Story frame JPEG. `photo` is the checked photo's data:
 * URL, or null for the crayon card (no photo, no credit).
 */
export async function renderFrame(
  slides: SlideSpec[],
  i: number,
  photo: string | null,
): Promise<{ bytes: Buffer; file: FrameFile }> {
  const bytes = await toJpeg(await slidePng(slides, i, photo, "story"));
  return { bytes, file: { sha: sha256(bytes), ext: "jpg", ...STORY } };
}

/** Store a frame under its own hash (never overwritten). */
export async function storeFrame(r: {
  bytes: Buffer;
  file: FrameFile;
}): Promise<FrameFile> {
  try {
    await put(mediaPath(r.file), r.bytes, {
      access: "private",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (e) {
    if (!/already exists/i.test((e as Error)?.message ?? "")) throw e;
  }
  return r.file;
}
