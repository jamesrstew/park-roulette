"use client";

import { useSyncExternalStore } from "react";

/**
 * Is a sheet, dialog, milestone or toast on screen? Asks (lib/asks.ts)
 * never stack on one. Read from the page itself (modal dialogs, alert
 * dialogs, and toasts marked data-overlay), so no overlay has to report in.
 */
const SELECTOR = '[aria-modal="true"], [role="alertdialog"], [data-overlay]';

export function overlayOpen(): boolean {
  return typeof document !== "undefined" && !!document.querySelector(SELECTOR);
}

/** Re-checks at most once a frame, however busy the page is. */
function subscribe(onChange: () => void) {
  let frame = 0;
  const mo = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return () => {
    mo.disconnect();
    cancelAnimationFrame(frame);
  };
}

/** overlayOpen(), kept current as overlays come and go. */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, overlayOpen, () => false);
}
