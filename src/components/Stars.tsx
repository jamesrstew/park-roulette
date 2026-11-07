import { formatStars } from "@/lib/rating";

const STAR =
  "M12 1.8l3.1 6.4 7 1-5.1 4.9 1.2 7-6.2-3.3-6.3 3.3 1.2-7L1.9 9.2l7-1z";

/** Five crayon stars, filled to the tenth. Pure SVG, so it works on the server. */
export function Stars({
  tenths,
  size = 20,
  showNumber = true,
}: {
  tenths: number | null;
  size?: number;
  showNumber?: boolean;
}) {
  const pct = tenths == null ? 0 : tenths / 50;
  const w = 5 * 24 + 4 * 3;
  const clipId = `stars-${tenths ?? "x"}-${size}`;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <svg
        width={(w / 24) * size}
        height={size}
        viewBox={`0 0 ${w} 24`}
        aria-label={
          tenths == null
            ? "No stars yet"
            : `${formatStars(tenths)} out of 5 stars`
        }
        role="img"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={w * pct} height="24" />
          </clipPath>
        </defs>
        <g filter="url(#wobble)">
          <g clipPath={`url(#${clipId})`}>
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
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          ))}
        </g>
      </svg>
      {showNumber && (
        <span className="font-hand text-[1.15em] leading-none">
          {tenths == null ? "–" : formatStars(tenths)}
        </span>
      )}
    </span>
  );
}

export { STAR };
