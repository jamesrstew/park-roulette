"use client";

import { useState } from "react";
import { DoodleScene } from "./Doodles";

/** The polaroid photo, falling back to the crayon scene if it won't load. */
export function CoverPhoto({
  src,
  alt,
  playground,
}: {
  src: string;
  alt: string;
  playground: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <DoodleScene className="aspect-[4/3] w-full" playground={playground} />
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Blob URLs, no image optimizer
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="aspect-[4/3] w-full object-cover"
    />
  );
}
