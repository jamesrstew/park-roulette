"use client";

import confetti from "canvas-confetti";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PasteInvite } from "@/components/me/PasteInvite";
import { cancelHello } from "@/components/HelloToast";
import { PhoneCode } from "@/components/PhoneCode";
import { CRAYONS } from "@/lib/crayons";
import { isStandalone, takeFirstAppOpen } from "@/lib/install";
import { sfx } from "@/lib/sound";
import { storage } from "@/lib/storage";

const HIDE_KEY = "pr:hide-app-signin";
/** "Hide this" snoozes for a week, not forever: they may need it later. */
const HIDE_MS = 7 * 24 * 3600 * 1000;
const hiddenNow = () => {
  const v = storage.get(HIDE_KEY);
  if (v === "1") return false; // the old "forever" value: show it again
  return !!v && Date.now() - Number(v) < HIDE_MS;
};

/**
 * Little moments for the Home Screen app:
 *  - the first time it's opened from the Home Screen: "You did it!" + confetti
 *  - if it opens signed out (an installed web app can start without Safari's
 *    sign-in), a friendly way back in: your phone number (or a crew link)
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
    hiddenNow,
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!signedIn || !takeFirstAppOpen()) return;
    cancelHello(); // one celebration, not "Welcome back" stacked on top
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
            storage.set(HIDE_KEY, String(Date.now()));
            setDismissed(true);
          }}
          className="absolute top-1 right-1 grid size-11 place-items-center"
        >
          <Icon name="close" size={20} className="opacity-70" />
        </button>
        <h2 className="text-3xl">Welcome to the app!</h2>
        <p className="mt-1 mb-3 leading-snug">
          Sign in once with your phone number, and you&apos;re in for good.
        </p>
        <PhoneCode mode="signin" />
        <div className="mt-4 border-t-2 border-dashed border-ink/20 pt-3">
          <PasteInvite label="No number yet? Paste your family link:" />
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          Brand new?{" "}
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
