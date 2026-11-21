import "server-only";
import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { handFont } from "@/components/me/og-card";
import { Slide, slideSize } from "@/components/social/Slides";
import { fetchImage } from "@/lib/news/fetcher";
import {
  mediaPath,
  type PhotoRef,
  type PostSpec,
  type SlideSpec,
} from "./model";

/**
 * Slides to files: next/og draws each slide (PNG), sharp turns it into a
 * JPEG (Instagram takes JPEG only), and the bytes go to our private Blob
 * store under their own sha256, written once. Meta fetches them from
 * /social/m/<sha>.jpg. Only server code that renders imports this module
 * (always lazily), so sharp and next/og stay out of page functions.
 */

export type MediaFile = {
  sha: string;
  ext: "jpg";
  role: "slide";
  width: number;
  height: number;
  alt: string;
};

/** Where photos may come from: BPRD's site and Wikimedia Commons. */
export const PHOTO_DOMAINS = [
  "bendparksandrec.org",
  "upload.wikimedia.org",
] as const;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type PhotoFetcher = (
  url: string,
) => Promise<{ bytes: Uint8Array; type: string } | null>;

const fetchPhoto: PhotoFetcher = (url) => fetchImage(url, PHOTO_DOMAINS, "*/*");

/**
 * A checked photo as a data: URL for the slide, or null. The bytes must
 * hash to what the vision check looked at; anything else (a swapped file,
 * a failed fetch, bytes sharp can't read) draws the crayon card instead.
 */
export async function loadPhoto(
  ref: PhotoRef | null,
  fetcher: PhotoFetcher = fetchPhoto,
): Promise<string | null> {
  if (!ref) return null;
  const got = await fetcher(ref.src).catch(() => null);
  if (!got || sha256(got.bytes) !== ref.sha256) return null;
  try {
    const jpg = await sharp(got.bytes)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } catch {
    return null;
  }
}

/** One slide as a PNG (the preview route and the JPEG both start here). */
export async function slidePng(
  slides: SlideSpec[],
  i: number,
  photo: string | null,
): Promise<Buffer> {
  const res = new ImageResponse(<Slide slides={slides} i={i} photo={photo} />, {
    ...slideSize(slides[i]),
    fonts: await handFont(),
  });
  return Buffer.from(await res.arrayBuffer());
}

/** PNG to an sRGB baseline JPEG on paper (no transparency). */
export async function toJpeg(pngBytes: Buffer): Promise<Buffer> {
  return sharp(pngBytes)
    .flatten({ background: "#fffaf0" })
    .toColorspace("srgb")
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

export type Rendered = { bytes: Buffer; file: MediaFile };

/**
 * Every slide of a post as a JPEG. `photos` are the data: URLs the caller
 * already loaded (loadPhoto), one per slide, null for the crayon card.
 */
export async function renderPost(
  spec: PostSpec,
  photos: (string | null)[] = [],
): Promise<Rendered[]> {
  const out: Rendered[] = [];
  for (let i = 0; i < spec.slides.length; i++) {
    const bytes = await toJpeg(
      await slidePng(spec.slides, i, photos[i] ?? null),
    );
    out.push({
      bytes,
      file: {
        sha: sha256(bytes),
        ext: "jpg",
        role: "slide",
        ...slideSize(spec.slides[i]),
        alt: spec.alts[i] ?? "",
      },
    });
  }
  return out;
}

/** The photo each slide names, loaded once per photo. */
export async function photosFor(spec: PostSpec): Promise<(string | null)[]> {
  const cache = new Map<string, Promise<string | null>>();
  return Promise.all(
    spec.slides.map((s) => {
      const ref = "photo" in s ? s.photo : null;
      if (!ref) return null;
      const key = `${ref.src}#${ref.sha256}`;
      if (!cache.has(key)) cache.set(key, loadPhoto(ref));
      return cache.get(key)!;
    }),
  );
}

/** Store each file under its own hash (never overwritten: same hash, same bytes). */
export async function storeMedia(files: Rendered[]): Promise<MediaFile[]> {
  for (const { bytes, file } of files) {
    try {
      await put(mediaPath(file), bytes, {
        access: "private",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    } catch (e) {
      if (!/already exists/i.test((e as Error)?.message ?? "")) throw e;
    }
  }
  return files.map((f) => f.file);
}
