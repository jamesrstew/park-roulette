"use client";

import { useEffect } from "react";

/**
 * Counts one tap from a Weekend Pick text (?src=text) per issue per tab
 * session, then takes ?src off the address, so a reload or a copied link
 * doesn't count again. Scripts only run in a browser: link scanners and
 * preview fetchers never count.
 */
export function TextTapBeacon({ date }: { date: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("src") !== "text") return;
    const key = `pr:tap:${date}`;
    try {
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        const body = JSON.stringify({ date });
        if (!navigator.sendBeacon?.("/api/news/tap", body))
          void fetch("/api/news/tap", {
            method: "POST",
            body,
            keepalive: true,
          }).catch(() => {});
      }
    } catch {
      /* private mode: no count */
    }
    url.searchParams.delete("src");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [date]);
  return null;
}
