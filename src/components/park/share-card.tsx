import "server-only";
import { ImageResponse } from "next/og";
import { INK, PAPER, WheelArt } from "@/components/me/brand-art";
import { handFont, OG_SIZE } from "@/components/me/og-card";
import { CRAYONS } from "@/lib/crayons";
import { PLAY_TYPES, playOf } from "@/lib/features";
import { formatStars } from "@/lib/rating";

/**
 * A park's link preview (iMessage, group chats): "Let's go here!", the
 * park's name and town and its stars, next to the crayon wheel. Never review
 * photos: link previews are seen by anyone, and photos are for signed-in
 * families only.
 */

export type ParkShare = {
  name: string;
  city: string;
  play: string;
  status: string;
  avgTenths: number | null;
  reviewCount: number;
};

const SOFT = "#5d5a6b";

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
  // Drawn in full before sending, so a render problem can't send half a card.
  return buffered(renderParkCard(park, null));
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
