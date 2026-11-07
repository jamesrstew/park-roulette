"use client";

import { InstallSheet } from "./InstallSheet";
import { shouldOfferInstall } from "@/lib/install";
import confetti from "canvas-confetti";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { CRAYONS, crayon } from "@/lib/crayons";
import { sfx } from "@/lib/sound";

/**
 * Shown once on /?welcome=1 right after joining or re-claiming on a new phone.
 * Greets the explorer, gives a 3-line how-to, and throws confetti one time.
 */
export function WelcomeSheet({
  name,
  avatar,
  color,
  crewName,
  crewLink,
}: {
  name: string;
  avatar: string;
  color: string;
  crewName: string;
  /** This crew's join link: the only way back in on a new phone. */
  crewLink: string;
}) {
  const [copied, setCopied] = useState(false);
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
    setClosed(true);
    if (offerInstall) setInstallOpen(true);
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  useEffect(() => {
    if (!open) return;
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
      />
    );
  const hex = crayon(color);

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center">
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
        className="doodle-box relative mx-3 mb-[max(env(safe-area-inset-bottom),0.75rem)] w-full max-w-md animate-pop-in px-5 pt-14 pb-5 shadow-[4px_6px_0_#2b2a33]"
      >
        <span
          className="absolute -top-12 left-1/2 grid size-24 -translate-x-1/2 animate-float place-items-center rounded-[var(--radius-blob)] border-[3px] border-ink text-6xl shadow-[3px_4px_0_#2b2a33]"
          style={{ backgroundColor: `color-mix(in srgb, ${hex} 40%, #fffdf7)` }}
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
                <b className="font-hand text-2xl font-normal">{bold}</b> {rest}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-xl border-2 border-dashed border-ink/30 px-3 py-2 text-left">
          <p className="font-hand text-lg leading-tight">
            Save your crew link! It&apos;s how you (and only your crew) get back
            in on a new phone.
          </p>
          <button
            type="button"
            className="chip mt-1.5 min-h-11"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(crewLink);
                setCopied(true);
              } catch {
                window.prompt("Copy your crew link:", crewLink);
              }
            }}
          >
            {copied ? "Copied!" : "Copy my crew link"}
          </button>
        </div>
        <button
          type="button"
          onClick={finish}
          autoFocus
          className="crayon-btn wax mt-5 w-full bg-crayon-yellow py-3.5 text-3xl"
        >
          Let&apos;s spin!
        </button>
      </div>
    </div>
  );
}
