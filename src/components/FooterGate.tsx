"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Where the site footer shows: reading pages only, as an allowlist, so a
 * new tool page can never grow a footer by accident. Never the wheel,
 * map, Passport, settings, /start, /join, /admin, or the confirm and
 * unsubscribe pages.
 */
export function footerFor(path: string): { show: boolean; signup: boolean } {
  const reading =
    path === "/list" ||
    path === "/news" ||
    path === "/texts" ||
    path === "/terms" ||
    path === "/privacy" ||
    path === "/towns" ||
    path.startsWith("/towns/") ||
    path.startsWith("/playgrounds") ||
    path === "/newsletter" ||
    path.startsWith("/newsletter/") ||
    (/^\/parks\/[^/]+$/.test(path) && path !== "/parks/new");
  // /newsletter and /texts carry their own signup.
  const signup = !(path.startsWith("/newsletter") || path === "/texts");
  return { show: reading, signup };
}

/** Picks the footer for this page: with the signup, without it, or none. */
export function FooterGate({
  full,
  bare,
}: {
  full: ReactNode;
  bare: ReactNode;
}) {
  const f = footerFor(usePathname());
  return f.show ? (f.signup ? full : bare) : null;
}
