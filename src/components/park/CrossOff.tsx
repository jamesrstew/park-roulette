"use client";

import confetti from "canvas-confetti";
import { useState, useTransition } from "react";
import { setParkPlay, setParkStatus } from "@/lib/client-actions";
import { sayWaiting } from "./fix-toast";
import { CROSS_OFF_ICONS, Icon, PLAY_ICONS } from "@/components/icons";
import { CRAYONS } from "@/lib/crayons";
import { CROSS_OFF_REASONS, type PlayType } from "@/lib/features";
import { ScribbleOut } from "./Doodles";
import { JoinNudge } from "./JoinNudge";
import { sfx } from "@/lib/sound";

type Reason = keyof typeof CROSS_OFF_REASONS;

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
  };
  const note = statusNote ?? "";
  const showNote = note && note !== reason.label && note !== "Flagged";

  return (
    <div
      className="doodle-box-alt relative flex animate-pop-in flex-col gap-2 overflow-hidden bg-[color-mix(in_srgb,var(--color-crayon-purple)_9%,#fffdf7)] p-4"
      role="status"
    >
      <div className="flex items-start gap-3">
        <Icon name={CROSS_OFF_ICONS[status as Reason] ?? "close"} size={42} />
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
            It&apos;s off the wheel. One less to hunt for!
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
              if (!res.ok) return (sfx.oops(), setError(res.error));
              if (res.outcome === "waiting") return sayWaiting();
              sfx.undo();
            })
          }
        >
          {pending ? (
            "Un-crossing…"
          ) : (
            <>
              <Icon name="undo" size={24} /> Undo, it&apos;s real!
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * "No playground here" is a fix, not a cross-off: a sign under the title says
 * so, and anyone can flip it back.
 */
export function PlaySign({
  parkId,
  play,
  signedIn,
}: {
  parkId: number;
  play: PlayType;
  signedIn: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (play === "playground") return null;
  return (
    <div className="doodle-box-alt flex flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-green)_10%,#fffdf7)] px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon name={PLAY_ICONS[play]} size={36} />
        <div className="flex-1">
          <p className="font-hand text-xl leading-tight">
            {play === "none" ? "Just a park, no playground" : "Nature play"}
          </p>
          <p className="text-sm leading-snug text-ink-soft">
            {play === "none"
              ? "A bonus on the every-park list. It skips the wheel unless you ask."
              : "Logs, rocks, and dirt instead of slides. Counts as a playground!"}
          </p>
        </div>
      </div>
      {error && <p className="font-hand text-lg text-crayon-red">{error}</p>}
      {signedIn && play === "none" && (
        <button
          type="button"
          className="crayon-btn min-h-11 self-start bg-paper px-3 text-base"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setParkPlay({ parkId, play: "playground" });
              if (!res.ok) return (sfx.oops(), setError(res.error));
              if (res.outcome === "waiting") return sayWaiting();
              sfx.pop();
            })
          }
        >
          {pending ? (
            "Fixing…"
          ) : (
            <>
              <Icon name="playground" size={24} /> Actually, there&apos;s a
              playground!
            </>
          )}
        </button>
      )}
    </div>
  );
}

type Fix = "no_playground" | Reason;

/** Footer: "Something off?" Fix a missing playground, or cross a park off. */
export function CrossOffFooter({
  parkId,
  play,
  signedIn,
}: {
  parkId: number;
  play: PlayType;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Fix | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const options = (Object.keys(CROSS_OFF_REASONS) as Fix[]).filter(
    (r) => !(r === "no_playground" && play === "none"),
  );
  const isFix = reason === "no_playground";

  function submit() {
    if (!reason) return;
    setError(null);
    start(async () => {
      const res = await setParkStatus({
        parkId,
        status: reason,
        note: note.trim() || CROSS_OFF_REASONS[reason].label,
      });
      if (!res.ok) return (sfx.oops(), setError(res.error));
      setOpen(false);
      setReason(null);
      setNote("");
      if (res.outcome === "waiting") return sayWaiting();
      if (isFix) sfx.scribble();
      else sfx.strike();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (!isFix)
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
    <section aria-label="Something off?" className="flex flex-col gap-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="doodle-box-alt flex min-h-14 items-center gap-3 border-dashed bg-transparent p-3 text-left"
        >
          <Icon name="crayon" size={34} />
          <span className="flex-1">
            <span className="block font-hand text-xl leading-tight">
              Something off?
            </span>
            <span className="block text-sm text-ink-soft">
              {play === "none"
                ? "Closed or private? Cross it off the list."
                : "No playground? Closed? Private? Fix the list."}
            </span>
          </span>
          <span className="font-hand text-2xl" aria-hidden>
            ›
          </span>
        </button>
      ) : !signedIn ? (
        <JoinNudge
          icon="crayon"
          line="Hop in to fix the list!"
          onClose={() => setOpen(false)}
        />
      ) : (
        <div className="doodle-box-alt flex animate-pop-in flex-col gap-3 p-4">
          <p className="font-hand text-2xl leading-none">
            What&apos;s the story?
          </p>
          <div className="flex flex-col gap-2" role="radiogroup">
            {options.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={`chip min-h-12 justify-start text-xl ${reason === r ? (r === "no_playground" ? "bg-crayon-green/20" : "bg-crayon-purple/25") + " shadow-[2px_2px_0_#2b2a33]" : ""}`}
              >
                <Icon name={CROSS_OFF_ICONS[r]} size={26} />
                {r === "no_playground"
                  ? "No playground, just a park"
                  : CROSS_OFF_REASONS[r].label}
              </button>
            ))}
          </div>
          {reason && (
            <p className="-mt-1 text-sm text-ink-soft">
              {isFix
                ? "It stays on the every-park list and comes off the playground count once another family agrees."
                : "It comes off the wheel for everyone once another family agrees."}
            </p>
          )}
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
              className={`crayon-btn wax min-h-12 flex-1 text-white [text-shadow:1px_1px_0_#2b2a33] ${isFix ? "bg-crayon-green" : "bg-crayon-purple"}`}
              disabled={!reason || pending}
              onClick={submit}
            >
              {pending ? (
                "Scribbling…"
              ) : isFix ? (
                <>
                  Fix it <Icon name="park" size={24} />
                </>
              ) : (
                <>
                  Cross it off <Icon name="close" size={20} />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
