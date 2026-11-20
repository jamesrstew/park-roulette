/* eslint-disable @next/next/no-img-element -- Satori (next/og) draws plain <img>. */
/**
 * Parents' corner: a faithful light-mode Instagram post card for the Bend
 * Playground Passport email. Sits beside PostCard (X) and TikTokTile and uses
 * the same crayon paper mat; only the mat is ours, the post keeps Instagram's
 * own look. Pure JSX + inline styles + inline SVG for next/og ImageResponse
 * (Satori). SVG helpers are plain functions, never JSX components.
 *
 *   const fonts = await loadInterFonts(); // from PostCard
 *   const post: IgPost = {
 *     username, avatar,                    // avatar: data URL or null
 *     mediaType: m.media_type,             // IMAGE | VIDEO | CAROUSEL_ALBUM
 *     productType: m.media_product_type,   // FEED | REELS (optional)
 *     image,                               // data URL of igImageUrl(m), copied to Blob first
 *     imageWidth, imageHeight,             // that image's pixel size (read at copy time)
 *     likes: m.like_count ?? null,         // absent when the owner hides likes
 *     timestamp: m.timestamp,
 *   };
 *   new ImageResponse(<InstagramCard post={post} />, { ...igCardSize(post), fonts });
 *
 * 1200 wide (2x for a 536px slot, ~340px on phones). Every row has a fixed
 * height (the optional caption is one line, cut with an ellipsis), so the
 * size needs no text measurement.
 */

import type { ReactNode } from "react";
import { MAT, W, paperMat, playButton } from "./PostCard";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type IgMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export type IgPost = {
  /** Without the "@". */
  username: string;
  /** Server-fetched profile picture as a data URL; null/undefined draws Instagram's default. */
  avatar?: string | null;
  mediaType: IgMediaType;
  /** media_product_type: "REELS" adds the Reels glyph to a video. Optional. */
  productType?: "FEED" | "REELS" | "STORY" | "AD" | null;
  /** The image to show, as a data URL (see igImageUrl). */
  image: string;
  /**
   * The image's pixel size, read when it is copied to Blob. A landscape post is
   * drawn at its own ratio (down to Instagram's 1.91:1), as the feed shows it;
   * square and portrait crop to a square. Omit both to crop to a square.
   */
  imageWidth?: number | null;
  imageHeight?: number | null;
  /** Carousel only: number of items, for the page dots (children.data.length). Omit to skip the dots. */
  carouselCount?: number | null;
  /** like_count; null/undefined (hidden by the owner) hides the likes line. */
  likes?: number | null;
  /** Off by default. When set, one line under the likes: "username caption…". */
  caption?: string | null;
  /** ISO timestamp from the API. */
  timestamp: string;
};

/** The Graph API media fields this card reads. */
export type IgApiMedia = {
  media_type: IgMediaType;
  media_url?: string;
  thumbnail_url?: string;
};

/**
 * Which URL to copy into Blob. A VIDEO's media_url is the video file, so use
 * its thumbnail_url. media_url is missing for some videos and reels (licensed
 * audio, downloads off) and for a carousel whose first item is a video; fall
 * back to thumbnail_url. Null means there's no image: use the text card.
 */
export function igImageUrl(m: IgApiMedia): string | null {
  if (m.media_type === "VIDEO") return m.thumbnail_url ?? null;
  return m.media_url ?? m.thumbnail_url ?? null;
}

/* ------------------------------------------------------------------ */
/* Design tokens (2x)                                                  */
/* ------------------------------------------------------------------ */

const IG_TEXT = "#000000";
const IG_GRAY = "#737373"; // Instagram's secondary text
const IG_LINE = "#dbdbdb"; // Instagram's borders
const IG_BLUE = "#0095f6"; // Instagram's primary blue (carousel dot)
// Button text: Meta's darker blue. #0095f6 is 3.2:1 on white, too faint for
// 13px text on a phone; this is 5.4:1, like the X card's #006fd6 (4.9:1).
const IG_LINK = "#0064e0";

const MAT_PAD = 34; // cream visible around the post, as on the X card
const CARD_BORDER = 2;
const CARD_W = W - MAT.left - MAT.right - 2 * MAT.border - 2 * MAT_PAD; // 1092
const MEDIA_W = CARD_W - 2 * CARD_BORDER; // 1088, full bleed like the feed
const PAD_X = 48; // the X card's inset: avatar, icons, text and button share its edges

const AVATAR = 104; // ~29px on a phone (Instagram: 32px)
const HEADER_H = 168;
const USER_SIZE = 48; // ~13.6px on a phone (Instagram: 14px semibold)
const ACTION_H = 124;
const ICON = 84; // ~24px on a phone, Instagram's action icon size
const LIKES_H = 60;
const CAPTION_H = 64;
const DATE_H = 60;
const DATE_SIZE = 44; // ~12.5px on a phone, the smallest text on the X card too
const BUTTON_GAP = 30; // as on the X card
const BUTTON_H = 104;
const PAD_BOTTOM = 36;

/* ------------------------------------------------------------------ */
/* Size, alt text, formatting                                          */
/* ------------------------------------------------------------------ */

const MEDIA_MIN_RATIO = 1 / 1.91; // Instagram's widest landscape post

/** Media height: the image's own ratio for landscape posts, else square. */
function mediaH(p: IgPost): number {
  const r = p.imageWidth && p.imageHeight ? p.imageHeight / p.imageWidth : 1;
  return Math.round(MEDIA_W * Math.min(1, Math.max(MEDIA_MIN_RATIO, r)));
}

const hasLikes = (p: IgPost) => p.likes != null && p.likes > 0;
const captionText = (p: IgPost) => p.caption?.replace(/\s+/g, " ").trim() || "";

/** Exact image size. Use it for ImageResponse and the email <img width/height>. */
export function igCardSize(post: IgPost) {
  const cardH =
    2 * CARD_BORDER +
    HEADER_H +
    mediaH(post) +
    ACTION_H +
    (hasLikes(post) ? LIKES_H : 0) +
    (captionText(post) ? CAPTION_H : 0) +
    DATE_H +
    BUTTON_GAP +
    BUTTON_H +
    PAD_BOTTOM;
  return {
    width: W,
    height: MAT.top + 2 * MAT.border + 2 * MAT_PAD + cardH + MAT.bottom,
  };
}

/**
 * Alt text, which is also the link's accessible name: "Instagram post by
 * @handle, with a photo." (or "a video" / "several photos"; a Reel is
 * "Instagram reel by @handle."). When the card
 * shows a caption, it follows after a colon, as on the X card.
 */
export function igAlt(post: IgPost): string {
  const isReel = post.mediaType === "VIDEO" && post.productType === "REELS";
  const what =
    post.mediaType === "VIDEO"
      ? "a video"
      : post.mediaType === "CAROUSEL_ALBUM"
        ? "several photos"
        : "a photo";
  const head = isReel
    ? `Instagram reel by @${post.username}`
    : `Instagram post by @${post.username}, with ${what}`;
  const c = captionText(post);
  return c ? `${head}: ${c}` : `${head}.`;
}

/** Instagram's absolute date, in Bend's time zone: "November 16, 2026". */
export function igDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Instagram's likes line: full count with commas, "1 like" in the singular. */
export function igLikes(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "like" : "likes"}`;
}

/* ------------------------------------------------------------------ */
/* SVG helpers (called as functions)                                   */
/* ------------------------------------------------------------------ */

/** Instagram's glyph (camera outline), drawn from primitives. */
function igGlyph(size: number, color = IG_TEXT): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect
        x="2.2"
        y="2.2"
        width="19.6"
        height="19.6"
        rx="5.6"
        fill="none"
        stroke={color}
        strokeWidth="2.1"
      />
      <circle
        cx="12"
        cy="12"
        r="4.6"
        fill="none"
        stroke={color}
        strokeWidth="2.1"
      />
      <circle cx="17.6" cy="6.4" r="1.35" fill={color} />
    </svg>
  );
}

/** Instagram-style outline icons: 24 grid, 2px strokes, round joins. */
function outline(size: number, children: ReactNode): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: IG_TEXT,
  strokeWidth: 2,
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

function heartIcon(size: number): ReactNode {
  return outline(
    size,
    <path
      {...stroke}
      d="M16.79 3.9A4.99 4.99 0 0 1 21.5 9.12c0 3.07-2.65 4.96-5.2 7.22-2.51 2.24-3.86 3.47-4.3 3.75-.48-.31-2.14-1.82-4.3-3.75C5.14 14.07 2.5 12.17 2.5 9.12A4.99 4.99 0 0 1 7.21 3.9a4.21 4.21 0 0 1 3.67 1.94c.84 1.18.98 1.77 1.12 1.77s.28-.59 1.11-1.77a4.17 4.17 0 0 1 3.68-1.94Z"
    />,
  );
}

function commentIcon(size: number): ReactNode {
  return outline(
    size,
    <path {...stroke} d="M20.66 17.01a9.99 9.99 0 1 0-3.59 3.61L22 22Z" />,
  );
}

function shareIcon(size: number): ReactNode {
  return outline(
    size,
    <>
      <path {...stroke} d="M22 3 9.22 10.08" />
      <path {...stroke} d="M11.7 20.33 22 3H2l7.22 7.08Z" />
    </>,
  );
}

function bookmarkIcon(size: number): ReactNode {
  return outline(size, <path {...stroke} d="M20 21 12 13.44 4 21V3h16Z" />);
}

/** Instagram's default profile picture: a white silhouette on pale gray. */
function defaultAvatar(size: number): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#dbdbdb" />
      <circle cx="50" cy="39" r="17" fill="#ffffff" />
      <path
        d="M18 86 C22 66 35 58 50 58 C65 58 78 66 82 86 C73 94 62 98 50 98 C38 98 27 94 18 86 Z"
        fill="#ffffff"
      />
    </svg>
  );
}

/** Instagram's carousel glyph, top right of the media: two stacked squares, white with a faint shadow. */
function carouselGlyph(size: number): ReactNode {
  const shape = (fill: string, dx: number) => (
    <>
      <path
        d={`M${8.5 + dx} ${2 + dx}h${11 - 0}a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5`}
        fill="none"
        stroke={fill}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect
        x={2 + dx}
        y={6.5 + dx}
        width="15.5"
        height="15.5"
        rx="2.5"
        fill={fill}
      />
    </>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {shape("rgba(0,0,0,0.28)", 0.5)}
      {shape("#ffffff", 0)}
    </svg>
  );
}

/** Instagram's Reels glyph (clapper with a play triangle), white with a faint shadow. */
function reelsGlyph(size: number): ReactNode {
  const shape = (color: string, dx: number) => (
    <g transform={`translate(${dx} ${dx})`}>
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5"
        fill="none"
        stroke={color}
        strokeWidth="2"
      />
      <path
        d="M2.8 8h18.4M9 2.8l3 5.2M15 2.8l3 5.2"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10 11.6v6.2l5.2-3.1Z"
        fill={color}
        stroke={color}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {shape("rgba(0,0,0,0.28)", 0.5)}
      {shape("#ffffff", 0)}
    </svg>
  );
}

/** Carousel page dots under the media, first one active (Instagram's blue). */
function pageDots(count: number): ReactNode {
  const n = Math.min(count, 5); // Instagram shrinks the rest; five is enough at this size
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            width: 20,
            height: 20,
            borderRadius: 10,
            marginLeft: i ? 14 : 0,
            background: i === 0 ? IG_BLUE : "#c7c7c7",
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function InstagramCard({ post }: { post: IgPost }) {
  const { width, height } = igCardSize(post);
  const isVideo = post.mediaType === "VIDEO";
  const isCarousel = post.mediaType === "CAROUSEL_ALBUM";
  const caption = captionText(post);
  const mh = mediaH(post);
  const corner = isCarousel
    ? carouselGlyph(88)
    : isVideo && post.productType === "REELS"
      ? reelsGlyph(88)
      : null;

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        fontFamily: "Inter",
        color: IG_TEXT,
      }}
    >
      {paperMat()}
      <div
        style={{
          position: "absolute",
          left: MAT.left + MAT.border + MAT_PAD,
          top: MAT.top + MAT.border + MAT_PAD,
          width: CARD_W,
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          border: `${CARD_BORDER}px solid ${IG_LINE}`,
          borderRadius: 32,
          overflow: "hidden",
          paddingBottom: PAD_BOTTOM,
        }}
      >
        {/* header: avatar, username, Instagram glyph */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: HEADER_H,
            padding: `0 ${PAD_X}px`,
          }}
        >
          {post.avatar ? (
            <img
              alt=""
              src={post.avatar}
              width={AVATAR}
              height={AVATAR}
              style={{ borderRadius: AVATAR / 2, objectFit: "cover" }}
            />
          ) : (
            defaultAvatar(AVATAR)
          )}
          <div
            style={{
              display: "block",
              marginLeft: 28,
              maxWidth: MEDIA_W - 2 * PAD_X - AVATAR - 28 - 100,
              fontSize: USER_SIZE,
              fontWeight: 700,
              lineHeight: "60px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {post.username}
          </div>
          <div style={{ display: "flex", marginLeft: "auto" }}>
            {igGlyph(68)}
          </div>
        </div>

        {/* the media, full bleed as in the feed: landscape at its ratio, else square */}
        <div
          style={{
            display: "flex",
            position: "relative",
            width: MEDIA_W,
            height: mh,
          }}
        >
          <img
            alt=""
            src={post.image}
            width={MEDIA_W}
            height={mh}
            style={{ objectFit: "cover" }}
          />
          {isVideo && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* the X card's play button (same size and ring), in a neutral dark disc */}
              {playButton(168, "rgba(0,0,0,0.5)")}
            </div>
          )}
          {corner && (
            <div
              style={{
                position: "absolute",
                top: 32,
                right: 32,
                display: "flex",
              }}
            >
              {corner}
            </div>
          )}
        </div>

        {/* action row: heart, comment, share; bookmark right; carousel dots centered */}
        <div
          style={{
            display: "flex",
            position: "relative",
            alignItems: "center",
            height: ACTION_H,
            padding: `0 ${PAD_X - 6}px`,
          }}
        >
          {isCarousel && post.carouselCount
            ? pageDots(post.carouselCount)
            : null}
          <div style={{ display: "flex" }}>{heartIcon(ICON)}</div>
          <div style={{ display: "flex", marginLeft: 44 }}>
            {commentIcon(ICON)}
          </div>
          <div style={{ display: "flex", marginLeft: 44 }}>
            {shareIcon(ICON)}
          </div>
          <div style={{ display: "flex", marginLeft: "auto" }}>
            {bookmarkIcon(ICON)}
          </div>
        </div>

        {/* likes (hidden when the owner hides them, or at zero) */}
        {hasLikes(post) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: LIKES_H,
              padding: `0 ${PAD_X}px`,
              fontSize: USER_SIZE,
              fontWeight: 700,
            }}
          >
            {igLikes(post.likes!)}
          </div>
        )}

        {/* optional one-line caption: bold username, then the text, cut with an ellipsis */}
        {caption && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: CAPTION_H,
              padding: `0 ${PAD_X}px`,
            }}
          >
            {/* two blocks, not spans: Satori's ellipsis works only on a single-text block */}
            <div
              style={{
                display: "flex",
                flexShrink: 0,
                fontSize: USER_SIZE,
                fontWeight: 700,
                lineHeight: "60px",
              }}
            >
              {post.username}
            </div>
            <div
              style={{
                display: "block",
                flex: 1,
                minWidth: 0,
                marginLeft: 14,
                fontSize: USER_SIZE,
                lineHeight: "60px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {caption}
            </div>
          </div>
        )}

        {/* date */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: DATE_H,
            padding: `0 ${PAD_X}px`,
            fontSize: DATE_SIZE,
            color: IG_GRAY,
          }}
        >
          {igDate(post.timestamp)}
        </div>

        {/* "View on Instagram", in the X card's button style */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: `${BUTTON_GAP}px ${PAD_X}px 0 ${PAD_X}px`,
            height: BUTTON_H,
            borderRadius: BUTTON_H / 2,
            border: `${CARD_BORDER}px solid ${IG_LINE}`,
            fontSize: 46,
            fontWeight: 700,
            color: IG_LINK,
          }}
        >
          View on Instagram
        </div>
      </div>
    </div>
  );
}
