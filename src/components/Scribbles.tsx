import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { color?: string };

/** A loose hand-drawn underline. */
export function Underline({ color = "#e5432f", ...p }: P) {
  return (
    <svg viewBox="0 0 200 20" preserveAspectRatio="none" fill="none" {...p}>
      <path
        d="M3 13 C 40 6, 80 16, 120 9 S 180 7, 197 11 M10 16 C 60 12, 120 17, 190 13"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        filter="url(#crayon)"
      />
    </svg>
  );
}

/** A scribbled loop, for circling something important. */
export function Circle({ color = "#e5432f", ...p }: P) {
  return (
    <svg viewBox="0 0 120 80" fill="none" preserveAspectRatio="none" {...p}>
      <path
        d="M70 6 C 30 2, 4 20, 6 42 C 8 66, 50 78, 86 70 C 116 62, 120 34, 98 16 C 82 4, 50 6, 34 12"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        filter="url(#crayon)"
      />
    </svg>
  );
}

export function Sun(p: P) {
  return (
    <svg viewBox="0 0 80 80" fill="none" {...p}>
      <g filter="url(#crayon)" strokeLinecap="round">
        <circle
          cx="40"
          cy="40"
          r="16"
          fill="#f7c933"
          stroke="#f58a2c"
          strokeWidth="3"
        />
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          const r1 = 23,
            r2 = i % 2 ? 33 : 36;
          return (
            <line
              key={i}
              x1={40 + Math.cos(a) * r1}
              y1={40 + Math.sin(a) * r1}
              x2={40 + Math.cos(a + 0.08) * r2}
              y2={40 + Math.sin(a + 0.08) * r2}
              stroke="#f58a2c"
              strokeWidth="3.5"
            />
          );
        })}
      </g>
    </svg>
  );
}

export function Cloud(p: P) {
  return (
    <svg viewBox="0 0 120 60" fill="none" {...p}>
      <path
        d="M22 50 C 6 50, 4 32, 20 30 C 18 14, 42 8, 50 22 C 56 6, 86 8, 86 26 C 104 22, 116 44, 98 50 Z"
        fill="#ffffff"
        stroke="#2f78d4"
        strokeWidth="3"
        strokeLinejoin="round"
        filter="url(#crayon)"
      />
    </svg>
  );
}

export function Arrow({ color = "#2b2a33", ...p }: P) {
  return (
    <svg viewBox="0 0 100 60" fill="none" {...p}>
      <g
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#crayon)"
      >
        <path d="M6 10 C 30 50, 60 54, 88 36" />
        <path d="M74 30 L 90 35 L 82 50" />
      </g>
    </svg>
  );
}

/** Little pine trees, very Central Oregon. */
export function Pines(p: P) {
  return (
    <svg viewBox="0 0 160 70" fill="none" {...p}>
      <g filter="url(#crayon)" strokeLinejoin="round">
        <path
          d="M30 66 L30 58 M30 6 L12 34 L22 34 L8 56 L52 56 L38 34 L48 34 Z"
          fill="#3aa35b"
          stroke="#25683a"
          strokeWidth="2.5"
        />
        <path
          d="M80 66 L80 60 M80 18 L66 40 L74 40 L62 58 L98 58 L86 40 L94 40 Z"
          fill="#4fbf72"
          stroke="#25683a"
          strokeWidth="2.5"
        />
        <path
          d="M128 66 L128 56 M128 2 L108 32 L120 32 L104 54 L152 54 L136 32 L148 32 Z"
          fill="#3aa35b"
          stroke="#25683a"
          strokeWidth="2.5"
        />
        <path
          d="M2 67 C 50 63, 110 69, 158 65"
          stroke="#9a6a3f"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
