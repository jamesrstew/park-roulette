import { ImageResponse } from "next/og";
import { appIconDataUri } from "@/lib/app-icon";

const SIZES = {
  "32": { px: 32, safe: false, tiny: true },
  "192": { px: 192, safe: false, tiny: false },
  "512": { px: 512, safe: false, tiny: false },
  /** Android adaptive icons crop to a circle: keep the art in the safe zone. */
  maskable: { px: 512, safe: true, tiny: false },
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
  const { px, safe, tiny } = SIZES[key] ?? SIZES["512"];
  return new ImageResponse(
    <img src={appIconDataUri({ safe, tiny })} width={px} height={px} alt="" />,
    { width: px, height: px },
  );
}
