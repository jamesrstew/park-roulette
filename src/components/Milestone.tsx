"use client";

import confetti from "canvas-confetti";
import { useEffect } from "react";
import { CRAYONS } from "@/lib/crayons";
import type { Milestone } from "@/lib/milestones";
import { sfx } from "@/lib/sound";

/** A big-moment card (first stamp, a town finished, the whole list). */
export function MilestoneCard({
  milestone,
  onClose,
}: {
  milestone: Milestone;
  onClose: () => void;
}) {
  useEffect(() => {
    sfx.celebrate();
    const colors = Object.values(CRAYONS);
    confetti({
      particleCount: 160,
      spread: 100,
      origin: { y: 0.55 },
      colors,
      scalar: 1.15,
      disableForReducedMotion: true,
    });
    navigator.vibrate?.([20, 40, 20]);
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1100] grid place-items-center bg-[#2b2a33]/25 px-8"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-label={milestone.title}
        className="doodle-box flex max-w-xs animate-pop-in flex-col items-center gap-1 bg-[#fffdf7] px-6 py-6 text-center shadow-[4px_5px_0_#2b2a33]"
      >
        <span className="animate-float text-6xl" aria-hidden>
          {milestone.emoji}
        </span>
        <h2 className="mt-1 font-sketch text-[2.1rem] leading-none font-bold text-balance">
          {milestone.title}
        </h2>
        <p className="font-hand text-xl text-ink-soft">{milestone.line}</p>
        <button
          type="button"
          className="crayon-btn wax mt-3 bg-crayon-yellow text-xl"
          onClick={onClose}
          autoFocus
        >
          Woo-hoo!
        </button>
      </div>
    </div>
  );
}
