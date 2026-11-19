import "server-only";
import { get, put } from "@vercel/blob";
import { fetchImage } from "./fetcher";
import type { Issue, MemeSnapshot } from "./issue";
import { checkCard, storeCard } from "./cards";
import type { CardFile } from "./issue";
import { lookupPost } from "./xapi";

/**
 * Parents' corner, server side: fetch the post the writer named (the
 * validator's memeSource), and load its pictures for the card. Readers
 * only ever load our own image; X and TikTok see our server, once.
 */

/** Where X keeps avatars and media. */
const X_IMAGES = ["pbs.twimg.com", "abs.twimg.com"];
/** TikTok's image hosts (registrable domains, so no look-alikes). */
const TIKTOK_IMAGES = ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com"];

type Meme = NonNullable<Issue["meme"]>;

/** Images, already fetched by the server, as data URLs (null if missing). */
export type CardImages = { avatar: string | null; media: string | null };

/**
 * The post as it is now, or null (deleted, private, flagged sensitive, a
 * TikTok with no cover). For TikTok, the cover is copied into our private
 * Blob store, because TikTok's links expire and would tell TikTok who
 * opened the email.
 */
/**
 * How the card is handled:
 *   memory  render it to prove it draws, store nothing (the writer's /check)
 *   store   render it and store it (a draft coming in)
 *   reuse   keep the card already stored for this post (the sender's
 *           re-check: what was drafted is what goes out, never re-drawn)
 */
export type CardMode =
  | { mode: "memory" }
  | { mode: "store" }
  | { mode: "reuse"; card: CardFile; kind: "x" | "tiktok"; id: string };

/** The post as it is now, with its card handled per `cards`. */
export async function memeSnapshot(
  meme: Meme,
  cards: CardMode = { mode: "store" },
): Promise<MemeSnapshot | null> {
  const snap = await fetchSnapshot(meme);
  if (!snap) return null;
  if (
    cards.mode === "reuse" &&
    cards.kind === snap.kind &&
    cards.id === snap.id
  )
    return { ...snap, card: cards.card };
  const images = await cardImages(snap);
  if (cards.mode === "memory")
    return (await checkCard(snap, images)) ? snap : null;
  // Draw the card once and keep the file: the email, the archive and every
  // resend show these exact bytes.
  const card = await storeCard(snap, images);
  return card ? { ...snap, card } : null;
}

async function fetchSnapshot(meme: Meme): Promise<MemeSnapshot | null> {
  if (meme.platform === "x") {
    const post = await lookupPost(meme.postId, process.env.X_BEARER_TOKEN);
    // A standalone post only (no reply, quote, edit or long post), so the
    // card draws all of it, and never one X flags as sensitive.
    if (!post || post.possiblySensitive || !post.standalone) return null;
    return post;
  }
  return tiktokSnapshot(meme);
}

/** The id in a TikTok video link (/@handle/video/<id>). */
export function tiktokId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)tiktok\.com$/.test(u.hostname)) return null;
    return u.pathname.match(/\/video\/(\d{5,25})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function tiktokSnapshot(meme: Meme): Promise<MemeSnapshot | null> {
  const id = tiktokId(meme.url);
  if (!id || id !== meme.postId) return null;
  let o: {
    thumbnail_url?: string;
    thumbnail_width?: number;
    thumbnail_height?: number;
    author_unique_id?: string;
    title?: string;
  };
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(meme.url)}`,
      { signal: AbortSignal.timeout(15_000), cache: "no-store" },
    );
    if (!res.ok) return null;
    o = await res.json();
  } catch {
    return null;
  }
  // No cover from oEmbed: not eligible.
  if (!o.thumbnail_url || !o.author_unique_id) return null;
  const img = await fetchImage(o.thumbnail_url, TIKTOK_IMAGES);
  if (!img) return null;
  const pathname = `news/tiktok/${id}.jpg`;
  await put(pathname, Buffer.from(img.bytes), {
    access: "private",
    contentType: img.type,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return {
    kind: "tiktok",
    id,
    handle: o.author_unique_id,
    title: (o.title ?? "").slice(0, 300),
    thumb: pathname,
    width: o.thumbnail_width ?? 720,
    height: o.thumbnail_height ?? 1280,
  };
}

const dataUrl = (img: { bytes: Uint8Array; type: string } | null) =>
  img
    ? `data:${img.type};base64,${Buffer.from(img.bytes).toString("base64")}`
    : null;

/** The card's pictures as data URLs, fetched by our server. */
export async function cardImages(s: MemeSnapshot): Promise<CardImages> {
  if (s.kind === "x") {
    const [avatar, media] = await Promise.all([
      s.avatar ? fetchImage(s.avatar, X_IMAGES) : null,
      s.media[0] ? fetchImage(s.media[0].url, X_IMAGES) : null,
    ]);
    return { avatar: dataUrl(avatar), media: dataUrl(media) };
  }
  try {
    const blob = await get(s.thumb, { access: "private" });
    if (!blob?.stream) return { avatar: null, media: null };
    const bytes = new Uint8Array(await new Response(blob.stream).arrayBuffer());
    return {
      avatar: null,
      media: dataUrl({ bytes, type: blob.blob.contentType || "image/jpeg" }),
    };
  } catch {
    return { avatar: null, media: null };
  }
}
