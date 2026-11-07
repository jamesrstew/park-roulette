"use client";

import confetti from "canvas-confetti";
import { useEffect, useState, useTransition } from "react";
import { deleteReview } from "@/lib/actions";
import { CRAYONS } from "@/lib/crayons";
import type { ReviewView } from "@/lib/data";
import { formatStars, verdict } from "@/lib/rating";
import { JoinNudge } from "./JoinNudge";
import { ReviewCard } from "./ReviewCard";
import { STAR } from "../Stars";
import { ReviewComposer } from "./ReviewComposer";
import { sfx } from "@/lib/sound";

/** My review (editable, always first) or the composer. Anchor: #review. */
export function MyReview({
  parkId,
  parkFeatures,
  review,
  signedIn,
  firstCritic,
  startOpen,
}: {
  parkId: number;
  parkFeatures: string[];
  review: ReviewView | null;
  signedIn: boolean;
  firstCritic: boolean;
  /** Open the composer right away (e.g. our crew has been here). */
  startOpen: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(startOpen);
  const [startStars, setStartStars] = useState<number | null>(null);

  // Deep link: /parks/x#review (after "We went!") opens the composer.
  useEffect(() => {
    const check = () => {
      if (location.hash === "#review") setComposing(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const [thanks, setThanks] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, start] = useTransition();

  useEffect(() => {
    if (thanks == null) return;
    const t = setTimeout(() => setThanks(null), 2600);
    return () => clearTimeout(t);
  }, [thanks]);

  function celebrate(tenths: number) {
    setEditing(false);
    setThanks(tenths);
    sfx.yay();
    const colors = Object.values(CRAYONS);
    confetti({
      particleCount: 90,
      spread: 75,
      startVelocity: 35,
      origin: { y: 0.6 },
      colors,
      shapes: ["star", "circle"],
      scalar: 1.1,
      disableForReducedMotion: true,
    });
  }

  if (!signedIn)
    return (
      <div id="review" className="scroll-mt-6">
        <JoinNudge
          emoji="⭐"
          line={
            firstCritic
              ? "No stars yet. Join and be the first critic!"
              : "Join to add your stars!"
          }
        />
      </div>
    );

  return (
    <div id="review" className="relative scroll-mt-6">
      {thanks != null && (
        <ThanksCritic tenths={thanks} onDone={() => setThanks(null)} />
      )}
      {review && !editing ? (
        <ReviewCard
          review={review}
          mine
          actions={
            <div className="mt-1 flex items-center gap-2 border-t-2 border-dashed border-ink/15 pt-3">
              {confirmDelete ? (
                <>
                  <span className="flex-1 font-hand text-lg leading-tight">
                    Erase your review?
                  </span>
                  <button
                    type="button"
                    className="chip min-h-11"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    className="chip min-h-11 bg-crayon-red text-white"
                    disabled={deleting}
                    onClick={() =>
                      start(async () => {
                        await deleteReview(parkId);
                        setConfirmDelete(false);
                      })
                    }
                  >
                    {deleting ? "Erasing…" : "Erase"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="crayon-btn min-h-11 flex-1 bg-paper text-lg"
                    onClick={() => setEditing(true)}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    type="button"
                    className="crayon-btn min-h-11 bg-paper px-4 text-lg"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Delete my review"
                  >
                    🗑️
                  </button>
                </>
              )}
            </div>
          }
        />
      ) : !review && !composing ? (
        <ComposeTeaser
          firstCritic={firstCritic}
          onPick={(stars) => {
            setStartStars(stars);
            setComposing(true);
          }}
        />
      ) : (
        <ReviewComposer
          key={review?.updatedAt ?? "new"}
          parkId={parkId}
          parkFeatures={parkFeatures}
          initial={review}
          firstCritic={firstCritic}
          startStars={startStars}
          onCancel={() => (review ? setEditing(false) : setComposing(false))}
          onSaved={celebrate}
        />
      )}
    </div>
  );
}

function ThanksCritic({
  tenths,
  onDone,
}: {
  tenths: number;
  onDone: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onDone}
      className="fixed inset-x-0 top-1/3 z-[2000] mx-auto flex w-[min(20rem,86vw)] animate-pop-in flex-col items-center gap-1 rounded-[var(--radius-wobbly)] border-[3px] border-ink bg-[#fffdf7] px-5 py-5 shadow-[5px_6px_0_#2b2a33]"
      aria-live="polite"
    >
      <span className="text-5xl" aria-hidden>
        🏆
      </span>
      <span className="font-sketch text-4xl leading-none font-bold">
        Thanks, critic!
      </span>
      <span className="font-hand text-xl text-ink-soft">
        {formatStars(tenths)} stars · {verdict(tenths)}
      </span>
    </button>
  );
}

/** A small "your turn" card. Tapping a star opens the full composer with it. */
function ComposeTeaser({
  firstCritic,
  onPick,
}: {
  firstCritic: boolean;
  onPick: (stars: number | null) => void;
}) {
  return (
    <div className="doodle-box flex flex-col items-center gap-2 bg-[color-mix(in_srgb,var(--color-crayon-yellow)_16%,#fffdf7)] p-4 text-center">
      <p className="font-hand text-[1.7rem] leading-none">
        {firstCritic
          ? "No stars yet. Be the first critic!"
          : "Your turn, critic!"}
      </p>
      <div className="flex gap-1" role="group" aria-label="Quick rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className="grid h-12 w-12 place-items-center transition-transform active:scale-90"
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => onPick(n)}
          >
            <svg viewBox="0 0 24 24" className="h-10 w-10" aria-hidden>
              <path
                d={STAR}
                fill="#fffdf7"
                stroke="#2b2a33"
                strokeWidth="1.6"
                strokeLinejoin="round"
                filter="url(#wobble)"
              />
            </svg>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="min-h-11 font-hand text-lg text-crayon-blue underline decoration-dashed underline-offset-4"
        onClick={() => onPick(null)}
      >
        Tap a star, then fine-tune to the tenth
      </button>
    </div>
  );
}
