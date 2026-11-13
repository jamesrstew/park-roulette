"use client";

import { storage } from "@/lib/storage";
import confetti from "canvas-confetti";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { logVisit } from "@/lib/client-actions";
import {
  Icon,
  PLAY_ICONS,
  SMART_FILTER_ICONS,
  attrIcon,
} from "@/components/icons";
import { CRAYONS, townCrayon } from "@/lib/crayons";
import type { ParkSummary } from "@/lib/data";
import {
  ATTRIBUTES,
  SMART_FILTERS,
  attributeScores,
  hasPlayground,
  isCrossedOff,
  matchesSmartFilter,
  playOf,
  tally,
} from "@/lib/features";
import {
  directionsUrl,
  formatMiles,
  milesBetween,
  placeUrl,
  type LatLng,
} from "@/lib/geo";
import { stampMilestone, type Milestone } from "@/lib/milestones";
import { MilestoneCard } from "./Milestone";
import { Stars } from "./Stars";
import { Wheel, type WheelHandle, type WheelItem } from "./Wheel";
import { sfx } from "@/lib/sound";
import { PageTitle } from "./PageTitle";
import { SoundToggle } from "./SoundToggle";

const MAX_WEDGES = 10;
const RADII = [5, 10, 20, 40];

type Filters = {
  newOnly: boolean;
  /** include parks without a playground */
  allParks: boolean;
  town: string;
  radius: number | null;
  features: string[];
};
const DEFAULT_FILTERS: Filters = {
  newOnly: true,
  allParks: false,
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
  parks: everything,
  signedIn,
}: {
  /** The whole bucket list; crossed-off parks never land on the wheel. */
  parks: ParkSummary[];
  signedIn: boolean;
}) {
  const parks = useMemo(
    () => everything.filter((p) => !isCrossedOff(p)),
    [everything],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const closeMilestone = useCallback(() => setMilestone(null), []);
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
      saved = JSON.parse(storage.get("pr:filters") ?? "null");
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
    storage.set("pr:filters", JSON.stringify(filters));
  }, [filters]);

  const towns = useMemo(
    () => [...new Set(parks.map((p) => p.city))].sort(),
    [parks],
  );
  // Same count as the list and passport: visited + crossed off, playgrounds only.
  const quest = useMemo(
    () => tally(everything.filter(hasPlayground), (p) => !!p.lastVisit),
    [everything],
  );
  const playgroundsLeft = parks.filter(hasPlayground).length;

  const pool = useMemo(
    () =>
      parks.filter((p) => {
        if (!filters.allParks && !hasPlayground(p)) return false;
        if (signedIn && filters.newOnly && p.lastVisit) return false;
        if (filters.town && p.city !== filters.town) return false;
        if (filters.radius && here && milesBetween(here, p) > filters.radius)
          return false;
        const scores = attributeScores(p.features, p.reports);
        return filters.features.every((k) => matchesSmartFilter(k, scores));
      }),
    [parks, filters, here, signedIn],
  );

  // "Everywhere" is judged within what the wheel spins (playgrounds unless
  // "parks without playgrounds too" is on), not across every park.
  const scope = filters.allParks ? parks : parks.filter(hasPlayground);
  const everywhere =
    signedIn &&
    filters.newOnly &&
    scope.length > 0 &&
    scope.every((p) => p.lastVisit);

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
        setNotice("Couldn't find you. Check location permissions!");
        setTimeout(() => setNotice(null), 4000);
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
      <div className="relative">
        <div className="absolute top-1 -right-2 z-10">
          <SoundToggle />
        </div>
        <PageTitle
          lead="Park"
          accent="Roulette"
          color="red"
          underline="yellow"
          underlineWidth="w-56"
          subtitle={
            <p>
              {signedIn ? (
                <>
                  <span className="highlight">{quest.done}</span> of{" "}
                  {quest.total} playgrounds done!
                </>
              ) : (
                <span className="text-balance">
                  {playgroundsLeft} playgrounds in Central Oregon. Where to?
                </span>
              )}
            </p>
          }
        />
      </div>

      {!signedIn && (
        <div className="doodle-box -mt-1 flex items-center gap-3 bg-[color-mix(in_srgb,var(--color-crayon-yellow)_22%,#fffdf7)] px-4 py-2.5">
          <Icon name="passport" size={34} className="shrink-0" />
          <p className="flex-1 text-sm leading-snug">
            <b className="font-hand text-lg font-normal">New here?</b> A free
            game for Central Oregon families. Spin, go play, stamp your
            family&apos;s passport.{" "}
            <Link
              href="/me#signin"
              className="inline-block py-1 font-semibold whitespace-nowrap underline underline-offset-2"
            >
              Played before? Sign in
            </Link>
          </p>
          <Link
            href="/start"
            className="crayon-btn wax min-h-11 shrink-0 bg-crayon-yellow px-3 text-base"
          >
            Start
          </Link>
        </div>
      )}

      {/* Filters: compact summary, expandable drawer */}
      <section
        aria-label="Filters"
        className={`flex flex-col gap-2 transition-opacity ${spinning ? "opacity-60" : ""}`}
        inert={spinning}
      >
        <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1">
          {signedIn && (
            <button
              className="chip"
              aria-pressed={filters.newOnly}
              onClick={() => setFilters((f) => ({ ...f, newOnly: !f.newOnly }))}
            >
              <Icon name="sparkles" size={22} /> New to us
            </button>
          )}
          <button
            className="chip"
            aria-pressed={filters.radius != null}
            onClick={() => locate(filters.radius ? null : 10)}
            disabled={locating}
          >
            <Icon name="near_me" size={22} />
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
            <Icon name="filter" size={22} /> More
            {activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </div>

        {notice && (
          <p role="status" className="font-hand text-lg text-crayon-red">
            {notice}
          </p>
        )}

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
              <button
                className="chip self-start"
                aria-pressed={filters.allParks}
                onClick={() =>
                  setFilters((f) => ({ ...f, allParks: !f.allParks }))
                }
              >
                <Icon name="park" size={22} /> Parks without playgrounds too
              </button>
              <div className="flex flex-wrap gap-2">
                {SMART_FILTERS.map(({ key: k, label }) => (
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
                    <Icon
                      name={
                        SMART_FILTER_ICONS[k as keyof typeof SMART_FILTER_ICONS]
                      }
                      size={22}
                    />{" "}
                    {label}
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
          everywhere={everywhere}
          onReset={() =>
            // Finished everything in scope? Then the reset has to include
            // visited parks too, or the wheel stays empty.
            setFilters({ ...DEFAULT_FILTERS, newOnly: !everywhere })
          }
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
                <Icon name="shuffle" size={22} /> Shuffle
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
          onStamped={(id) => {
            const m = stampMilestone(everything, id);
            if (m) setMilestone(m);
          }}
        />
      )}

      {milestone && (
        <MilestoneCard milestone={milestone} onClose={closeMilestone} />
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
      <span className="animate-float">
        <Icon name={everywhere ? "trophy" : "search"} size={64} />
      </span>
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
  onStamped,
}: {
  park: ParkSummary;
  here: LatLng | null;
  signedIn: boolean;
  onAgain: () => void;
  onStamped: (parkId: number) => void;
}) {
  const [pending, start] = useTransition();
  const [logged, setLogged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const play = playOf(park);
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
            <span className="inline-flex items-center gap-1 font-hand text-lg">
              <Icon name="car" size={22} />{" "}
              {formatMiles(milesBetween(here, park))}
            </span>
          )}
          {park.reviewCount > 0 && <Stars tenths={park.avgTenths} size={18} />}
          {park.lastVisit && (
            <span className="inline-flex items-center gap-1 font-hand text-lg">
              <Icon name="check" size={20} /> been here
            </span>
          )}
        </div>
        {park.notes && <ParkNote text={park.notes} />}
        {play !== "playground" && (
          <p className="flex items-center justify-center gap-1.5 text-center font-hand text-lg">
            <Icon name={PLAY_ICONS[play]} size={24} />
            {play === "none"
              ? "Just a park, no playground. Bring a ball!"
              : "Nature play: logs, rocks, and dirt."}
          </p>
        )}
        <ReportCard park={park} />
        {park.confidence !== "confirmed" && play === "playground" && (
          <p className="text-center text-sm text-ink-soft">
            <Icon
              name="search"
              size={18}
              className="mr-1 inline-block align-[-4px]"
            />
            We think there&apos;s a playground here. Let us know if we&apos;re
            wrong!
          </p>
        )}
        <div className="mt-1 grid grid-cols-1 gap-3">
          <a
            className="crayon-btn wax bg-crayon-green text-2xl text-white"
            href={directionsUrl(park)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="directions" size={30} /> Let&apos;s go!
          </a>
          <div className="grid grid-cols-2 gap-3">
            <a
              className="crayon-btn bg-paper px-3 text-lg whitespace-nowrap"
              href={placeUrl(park)}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="peek" size={26} /> Peek
            </a>
            <Link
              className="crayon-btn bg-paper px-3 text-lg whitespace-nowrap"
              href={`/parks/${park.slug}`}
            >
              <Icon name="book" size={26} /> Park page
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
                    if (!r.ok) return (sfx.oops(), setError(r.error));
                    sfx.stamp();
                    setLogged(true);
                    onStamped(park.id);
                  })
                }
              >
                {logged ? (
                  <>
                    <Icon name="check" size={26} /> Stamped!
                  </>
                ) : pending ? (
                  "Stamping…"
                ) : (
                  <>
                    <Icon name="stamp" size={26} /> We went!
                  </>
                )}
              </button>
            ) : (
              <Link
                className="crayon-btn bg-paper px-3 text-lg whitespace-nowrap"
                href="/start"
              >
                <Icon name="stamp" size={26} /> Save it
              </Link>
            )}
            <button
              className="crayon-btn wax bg-crayon-pink text-lg"
              onClick={onAgain}
            >
              <Icon name="spin" size={26} /> Again!
            </button>
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
              className="inline-flex min-h-11 items-center justify-center gap-1.5 font-hand text-xl text-crayon-blue underline"
            >
              Now give it some stars <Icon name="star" size={24} />
            </Link>
          )}
        </div>
      </article>
    </div>
  );
}

/** Her one-line description, as a little handwritten note. */
function ParkNote({ text }: { text: string }) {
  return (
    <p className="mx-auto max-w-sm text-center font-hand text-xl leading-snug text-balance">
      &ldquo;{text}&rdquo;
    </p>
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
              className="inline-flex items-center gap-1 rounded-full bg-paper-dark py-0.5 pr-2.5 pl-1.5 text-sm"
            >
              <Icon name={attrIcon(k)} size={20} /> {ATTRIBUTES[k].label}
            </li>
          ))}
        </ul>
      )}
      {heads.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-1.5">
          {heads.map((k) => (
            <li
              key={k}
              className="inline-flex items-center gap-1 rounded-full border-2 border-dashed border-crayon-orange bg-[#fff1e3] py-0.5 pr-2.5 pl-1.5 text-sm"
            >
              <Icon name={attrIcon(k)} size={20} /> {ATTRIBUTES[k].label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
