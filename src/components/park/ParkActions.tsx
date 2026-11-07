"use client";

import confetti from "canvas-confetti";
import { useState, useTransition } from "react";
import { logVisit, removeVisit } from "@/lib/client-actions";
import { Icon } from "@/components/icons";
import { CRAYONS } from "@/lib/crayons";
import { directionsUrl, placeUrl } from "@/lib/geo";
import { formatDay, todayLocal } from "./format";
import { JoinNudge } from "./JoinNudge";
import { sfx } from "@/lib/sound";

type Visit = { id: number; visitedOn: string; by: string };

export function ParkActions({
  park,
  signedIn,
  visits,
  hasMyReview,
}: {
  park: { id: number; name: string; city: string; lat: number; lng: number };
  signedIn: boolean;
  visits: Visit[];
  hasMyReview: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayLocal);
  const [error, setError] = useState<string | null>(null);
  const [justStamped, setJustStamped] = useState(false);
  const [pending, start] = useTransition();

  function stamp() {
    setError(null);
    const first = visits.length === 0;
    start(async () => {
      const res = await logVisit({ parkId: park.id, visitedOn: date });
      if (!res.ok) return (sfx.oops(), setError(res.error));
      sfx.stamp();
      setOpen(false);
      setJustStamped(true);
      confetti({
        particleCount: first ? 150 : 60,
        spread: first ? 90 : 60,
        origin: { y: 0.55 },
        colors: Object.values(CRAYONS),
        disableForReducedMotion: true,
      });
    });
  }

  return (
    <section aria-label="Let's go" className="flex flex-col gap-3">
      <a
        href={directionsUrl(park)}
        target="_blank"
        rel="noopener noreferrer"
        className="crayon-btn wax min-h-16 w-full bg-crayon-green text-[1.7rem] text-white [text-shadow:1px_1px_0_#2b2a33]"
      >
        <Icon name="directions" size={34} /> Let&apos;s go!
      </a>
      <div className="grid grid-cols-2 gap-3">
        <a
          href={placeUrl(park)}
          target="_blank"
          rel="noopener noreferrer"
          className="crayon-btn min-h-14 bg-paper px-2 text-[1.2rem]"
        >
          <Icon name="peek" size={26} /> Peek in Maps
        </a>
        <button
          type="button"
          className="crayon-btn wax min-h-14 bg-crayon-yellow px-2 text-[1.3rem]"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
            setJustStamped(false);
            setDate(todayLocal());
          }}
        >
          <Icon name="stamp" size={28} /> We went!
        </button>
      </div>

      {open && !signedIn && (
        <JoinNudge
          icon="stamp"
          line="Join a crew to stamp your passport!"
          onClose={() => setOpen(false)}
        />
      )}

      {open && signedIn && (
        <div className="doodle-box-alt flex animate-pop-in flex-col gap-3 p-4">
          <p className="font-hand text-2xl leading-none">When did you go?</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Today", d: todayLocal() },
              { label: "Yesterday", d: todayLocal(-1) },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                className="chip min-h-11"
                aria-pressed={date === o.d}
                onClick={() => setDate(o.d)}
              >
                {o.label}
              </button>
            ))}
            <input
              type="date"
              className="field min-h-11 w-auto flex-1 py-1.5 font-hand text-lg"
              value={date}
              max={todayLocal()}
              aria-label="Visit date"
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
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
              className="crayon-btn wax min-h-12 flex-1 bg-crayon-red text-white [text-shadow:1px_1px_0_#2b2a33]"
              disabled={pending || !date}
              onClick={stamp}
            >
              {pending ? (
                "Stamping…"
              ) : (
                <>
                  Stamp it! <Icon name="crayon" size={26} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {justStamped && (
        <div className="doodle-box flex animate-pop-in items-center gap-3 bg-[color-mix(in_srgb,var(--color-crayon-green)_14%,#fffdf7)] p-3">
          <Icon name="party" size={44} />
          <div className="flex-1">
            <p className="font-hand text-2xl leading-none">Stamped!</p>
            <p className="text-sm text-ink-soft">
              {hasMyReview
                ? "Another one for the passport."
                : "How was it? Color in some stars."}
            </p>
          </div>
          {!hasMyReview && (
            <a
              href="#review"
              className="crayon-btn min-h-11 bg-crayon-yellow px-3 text-lg"
            >
              <Icon name="star" size={24} /> Rate it
            </a>
          )}
        </div>
      )}

      {signedIn && visits.length > 0 && <OurVisits visits={visits} />}
    </section>
  );
}

function OurVisits({ visits }: { visits: Visit[] }) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-1">
      <h2 className="font-hand text-2xl">
        Our visits{" "}
        <span className="text-lg text-ink-soft">({visits.length})</span>
      </h2>
      {error && (
        <p role="alert" className="font-hand text-lg text-crayon-red">
          {error}
        </p>
      )}
      <ul className="mt-1 flex flex-col gap-1.5">
        {visits.map((v, i) => (
          <li
            key={v.id}
            className="flex min-h-12 items-center gap-3 border-b-2 border-dashed border-ink/15 pb-1"
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-crayon-red text-sm text-crayon-red"
              style={{ rotate: `${(i % 3) * 6 - 6}deg` }}
              aria-hidden
            >
              ✓
            </span>
            <span className="flex-1">
              <span className="font-hand text-xl">
                {formatDay(v.visitedOn)}
              </span>
              <span className="text-sm text-ink-soft">
                {" "}
                · stamped by {v.by}
              </span>
            </span>
            {confirming === v.id ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className="chip min-h-11 bg-crayon-red text-white"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await removeVisit(v.id);
                      setConfirming(null);
                      if (!res.ok) return (sfx.oops(), setError(res.error));
                      sfx.undo();
                    })
                  }
                >
                  {pending ? "…" : "Erase"}
                </button>
                <button
                  type="button"
                  className="chip min-h-11"
                  onClick={() => setConfirming(null)}
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-full active:scale-90"
                aria-label={`Remove the ${formatDay(v.visitedOn)} visit`}
                onClick={() => setConfirming(v.id)}
              >
                <Icon name="close" size={18} className="opacity-60" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
