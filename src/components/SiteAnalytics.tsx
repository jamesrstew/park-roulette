"use client";

import { Analytics } from "@vercel/analytics/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { URL_EVENTS } from "@/lib/events";
import { trackEvent } from "@/lib/events-client";
import { analyticsPath, analyticsUrl } from "@/lib/analytics-url";
import { ASKS_KEY, parseState, recordOn } from "@/lib/asks";
import { storage } from "@/lib/storage";

/**
 * Vercel Web Analytics: counts page views with no cookies. We hand it the
 * cleaned path and route ourselves (so a family invite code can't reach it
 * through any field), and clean the page address again in beforeSend.
 */
export function SiteAnalytics() {
  const clean = analyticsPath(usePathname() ?? "/");
  // Events from actions that redirected (?ev=start-home): record once, drop.
  const params = useSearchParams();
  const evKey = params.get("ev");
  const via = params.get("via");
  // An arrival from an email link (/n/ adds ?via=email): this browser gets
  // the email, so the ask moments never offer it (lib/asks.ts). Then drop it.
  useEffect(() => {
    if (via !== "email") return;
    storage.set(
      ASKS_KEY,
      JSON.stringify(recordOn(parseState(storage.get(ASKS_KEY)), "email")),
    );
    const url = new URL(window.location.href);
    url.searchParams.delete("via");
    window.history.replaceState(window.history.state, "", url);
  }, [via]);
  useEffect(() => {
    if (!evKey) return;
    if (Object.prototype.hasOwnProperty.call(URL_EVENTS, evKey)) {
      const t = URL_EVENTS[evKey];
      trackEvent(t.name, t.props);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("ev");
    window.history.replaceState(window.history.state, "", url);
  }, [evKey]);
  return (
    <Analytics
      // Versioned address: Vercel's CDN cached an empty script.js from
      // before Web Analytics was enabled (Nov 13, 2026) and kept serving it.
      // If it ever breaks again, bump ?v= or purge the CDN cache. (Dev keeps
      // the default debug script.)
      scriptSrc={
        process.env.NODE_ENV === "production"
          ? "/_vercel/insights/script.js?v=1"
          : undefined
      }
      path={clean}
      route={clean}
      beforeSend={(event) => ({ ...event, url: analyticsUrl(event.url) })}
    />
  );
}
