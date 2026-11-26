import "server-only";
import { createHash } from "node:crypto";
import { igImageUrl } from "@/components/news/InstagramCard";
import { IG_MAX_AGE_DAYS, igIneligible, igLookup } from "./igapi";
import { imageSize } from "./image-size";
import { blockedAccounts, snapshotTakenDown, takenDown } from "./takedowns";
import { get, put } from "@vercel/blob";
import { fetchImage } from "./fetcher";
import type { Issue, MemeSnapshot } from "./issue";
import { checkCard, storeCard } from "./cards";
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
  | {
      mode: "reuse";
      /** The drafted snapshot, card included. */
      snapshot: MemeSnapshot;
    };

/** The post as it is now, with its card handled per `cards`. */
export async function memeSnapshot(
  meme: Meme,
  cards: CardMode = { mode: "store" },
  /**
   * Instagram only: how old the post may be. The default week, or longer
   * for a post James suggested by DM (the caller reads that from the
   * stored plan; lib/news/suggest.ts).
   */
  igMaxAgeDays: number = IG_MAX_AGE_DAYS,
): Promise<MemeSnapshot | null> {
  const drafted =
    cards.mode === "reuse" && cards.snapshot.id === meme.postId
      ? cards.snapshot
      : null;
  // At send, an Instagram pick only has to still exist and not be taken
  // down: its age and likes were judged at plan and draft time.
  if (drafted?.kind === "instagram")
    return (await igStillThere(drafted)) ? drafted : null;
  const snap = await fetchSnapshot(meme, igMaxAgeDays);
  if (!snap) return null;
  if (drafted?.card && drafted.kind === snap.kind)
    return { ...snap, card: drafted.card };
  const images = await cardImages(snap);
  if (cards.mode === "memory")
    return (await checkCard(snap, images)) ? snap : null;
  // Draw the card once and keep the file: the email, the archive and every
  // resend show these exact bytes.
  const card = await storeCard(snap, images);
  return card ? { ...snap, card } : null;
}

/** Instagram's image hosts. */
const IG_IMAGES = ["cdninstagram.com", "fbcdn.net"];

/**
 * An Instagram post as it is now (Business Discovery), its image copied
 * into our private Blob store at a content-addressed path, with its pixel
 * size. Null when it's gone, ineligible, taken down or Meta says no.
 */
const igOpts = () => ({
  token: process.env.IG_ACCESS_TOKEN,
  igUserId: process.env.IG_USER_ID,
  appSecret: process.env.IG_APP_SECRET || undefined,
});

/** A drafted Instagram post is still up and not taken down. */
export async function igStillThere(
  s: Extract<MemeSnapshot, { kind: "instagram" }>,
): Promise<boolean> {
  if (snapshotTakenDown(s)) return false;
  return !!(await igLookup(s.username, s.id, {
    ...igOpts(),
    timestamp: s.timestamp,
  }));
}

/** An image's real type from its first bytes (never the server's header). */
export function sniffImageType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

async function igSnapshot(
  meme: Meme,
  maxAge: number,
): Promise<MemeSnapshot | null> {
  if (!meme.account || takenDown("instagram", meme.postId)) return null;
  if (blockedAccounts("instagram").has(meme.account)) return null;
  const now = new Date();
  // A post James suggested by DM may be older than a week (suggest.ts);
  // every other rule is the same.
  const older = maxAge > IG_MAX_AGE_DAYS;
  const got = await igLookup(meme.account, meme.postId, {
    ...igOpts(),
    // Page back far enough to find an older suggested post.
    timestamp: older
      ? new Date(now.getTime() - maxAge * 86_400_000).toISOString()
      : undefined,
  });
  if (!got || igIneligible(got.media, meme.account, now, maxAge)) return null;
  const url = igImageUrl(got.media);
  const img = url ? await fetchImage(url, IG_IMAGES) : null;
  const size = img ? imageSize(img.bytes) : null;
  // Stored under the type its bytes say, not the header's.
  const type = img ? sniffImageType(img.bytes) : null;
  if (!img || !size || !type) return null;
  const hash = createHash("sha256").update(img.bytes).digest("hex");
  const ext = type.split("/")[1].replace("jpeg", "jpg");
  const path = `news/ig/${hash}.${ext}`;
  try {
    await put(path, Buffer.from(img.bytes), {
      access: "private",
      contentType: type,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (e) {
    if (!/already exists/i.test((e as Error)?.message ?? "")) throw e;
  }
  const m = got.media;
  return {
    kind: "instagram",
    id: m.id,
    username: meme.account,
    permalink: m.permalink,
    mediaType: m.media_type,
    productType: m.media_product_type ?? null,
    likes: m.like_count ?? 0,
    timestamp: m.timestamp,
    carouselCount: m.children?.data.length ?? null,
    avatar: got.avatar,
    image: { path, ...size, type },
  };
}

async function fetchSnapshot(
  meme: Meme,
  igMaxAgeDays: number,
): Promise<MemeSnapshot | null> {
  if (meme.platform === "instagram") return igSnapshot(meme, igMaxAgeDays);
  if (takenDown(meme.platform, meme.postId)) return null;
  const snap = await fetchOther(meme);
  // Blocked accounts (by handle, and for X by permanent id) never show.
  return snap && !snapshotTakenDown(snap) ? snap : null;
}

async function fetchOther(meme: Meme): Promise<MemeSnapshot | null> {
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

/** A private Blob file's bytes, or null. */
async function readBlob(
  path: string,
  type: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const blob = await get(path, { access: "private" });
    if (!blob?.stream) return null;
    return {
      bytes: new Uint8Array(await new Response(blob.stream).arrayBuffer()),
      type: blob.blob.contentType || type,
    };
  } catch {
    return null;
  }
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
  if (s.kind === "instagram") {
    const [avatar, media] = await Promise.all([
      s.avatar ? fetchImage(s.avatar, IG_IMAGES) : null,
      readBlob(s.image.path, s.image.type),
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
