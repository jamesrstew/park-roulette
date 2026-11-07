"use client";

import confetti from "canvas-confetti";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { logVisit } from "@/lib/actions";
import { CRAYONS, townCrayon } from "@/lib/crayons";
import type { ParkSummary } from "@/lib/data";
import {
  ATTRIBUTES,
  SMART_FILTERS,
  attributeScores,
  matchesSmartFilter,
} from "@/lib/features";
import {
  directionsUrl,
  formatMiles,
  milesBetween,
  placeUrl,
  type LatLng,
} from "@/lib/geo";
import { Stars } from "./Stars";
import { Underline } from "./Scribbles";
import { Wheel, type WheelHandle, type WheelItem } from "./Wheel";

const MAX_WEDGES = 10;
const RADII = [5, 10, 20, 40];

type Filters = {
  newOnly: boolean;
  town: string;
  radius: number | null;
  features: string[];
};
const DEFAULT_FILTERS: Filters = {
  newOnly: true,
  town: "",
  radius: null,
  features: [],
};

function sample<T>(arr: T[], k: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SpinScreen({
  parks,
  signedIn,
}: {
  parks: ParkSummary[];
  signedIn: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [here, setHere] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [wheelItems, setWheelItems] = useState<ParkSummary[]>([]);
  const [result, setResult] = useState<ParkSummary | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const wheel = useRef<WheelHandle>(null);

  // Remember filters between visits (read once after mount; write after that).
  const hydrated = useRef(false);
  useEffect(() => {
    let saved: Partial<Filters> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem("pr:filters") ?? "null");
    } catch {}
    hydrated.current = true;
    if (saved) {
      const next = { ...DEFAULT_FILTERS, ...saved, radius: null };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate from localStorage
      setFilters(next);
    }
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem("pr:filters", JSON.stringify(filters));
  }, [filters]);

  const towns = useMemo(
    () => [...new Set(parks.map((p) => p.city))].sort(),
    [parks],
  );
  const visitedCount = parks.filter((p) => p.lastVisit).length;

  const pool = useMemo(
    () =>
      parks.filter((p) => {
        if (signedIn && filters.newOnly && p.lastVisit) return false;
        if (filters.town && p.city !== filters.town) return false;
        if (filters.radius && here && milesBetween(here, p) > filters.radius)
          return false;
        const scores = attributeScores(p.features, p.reports);
        return filters.features.every((k) => matchesSmartFilter(k, scores));
      }),
    [parks, filters, here, signedIn],
  );

  // Re-deal the wheel whenever the pool changes.
  const poolKey = pool.map((p) => p.id).join(",");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- dealing a fresh random wheel
    setWheelItems(sample(pool, MAX_WEDGES));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey]);

  const items: WheelItem[] = useMemo(
    () =>
      wheelItems.map((p, i) => ({
        id: p.id,
        label: p.name,
        color: Object.keys(CRAYONS)[i % 9],
      })),
    [wheelItems],
  );

  function locate(radius: number | null) {
    if (radius == null) return setFilters((f) => ({ ...f, radius: null }));
    if (here) return setFilters((f) => ({ ...f, radius }));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFilters((f) => ({ ...f, radius }));
        setLocating(false);
      },
      () => {
        setLocating(false);
        alert(
          "We couldn't find you. Check location permissions and try again!",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function onResult(id: number) {
    setSpinning(false);
    const park = wheelItems.find((p) => p.id === id) ?? null;
    setResult(park);
    const colors = Object.values(CRAYONS);
    confetti({
      particleCount: 140,
      spread: 85,
      origin: { y: 0.45 },
      colors,
      scalar: 1.1,
      disableForReducedMotion: true,
    });
    setTimeout(
      () =>
        confetti({
          particleCount: 60,
          angle: 60,
          spread: 60,
          origin: { x: 0, y: 0.6 },
          colors,
          disableForReducedMotion: true,
        }),
      200,
    );
    setTimeout(
      () =>
        confetti({
          particleCount: 60,
          angle: 120,
          spread: 60,
          origin: { x: 1, y: 0.6 },
          colors,
          disableForReducedMotion: true,
        }),
      350,
    );
  }

  const activeFilterCount =
    (filters.town ? 1 : 0) +
    (filters.radius ? 1 : 0) +
    filters.features.length +
    (signedIn && !filters.newOnly ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="relative pt-2 text-center">
        <h1 className="font-sketch text-[3.2rem] leading-none font-bold tracking-tight">
          Park <span className="text-crayon-red">Roulette</span>
        </h1>
        <Underline className="mx-auto -mt-1 h-4 w-56" color="#f7c933" />
        <p className="mt-1 font-hand text-xl text-ink-soft">
          {signedIn ? (
            <>
              <span className="highlight">{visitedCount}</span> of{" "}
              {parks.length} playgrounds colored in!
            </>
          ) : (
            <>{parks.length} playgrounds in Central Oregon. Where to?</>
          )}
        </p>
      </header>

      {/* Filters: compact summary, expandable drawer */}
      <section aria-label="Filters" className="flex flex-col gap-2">
        <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1">
          {signedIn && (
            <button
              className="chip"
              aria-pressed={filters.newOnly}
              onClick={() => setFilters((f) => ({ ...f, newOnly: !f.newOnly }))}
            >
              ✨ New to us
            </button>
          )}
          <button
            className="chip"
            aria-pressed={filters.radius != null}
            onClick={() => locate(filters.radius ? null : 10)}
            disabled={locating}
          >
            📍{" "}
            {locating
              ? "Finding you…"
              : filters.radius
                ? `Within ${filters.radius} mi`
                : "Near me"}
          </button>
          <button
            className="chip"
            aria-pressed={showFilters}
            onClick={() => setShowFilters((s) => !s)}
          >
            🎛️ More{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </div>

        {showFilters && (
          <div className="doodle-box-alt flex animate-pop-in flex-col gap-3 p-4">
            <label className="flex flex-col gap-1">
              <span className="font-hand text-lg">Which town?</span>
              <select
                className="field"
                value={filters.town}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, town: e.target.value }))
                }
              >
                <option value="">Anywhere in Central Oregon</option>
                {towns.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className="font-hand text-lg">How far?</span>
              <div className="flex flex-wrap gap-2">
                <button
                  className="chip"
                  aria-pressed={filters.radius == null}
                  onClick={() => locate(null)}
                >
                  Any distance
                </button>
                {RADII.map((r) => (
                  <button
                    key={r}
                    className="chip"
                    aria-pressed={filters.radius === r}
                    onClick={() => locate(r)}
                  >
                    {r} mi
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-hand text-lg">Today we want…</span>
              <div className="flex flex-wrap gap-2">
                {SMART_FILTERS.map(({ key: k, emoji, label }) => (
                  <button
                    key={k}
                    className="chip"
                    aria-pressed={filters.features.includes(k)}
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        features: f.features.includes(k)
                          ? f.features.filter((x) => x !== k)
                          : [...f.features, k],
                      }))
                    }
                  >
                    {emoji} {label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-ink-soft">
                These come from maps and your reviews, so they get smarter every
                time you rate a park.
              </p>
            </div>
            <button
              className="self-start font-hand text-lg text-crayon-blue underline"
              onClick={() => setFilters(DEFAULT_FILTERS)}
            >
              Reset everything
            </button>
          </div>
        )}
      </section>

      {pool.length === 0 ? (
        <EmptyWheel
          everywhere={
            signedIn && filters.newOnly && visitedCount === parks.length
          }
          onReset={() => setFilters(DEFAULT_FILTERS)}
        />
      ) : (
        <>
          <Wheel
            ref={wheel}
            items={items}
            onSpinStart={() => (setSpinning(true), setResult(null))}
            onResult={onResult}
          />
          <div className="-mt-2 flex items-center justify-center gap-3 text-center">
            <p className="font-hand text-lg text-ink-soft">
              {spinning
                ? "Round and round…"
                : pool.length > MAX_WEDGES
                  ? `${MAX_WEDGES} of ${pool.length} parks on the wheel`
                  : `${pool.length} parks on the wheel`}
            </p>
            {pool.length > MAX_WEDGES && !spinning && (
              <button
                className="chip"
                onClick={() => (
                  setWheelItems(sample(pool, MAX_WEDGES)),
                  setResult(null)
                )}
              >
                🔀 Shuffle
              </button>
            )}
          </div>
        </>
      )}

      {result && !spinning && (
        <ResultCard
          park={result}
          here={here}
          signedIn={signedIn}
          onAgain={() => wheel.current?.spin(0)}
        />
      )}
    </div>
  );
}

function EmptyWheel({
  everywhere,
  onReset,
}: {
  everywhere: boolean;
  onReset: () => void;
}) {
  return (
    <div className="doodle-box flex flex-col items-center gap-3 p-8 text-center">
      <span className="animate-float text-6xl">{everywhere ? "🏆" : "🤷"}</span>
      <h2 className="text-3xl">
        {everywhere ? "You've been EVERYWHERE!" : "No parks match"}
      </h2>
      <p className="text-ink-soft">
        {everywhere
          ? "Every single playground. Legends. Time to find new ones?"
          : "Try fewer filters or a bigger circle."}
      </p>
      <button
        className="crayon-btn wax bg-crayon-green text-white"
        onClick={onReset}
      >
        {everywhere ? "Spin all parks" : "Clear filters"}
      </button>
    </div>
  );
}

function ResultCard({
  park,
  here,
  signedIn,
  onAgain,
}: {
  park: ParkSummary;
  here: LatLng | null;
  signedIn: boolean;
  onAgain: () => void;
}) {
  const [pending, start] = useTransition();
  const [logged, setLogged] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const color = CRAYONS[townCrayon(park.city)];

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  return (
    <div ref={ref} className="relative mt-2 animate-pop-in scroll-mb-32">
      <div className="tape -top-3 left-1/2 z-10 -translate-x-1/2 -rotate-3" />
      <article className="doodle-box relative flex flex-col gap-3 p-5 pt-6 shadow-[4px_5px_0_#2b2a33]">
        <p className="text-center font-hand text-lg text-ink-soft">
          The wheel has spoken…
        </p>
        <h2 className="text-center text-4xl">{park.name}</h2>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-base">
          <span
            className="rounded-full px-2.5 py-0.5 font-hand text-lg text-white"
            style={{ background: color }}
          >
            {park.city}
          </span>
          {here && (
            <span className="font-hand text-lg">
              🚗 {formatMiles(milesBetween(here, park))}
            </span>
          )}
          {park.reviewCount > 0 && <Stars tenths={park.avgTenths} size={18} />}
          {park.lastVisit && (
            <span className="font-hand text-lg">✅ been here</span>
          )}
        </div>
        <ReportCard park={park} />
        {park.confidence !== "confirmed" && (
          <p className="text-center text-sm text-ink-soft">
            🔍 We think there&apos;s a playground here. Let us know if
            we&apos;re wrong!
          </p>
        )}
        <div className="mt-1 grid grid-cols-1 gap-3">
          <a
            className="crayon-btn wax bg-crayon-green text-2xl text-white"
            href={directionsUrl(park)}
            target="_blank"
            rel="noreferrer"
          >
            🚗 Let&apos;s go!
          </a>
          <div className="grid grid-cols-2 gap-3">
            <a
              className="crayon-btn bg-paper text-lg"
              href={placeUrl(park)}
              target="_blank"
              rel="noreferrer"
            >
              👀 Peek
            </a>
            <Link
              className="crayon-btn bg-paper text-lg"
              href={`/parks/${park.slug}`}
            >
              📖 Park page
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {signedIn ? (
              <button
                className="crayon-btn wax bg-crayon-yellow text-lg"
                disabled={pending || logged}
                onClick={() =>
                  start(async () => {
                    const r = await logVisit({
                      parkId: park.id,
                      visitedOn: todayLocal(),
                    });
                    if (r.ok) setLogged(true);
                    else alert(r.error);
                  })
                }
              >
                {logged ? "✅ Stamped!" : pending ? "Stamping…" : "📒 We went!"}
              </button>
            ) : (
              <Link className="crayon-btn bg-paper text-lg" href="/me">
                🖍️ Join to track
              </Link>
            )}
            <button
              className="crayon-btn wax bg-crayon-pink text-lg"
              onClick={onAgain}
            >
              🎡 Again!
            </button>
          </div>
          {logged && (
            <Link
              href={`/parks/${park.slug}#review`}
              className="text-center font-hand text-xl text-crayon-blue underline"
            >
              Now give it some stars ⭐
            </Link>
          )}
        </div>
      </article>
    </div>
  );
}

/** Good stuff as stickers, heads-ups as orange warnings so a parent spots them fast. */
function ReportCard({ park }: { park: ParkSummary }) {
  const scores = attributeScores(park.features, park.reports);
  const keys = Object.keys(scores)
    .filter((k) => ATTRIBUTES[k] && scores[k] > 0)
    .sort((a, b) => scores[b] - scores[a]);
  const good = keys.filter((k) => ATTRIBUTES[k].kind === "good").slice(0, 6);
  const heads = keys
    .filter((k) => ATTRIBUTES[k].kind === "heads_up")
    .slice(0, 3);
  if (!good.length && !heads.length) return null;
  return (
    <div className="flex flex-col items-center gap-1.5">
      {good.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-1.5">
          {good.map((k) => (
            <li
              key={k}
              className="rounded-full bg-paper-dark px-2 py-0.5 text-sm"
            >
              {ATTRIBUTES[k].emoji} {ATTRIBUTES[k].label}
            </li>
          ))}
        </ul>
      )}
      {heads.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-1.5">
          {heads.map((k) => (
            <li
              key={k}
              className="rounded-full border-2 border-dashed border-crayon-orange bg-[#fff1e3] px-2 py-0.5 text-sm"
            >
              ⚠️ {ATTRIBUTES[k].label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
