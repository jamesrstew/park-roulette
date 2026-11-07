"use client";

import Link from "next/link";
import { useEffect } from "react";

/** A page hiccuped. The bottom nav stays; this replaces just the page. */
export default function PageError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div
      className="flex flex-col items-center gap-4 py-16 text-center"
      role="alert"
    >
      <svg viewBox="0 0 120 60" className="h-20 w-40" aria-hidden>
        <g
          fill="none"
          stroke="#2b2a33"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#wobble)"
        >
          <rect x="8" y="22" width="44" height="16" rx="3" fill="#ee6aa7" />
          <path d="M52 22 L60 30 L52 38" fill="#f4c7a1" />
          <rect
            x="70"
            y="22"
            width="40"
            height="16"
            rx="3"
            fill="#ee6aa7"
            transform="rotate(14 90 30)"
          />
        </g>
      </svg>
      <h1 className="text-4xl">Oops, a crayon snapped!</h1>
      <p className="max-w-xs font-hand text-xl text-ink-soft">
        Something went wobbly loading this page. It&apos;s usually a spotty
        signal.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          className="crayon-btn wax bg-crayon-yellow"
          onClick={() => retry()}
        >
          Try again
        </button>
        <Link href="/" className="crayon-btn bg-paper">
          Spin the wheel
        </Link>
      </div>
    </div>
  );
}
