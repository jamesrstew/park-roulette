"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { storage } from "@/lib/storage";
import { navHistory } from "@/lib/nav-history";
import { Icon } from "@/components/icons";

/** Which Parks view you used last (map or list); the tab goes back there. */
const PARKS_VIEW_KEY = "pr:parks-view";

/**
 * Four tabs: Spin, Parks (map and list are one place, with a switch),
 * News, and Passport, the family hub (Me, your profile and family, opens
 * from your face at the top of the Passport).
 */
const TABS = [
  {
    id: "spin",
    href: "/",
    label: "Spin",
    icon: "spin",
    match: (p: string) => p === "/",
  },
  {
    id: "parks",
    href: "/map",
    label: "Parks",
    icon: "map",
    match: (p: string) =>
      p.startsWith("/map") ||
      p.startsWith("/list") ||
      p.startsWith("/towns") ||
      p.startsWith("/parks") ||
      p.startsWith("/playgrounds"),
  },
  {
    id: "news",
    href: "/news",
    label: "News",
    icon: "sparkles",
    match: (p: string) => p.startsWith("/news"),
  },
  {
    id: "passport",
    href: "/passport",
    label: "Passport",
    icon: "passport",
    match: (p: string) =>
      p.startsWith("/passport") ||
      p.startsWith("/me") ||
      p.startsWith("/admin") ||
      p.startsWith("/join") ||
      p.startsWith("/start"),
  },
] as const;

const noSubscribe = () => () => {};

export function BottomNav() {
  const path = usePathname();
  // Count in-app page views so Back buttons know if there's somewhere to go.
  useEffect(() => navHistory.visited(), [path]);
  // Remember map or list, so the Parks tab goes back to the one you use.
  const onParks = path.startsWith("/map") || path.startsWith("/list");
  useEffect(() => {
    if (onParks)
      storage.set(PARKS_VIEW_KEY, path.startsWith("/list") ? "/list" : "/map");
  }, [path, onParks]);
  const stored = useSyncExternalStore(
    noSubscribe,
    () => storage.get(PARKS_VIEW_KEY),
    () => null,
  );
  const parks = onParks
    ? path.startsWith("/list")
      ? "/list"
      : "/map"
    : stored === "/list"
      ? "/list"
      : "/map";
  return <NavBar path={path} parksHref={parks} />;
}

/** Hook-free nav, also used as the static Suspense fallback. */
export function NavBar({
  path,
  parksHref = "/map",
}: {
  path: string;
  parksHref?: string;
}) {
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
                href={t.id === "parks" ? parksHref : t.href}
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
                  className={`relative transition-transform ${active ? "scale-110 -rotate-6" : "group-active:scale-90"}`}
                >
                  <Icon name={t.icon} size={30} />
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
