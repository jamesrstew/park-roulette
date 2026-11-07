import type { SVGProps } from "react";
import { Cloud, Pines, Sun } from "../Scribbles";

type P = SVGProps<SVGSVGElement>;

/** A swing set and a slide, the way a six-year-old would draw them. */
export function PlaygroundDoodle(p: P) {
  return (
    <svg viewBox="0 0 220 120" fill="none" {...p}>
      <g filter="url(#crayon)" strokeLinecap="round" strokeLinejoin="round">
        {/* swing set */}
        <path
          d="M14 116 L40 26 L66 116 M100 116 L120 26 L140 116 M36 28 L124 28"
          stroke="#e5432f"
          strokeWidth="5"
        />
        <path
          d="M62 30 L62 80 M84 30 L84 80"
          stroke="#2b2a33"
          strokeWidth="2.5"
        />
        <path d="M56 82 L90 82" stroke="#2f78d4" strokeWidth="6" />
        <path
          d="M96 30 L104 72 M114 30 L106 72"
          stroke="#2b2a33"
          strokeWidth="2.5"
        />
        <path d="M98 74 L112 70" stroke="#8a5cc6" strokeWidth="6" />
        {/* slide */}
        <path
          d="M168 116 L168 46 M190 116 L190 46"
          stroke="#9a6a3f"
          strokeWidth="4"
        />
        <path
          d="M168 60 L190 60 M168 76 L190 76 M168 92 L190 92"
          stroke="#9a6a3f"
          strokeWidth="3"
        />
        <path
          d="M188 46 L176 46 C 160 46, 150 70, 140 92 C 134 106, 124 114, 112 114"
          stroke="#f7c933"
          strokeWidth="9"
        />
        <path d="M172 44 L194 44" stroke="#2b2a33" strokeWidth="3" />
      </g>
    </svg>
  );
}

/** Sky, sun, clouds, pines, and a playground: the no-photo-yet hero. */
export function DoodleScene({
  className = "",
  playground = true,
}: {
  className?: string;
  /** False for a park without a playground: just trees and sky. */
  playground?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-[color-mix(in_srgb,var(--color-crayon-blue)_14%,#fffdf7)] ${className}`}
      aria-hidden
    >
      <Sun className="absolute top-2 right-3 w-16 animate-float" />
      <Cloud className="absolute top-5 left-4 w-20" />
      <Cloud className="absolute top-14 left-32 w-12 opacity-80" />
      {playground ? (
        <>
          <Pines className="absolute right-0 bottom-0 w-36" />
          <PlaygroundDoodle className="absolute bottom-1 left-3 w-48" />
        </>
      ) : (
        <>
          <Pines className="absolute bottom-0 left-2 w-36" />
          <Pines className="absolute right-0 bottom-0 w-44" />
        </>
      )}
      <div className="absolute inset-x-0 bottom-0 h-2 bg-crayon-green/60" />
    </div>
  );
}

/** A wobbly crayon progress bar. pct is 0..100. */
export function CrayonProgress({
  pct,
  color = "#3aa35b",
  failed = false,
}: {
  pct: number;
  color?: string;
  failed?: boolean;
}) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <svg
      viewBox="0 0 200 18"
      preserveAspectRatio="none"
      className="h-4 w-full"
      role="progressbar"
      aria-valuenow={Math.round(w)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <g filter="url(#wobble)">
        <path
          d={`M3 9 L${3 + (194 * w) / 100} 9`}
          stroke={failed ? "#e5432f" : color}
          strokeWidth="11"
          strokeLinecap="round"
          opacity={failed ? 0.35 : 0.9}
          style={{ transition: "d 0.3s ease" }}
        />
        <path
          d="M3 4 C 60 2, 140 5, 197 3 L197 15 C 140 16, 60 13, 3 15 Z"
          fill="none"
          stroke="#2b2a33"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/** A loose scribble for crossing things out. */
export function ScribbleOut({
  color = "#e5432f",
  ...p
}: P & { color?: string }) {
  return (
    <svg viewBox="0 0 200 40" preserveAspectRatio="none" fill="none" {...p}>
      <path
        d="M4 26 C 30 10, 50 30, 76 16 S 120 30, 150 14 S 186 24, 196 12 M8 30 C 50 22, 120 30, 192 20"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        filter="url(#crayon)"
      />
    </svg>
  );
}
