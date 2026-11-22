"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * A swipe row of cards: native scrolling with snap points (no autoplay, no
 * JavaScript needed to use it). With a mouse, two crayon arrows scroll one
 * card at a time and gray out at the ends. Keyboard users tab card to
 * card; the browser scrolls each into view.
 */
export function Carousel({
  id,
  label,
  children,
}: {
  id: string;
  /** What the row holds, for screen readers: "Upcoming kids' events". */
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [ends, setEnds] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEnds({
      start: el.scrollLeft < 8,
      end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.querySelector("li");
    const step = card ? card.getBoundingClientRect().width + 12 : 252;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * step, behavior: still ? "auto" : "smooth" });
  };

  const arrow =
    "crayon-btn wax h-11 w-11 min-h-0 bg-crayon-yellow p-0 disabled:bg-paper";
  return (
    <div className="relative">
      <ul
        ref={ref}
        id={id}
        // Safari drops list semantics from a list styled without bullets.
        role="list"
        aria-label={label}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-3 overflow-x-auto px-4 pt-3 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
      <div className="mt-1 hidden justify-end gap-3 [@media(pointer:fine)]:flex">
        <button
          type="button"
          className={arrow}
          aria-label="Earlier events"
          aria-controls={id}
          disabled={ends.start}
          onClick={() => go(-1)}
        >
          <Chevron flip />
        </button>
        <button
          type="button"
          className={arrow}
          aria-label="Later events"
          aria-controls={id}
          disabled={ends.end}
          onClick={() => go(1)}
        >
          <Chevron />
        </button>
      </div>
    </div>
  );
}

/** A hand-drawn arrow (points right; flip for left). */
function Chevron({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      aria-hidden
      className={flip ? "-scale-x-100" : undefined}
    >
      <path
        d="M3.5 12.4 C 8 11.4, 13 12.8, 19.5 11.8 M13.2 5.5 L 20 11.9 L 13.6 18.6"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
