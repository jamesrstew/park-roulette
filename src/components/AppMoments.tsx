"use client";

import confetti from "canvas-confetti";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PasteInvite } from "@/components/me/PasteInvite";
import { CRAYONS } from "@/lib/crayons";
import { isStandalone, takeFirstAppOpen } from "@/lib/install";
import { sfx } from "@/lib/sound";
import { storage } from "@/lib/storage";

const HIDE_KEY = "pr:hide-app-signin";

/**
 * Little moments for the Home Screen app:
 *  - the first time it's opened from the Home Screen: "You did it!" + confetti
 *  - if it opens signed out (an installed web app can start without Safari's
 *    sign-in), a friendly way back in: paste the crew link
 */
export function AppMoments({ signedIn }: { signedIn: boolean }) {
  const standalone = useSyncExternalStore(
    () => () => {},
    isStandalone,
    () => false,
  );
  const [hello, setHello] = useState(false);
  const hidden = useSyncExternalStore(
    () => () => {},
    () => storage.get(HIDE_KEY) === "1",
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!signedIn || !takeFirstAppOpen()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time celebration on first app launch
    setHello(true);
    sfx.celebrate();
    confetti({
      particleCount: 120,
      spread: 90,
      origin: { y: 0.3 },
      colors: Object.values(CRAYONS),
      disableForReducedMotion: true,
    });
    const t = setTimeout(() => setHello(false), 4500);
    return () => clearTimeout(t);
  }, [signedIn]);

  if (standalone && !signedIn && !hidden && !dismissed)
    return (
      <section className="doodle-box wax relative mb-2 bg-crayon-yellow/40 px-5 py-4 text-center shadow-[3px_4px_0_#2b2a33]">
        <button
          type="button"
          aria-label="Hide this"
          onClick={() => {
            storage.set(HIDE_KEY, "1");
            setDismissed(true);
          }}
          className="absolute top-1 right-1 grid size-11 place-items-center"
        >
          <Icon name="close" size={20} className="opacity-70" />
        </button>
        <h2 className="text-3xl">Welcome to the app!</h2>
        <p className="mt-1 leading-snug">
          Paste your crew link once, and you&apos;re in for good.
        </p>
        <div className="mt-3">
          <PasteInvite />
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          No link yet?{" "}
          <Link href="/me" className="underline">
            Here&apos;s how Park Roulette works
          </Link>
          .
        </p>
      </section>
    );

  if (!hello) return null;
  return (
    <div
      role="status"
      className="doodle-box fixed inset-x-4 top-[max(env(safe-area-inset-top),1rem)] z-[1100] mx-auto max-w-md animate-pop-in bg-[#fffdf7] px-4 py-3 text-center shadow-[3px_4px_0_#2b2a33]"
    >
      <p className="font-hand text-2xl">
        You did it! Park Roulette is an app now.
      </p>
    </div>
  );
}
