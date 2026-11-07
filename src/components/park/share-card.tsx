import "server-only";
import { ImageResponse } from "next/og";
import { INK, PAPER, WheelArt } from "@/components/me/brand-art";
import { handFont, OG_SIZE } from "@/components/me/og-card";
import { isOurBlobUrl } from "@/lib/blob";
import { CRAYONS } from "@/lib/crayons";
import { PLAY_TYPES, playOf } from "@/lib/features";
import { formatStars } from "@/lib/rating";

/**
 * A park's link preview (iMessage, group chats): "Let's go here!", the
 * park's name and town, its stars, and a photo from a review if there is one.
 * Fetched by messaging apps without anyone signed in, so only public things.
 */

export type ParkShare = {
  name: string;
  city: string;
  play: string;
  status: string;
  avgTenths: number | null;
  reviewCount: number;
  photos: string[];
};

const SOFT = "#5d5a6b";
const PHOTO_TIMEOUT_MS = 3500;
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

/**
 * A review photo as a data URI, or null (then the card shows the wheel).
 * Only our own Blob store, only real JPEG/PNG bytes (what the renderer can
 * draw; the uploader's label isn't trusted), never too big or too slow.
 * Photos are re-encoded in the browser before upload, so they're already a
 * sensible size with their rotation baked in.
 */
async function photoData(url: string): Promise<string | null> {
  if (!isOurBlobUrl(url)) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
      redirect: "error",
    });
    const size = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || size > PHOTO_MAX_BYTES) {
      await res.body?.cancel();
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > PHOTO_MAX_BYTES) return null;
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const png = buf
      .subarray(0, 4)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (!jpeg && !png) return null;
    return `data:image/${jpeg ? "jpeg" : "png"};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** The first of the park's newest photos that we can use. */
async function firstPhoto(urls: string[]): Promise<string | null> {
  for (const url of urls.slice(0, 4)) {
    const data = await photoData(url);
    if (data) return data;
  }
  return null;
}

/** One crayon star, filled 0..1 from the left. */
function Star({ fill, size }: { fill: number; size: number }) {
  const d =
    "M50 6 L62 37 L95 38 L69 59 L78 92 L50 73 L22 92 L31 59 L5 38 L38 37 Z";
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: size,
        height: size,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{ position: "absolute" }}
      >
        <path
          d={d}
          fill="#fffdf7"
          stroke={INK}
          strokeWidth={7}
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 0,
          top: 0,
          // the star itself spans 5..95 of its 100-wide box
          width: Math.round(size * (fill <= 0 ? 0 : 0.05 + 0.9 * fill)),
          height: size,
          overflow: "hidden",
        }}
      >
        <svg width={size} height={size} viewBox="0 0 100 100">
          <path
            d={d}
            fill={CRAYONS.yellow}
            stroke={INK}
            strokeWidth={7}
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

/** Big for short names; long ones step down and get up to three lines. */
function titleSize(name: string) {
  if (name.length <= 12) return 92;
  if (name.length <= 18) return 78;
  if (name.length <= 26) return 64;
  if (name.length <= 34) return 54;
  if (name.length <= 46) return 48;
  return 40;
}

export async function parkShareCard(park: ParkShare): Promise<Response> {
  const photo = await firstPhoto(park.photos);
  // Draw the whole card before sending anything: a photo the renderer
  // chokes on would otherwise break the preview mid-stream (and get cached).
  try {
    return await buffered(renderParkCard(park, photo));
  } catch (e) {
    if (!photo) throw e;
    console.error(
      "[share-card] photo failed to draw; using the wheel",
      (e as Error)?.name,
    );
    return buffered(renderParkCard(park, null));
  }
}

async function buffered(card: Promise<ImageResponse>): Promise<Response> {
  const res = await card;
  const body = await res.arrayBuffer();
  return new Response(body, { headers: res.headers });
}

/** The card itself, given the photo as a data URI (or null for the wheel). */
export async function renderParkCard(park: ParkShare, photo: string | null) {
  const fonts = await handFont();
  const stars = park.avgTenths == null ? null : park.avgTenths / 10;
  const crossed = park.status === "closed" || park.status === "private";
  const chip = crossed
    ? park.status === "closed"
      ? "Closed"
      : "Private"
    : PLAY_TYPES[playOf(park)].label;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: PAPER,
        fontFamily: fonts.length ? "Gochi" : "sans-serif",
        color: INK,
        position: "relative",
      }}
    >
      {/* paper card */}
      <div
        style={{
          position: "absolute",
          left: 40,
          top: 40,
          right: 40,
          bottom: 40,
          display: "flex",
          border: `6px solid ${INK}`,
          borderRadius: "40px 18px 46px 16px",
          background: "#fffdf7",
          boxShadow: `10px 12px 0 ${INK}`,
        }}
      />

      {/* left: a taped photo, or the wheel */}
      {photo ? (
        <div
          style={{
            position: "absolute",
            left: 86,
            top: 92,
            width: 400,
            height: 430,
            display: "flex",
            flexDirection: "column",
            background: "#ffffff",
            border: `5px solid ${INK}`,
            borderRadius: 14,
            padding: "16px 16px 52px 16px",
            transform: "rotate(-4deg)",
            boxShadow: `6px 8px 0 ${INK}`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered by ImageResponse, not the browser */}
          <img
            src={photo}
            width={358}
            height={352}
            style={{ objectFit: "cover", borderRadius: 6 }}
            alt=""
          />
          <div
            style={{
              position: "absolute",
              left: 130,
              top: -26,
              width: 140,
              height: 44,
              background: "rgba(247, 201, 51, 0.7)",
              transform: "rotate(3deg)",
              display: "flex",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            left: 80,
            top: 115,
            display: "flex",
            transform: "rotate(-6deg)",
          }}
        >
          <WheelArt size={400} />
        </div>
      )}

      {/* right: what and where */}
      <div
        style={{
          position: "absolute",
          left: 540,
          top: 92,
          right: 84,
          bottom: 84,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 42, color: SOFT, display: "flex" }}>
          {crossed ? "On the Park Roulette map" : "Let's go here!"}
        </div>
        <div
          style={{
            fontSize: titleSize(park.name),
            lineHeight: 1.02,
            display: "flex",
            marginTop: 6,
            maxHeight: titleSize(park.name) * 1.02 * 3 + 4,
            overflow: "hidden",
          }}
        >
          {park.name}
        </div>
        <div
          style={{
            width: 220,
            height: 14,
            marginTop: 10,
            background: CRAYONS.yellow,
            borderRadius: 8,
            transform: "rotate(-1.5deg)",
            display: "flex",
          }}
        />
        <div style={{ fontSize: 40, marginTop: 14, display: "flex" }}>
          {park.city}, Oregon
        </div>

        <div style={{ display: "flex", flexGrow: 1 }} />

        {stars == null ? (
          <div style={{ fontSize: 38, color: SOFT, display: "flex" }}>
            No stars yet. Be the first!
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Star
                key={i}
                size={54}
                fill={Math.max(0, Math.min(1, stars - i))}
              />
            ))}
            <div style={{ fontSize: 54, marginLeft: 12, display: "flex" }}>
              {formatStars(park.avgTenths!)}
            </div>
            <div
              style={{
                fontSize: 32,
                color: SOFT,
                marginLeft: 10,
                display: "flex",
              }}
            >
              {park.reviewCount} {park.reviewCount === 1 ? "review" : "reviews"}
            </div>
          </div>
        )}
        <div style={{ display: "flex", marginTop: 18 }}>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              padding: "4px 22px",
              border: `4px solid ${INK}`,
              borderRadius: 999,
              background: crossed ? "#f2e6e0" : "#d5ebd9", // crayon green, lightly colored in
            }}
          >
            {chip}
          </div>
        </div>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts,
      headers: {
        "cache-control":
          "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
