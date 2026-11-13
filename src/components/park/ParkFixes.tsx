"use client";

import { useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { toastNow } from "@/components/HelloToast";
import { Icon } from "@/components/icons";
import { confirmPark, voteOnFix } from "@/lib/client-actions";
import { fixLine } from "@/lib/fix-words";
import type { PendingFix } from "@/lib/park-votes";
import { sfx } from "@/lib/sound";

/** The opposite answer: "No, it's still there". */
function keepLine(topic: string, value: string): string {
  if (topic.startsWith("feature:"))
    return value === "yes" ? "No, it doesn't" : "No, it's still there";
  if (topic === "status")
    return value === "active" ? "No, still closed" : "No, it's open";
  return "No, that's not right";
}

/** What it says now, to vote "no" on a suggestion. */
function currentFor(topic: string, value: string): string {
  if (topic.startsWith("feature:")) return value === "yes" ? "no" : "yes";
  if (topic === "status") return value === "active" ? "closed" : "active";
  return value === "none" ? "playground" : "none";
}

/**
 * Suggestions waiting on a second family: "Splash pad? 1 family says it's
 * gone. Seen it?" Agreeing makes it real for everyone.
 */
export function ParkFixes({
  parkId,
  fixes,
  canVote,
}: {
  parkId: number;
  fixes: PendingFix[];
  canVote: boolean;
}) {
  return (
    <section
      aria-labelledby="fixes-h"
      className="doodle-box-alt flex flex-col gap-3 border-dashed p-4"
    >
      <h2 id="fixes-h" className="flex items-center gap-2 font-hand text-2xl">
        <Icon name="wrench" size={30} /> Waiting for another family
      </h2>
      <p className="-mt-2 text-sm leading-snug text-ink-soft">
        A family spotted these. They change for everyone once a second family
        agrees.
      </p>
      <ul className="flex flex-col gap-3">
        {fixes.map((f) => (
          <FixRow key={f.topic} parkId={parkId} fix={f} canVote={canVote} />
        ))}
      </ul>
      {!canVote && (
        <p className="text-sm leading-snug text-ink-soft">
          Grown-ups who sign in with their number can vote on these.
        </p>
      )}
    </section>
  );
}

function FixRow({
  parkId,
  fix,
  canVote,
}: {
  parkId: number;
  fix: PendingFix;
  canVote: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const vote = (value: string) =>
    start(async () => {
      setError(null);
      const r = await voteOnFix({ parkId, topic: fix.topic, value });
      if (!r.ok) return (sfx.oops(), setError(r.error));
      sfx.pop();
      toastNow(
        r.outcome === "applied"
          ? "Fixed for everyone. Thanks!"
          : "Thanks! Vote counted.",
      );
    });
  const agreed = fix.mine === fix.value;
  const disagreed = fix.mine != null && !agreed;
  return (
    <li className="flex flex-col gap-2 rounded-xl border-2 border-ink/20 bg-[#fffdf7] p-3">
      <p className="font-hand text-xl leading-tight">
        {fixLine(fix.topic, fix.value)}
      </p>
      <p className="text-xs text-ink-soft">
        {fix.families}{" "}
        {fix.families === 1 ? "family says so" : "families say so"}
        {fix.against > 0
          ? ` · ${fix.against} ${fix.against === 1 ? "says" : "say"} no`
          : ""}
        {agreed ? " · you agreed" : disagreed ? " · you said no" : ""}
      </p>
      {canVote && !fix.mine && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => vote(fix.value)}
            className="crayon-btn wax min-h-11 flex-1 bg-crayon-green text-lg text-white [text-shadow:1px_1px_0_#2b2a33]"
          >
            <Icon name="check" size={20} /> Yes, I saw that
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => vote(currentFor(fix.topic, fix.value))}
            className="crayon-btn min-h-11 flex-1 bg-paper text-lg"
          >
            {keepLine(fix.topic, fix.value)}
          </button>
        </div>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </li>
  );
}

/**
 * A park a family added that nobody else has confirmed: it isn't on other
 * families' wheels yet. "Been here? It's real!"
 */
export function NewParkBanner({
  parkId,
  ours,
  canVote,
  signedIn,
}: {
  parkId: number;
  ours: boolean;
  canVote: boolean;
  signedIn: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="doodle-box flex flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-yellow)_18%,#fffdf7)] p-4">
      <p className="flex items-center gap-2 font-hand text-2xl leading-tight">
        <Icon name="sparkles" size={30} /> New on the map!
      </p>
      <p className="text-sm leading-snug">
        {ours
          ? "Only your family sees it for now. It joins everyone's wheel once another family confirms it's a real park."
          : "A family added this one. It joins everyone's wheel once another family says it's real."}
      </p>
      {!ours && canVote && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await confirmPark(parkId);
              if (!r.ok) return (sfx.oops(), setError(r.error));
              sfx.pop();
              toastNow("Confirmed! It's on everyone's wheel now.");
            })
          }
          className="crayon-btn wax min-h-12 self-start bg-crayon-green px-4 text-lg text-white [text-shadow:1px_1px_0_#2b2a33]"
        >
          <Icon name="check" size={22} /> We&apos;ve been here, it&apos;s real!
        </button>
      )}
      {!ours && signedIn && !canVote && (
        <p className="text-xs text-ink-soft">
          Grown-ups who sign in with their number can confirm it.
        </p>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}
