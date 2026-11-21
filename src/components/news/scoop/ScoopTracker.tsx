"use client";

import type { ReactNode } from "react";
import { EVENTS } from "@/lib/events";
import { trackEvent } from "@/lib/events-client";

/** Where a Scoop link goes, as the Scoop tap's `to` label. */
export type ScoopTo =
  "event" | "all_events" | "review" | "pick" | "issue" | "indoor";

/**
 * Records a Scoop tap for any link inside marked data-scoop="<to>": one
 * listener, so the blocks stay server components.
 */
export function ScoopTracker({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-5"
      onClickCapture={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>(
          "[data-scoop]",
        );
        const to = el?.dataset.scoop;
        if (to) trackEvent(EVENTS.scoopTap, { to });
      }}
    >
      {children}
    </div>
  );
}
