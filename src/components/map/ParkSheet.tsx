"use client";

import confetti from "canvas-confetti";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Stars } from "@/components/Stars";
import { logVisit } from "@/lib/client-actions";
import { CRAYONS, townCrayon } from "@/lib/crayons";
import type { ParkSummary } from "@/lib/data";
import { sfx } from "@/lib/sound";
import {
  ATTRIBUTES,
  CROSS_OFF_REASONS,
  PLAY_TYPES,
  attributeScores,
  isCrossedOff,
  playOf,
} from "@/lib/features";
import {
  directionsUrl,
  formatMiles,
  milesBetween,
  placeUrl,
  type LatLng,
} from "@/lib/geo";

const MAX_STICKERS = 6;

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function prettyDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function ParkSheet({
  park,
  signedIn,
  here,
  onClose,
  onHeight,
  onStamped,
}: {
  park: ParkSummary;
  signedIn: boolean;
  here: LatLng | null;
  onClose: () => void;
  onHeight: (h: number) => void;
  /** Return true if the parent is throwing its own (bigger) party. */
  onStamped?: (parkId: number) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  // Report our height so the map can keep the pin in view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight + 90));
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeight(0);
    };
  }, [onHeight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const crossedOff = isCrossedOff(park);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[900] px-3"
      style={{
        bottom: "calc(max(env(safe-area-inset-bottom), 0.6rem) + 80px)",
      }}
    >
      <div
        ref={ref}
        key={park.id}
        role="dialog"
        aria-label={park.name}
        className="map-sheet-enter pointer-events-auto relative mx-auto max-w-md"
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: drag ? "none" : "transform 0.2s ease",
        }}
        onTouchStart={(e) => {
          // Only swipe-to-close from the top: if the card's own content is
          // scrolled, the finger is scrolling it, not dismissing it.
          const scroller = e.currentTarget.querySelector("article");
          startY.current =
            scroller && scroller.scrollTop > 0 ? null : e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (startY.current == null) return;
          setDrag(Math.max(0, e.touches[0].clientY - startY.current));
        }}
        onTouchEnd={() => {
          if (drag > 70) onClose();
          setDrag(0);
          startY.current = null;
        }}
      >
        <div className="tape -top-3 left-1/2 z-10 -translate-x-1/2 -rotate-2" />
        <article className="doodle-box relative flex max-h-[62dvh] flex-col gap-2.5 overflow-y-auto p-4 pt-5 shadow-[4px_5px_0_#2b2a33]">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-1 right-1 grid h-11 w-11 place-items-center font-hand text-2xl text-ink-soft active:scale-90"
          >
            ✕
          </button>
          {crossedOff ? (
            <CrossedOffBody park={park} />
          ) : (
            <ActiveBody
              park={park}
              signedIn={signedIn}
              here={here}
              onStamped={onStamped}
            />
          )}
        </article>
      </div>
    </div>
  );
}

function TownPill({ city }: { city: string }) {
  return (
    <span
      className="rounded-full border-2 border-ink px-2.5 py-0.5 font-hand text-lg leading-tight text-white"
      style={{ background: CRAYONS[townCrayon(city)] }}
    >
      {city}
    </span>
  );
}

function CrossedOffBody({ park }: { park: ParkSummary }) {
  const reason =
    CROSS_OFF_REASONS[park.status as keyof typeof CROSS_OFF_REASONS];
  return (
    <>
      <h2 className="pr-10 text-3xl text-ink-soft line-through decoration-crayon-red decoration-[3px]">
        {park.name}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <TownPill city={park.city} />
        <span className="font-hand text-lg">
          {reason ? `${reason.emoji} ${reason.label}` : "Crossed off"}
        </span>
      </div>
      <p className="text-sm text-ink-soft">
        Crossed off the list, so it counts as done.
        {park.statusNote ? ` “${park.statusNote}”` : ""}
      </p>
      <Link
        className="crayon-btn mt-1 bg-paper text-lg"
        href={`/parks/${park.slug}`}
      >
        📖 Park page
      </Link>
    </>
  );
}

function ActiveBody({
  park,
  signedIn,
  here,
  onStamped,
}: {
  park: ParkSummary;
  signedIn: boolean;
  here: LatLng | null;
  onStamped?: (parkId: number) => boolean;
}) {
  const [pending, start] = useTransition();
  const [logged, setLogged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scores = attributeScores(park.features, park.reports ?? {});
  const keys = Object.keys(scores)
    .filter((k) => ATTRIBUTES[k] && scores[k] > 0)
    .sort((a, b) => scores[b] - scores[a]);
  const good = keys.filter((k) => ATTRIBUTES[k].kind === "good");
  const headsUp = keys.filter((k) => ATTRIBUTES[k].kind === "heads_up");
  const visited = !!park.lastVisit || logged;
  const play = playOf(park);

  function stamp() {
    setError(null);
    start(async () => {
      const r = await logVisit({ parkId: park.id, visitedOn: todayLocal() });
      if (!r.ok) return (sfx.oops(), setError(r.error));
      sfx.stamp();
      setLogged(true);
      if (onStamped?.(park.id)) return;
      if (!park.lastVisit)
        confetti({
          particleCount: 90,
          spread: 70,
          origin: { y: 0.7 },
          colors: Object.values(CRAYONS),
          disableForReducedMotion: true,
        });
    });
  }

  return (
    <>
      <h2 className="pr-10 text-[1.9rem]">{park.name}</h2>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <TownPill city={park.city} />
        {park.reviewCount > 0 ? (
          <Stars tenths={park.avgTenths} size={16} />
        ) : (
          <span className="font-hand text-lg text-ink-soft">No stars yet</span>
        )}
        {here && (
          <span className="font-hand text-lg">
            🚗 {formatMiles(milesBetween(here, park))}
          </span>
        )}
      </div>
      {park.notes && (
        <p className="font-hand text-lg leading-snug">
          &ldquo;{park.notes}&rdquo;
        </p>
      )}
      {play !== "playground" && (
        <p className="font-hand text-lg leading-tight">
          {PLAY_TYPES[play].emoji}{" "}
          {play === "none"
            ? "Just a park, no playground. Bonus stamp!"
            : "Nature play: logs, rocks, and dirt."}
        </p>
      )}

      {signedIn && (
        <p className="font-hand text-lg leading-tight">
          {visited ? (
            <>
              <span className="highlight">⭐ Colored in!</span>{" "}
              <span className="text-ink-soft">
                {logged
                  ? "Stamped today"
                  : `${park.visitCount > 1 ? `${park.visitCount} visits, last` : "Last"} ${prettyDate(park.lastVisit!)}`}
              </span>
            </>
          ) : (
            <span className="text-ink-soft">
              🖍️ Not yet! Still to color in.
            </span>
          )}
        </p>
      )}

      {(good.length > 0 || headsUp.length > 0) && (
        <ul className="map-hide-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5">
          {headsUp.map((k) => (
            <li
              key={k}
              className="shrink-0 rounded-full border-2 border-dashed border-crayon-orange bg-[#fff1e3] px-2 py-0.5 text-sm"
              title="Heads up"
            >
              {ATTRIBUTES[k].emoji} {ATTRIBUTES[k].label}
            </li>
          ))}
          {good.slice(0, MAX_STICKERS).map((k) => (
            <li
              key={k}
              className="shrink-0 rounded-full bg-paper-dark px-2 py-0.5 text-sm"
            >
              {ATTRIBUTES[k].emoji} {ATTRIBUTES[k].label}
            </li>
          ))}
          {good.length > MAX_STICKERS && (
            <li className="shrink-0 px-1 py-0.5 text-sm text-ink-soft">
              +{good.length - MAX_STICKERS} more
            </li>
          )}
        </ul>
      )}
      {park.confidence !== "confirmed" && play === "playground" && (
        <p className="text-sm leading-snug text-ink-soft">
          🔍 Not checked yet. No playground? Fix it on the park page.
        </p>
      )}

      <div className="mt-1 grid grid-cols-2 gap-2.5">
        <a
          className="crayon-btn wax bg-crayon-green text-white"
          href={directionsUrl(park)}
          target="_blank"
          rel="noreferrer"
        >
          🚗 Let&apos;s go!
        </a>
        {signedIn ? (
          <button
            className="crayon-btn wax bg-crayon-yellow"
            disabled={pending || logged}
            onClick={stamp}
          >
            {logged ? "✅ Stamped!" : pending ? "Stamping…" : "📒 We went!"}
          </button>
        ) : (
          <Link className="crayon-btn bg-paper text-lg" href="/me">
            🖍️ Join in
          </Link>
        )}
        <a
          className="crayon-btn min-h-11 bg-paper py-1.5 text-lg"
          href={placeUrl(park)}
          target="_blank"
          rel="noreferrer"
        >
          👀 Peek
        </a>
        <Link
          className="crayon-btn min-h-11 bg-paper py-1.5 text-lg"
          href={`/parks/${park.slug}`}
        >
          📖 Park page
        </Link>
      </div>
      {error && (
        <p
          role="alert"
          className="text-center font-hand text-lg text-crayon-red"
        >
          {error}
        </p>
      )}
      {logged && (
        <Link
          href={`/parks/${park.slug}#review`}
          className="min-h-11 text-center font-hand text-xl text-crayon-blue underline"
        >
          Now give it some stars ⭐
        </Link>
      )}
    </>
  );
}
