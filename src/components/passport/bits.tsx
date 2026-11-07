import type { ReactNode } from "react";
import { Underline } from "@/components/Scribbles";

/** A stable little tilt per id, so stamps and stickers look hand-placed. */
export function tilt(seed: number, max = 7): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return Math.round((x - Math.floor(x)) * max * 2 - max);
}

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "2-digit",
  timeZone: "UTC",
});

/** "2026-11-06" -> "Nov 6, 26" with no time-zone drift. */
export function stampDate(iso: string): string {
  return DAY.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace(
    ", ",
    " '",
  );
}

/** Today in Central Oregon, "YYYY-MM-DD". */
export function todayInBend(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
}

export function SectionTitle({
  emoji,
  children,
  color,
  aside,
}: {
  emoji: string;
  children: ReactNode;
  color: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-[2rem]">
          <span aria-hidden className="text-2xl">
            {emoji}
          </span>
          {children}
        </h2>
        <Underline className="-mt-1 ml-8 h-3 w-36" color={color} />
      </div>
      {aside}
    </div>
  );
}

/** A hand-colored bar: zigzag crayon strokes fill the share that's done. */
export function ScribbleBar({
  done,
  crossed = 0,
  total,
  color,
}: {
  done: number;
  crossed?: number;
  total: number;
  color: string;
}) {
  const inner = 192;
  const wDone = total ? (inner * done) / total : 0;
  const wCrossed = total ? (inner * crossed) / total : 0;
  // Back-and-forth crayon strokes, like a kid coloring inside the lines.
  const zig = (x0: number, w: number) => {
    if (w < 1) return "";
    let d = `M${x0 + 1} 6`;
    for (let x = x0; x < x0 + w - 1; x += 6) {
      d += ` L${Math.min(x + 3, x0 + w - 1)} 16 L${Math.min(x + 6, x0 + w - 1)} 6`;
    }
    return d;
  };
  // Light pencil hatching for crossed-off parks.
  const hatch = (x0: number, w: number) => {
    let d = "";
    for (let x = x0; x < x0 + w - 2; x += 5) d += ` M${x} 17 L${x + 5} 5`;
    return d.trim();
  };
  return (
    <svg
      viewBox="0 0 200 22"
      preserveAspectRatio="none"
      className="h-4 w-full"
      aria-hidden
    >
      {wDone >= 1 && (
        <rect
          x="4"
          y="5"
          width={wDone}
          height="12"
          fill={color}
          opacity="0.25"
        />
      )}
      <path
        d={zig(4, wDone)}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#crayon)"
      />
      {wCrossed >= 2 && (
        <path
          d={hatch(4 + wDone, wCrossed)}
          fill="none"
          stroke="#5d5a6b"
          strokeOpacity="0.55"
          strokeWidth="1.3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d="M3 4 C 60 2, 140 5, 197 3 L 198 18 C 140 20, 60 17, 2 19 Z"
        fill="none"
        stroke="#2b2a33"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
