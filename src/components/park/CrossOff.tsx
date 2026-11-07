"use client";

import confetti from "canvas-confetti";
import { useState, useTransition } from "react";
import { setParkStatus } from "@/lib/actions";
import { CRAYONS } from "@/lib/crayons";
import { CROSS_OFF_REASONS } from "@/lib/features";
import { ScribbleOut } from "./Doodles";
import { JoinNudge } from "./JoinNudge";

type Reason = keyof typeof CROSS_OFF_REASONS;

/** statusNote is saved as "note (Name)". Split it back apart. */
function parseNote(statusNote: string | null) {
  const m = statusNote?.match(/^(.*) \(([^()]+)\)$/);
  return m
    ? { note: m[1], by: m[2] }
    : { note: statusNote ?? "", by: null as string | null };
}

/** The scribbled-out banner on a crossed-off park, with Undo. */
export function CrossedOffBanner({
  parkId,
  status,
  statusNote,
  signedIn,
}: {
  parkId: number;
  status: string;
  statusNote: string | null;
  signedIn: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const reason = CROSS_OFF_REASONS[status as Reason] ?? {
    label: "Crossed off",
    emoji: "✖️",
  };
  const { note, by } = parseNote(statusNote);
  const showNote = note && note !== reason.label && note !== "Flagged";

  return (
    <div
      className="doodle-box-alt relative flex animate-pop-in flex-col gap-2 overflow-hidden bg-[color-mix(in_srgb,var(--color-crayon-purple)_9%,#fffdf7)] p-4"
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="text-4xl" aria-hidden>
          {reason.emoji}
        </span>
        <div className="flex-1">
          <p className="font-hand text-sm tracking-[0.15em] text-crayon-purple uppercase">
            Crossed off the list
          </p>
          <p className="relative inline-block font-hand text-2xl leading-tight">
            {reason.label}
            <ScribbleOut
              className="pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 opacity-70"
              color={CRAYONS.purple}
            />
          </p>
          {showNote && (
            <p className="mt-0.5 text-[0.95rem] italic">&ldquo;{note}&rdquo;</p>
          )}
          <p className="mt-1 text-sm text-ink-soft">
            {by ? `By ${by}. ` : ""}It&apos;s off the wheel. One less to hunt
            for!
          </p>
        </div>
      </div>
      {error && <p className="font-hand text-lg text-crayon-red">{error}</p>}
      {signedIn && (
        <button
          type="button"
          className="crayon-btn min-h-11 self-start bg-paper px-4 text-lg"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setParkStatus({ parkId, status: "active" });
              if (!res.ok) setError(res.error);
            })
          }
        >
          {pending ? "Un-crossing…" : "↩️ Undo, it's real!"}
        </button>
      )}
    </div>
  );
}

/** Footer: "Cross it off the list" with a reason. Duds are progress too. */
export function CrossOffFooter({
  parkId,
  signedIn,
}: {
  parkId: number;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function crossOff() {
    if (!reason) return;
    setError(null);
    start(async () => {
      const res = await setParkStatus({
        parkId,
        status: reason,
        note: note.trim() || CROSS_OFF_REASONS[reason].label,
      });
      if (!res.ok) return setError(res.error);
      setOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      confetti({
        particleCount: 45,
        spread: 55,
        origin: { y: 0.2 },
        colors: [CRAYONS.purple, CRAYONS.pink, CRAYONS.blue],
        disableForReducedMotion: true,
      });
    });
  }

  return (
    <section aria-label="Cross it off the list" className="flex flex-col gap-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="doodle-box-alt flex min-h-14 items-center gap-3 border-dashed bg-transparent p-3 text-left"
        >
          <span className="text-3xl" aria-hidden>
            🖍️
          </span>
          <span className="flex-1">
            <span className="block font-hand text-xl leading-tight">
              Cross it off the list
            </span>
            <span className="block text-sm text-ink-soft">
              No playground? Closed? Private? Still counts as progress.
            </span>
          </span>
          <span className="font-hand text-2xl" aria-hidden>
            ›
          </span>
        </button>
      ) : !signedIn ? (
        <JoinNudge
          emoji="🖍️"
          line="Join to cross parks off the list!"
          onClose={() => setOpen(false)}
        />
      ) : (
        <div className="doodle-box-alt flex animate-pop-in flex-col gap-3 p-4">
          <p className="font-hand text-2xl leading-none">
            What&apos;s the story?
          </p>
          <p className="-mt-1 text-sm text-ink-soft">
            It comes off the wheel, and anyone can undo it.
          </p>
          <div className="flex flex-col gap-2" role="radiogroup">
            {(Object.keys(CROSS_OFF_REASONS) as Reason[]).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={`chip min-h-12 justify-start text-xl ${reason === r ? "bg-crayon-purple/25 shadow-[2px_2px_0_#2b2a33]" : ""}`}
              >
                <span aria-hidden>{CROSS_OFF_REASONS[r].emoji}</span>
                {CROSS_OFF_REASONS[r].label}
              </button>
            ))}
          </div>
          <input
            className="field"
            value={note}
            maxLength={250}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            aria-label="Note"
          />
          {error && (
            <p className="font-hand text-lg text-crayon-red">{error}</p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              className="crayon-btn min-h-12 bg-paper px-4 text-lg"
              onClick={() => setOpen(false)}
            >
              Never mind
            </button>
            <button
              type="button"
              className="crayon-btn wax min-h-12 flex-1 bg-crayon-purple text-white [text-shadow:1px_1px_0_#2b2a33]"
              disabled={!reason || pending}
              onClick={crossOff}
            >
              {pending ? "Scribbling…" : "Cross it off ✖️"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
