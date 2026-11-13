"use client";

import { Analytics } from "@vercel/analytics/react";
import { usePathname } from "next/navigation";
import { analyticsPath, analyticsUrl } from "@/lib/analytics-url";

/**
 * Vercel Web Analytics: counts page views with no cookies. We hand it the
 * cleaned path and route ourselves (so a family invite code can't reach it
 * through any field), and clean the page address again in beforeSend.
 */
export function SiteAnalytics() {
  const clean = analyticsPath(usePathname() ?? "/");
  return (
    <Analytics
      path={clean}
      route={clean}
      beforeSend={(event) => ({ ...event, url: analyticsUrl(event.url) })}
    />
  );
}
