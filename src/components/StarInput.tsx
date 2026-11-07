"use client";

import { useRef } from "react";
import { formatStars, toTenths, verdict } from "@/lib/rating";
import { STAR } from "./Stars";

/**
 * Drag (or tap) across the stars to color them in, to the tenth of a star.
 * The +/- buttons nudge by 0.1 for the perfectionists.
 */
export function StarInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (stars: number) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const w = 5 * 24 + 4 * 3;
  const tenths = toTenths(value);

  function fromPointer(clientX: number) {
    const box = ref.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - box.left, 0), box.width);
    onChange(toTenths((x / box.width) * 5) / 10);
  }

  const nudge = (d: number) => onChange(toTenths(value + d) / 10);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-end gap-3">
        <span className="font-sketch text-6xl leading-none font-bold">
          {formatStars(tenths)}
        </span>
        <span className="pb-1 font-hand text-2xl text-ink-soft">
          {verdict(tenths)}
        </span>
      </div>
      <svg
        ref={ref}
        viewBox={`-2 -2 ${w + 4} 28`}
        className="w-full max-w-sm cursor-pointer touch-none select-none"
        role="slider"
        tabIndex={0}
        aria-label="Star rating"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={tenths / 10}
        aria-valuetext={`${formatStars(tenths)} stars`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            fromPointer(e.clientX);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1 : 0.1;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            nudge(step);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            nudge(-step);
          }
        }}
      >
        <defs>
          <clipPath id="star-input-clip">
            <rect x="0" y="-2" width={(w * tenths) / 50} height="28" />
          </clipPath>
        </defs>
        <g filter="url(#wobble)">
          <g clipPath="url(#star-input-clip)">
            {[0, 1, 2, 3, 4].map((i) => (
              <path
                key={i}
                d={STAR}
                transform={`translate(${i * 27} 0)`}
                fill="url(#hatch-yellow)"
              />
            ))}
          </g>
          {[0, 1, 2, 3, 4].map((i) => (
            <path
              key={i}
              d={STAR}
              transform={`translate(${i * 27} 0)`}
              fill="none"
              stroke="#2b2a33"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          ))}
        </g>
      </svg>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="crayon-btn min-h-10 bg-paper px-4 text-2xl"
          onClick={() => nudge(-0.1)}
          aria-label="Minus a tenth"
        >
          −
        </button>
        <span className="text-sm text-ink-soft">
          drag the stars or nudge it
        </span>
        <button
          type="button"
          className="crayon-btn min-h-10 bg-paper px-4 text-2xl"
          onClick={() => nudge(0.1)}
          aria-label="Plus a tenth"
        >
          +
        </button>
      </div>
    </div>
  );
}
