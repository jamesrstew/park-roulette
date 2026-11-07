"use client";

import { AVATARS, crayon } from "@/lib/crayons";

/** A sticker sheet of buddies. The chosen one gets a crayon circle. */
export function AvatarPicker({
  value,
  color,
  onChange,
}: {
  value: string;
  color: string;
  onChange: (a: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Pick a buddy"
      className="grid grid-cols-6 gap-1.5"
    >
      {AVATARS.map((a, i) => {
        const on = a === value;
        return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`Buddy ${i + 1}`}
            onClick={() => onChange(a)}
            className="relative grid aspect-square min-h-12 place-items-center rounded-2xl text-3xl transition-transform active:scale-90"
          >
            {on && (
              <svg
                viewBox="0 0 120 80"
                className="absolute -inset-1 h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)]"
                fill="none"
                aria-hidden
              >
                <path
                  d="M70 6 C 30 2, 4 20, 6 42 C 8 66, 50 78, 86 70 C 116 62, 120 34, 98 16 C 82 4, 50 6, 34 12"
                  stroke={crayon(color)}
                  strokeWidth="7"
                  strokeLinecap="round"
                  className="draw-in"
                  style={{ ["--len" as string]: 330 }}
                />
              </svg>
            )}
            <span
              className={`relative transition-transform duration-300 ${on ? "scale-125 animate-wiggle" : "opacity-80"}`}
            >
              {a}
            </span>
          </button>
        );
      })}
    </div>
  );
}
