import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { CrayonStick, INK, PAPER, WheelArt } from "./brand-art";

export const OG_SIZE = { width: 1200, height: 630 };

/** Gochi Hand (OFL), bundled in public/fonts. Falls back to the default font. */
export async function handFont() {
  try {
    const data = await readFile(
      join(process.cwd(), "public/fonts/GochiHand-Regular.ttf"),
    );
    return [
      { name: "Gochi", data, weight: 400 as const, style: "normal" as const },
    ];
  } catch {
    return [];
  }
}

/** Link previews refresh hourly (stars change), not "forever". */
const HEADERS = {
  "cache-control":
    "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
};

/** The shared crayon card for link unfurls (home and invite links). */
export async function ogCard({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle: string;
}) {
  const fonts = await handFont();
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
      {/* tape */}
      <div
        style={{
          position: "absolute",
          left: 520,
          top: 22,
          width: 160,
          height: 44,
          background: "rgba(247, 201, 51, 0.55)",
          transform: "rotate(-3deg)",
          display: "flex",
        }}
      />
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
      <div
        style={{
          position: "absolute",
          left: 530,
          top: 110,
          right: 80,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 44, color: "#5d5a6b", display: "flex" }}>
          {kicker}
        </div>
        <div
          style={{
            fontSize: title.length > 11 ? 92 : 112,
            lineHeight: 1,
            whiteSpace: "nowrap",
            display: "flex",
            position: "relative",
            marginTop: 4,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -10,
              right: 10,
              bottom: 8,
              height: 44,
              background: "rgba(247, 201, 51, 0.75)",
              transform: "rotate(-1.5deg)",
              borderRadius: 8,
              display: "flex",
            }}
          />
          <div style={{ display: "flex", position: "relative" }}>{title}</div>
        </div>
        <div
          style={{
            fontSize: 46,
            lineHeight: 1.2,
            marginTop: 26,
            display: "flex",
          }}
        >
          {subtitle}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 560,
          bottom: 70,
          display: "flex",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", transform: "rotate(-4deg)" }}>
          <CrayonStick color="#2f78d4" width={170} />
        </div>
        <div style={{ display: "flex", transform: "rotate(3deg)" }}>
          <CrayonStick color="#3aa35b" width={170} />
        </div>
        <div style={{ display: "flex", transform: "rotate(-2deg)" }}>
          <CrayonStick color="#ee6aa7" width={170} />
        </div>
      </div>
    </div>,
    { ...OG_SIZE, fonts, headers: HEADERS },
  );
}
