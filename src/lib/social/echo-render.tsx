import "server-only";
import { get, put } from "@vercel/blob";
import { ImageResponse } from "next/og";
import { handFont } from "@/components/me/og-card";
import { WheelArt } from "@/components/me/brand-art";
import { INK, PAPER, tint } from "@/components/social/Slides";
import { CRAYONS } from "@/lib/crayons";
import { mediaPath, type PostKind, type SlideSpec, STORY } from "./model";
import { sha256, slidePng, toJpeg } from "./render";

/**
 * The Story echo's picture: the feed post's own cover (the JPEG that went
 * out, so exactly the media that was cleared for it) taped onto a 1080 x
 * 1920 crayon card with a "New post" label and one line by post type.
 * Instagram's top and bottom UI cover about 250 px each, so nothing sits
 * there. Graph API Stories take no link sticker, so the card promises no
 * tap.
 */

export type EchoFile = {
  sha: string;
  ext: "jpg";
  width: number;
  height: number;
  /** True when no photo is in it (the cover was the crayon card). */
  photoFree?: boolean;
};

/** Each post type's crayon on the Story (the label and the underline). */
const COLORS: Record<PostKind, string> = {
  park_post: CRAYONS.green,
  events_week: CRAYONS.blue,
  unpack: CRAYONS.orange,
  teaser: CRAYONS.purple,
  at_home: CRAYONS.pink,
  story: CRAYONS.yellow,
};

/** The top and bottom bands Instagram draws over. */
export const ECHO_SAFE = 250;
const COVER = { width: 736, height: 920 } as const;
/**
 * Where a feed slide's frame draws "Swipe" and the page count (Slides.tsx
 * HeadlineSlide and Frame), in feed pixels. A Story swipe skips to the
 * next account, so the echo papers over them in the card's own color.
 */
const SWIPE_PATCH = { left: 630, top: 1090, width: 385, height: 192 };
const CARD = "#fffdf7";
const SCALE = COVER.width / 1080;
const SOFT = "#5d5a6b";

function Underline({ width, color }: { width: number; color: string }) {
  return (
    <svg width={width} height={34} viewBox={`0 0 ${width} 34`}>
      <path
        d={`M6 20 C ${width * 0.25} 8, ${width * 0.5} 30, ${width * 0.75} 14 S ${width - 20} 22, ${width - 6} 12`}
        stroke={color}
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EchoCard({
  kind,
  line,
  cover,
  hideSwipe,
}: {
  kind: PostKind;
  line: string;
  /** The cover JPEG as a data: URL. */
  cover: string;
  /** Paper over the cover's "Swipe" and page count (headline covers). */
  hideSwipe: boolean;
}) {
  const color = COLORS[kind];
  return (
    <div
      style={{
        width: STORY.width,
        height: STORY.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: tint(color, 0.12, PAPER),
        fontFamily: "Gochi",
        color: INK,
        paddingTop: ECHO_SAFE + 14,
        paddingBottom: ECHO_SAFE + 14,
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 80,
          lineHeight: 1.1,
          padding: "8px 36px 14px",
          background: CRAYONS.yellow,
          border: `6px solid ${INK}`,
          borderRadius: "30px 16px 34px 14px",
          transform: "rotate(-3deg)",
        }}
      >
        New post
      </div>
      <div
        style={{
          display: "flex",
          fontSize: line.length > 24 ? 84 : 96,
          lineHeight: 1.2,
          marginTop: 30,
          maxWidth: 980,
          textAlign: "center",
        }}
      >
        {line}
      </div>
      <div style={{ display: "flex", marginTop: 2 }}>
        <Underline width={520} color={color} />
      </div>
      <div
        style={{
          display: "flex",
          position: "relative",
          marginTop: 40,
          transform: "rotate(1.5deg)",
        }}
      >
        <div
          style={{
            display: "flex",
            border: `6px solid ${INK}`,
            borderRadius: 18,
            overflow: "hidden",
            position: "relative",
            boxShadow: `12px 14px 0 ${INK}`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img
            src={cover}
            width={COVER.width}
            height={COVER.height}
            style={{ ...COVER, objectFit: "cover" }}
          />
          {hideSwipe ? (
            <div
              style={{
                position: "absolute",
                left: SWIPE_PATCH.left * SCALE,
                top: SWIPE_PATCH.top * SCALE,
                width: SWIPE_PATCH.width * SCALE,
                height: SWIPE_PATCH.height * SCALE,
                background: CARD,
                display: "flex",
              }}
            />
          ) : null}
        </div>
        <div
          style={{
            position: "absolute",
            left: COVER.width / 2 - 100,
            top: -26,
            width: 200,
            height: 56,
            background: "rgba(247, 201, 51, 0.6)",
            transform: "rotate(-4deg)",
            display: "flex",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginTop: "auto",
          fontSize: 46,
          color: SOFT,
        }}
      >
        <WheelArt size={60} />
        <span>See it on our feed: @park_roulette</span>
      </div>
    </div>
  );
}

/** The Story's JPEG from the cover's JPEG bytes. */
export async function renderEcho(
  kind: PostKind,
  line: string,
  coverJpeg: Uint8Array,
  hideSwipe = false,
): Promise<{ bytes: Buffer; file: EchoFile }> {
  const cover = `data:image/jpeg;base64,${Buffer.from(coverJpeg).toString("base64")}`;
  const res = new ImageResponse(
    <EchoCard kind={kind} line={line} cover={cover} hideSwipe={hideSwipe} />,
    { ...STORY, fonts: await handFont() },
  );
  const bytes = await toJpeg(Buffer.from(await res.arrayBuffer()));
  return { bytes, file: { sha: sha256(bytes), ext: "jpg", ...STORY } };
}

/** A stored post file's bytes (the cover that went out). */
export async function storedBytes(f: {
  sha: string;
  ext: string;
}): Promise<Uint8Array> {
  const r = await get(mediaPath(f), { access: "private" });
  if (!r?.stream) throw new Error("The cover isn't in Blob.");
  return new Uint8Array(await new Response(r.stream).arrayBuffer());
}

/**
 * The post's cover drawn as the crayon card (no photo): for a cover whose
 * photo was flagged after the post was drawn.
 */
export async function crayonCover(slides: SlideSpec[]): Promise<Buffer> {
  const plain = slides.map((s, i) =>
    i === 0 && "photo" in s ? ({ ...s, photo: null } as SlideSpec) : s,
  );
  return toJpeg(await slidePng(plain, 0, null));
}

/** Store the Story under its own hash (never overwritten). */
export async function storeEcho(r: {
  bytes: Buffer;
  file: EchoFile;
}): Promise<EchoFile> {
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
