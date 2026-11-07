import type { SVGProps } from "react";
import { CRAYONS } from "@/lib/crayons";

type P = SVGProps<SVGSVGElement>;

const C = CRAYONS;

/** Sprinkles and streamers around an invitation card. */
export function PartyDoodles(p: P) {
  const bits: [number, number, string, "dot" | "zig" | "star"][] = [
    [4, 8, C.pink, "zig"],
    [22, 2, C.yellow, "dot"],
    [48, 4, C.teal, "star"],
    [76, 1, C.orange, "dot"],
    [95, 10, C.purple, "zig"],
    [2, 52, C.blue, "dot"],
    [98, 46, C.green, "star"],
    [3, 92, C.yellow, "star"],
    [30, 98, C.red, "dot"],
    [66, 97, C.pink, "zig"],
    [96, 90, C.teal, "dot"],
  ];
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
      {...p}
    >
      <g filter="url(#crayon)" strokeLinecap="round" strokeLinejoin="round">
        {bits.map(([x, y, c, kind], i) =>
          kind === "dot" ? (
            <ellipse key={i} cx={x} cy={y} rx="1.6" ry="1.1" fill={c} />
          ) : kind === "zig" ? (
            <path
              key={i}
              d={`M${x - 3} ${y} l2 -2 l2 2 l2 -2`}
              stroke={c}
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: 3 }}
            />
          ) : (
            <path
              key={i}
              d={`M${x} ${y - 2.5} L${x} ${y + 2.5} M${x - 2} ${y} L${x + 2} ${y}`}
              stroke={c}
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: 3 }}
            />
          ),
        )}
      </g>
    </svg>
  );
}

/** A crayon snapped in two with a smudge: for broken invite links. */
export function SmudgedCrayon(p: P) {
  return (
    <svg viewBox="0 0 220 150" fill="none" aria-hidden {...p}>
      <g filter="url(#crayon)" strokeLinejoin="round" strokeLinecap="round">
        {/* smudge */}
        <path
          d="M30 118 C 60 100, 90 128, 120 112 S 170 104, 196 122 M40 128 C 80 116, 120 136, 186 128 M56 108 C 90 96, 130 118, 170 106"
          stroke={C.purple}
          strokeWidth="9"
          opacity="0.35"
        />
        {/* left half */}
        <g transform="rotate(-18 70 70)">
          <path
            d="M14 62 L34 52 L34 86 L14 76 Z"
            fill={C.purple}
            stroke="#2b2a33"
            strokeWidth="3"
          />
          <rect
            x="34"
            y="50"
            width="62"
            height="38"
            rx="4"
            fill={C.purple}
            stroke="#2b2a33"
            strokeWidth="3"
          />
          <path
            d="M96 50 L90 58 L98 64 L90 72 L98 80 L94 88"
            stroke="#2b2a33"
            strokeWidth="3"
          />
          <ellipse
            cx="66"
            cy="69"
            rx="16"
            ry="9"
            fill="#fffdf7"
            opacity="0.8"
          />
        </g>
        {/* right half */}
        <g transform="rotate(14 160 70)">
          <rect
            x="124"
            y="52"
            width="66"
            height="38"
            rx="4"
            fill={C.purple}
            stroke="#2b2a33"
            strokeWidth="3"
          />
          <path
            d="M126 52 L132 60 L124 66 L132 74 L124 82 L128 90"
            stroke="#2b2a33"
            strokeWidth="3"
          />
          <path
            d="M144 56 Q 152 52 160 56 T 176 56 M144 86 Q 152 82 160 86 T 176 86"
            stroke="#2b2a33"
            strokeWidth="2"
          />
        </g>
        {/* crumbs + oops lines */}
        <circle cx="110" cy="80" r="3" fill={C.purple} />
        <circle cx="103" cy="94" r="2" fill={C.purple} />
        <circle cx="117" cy="98" r="2.4" fill={C.purple} />
        <path
          d="M104 30 L108 44 M120 26 L116 42 M90 36 L100 46"
          stroke="#2b2a33"
          strokeWidth="3"
        />
      </g>
    </svg>
  );
}

/** Step 1: a little roulette wheel. */
export function DoodleSpin(p: P) {
  const wedges = [C.red, C.yellow, C.blue, C.green, C.orange, C.purple];
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden {...p}>
      <g filter="url(#crayon)" strokeLinejoin="round">
        {wedges.map((c, i) => {
          const a0 = (i / 6) * Math.PI * 2;
          const a1 = ((i + 1) / 6) * Math.PI * 2;
          return (
            <path
              key={i}
              d={`M40 42 L${40 + Math.cos(a0) * 30} ${42 + Math.sin(a0) * 30} A30 30 0 0 1 ${40 + Math.cos(a1) * 30} ${42 + Math.sin(a1) * 30} Z`}
              fill={c}
              stroke="#2b2a33"
              strokeWidth="2"
            />
          );
        })}
        <circle
          cx="40"
          cy="42"
          r="5"
          fill="#fffdf7"
          stroke="#2b2a33"
          strokeWidth="2"
        />
        <path d="M40 4 L46 14 L34 14 Z" fill="#2b2a33" />
        <path
          d="M66 16 C 74 22, 76 32, 74 40"
          stroke="#2b2a33"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M70 38 L74 42 L78 36"
          stroke="#2b2a33"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Step 2: a car zooming to a slide. */
export function DoodleGo(p: P) {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden {...p}>
      <g filter="url(#crayon)" strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M6 66 C 20 60, 30 70, 44 64"
          stroke={C.brown}
          strokeWidth="3"
          strokeDasharray="4 5"
        />
        {/* slide */}
        <path
          d="M52 66 L52 26 L60 26 L60 66"
          stroke="#2b2a33"
          strokeWidth="2.5"
        />
        <path
          d="M52 34 L60 34 M52 44 L60 44 M52 54 L60 54"
          stroke="#2b2a33"
          strokeWidth="2"
        />
        <path d="M60 26 C 68 30, 70 50, 78 64" stroke={C.red} strokeWidth="5" />
        <circle
          cx="56"
          cy="16"
          r="4"
          fill={C.yellow}
          stroke={C.orange}
          strokeWidth="2"
        />
        {/* car */}
        <path
          d="M8 50 L12 40 L30 40 L36 50 L40 50 L40 58 L6 58 L6 50 Z"
          fill={C.teal}
          stroke="#2b2a33"
          strokeWidth="2.5"
        />
        <path
          d="M15 42 L18 49 M24 42 L24 49"
          stroke="#fffdf7"
          strokeWidth="2"
        />
        <circle cx="14" cy="59" r="4" fill="#2b2a33" />
        <circle cx="32" cy="59" r="4" fill="#2b2a33" />
        <path d="M0 46 L4 46 M0 52 L3 52" stroke="#2b2a33" strokeWidth="2" />
      </g>
    </svg>
  );
}

/** Step 3: a passport stamp and a star. */
export function DoodleStamp(p: P) {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden {...p}>
      <g filter="url(#crayon)" strokeLinejoin="round" strokeLinecap="round">
        <circle
          cx="34"
          cy="44"
          r="24"
          stroke={C.red}
          strokeWidth="3"
          strokeDasharray="5 3"
        />
        <circle cx="34" cy="44" r="17" stroke={C.red} strokeWidth="2.5" />
        <path d="M24 44 L31 51 L45 36" stroke={C.red} strokeWidth="4" />
        <path
          d="M62 6 L66 16 L77 17 L69 24 L71 35 L62 29 L53 35 L55 24 L47 17 L58 16 Z"
          fill={C.yellow}
          stroke={C.orange}
          strokeWidth="2.5"
        />
      </g>
    </svg>
  );
}
