import { ImageResponse } from "next/og";
import { PAPER, WheelArt } from "@/components/me/brand-art";

const SIZES = {
  "32": { px: 32, pad: 0 },
  "192": { px: 192, pad: 0.06 },
  "512": { px: 512, pad: 0.06 },
  /** Android adaptive icons crop to a circle: keep the art in the safe zone. */
  maskable: { px: 512, pad: 0.2 },
} as const;

type Id = keyof typeof SIZES;

export function generateImageMetadata() {
  return (Object.keys(SIZES) as Id[]).map((id) => ({
    id,
    contentType: "image/png",
    size: { width: SIZES[id].px, height: SIZES[id].px },
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const key = (await id) as Id;
  const { px, pad } = SIZES[key] ?? SIZES["512"];
  const art = Math.round(px * (1 - pad * 2));
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: px <= 32 ? "transparent" : PAPER,
      }}
    >
      <WheelArt size={art} />
    </div>,
    { width: px, height: px },
  );
}
