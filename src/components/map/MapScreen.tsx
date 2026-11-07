"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParkSummary } from "@/lib/data";
import { hasPlayground, isCrossedOff, tally } from "@/lib/features";
import { stampMilestone, type Milestone } from "@/lib/milestones";
import { MilestoneCard } from "../Milestone";
import type { LatLng } from "@/lib/geo";
import type { ParkMapHandle } from "./ParkMap";
import { ParkSheet } from "./ParkSheet";
import { ProgressBar } from "./ProgressBar";

const ParkMap = dynamic(() => import("./ParkMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

type Filter = "all" | "todo" | "done";
const PADDING = { top: 210, bottom: 200 };
const NAV_OFFSET = "calc(max(env(safe-area-inset-bottom), 0.6rem) + 92px)";

export function MapScreen({
  parks: everything,
  signedIn,
}: {
  parks: ParkSummary[];
  signedIn: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [here, setHere] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const closeMilestone = useCallback(() => setMilestone(null), []);
  const handle = useRef<ParkMapHandle | null>(null);
  const router = useRouter();

  const active = useMemo(
    () => everything.filter((p) => !isCrossedOff(p)),
    [everything],
  );
  const crossed = useMemo(
    () => everything.filter((p) => isCrossedOff(p)),
    [everything],
  );
  const visitedCount = active.filter((p) => p.lastVisit).length;
  // The header counts the playground quest, like the list and passport.
  const quest = tally(everything.filter(hasPlayground), (p) => !!p.lastVisit);
  const done = quest.done;
  const total = everything.length;
  const playgroundsLeft = active.filter(hasPlayground).length;

  const shown = useMemo(() => {
    if (!signedIn || filter === "all") return active;
    return active.filter((p) =>
      filter === "done" ? p.lastVisit : !p.lastVisit,
    );
  }, [active, filter, signedIn]);
  const shownCrossed = !signedIn || filter === "all" ? crossed : [];

  const selected = everything.find((p) => p.id === selectedId) ?? null;

  const onSelect = useCallback(
    (p: ParkSummary | null) => setSelectedId(p?.id ?? null),
    [],
  );
  const onReady = useCallback((h: ParkMapHandle) => {
    handle.current = h;
  }, []);
  const close = useCallback(() => setSelectedId(null), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function locate() {
    if (here) return handle.current?.locate(here);
    if (!("geolocation" in navigator))
      return setToast("This phone can't share its location. 🤷");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const h = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(h);
        setLocating(false);
        handle.current?.locate(h);
      },
      () => {
        setLocating(false);
        setToast("Couldn't find you. Check location permissions!");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function addHref() {
    const c = handle.current?.center();
    if (!c) return "/parks/new";
    return `/parks/new?lat=${c.lat.toFixed(5)}&lng=${c.lng.toFixed(5)}`;
  }

  const empty =
    total === 0
      ? "blank"
      : signedIn && filter === "done" && shown.length === 0
        ? "no-stars"
        : signedIn && filter === "todo" && shown.length === 0
          ? "all-done"
          : null;

  return (
    <div className="fixed inset-0">
      <div className="absolute inset-0">
        <ParkMap
          parks={shown}
          crossed={shownCrossed}
          selectedId={selectedId}
          onSelect={onSelect}
          here={here}
          padding={PADDING}
          sheetHeight={sheetHeight}
          onReady={onReady}
          fitKey={filter}
        />
      </div>

      {/* Floating header */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-[500] px-3"
        style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
      >
        <div className="pointer-events-auto mx-auto flex max-w-md flex-col gap-2">
          <div className="doodle-box flex items-center gap-3 bg-[#fffdf7]/95 py-2 pr-2 pl-4 shadow-[3px_4px_0_#2b2a33] backdrop-blur">
            <div className="min-w-0 flex-1">
              {signedIn ? (
                <>
                  <p className="font-hand text-xl leading-tight">
                    <span className="font-sketch text-2xl font-bold">
                      {done}
                    </span>{" "}
                    of {quest.total} playgrounds
                    {done > 0 && done === quest.total ? " 🏆" : ""}
                  </p>
                  <ProgressBar value={done} max={quest.total} />
                </>
              ) : (
                <>
                  <p className="font-hand text-xl leading-tight">
                    <span className="font-sketch text-2xl font-bold">
                      {playgroundsLeft}
                    </span>{" "}
                    playgrounds to find!
                  </p>
                  <Link
                    href="/me"
                    className="font-hand text-base text-crayon-blue underline"
                  >
                    Join to color them in →
                  </Link>
                </>
              )}
            </div>
            <Link
              href="/list"
              className="crayon-btn min-h-11 shrink-0 bg-paper px-3 text-lg"
              aria-label="Show as a list"
            >
              📋 List
            </Link>
          </div>
          {signedIn && total > 0 && !selected && (
            <div
              role="group"
              aria-label="Show"
              className="map-hide-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1"
            >
              <FilterChip
                on={filter === "all"}
                onClick={() => setFilter("all")}
                label="All"
                n={active.length}
              />
              <FilterChip
                on={filter === "todo"}
                onClick={() => setFilter("todo")}
                label="🖍️ To visit"
                n={active.length - visitedCount}
              />
              <FilterChip
                on={filter === "done"}
                onClick={() => setFilter("done")}
                label="⭐ Visited"
                n={visitedCount}
              />
            </div>
          )}
        </div>
      </header>

      {/* Thumb-zone buttons */}
      {!selected && (
        <div
          className="pointer-events-none absolute inset-x-0 z-[500] px-3"
          style={{ bottom: NAV_OFFSET }}
        >
          <div className="mx-auto flex max-w-md items-end justify-between">
            <button
              onClick={() => router.push(addHref())}
              className="crayon-btn wax pointer-events-auto bg-crayon-orange text-lg text-white"
            >
              ＋ Add a park
            </button>
            <button
              onClick={locate}
              disabled={locating}
              aria-label="Show where I am"
              className="crayon-btn pointer-events-auto h-14 w-14 rounded-[var(--radius-blob)] bg-paper p-0 text-2xl"
            >
              <span
                className={
                  locating
                    ? "animate-wiggle [animation-iteration-count:infinite]"
                    : ""
                }
              >
                📍
              </span>
            </button>
          </div>
        </div>
      )}

      {empty && !selected && (
        <EmptyCard kind={empty} onShowAll={() => setFilter("all")} />
      )}

      {toast && (
        <div
          role="status"
          className="absolute inset-x-0 z-[600] flex justify-center px-6"
          style={{
            top: "calc(max(env(safe-area-inset-top), 0.75rem) + 140px)",
          }}
        >
          <p className="doodle-box-alt animate-pop-in bg-[#fffdf7] px-4 py-2 text-center font-hand text-lg shadow-[3px_3px_0_#2b2a33]">
            {toast}
          </p>
        </div>
      )}

      {selected && (
        <ParkSheet
          park={selected}
          signedIn={signedIn}
          here={here}
          onClose={close}
          onHeight={setSheetHeight}
          onStamped={(id) => {
            const m = stampMilestone(everything, id);
            if (m) setMilestone(m);
            return !!m;
          }}
        />
      )}

      {milestone && (
        <MilestoneCard milestone={milestone} onClose={closeMilestone} />
      )}
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  label,
  n,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  n: number;
}) {
  return (
    <button
      className="chip min-h-11 shrink-0 shadow-[2px_2px_0_#2b2a33]"
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
      <span className="font-body text-sm text-ink-soft">{n}</span>
    </button>
  );
}

function EmptyCard({
  kind,
  onShowAll,
}: {
  kind: "blank" | "no-stars" | "all-done";
  onShowAll: () => void;
}) {
  const copy = {
    blank: {
      emoji: "🗺️",
      title: "The map is blank!",
      body: "No playgrounds yet. Know one? Put it on the map.",
    },
    "no-stars": {
      emoji: "⭐",
      title: "No gold stars yet",
      body: "Every park you visit turns into a star. Let's get the first one!",
    },
    "all-done": {
      emoji: "🏆",
      title: "Every park colored in!",
      body: "You did it. Know a playground we missed?",
    },
  }[kind];
  return (
    <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center px-8">
      <div className="doodle-box pointer-events-auto flex max-w-xs animate-pop-in flex-col items-center gap-2 bg-[#fffdf7] p-6 text-center shadow-[4px_5px_0_#2b2a33]">
        <span className="animate-float text-5xl">{copy.emoji}</span>
        <h2 className="text-3xl">{copy.title}</h2>
        <p className="text-ink-soft">{copy.body}</p>
        {kind === "no-stars" ? (
          <Link
            href="/"
            className="crayon-btn wax mt-1 bg-crayon-pink text-white"
          >
            🎡 Spin the wheel
          </Link>
        ) : (
          <Link
            href="/parks/new"
            className="crayon-btn wax mt-1 bg-crayon-orange text-white"
          >
            ＋ Add a park
          </Link>
        )}
        {kind !== "blank" && (
          <button
            onClick={onShowAll}
            className="min-h-11 font-hand text-lg text-crayon-blue underline"
          >
            Show all parks
          </button>
        )}
      </div>
    </div>
  );
}

export function MapLoading() {
  return (
    <div className="grid h-full w-full place-items-center bg-paper-dark">
      <div className="flex flex-col items-center gap-2" role="status">
        <span className="inline-block animate-wiggle text-5xl [animation-iteration-count:infinite]">
          🗺️
        </span>
        <p className="font-hand text-2xl text-ink-soft">Unfolding the map…</p>
      </div>
    </div>
  );
}
