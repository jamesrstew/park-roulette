"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

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
    path === "/events" ||
    path.startsWith("/events/") ||
    path.startsWith("/newsletter/") ||
    (/^\/parks\/[^/]+$/.test(path) && path !== "/parks/new");
  // /newsletter and /texts carry their own signup.
  const signup = !(path.startsWith("/newsletter") || path === "/texts");
  return { show: reading, signup };
}

/**
 * Picks the footer for this page: with the signup, without it, or none.
 * The footer is kept as first drawn on each page: a yes sets pr_on, and
 * the refresh that follows would otherwise swap the field or card out
 * (the footer hides what you get) before its "You're in!" shows. The next
 * page gets the new footer.
 */
export function FooterGate({
  who,
  full,
  bare,
}: {
  /** Who's signed in ("" signed out): a sign-in or out redraws it. */
  who: string;
  full: ReactNode;
  bare: ReactNode;
}) {
  const path = usePathname();
  const key = `${who}|${path}`;
  const [kept, setKept] = useState({ key, full, bare });
  if (kept.key !== key) setKept({ key, full, bare });
  const f = footerFor(path);
  const now = kept.key === key ? kept : { full, bare };
  return f.show ? (f.signup ? now.full : now.bare) : null;
}

/** A footer link that says when it's the page you're on (bold, aria-current). */
export function FooterNavLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const here = usePathname() === href;
  return (
    <Link
      href={href}
      className={`flex min-h-11 items-center ${here ? "font-bold" : ""}`}
      aria-current={here ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
