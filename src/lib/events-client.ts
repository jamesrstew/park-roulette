"use client";

import { track } from "@vercel/analytics/react";
import type { EventName, EventProps } from "./events";

/** Record a tap-only moment (a spin, a share). Never throws. */
export function trackEvent(name: EventName, props?: EventProps): void {
  try {
    track(name, props);
  } catch {}
}
