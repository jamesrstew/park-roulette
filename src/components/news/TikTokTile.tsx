/* eslint-disable @next/next/no-img-element -- Satori (next/og) draws plain <img>. */
/**
 * Parents' corner: a TikTok video tile for the Bend Playground Passport email.
 * The video's thumbnail (copied into our Blob store at draft time, passed in
 * as a data URL), cropped to 4:5 (default) or 9:16, with a centered play
 * button and a bottom bar holding the TikTok logo and the @handle.
 *
 *   new ImageResponse(<TikTokTile thumbnail={dataUrl} handle="example_parent" />, {
 *     ...tiktokSize(), fonts, // loadInterFonts() from PostCard
 *   });
 *
 * 1200 wide at 2x. SVG helpers are plain functions, not JSX components (Satori).
 */

import type { ReactNode } from "react";
import { MAT, W, paperMat } from "./PostCard";

export type TikTokAspect = "4:5" | "9:16";

export type TikTokTileProps = {
  /** Thumbnail as a data URL, fetched server-side from our Blob store. */
  thumbnail: string;
  /** Without the "@". */
  handle: string;
  aspect?: TikTokAspect;
};

const INNER_W = W - MAT.left - MAT.right - 2 * MAT.border; // 1160
const RATIO: Record<TikTokAspect, number> = { "4:5": 5 / 4, "9:16": 16 / 9 };

/** Exact image size; use for ImageResponse and the email <img width/height>. */
export function tiktokSize(aspect: TikTokAspect = "4:5") {
  const innerH = Math.round(INNER_W * RATIO[aspect]);
  return { width: W, height: MAT.top + 2 * MAT.border + innerH + MAT.bottom };
}

/**
 * Alt text, which is also the link's accessible name: "TikTok video by
 * @handle: <caption>", or "TikTok video by @handle." with no caption. Pass the
 * caption (oEmbed `title`) when there is one; the image alone says nothing
 * about what the video is.
 */
export function tiktokAlt(handle: string, caption?: string | null) {
  const c = caption?.replace(/\s+/g, " ").trim();
  return c ? `TikTok video by @${handle}: ${c}` : `TikTok video by @${handle}.`;
}

/* ---------------- SVG helpers (called as functions) ---------------- */

const NOTE =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

/** TikTok's note mark: cyan and red offsets under a white glyph. */
function tiktokLogo(size: number): ReactNode {
  return (
    <svg width={size} height={size} viewBox="-1 -1 26 26">
      <path d={NOTE} fill="#25F4EE" transform="translate(-0.7 -0.7)" />
      <path d={NOTE} fill="#FE2C55" transform="translate(0.7 0.7)" />
      <path d={NOTE} fill="#ffffff" />
    </svg>
  );
}

/** A soft dark disc, white ring, white triangle: reads on any thumbnail. */
function playButton(size: number): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="rgba(0,0,0,0.42)"
        stroke="rgba(255,255,255,0.92)"
        strokeWidth="3.5"
      />
      <path
        d="M41 31 L70 50 L41 69 Z"
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------- Tile ---------------- */

export function TikTokTile({
  thumbnail,
  handle,
  aspect = "4:5",
}: TikTokTileProps) {
  const { width, height } = tiktokSize(aspect);
  const innerH = height - MAT.top - MAT.bottom - 2 * MAT.border;
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        fontFamily: "Inter",
      }}
    >
      {/* no tape: here the mat's top edge is the creator's thumbnail, and tape
          would sit on their video (and vanish into warm skies at 340px) */}
      {paperMat({ background: "#1a1a1f", tape: false })}
      <div
        style={{
          position: "absolute",
          left: MAT.left + MAT.border,
          top: MAT.top + MAT.border,
          width: INNER_W,
          height: innerH,
          display: "flex",
          overflow: "hidden",
          // inner radii follow the mat's wobble, minus the border
          borderRadius: "34px 12px 40px 10px",
        }}
      >
        <img
          alt=""
          src={thumbnail}
          width={INNER_W}
          height={innerH}
          style={{ objectFit: "cover" }}
        />
        {/* centered play button */}
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
          {playButton(232)}
        </div>
        {/* bottom bar: scrim, TikTok logo, @handle */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 340,
            display: "flex",
            alignItems: "flex-end",
            padding: "0 48px 44px 48px",
            backgroundImage:
              "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.08) 20%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.5) 70%, rgba(0,0,0,0.72) 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                padding: 14,
                borderRadius: 24,
                background: "#000000",
              }}
            >
              {tiktokLogo(64)}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginLeft: 26,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 52,
                  fontWeight: 700,
                  color: "#ffffff",
                  lineHeight: "60px",
                }}
              >
                {`@${handle}`}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 44,
                  color: "rgba(255,255,255,0.9)",
                  lineHeight: "54px",
                }}
              >
                Watch on TikTok
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
