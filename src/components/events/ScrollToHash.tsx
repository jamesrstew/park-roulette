"use client";

import { useEffect } from "react";

/** When the last back/forward happened (the browser restores scroll then). */
let poppedAt = 0;
/** The document's first listing: its load type only counts then. */
let first = true;
if (typeof window !== "undefined")
  window.addEventListener("popstate", () => (poppedAt = Date.now()));

/**
 * Scrolls to the URL's #anchor once the streamed listing is in the page:
 * a tap on the Scoop's regulars card (/events#regulars) can land before
 * the section exists, so the browser's own jump finds nothing.
 */
export function ScrollToHash() {
  useEffect(() => {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    // Back or forward: leave the restored scroll alone.
    const restored = first && nav?.type === "back_forward";
    first = false;
    if (restored || Date.now() - poppedAt < 2000) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (el && Math.abs(el.getBoundingClientRect().top) > 48)
      el.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
