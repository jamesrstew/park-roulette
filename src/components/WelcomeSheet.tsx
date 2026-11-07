"use client";

import confetti from "canvas-confetti";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CRAYONS, crayon } from "@/lib/crayons";

/**
 * Shown once on /?welcome=1 right after joining or re-claiming on a new phone.
 * Greets the explorer, gives a 3-line how-to, and throws confetti one time.
 */
export function WelcomeSheet({
  name,
  avatar,
  color,
  crewName,
}: {
  name: string;
  avatar: string;
  color: string;
  crewName: string;
}) {
  const params = useSearchParams();
  // Latch on first render: we strip ?welcome=1 from the URL right away.
  const [wanted] = useState(() => params.get("welcome") === "1");
  const [closed, setClosed] = useState(false);
  const open = wanted && !closed;

  useEffect(() => {
    if (!open) return;
    // Drop ?welcome=1 so a refresh or share doesn't greet again.
    const url = new URL(window.location.href);
    url.searchParams.delete("welcome");
    window.history.replaceState(window.history.state, "", url);
    const t = setTimeout(() => {
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setClosed(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const hex = crayon(color);

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={() => setClosed(true)}
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
        <h2
          id="welcome-h"
          className="text-center font-sketch text-4xl font-bold"
        >
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
          {[
            ["🎡", "Spin", "the wheel to pick a playground."],
            ["🚗", "Go", "play! Slides first, snacks after."],
            ["📒", "Tap “We went!”", "to stamp your passport, then rate it."],
          ].map(([e, bold, rest]) => (
            <li key={bold} className="flex items-center gap-3">
              <span
                className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper text-xl"
                aria-hidden
              >
                {e}
              </span>
              <span>
                <b className="font-hand text-2xl font-normal">{bold}</b> {rest}
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => setClosed(true)}
          className="crayon-btn wax mt-5 w-full bg-crayon-yellow py-3.5 text-3xl"
        >
          Let&apos;s spin!
        </button>
      </div>
    </div>
  );
}
