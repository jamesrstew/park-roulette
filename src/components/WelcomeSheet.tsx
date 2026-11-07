"use client";

import { InstallSheet } from "./InstallSheet";
import { PhoneCode } from "./PhoneCode";
import { shouldOfferInstall } from "@/lib/install";
import confetti from "canvas-confetti";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { CRAYONS, crayon } from "@/lib/crayons";
import { sfx } from "@/lib/sound";
import { storage } from "@/lib/storage";
import { PHONE_NUDGE_KEY } from "./PhoneNudge";

/**
 * Shown once on /?welcome=1 right after joining. Page 1 greets the new
 * explorer with confetti and a 3-line how-to; page 2 (if they have no number
 * yet) asks for their phone, which is how they'll sign in anywhere later.
 * Then "Make it an app!".
 */
export function WelcomeSheet({
  name,
  avatar,
  color,
  crewName,
  crewLink,
  hasPhone,
}: {
  name: string;
  avatar: string;
  color: string;
  crewName: string;
  /** This crew's join link: the way back in for explorers with no phone. */
  crewLink: string;
  hasPhone: boolean;
}) {
  const [page, setPage] = useState<"hello" | "phone">("hello");
  const [phoneAdded, setPhoneAdded] = useState(false);
  const [phoneSkipped, setPhoneSkipped] = useState(false);
  const params = useSearchParams();
  // Latch on first render: we strip ?welcome=1 from the URL right away.
  const [wanted] = useState(() => params.get("welcome") === "1");
  const [closed, setClosed] = useState(false);
  const open = wanted && !closed;
  // After the welcome, offer "Make it an app!" (phones, not yet installed).
  const offerInstall = useSyncExternalStore(
    () => () => {},
    shouldOfferInstall,
    () => false,
  );
  const [installOpen, setInstallOpen] = useState(false);
  const finish = () => {
    // Leaving the phone page without a number (backdrop, Escape, Skip) is a
    // skip: don't ask again in the install sheet a second later.
    if (page === "phone" && !phoneAdded) setPhoneSkipped(true);
    setClosed(true);
    if (offerInstall) setInstallOpen(true);
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  useEffect(() => {
    if (!open) return;
    // This flow already asks for a number: the "Sign in on any phone"
    // nudge is never needed on this phone.
    storage.set(PHONE_NUDGE_KEY, String(Date.now()));
    // Drop ?welcome=1 so a refresh or share doesn't greet again.
    const url = new URL(window.location.href);
    url.searchParams.delete("welcome");
    window.history.replaceState(window.history.state, "", url);
    const t = setTimeout(() => {
      sfx.tada();
      confetti({
        particleCount: 110,
        spread: 80,
        startVelocity: 42,
        origin: { y: 0.75 },
        colors: Object.values(CRAYONS),
        disableForReducedMotion: true,
        zIndex: 1300,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && finishRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open)
    return (
      <InstallSheet
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        crewLink={crewLink}
        hasPhone={hasPhone || phoneAdded}
        phoneSkipped={phoneSkipped}
      />
    );
  const hex = crayon(color);

  return (
    <div
      className={`fixed inset-0 z-[1200] flex justify-center ${page === "phone" ? "items-start" : "items-end"}`}
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={finish}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-h"
        key={page}
        className={`doodle-box relative mx-3 w-full max-w-md animate-pop-in px-5 pb-5 shadow-[4px_6px_0_#2b2a33] ${
          page === "phone"
            ? "mt-[max(env(safe-area-inset-top),1rem)] pt-5"
            : "mb-[max(env(safe-area-inset-bottom),0.75rem)] pt-14"
        }`}
      >
        {page === "phone" ? (
          <>
            <h2 id="welcome-h" className="font-hand text-4xl leading-tight">
              One more thing!
            </h2>
            <p className="mt-1 mb-3 leading-snug">
              Add your number and you can sign in on any phone with a quick
              text. Kids can skip this.
            </p>
            <PhoneCode
              mode="add"
              autoFocus
              onDone={() => {
                setPhoneAdded(true);
                setTimeout(() => finishRef.current(), 900);
              }}
              onSkip={finish}
              skipLabel="Skip for now"
            />
          </>
        ) : (
          <>
            <span
              className="absolute -top-12 left-1/2 grid size-24 -translate-x-1/2 animate-float place-items-center rounded-[var(--radius-blob)] border-[3px] border-ink text-6xl shadow-[3px_4px_0_#2b2a33]"
              style={{
                backgroundColor: `color-mix(in srgb, ${hex} 40%, #fffdf7)`,
              }}
              aria-hidden
            >
              {avatar}
            </span>
            <h2 id="welcome-h" className="text-center font-hand text-4xl">
              Welcome, {name}!
            </h2>
            <p className="mt-1 text-center font-hand text-xl text-ink-soft">
              You&apos;re in{" "}
              <span
                className="highlight text-ink"
                style={{ ["--hl" as string]: hex }}
              >
                {crewName}
              </span>
              {". Here's the game:"}
            </p>
            <ol className="mt-4 flex flex-col gap-2.5 text-lg leading-snug">
              {(
                [
                  ["spin", "Spin", "the wheel to pick a playground."],
                  ["directions", "Go", "play! Slides first, snacks after."],
                  [
                    "stamp",
                    "Tap “We went!”",
                    "to stamp your passport, then rate it.",
                  ],
                ] as const
              ).map(([icon, bold, rest]) => (
                <li key={bold} className="flex items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper"
                    aria-hidden
                  >
                    <Icon name={icon} size={26} />
                  </span>
                  <span>
                    <b className="font-hand text-2xl font-normal">{bold}</b>{" "}
                    {rest}
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => {
                if (hasPhone) return finish();
                confetti.reset(); // don't rain on the number field
                setPage("phone");
              }}
              autoFocus
              className="crayon-btn wax mt-5 w-full bg-crayon-yellow py-3.5 text-3xl"
            >
              {hasPhone ? "Let's spin!" : "Next"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
