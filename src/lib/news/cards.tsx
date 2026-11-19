import "server-only";
import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { ImageResponse } from "next/og";
import {
  type CardPost,
  type FontDef,
  loadInterFonts,
  postAlt,
  postCardSize,
  PostCard,
} from "@/components/news/PostCard";
import {
  tiktokAlt,
  tiktokSize,
  TikTokTile,
} from "@/components/news/TikTokTile";
import type { CardFile, MemeSnapshot } from "./issue";

/**
 * Parents' corner cards, rendered once and stored. The validator fetches
 * the post (memeSnapshot), then this draws it with next/og and puts the
 * PNG in our private Blob store; /newsletter/<date>/post.png streams that
 * file. Every reader and every resend gets the same bytes, and if the
 * author deletes the post we can swap the one file.
 */

let fonts: Promise<FontDef[]> | null = null;
/** Inter, read once per server (it throws if the files are missing). */
export function interFonts(): Promise<FontDef[]> {
  fonts ??= loadInterFonts().catch((e) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

/** The card's post, from the snapshot and the pictures our server fetched. */
export function cardPost(
  s: Extract<MemeSnapshot, { kind: "x" }>,
  images: { avatar: string | null; media: string | null },
): CardPost {
  const m = s.media[0];
  return {
    name: s.name,
    handle: s.username,
    avatar: images.avatar,
    verified: s.verified,
    verifiedType: s.verifiedType ?? undefined,
    text: s.text,
    links: s.links,
    createdAt: s.createdAt,
    likes: s.likes,
    replies: s.replies,
    reposts: s.reposts,
    media:
      m && images.media
        ? [
            {
              src: images.media,
              width: m.width,
              height: m.height,
              kind: m.type,
            },
          ]
        : [],
  };
}

/** Draw the card: PNG bytes, its exact size and its alt text. */
export async function renderCard(
  s: MemeSnapshot,
  images: { avatar: string | null; media: string | null },
): Promise<{ bytes: Uint8Array; width: number; height: number; alt: string }> {
  const f = await interFonts();
  if (s.kind === "x") {
    const post = cardPost(s, images);
    const size = postCardSize(post, f);
    const res = new ImageResponse(<PostCard post={post} fonts={f} />, {
      ...size,
      fonts: f,
      emoji: "twemoji",
    });
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      ...size,
      alt: postAlt(post, f),
    };
  }
  const size = tiktokSize("4:5");
  const res = new ImageResponse(
    <TikTokTile thumbnail={images.media ?? ""} handle={s.handle} />,
    { ...size, fonts: f },
  );
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    ...size,
    alt: tiktokAlt(s.handle, s.title),
  };
}

/**
 * Render the card and store it, content-addressed: the path is the hash of
 * the bytes, written once and never overwritten, so a stored path always
 * means the same picture. Null when there's nothing to draw.
 */
export async function storeCard(
  s: MemeSnapshot,
  images: { avatar: string | null; media: string | null },
): Promise<CardFile | null> {
  if (s.kind === "tiktok" && !images.media) return null;
  const card = await renderCard(s, images);
  const hash = createHash("sha256").update(card.bytes).digest("hex");
  const path = `news/cards/${hash}.png`;
  try {
    await put(path, Buffer.from(card.bytes), {
      access: "private",
      contentType: "image/png",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (e) {
    // Already there: the same bytes, by construction.
    if (!/already exists/i.test((e as Error)?.message ?? "")) throw e;
  }
  return { path, width: card.width, height: card.height, alt: card.alt };
}

/** Render only, in memory (the writer's /check): nothing is stored. */
export async function checkCard(
  s: MemeSnapshot,
  images: { avatar: string | null; media: string | null },
): Promise<boolean> {
  if (s.kind === "tiktok" && !images.media) return false;
  await renderCard(s, images);
  return true;
}
