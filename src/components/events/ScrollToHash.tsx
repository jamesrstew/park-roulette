"use client";

import { useEffect } from "react";

/**
 * Scrolls to the URL's #anchor once the streamed listing is in the page:
 * a tap on the Scoop's regulars card (/events#regulars) can land before
 * the section exists, so the browser's own jump finds nothing.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (el && Math.abs(el.getBoundingClientRect().top) > 48)
      el.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
