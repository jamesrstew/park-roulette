"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Spin", emoji: "🎡", match: (p: string) => p === "/" },
  {
    href: "/map",
    label: "Map",
    emoji: "🗺️",
    match: (p: string) => p.startsWith("/map"),
  },
  {
    href: "/list",
    label: "List",
    emoji: "📋",
    match: (p: string) => p.startsWith("/list"),
  },
  {
    href: "/passport",
    label: "Passport",
    emoji: "📒",
    match: (p: string) => p.startsWith("/passport"),
  },
  {
    href: "/me",
    label: "Me",
    emoji: "🖍️",
    match: (p: string) => p.startsWith("/me") || p.startsWith("/join"),
  },
];

export function BottomNav() {
  return <NavBar path={usePathname()} />;
}

/** Hook-free nav, also used as the static Suspense fallback. */
export function NavBar({ path }: { path: string }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[1000] px-3 pb-[max(env(safe-area-inset-bottom),0.6rem)]"
    >
      <ul className="doodle-box mx-auto flex max-w-md items-stretch justify-around bg-[#fffdf7]/95 px-1 py-1 shadow-[3px_4px_0_#2b2a33] backdrop-blur">
        {TABS.map((t) => {
          const active = t.match(path);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className="group relative flex flex-col items-center gap-0.5 py-1.5"
              >
                {active && (
                  <svg
                    viewBox="0 0 120 80"
                    className="absolute inset-0 m-auto h-[88%] w-[88%]"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M70 6 C 30 2, 4 20, 6 42 C 8 66, 50 78, 86 70 C 116 62, 120 34, 98 16 C 82 4, 50 6, 34 12"
                      stroke="#f7c933"
                      strokeWidth="9"
                      strokeLinecap="round"
                      className="draw-in"
                      style={{ ["--len" as string]: 330 }}
                    />
                  </svg>
                )}
                <span
                  className={`relative text-2xl transition-transform ${active ? "scale-110 -rotate-6" : "group-active:scale-90"}`}
                >
                  {t.emoji}
                </span>
                <span className="relative font-hand text-base leading-none">
                  {t.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
