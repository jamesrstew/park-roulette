"use client";

import type { ReactNode } from "react";
import { EVENTS } from "@/lib/events";
import { trackEvent } from "@/lib/events-client";

/**
 * Records a Social tap for any link inside marked data-social="<to>": one
 * listener, so the grid and the post pages stay server components.
 */
export function SocialTracker({
  source,
  className,
  children,
}: {
  source: "social_grid" | "social_post";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      onClickCapture={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>(
          "[data-social]",
        );
        const to = el?.dataset.social;
        if (to) trackEvent(EVENTS.socialTap, { source, to });
      }}
    >
      {children}
    </div>
  );
}
