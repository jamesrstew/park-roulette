/**
 * Plain-SVG art for ImageResponse (icons, share cards). No CSS classes or
 * SVG filters here: Satori renders only inline styles and basic shapes.
 */

export const PAPER = "#fffaf0";
export const INK = "#2b2a33";

/** Six big wedges, the same as the app icon (src/lib/app-icon.ts). */
const WEDGES = [
  "#e5432f",
  "#f58a2c",
  "#f7c933",
  "#3aa35b",
  "#2f78d4",
  "#8a5cc6",
];

/** Slightly wobbly point on a circle, so the wheel looks hand drawn. */
function pt(cx: number, cy: number, r: number, a: number, wob = 0) {
  const rr = r + Math.sin(a * 5) * wob;
  return `${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`;
}

/** The crayon roulette wheel with its pointer, drawn in a 100x100 box. */
export function WheelArt({ size }: { size: number }) {
  const cx = 50;
  const cy = 54;
  const r = 38;
  const n = WEDGES.length;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {/* drop shadow */}
      <circle cx={cx + 2.5} cy={cy + 3} r={r + 1.5} fill={INK} />
      {WEDGES.map((c, i) => {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
        const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
        return (
          <path
            key={c}
            d={`M${cx} ${cy} L${pt(cx, cy, r, a0, 0.8)} A${r} ${r} 0 0 1 ${pt(cx, cy, r, a1, 0.8)} Z`}
            fill={c}
            stroke={INK}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
        );
      })}
      {/* wax highlights */}
      {WEDGES.map((c, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return (
          <path
            key={`h${c}`}
            d={`M${pt(cx, cy, 14, a - 0.12)} L${pt(cx, cy, 30, a - 0.08)}`}
            stroke="#ffffff"
            strokeOpacity={0.35}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        );
      })}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={INK}
        strokeWidth={3.2}
      />
      <circle
        cx={cx}
        cy={cy}
        r={7.5}
        fill={PAPER}
        stroke={INK}
        strokeWidth={2.6}
      />
      <circle cx={cx} cy={cy} r={2.4} fill={INK} />
      {/* pointer: a little crayon tip */}
      <path
        d={`M${cx - 7.5} 6 L${cx + 7.5} 6 L${cx} 22 Z`}
        fill="#e5432f"
        stroke={INK}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <rect
        x={cx - 7.5}
        y={1.5}
        width={15}
        height={5}
        rx={1.5}
        fill="#e5432f"
        stroke={INK}
        strokeWidth={2.2}
      />
    </svg>
  );
}

/** A horizontal crayon stick, for share cards. */
export function CrayonStick({
  color,
  width,
}: {
  color: string;
  width: number;
}) {
  return (
    <svg width={width} height={width * 0.2} viewBox="0 0 200 40">
      <path
        d="M4 20 L38 6 L38 34 Z"
        fill={color}
        stroke={INK}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <rect
        x={38}
        y={4}
        width={158}
        height={32}
        rx={5}
        fill={color}
        stroke={INK}
        strokeWidth={3}
      />
      <path
        d="M58 6 Q 62 12 58 18 T 58 34 M176 6 Q 180 12 176 18 T 176 34"
        fill="none"
        stroke={INK}
        strokeWidth={2.4}
      />
      <ellipse cx={117} cy={20} rx={34} ry={8} fill="#fffdf7" opacity={0.85} />
    </svg>
  );
}
