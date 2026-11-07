"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";

const noop = () => () => {};
const KEY = "pr:hide-a2hs";

/** iPhone-only nudge to put the app on the Home Screen. Hidden once installed. */
export function HomeScreenTip() {
  const show = useSyncExternalStore(
    noop,
    () => {
      const ios =
        /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      let hidden = false;
      try {
        hidden = localStorage.getItem(KEY) === "1";
      } catch {}
      return ios && !standalone && !hidden;
    },
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);
  if (!show || dismissed) return null;

  return (
    <aside className="doodle-box-alt relative bg-crayon-teal/10 px-4 py-3 pr-12">
      <p className="flex items-center gap-1.5 font-hand text-2xl">
        <Icon name="phone" size={28} /> Make it an app!
      </p>
      <p className="text-[0.95rem] leading-snug">
        In Safari, tap{" "}
        <span className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-white px-1.5 align-middle">
          <ShareGlyph /> Share
        </span>
        , then <b>Add to Home Screen</b>. One tap to spin, anytime.
      </p>
      <button
        type="button"
        aria-label="Hide this tip"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {}
          setDismissed(true);
        }}
        className="absolute top-1 right-1 grid size-11 place-items-center"
      >
        <Icon name="close" size={20} className="opacity-70" />
      </button>
    </aside>
  );
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
      <path
        d="M10 2 L10 12 M6 6 L10 2 L14 6 M5 9 L4 9 L4 18 L16 18 L16 9 L15 9"
        stroke="#2f78d4"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
