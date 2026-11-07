import { ImageResponse } from "next/og";
import { appIconDataUri } from "@/lib/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The iPhone Home Screen icon. Full-bleed: iOS rounds the corners itself. */
export default function AppleIcon() {
  return new ImageResponse(
    <img src={appIconDataUri()} width={180} height={180} alt="" />,
    size,
  );
}
