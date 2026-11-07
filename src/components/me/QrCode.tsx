"use client";

import { useMemo } from "react";
import { encodeQr } from "./qr";

/** An inline-SVG QR code. Ink on paper, with a quiet zone so phones can read it. */
export function QrCode({
  text,
  label,
  className = "",
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const path = useMemo(() => {
    const grid = encodeQr(text);
    let d = "";
    grid.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }),
    );
    return { d, size: grid.length + 8 };
  }, [text]);
  return (
    <svg
      viewBox={`0 0 ${path.size} ${path.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={path.size} height={path.size} fill="#ffffff" />
      <path d={path.d} fill="#2b2a33" />
    </svg>
  );
}
