"use client";

import { CRAYONS, CRAYON_NAMES, type CrayonName } from "@/lib/crayons";

const LABEL: Record<CrayonName, string> = {
  red: "Fire truck red",
  orange: "Pumpkin orange",
  yellow: "Sunshine yellow",
  green: "Pine tree green",
  teal: "River teal",
  blue: "Big sky blue",
  purple: "Huckleberry purple",
  pink: "Bubblegum pink",
  brown: "Pinecone brown",
};

export function crayonLabel(name: string) {
  return LABEL[name as CrayonName] ?? name;
}

/** One crayon stick: pointy waxy tip, paper wrapper with squiggles. */
function Stick({ hex }: { hex: string }) {
  return (
    <svg viewBox="0 0 30 132" className="h-full w-full" aria-hidden>
      <g filter="url(#wobble)" strokeLinejoin="round">
        {/* tip */}
        <path
          d="M15 3 L23 28 L7 28 Z"
          fill={hex}
          stroke="#2b2a33"
          strokeWidth="2"
        />
        <path d="M15 3 L18 12 L12 12 Z" fill="#2b2a33" opacity="0.25" />
        {/* collar */}
        <rect
          x="5"
          y="27"
          width="20"
          height="8"
          rx="2"
          fill={hex}
          stroke="#2b2a33"
          strokeWidth="2"
        />
        {/* wrapper */}
        <rect
          x="4"
          y="34"
          width="22"
          height="96"
          rx="3"
          fill={hex}
          stroke="#2b2a33"
          strokeWidth="2"
        />
        <path
          d="M5 44 Q 9 41 13 44 T 21 44 T 25 44 M5 118 Q 9 115 13 118 T 21 118 T 25 118"
          fill="none"
          stroke="#2b2a33"
          strokeWidth="1.6"
        />
        <ellipse
          cx="15"
          cy="81"
          rx="7"
          ry="20"
          fill="#fffdf7"
          opacity="0.85"
          stroke="#2b2a33"
          strokeWidth="1.4"
        />
        <path
          d="M8 36 L8 128"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.35"
        />
      </g>
    </svg>
  );
}

/**
 * A box of crayons. Tap a stick and it pops up out of the box.
 * Radio-group semantics so it works with a keyboard and screen readers.
 */
export function CrayonPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: CrayonName) => void;
}) {
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Pick your crayon"
        className="relative mt-6 h-44 pt-2"
      >
        <div className="relative z-0 grid h-36 grid-cols-9 items-end gap-0.5 px-2">
          {CRAYON_NAMES.map((name, i) => {
            const on = value === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={LABEL[name]}
                onClick={() => onChange(name)}
                className="relative h-full min-w-0 transition-transform duration-300 ease-[cubic-bezier(0.2,1.5,0.4,1)] focus-visible:outline-offset-0"
                style={{
                  transform: on
                    ? `translateY(-34px) rotate(${i % 2 ? 4 : -4}deg)`
                    : `translateY(${i % 3 === 0 ? 6 : i % 3 === 1 ? 0 : 3}px) rotate(${(i % 3) - 1}deg)`,
                }}
              >
                <Stick hex={CRAYONS[name]} />
              </button>
            );
          })}
        </div>
        {/* box front: covers the bottom of the sticks */}
        <div
          className="wax pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-20 flex-col items-center justify-center border-[2.5px] border-ink bg-crayon-green shadow-[3px_4px_0_#2b2a33]"
          style={{ borderRadius: "10px 10px 18px 14px / 30px 30px 14px 18px" }}
        >
          <svg
            viewBox="0 0 300 30"
            preserveAspectRatio="none"
            className="absolute inset-x-3 top-1.5 h-4 w-[calc(100%-1.5rem)]"
            aria-hidden
          >
            <path
              d="M0 15 Q 18 0 37 15 T 75 15 T 112 15 T 150 15 T 187 15 T 225 15 T 262 15 T 300 15"
              fill="none"
              stroke="#f7c933"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </svg>
          <p className="mt-3 font-hand text-3xl leading-none text-[#fffdf7] [text-shadow:2px_2px_0_#2b2a33]">
            CRAYONS
          </p>
        </div>
      </div>
      <p className="mt-2 text-center font-hand text-xl" aria-live="polite">
        <span
          className="highlight"
          style={{ ["--hl" as string]: CRAYONS[value as CrayonName] }}
        >
          {crayonLabel(value)}
        </span>
      </p>
    </div>
  );
}
