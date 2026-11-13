"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { QrCode } from "@/components/me/QrCode";
import { SITE_URL } from "@/lib/site";

/**
 * Wide screens only: Park Roulette is made for phones (thumbs, GPS, photos
 * at the park), so on a laptop the app stays a phone-sized column and this
 * panel fills the space on the left: what it is, a QR code that opens this
 * same page on your phone, and the guides people often arrive for from
 * search. Not on the map, which fills the whole screen.
 */
export function DesktopAside() {
  const path = usePathname();
  if (path.startsWith("/map")) return null;
  return (
    <aside
      aria-label="About Park Roulette"
      className="fixed inset-y-0 left-0 hidden w-[calc((100vw-36rem)/2)] overflow-y-auto px-8 py-6 xl:flex"
    >
      <div className="doodle-box m-auto flex max-w-xs -rotate-1 flex-col items-center gap-4 bg-[#fffdf7] px-6 py-6 text-center shadow-[4px_5px_0_#2b2a33]">
        {/* eslint-disable-next-line @next/next/no-img-element -- our generated app icon */}
        <img
          src="/icon/192"
          alt=""
          width={72}
          height={72}
          className="rounded-2xl"
        />
        <p className="font-hand text-3xl leading-tight">
          Every playground in Central Oregon, one spin at a time
        </p>
        <p className="text-sm leading-snug text-ink-soft">
          A free game for families. It&apos;s made for your phone: scan to open
          it there, then add it to your Home Screen.
        </p>
        <QrCode
          text={`${SITE_URL}${path}`}
          label="Open Park Roulette on your phone"
          className="w-36"
        />
        <nav aria-label="Guides" className="flex flex-col gap-1 text-sm">
          <Link href="/towns" className="underline underline-offset-2">
            Playgrounds by town
          </Link>
          <Link href="/list" className="underline underline-offset-2">
            The whole bucket list
          </Link>
          <Link
            href="/privacy"
            className="text-ink-soft underline underline-offset-2"
          >
            Privacy
          </Link>
        </nav>
      </div>
    </aside>
  );
}
