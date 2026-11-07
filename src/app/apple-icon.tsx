import { ImageResponse } from "next/og";
import { PAPER, WheelArt } from "@/components/me/brand-art";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS rounds the corners itself, so fill the square with paper. */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: PAPER,
      }}
    >
      <WheelArt size={150} />
    </div>,
    size,
  );
}
