/** A hand-drawn progress bar: wobbly outline, crayon-scribbled fill. */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const W = 200;
  const fillW = Math.max(pct > 0 ? 6 : 0, (W - 6) * pct);
  // Zig-zag scribble strokes across the filled part.
  const zig: string[] = [];
  for (let x = 3; x < 3 + fillW; x += 5)
    zig.push(`M${x} 11 L${Math.min(x + 6, 3 + fillW)} 2`);
  return (
    <svg
      viewBox="0 0 200 14"
      preserveAspectRatio="none"
      className="mt-1 block h-3.5 w-full"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={`${value} of ${max} colored in`}
    >
      <g filter="url(#wobble)">
        <rect
          x="3"
          y="2"
          width={fillW}
          height="9"
          rx="4"
          fill="#7fcf95"
          className="transition-[width] duration-700"
        />
        <path
          d={zig.join(" ")}
          stroke="#3aa35b"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
        <rect
          x="1.5"
          y="1.5"
          width="197"
          height="10"
          rx="5"
          fill="none"
          stroke="#2b2a33"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
