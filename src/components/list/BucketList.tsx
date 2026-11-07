"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import { logVisit, setParkPlay, setParkStatus } from "@/lib/actions";
import { CRAYONS, townCrayon } from "@/lib/crayons";
import type { ParkSummary } from "@/lib/data";
import {
  ATTRIBUTES,
  CROSS_OFF_KEYS,
  CROSS_OFF_REASONS,
  PLAY_TYPES,
  SMART_FILTERS,
  attributeScores,
  hasPlayground,
  isCrossedOff,
  matchesSmartFilter,
  playOf,
  tally,
} from "@/lib/features";
import { formatMiles, milesBetween, type LatLng } from "@/lib/geo";
import { stampMilestone, type Milestone } from "@/lib/milestones";
import { formatStars } from "@/lib/rating";
import { MilestoneCard } from "../Milestone";
import { PageTitle } from "../PageTitle";
import { sfx } from "@/lib/sound";

type Show = "all" | "todo" | "done" | "crossed";
type Sort = "town" | "near";

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function state(p: ParkSummary): "todo" | "done" | "crossed" {
  if (isCrossedOff(p)) return "crossed";
  return p.lastVisit ? "done" : "todo";
}

export function BucketList({
  parks: allParks,
  signedIn,
}: {
  parks: ParkSummary[];
  signedIn: boolean;
}) {
  const [mode, setMode] = useState<"playgrounds" | "all">("playgrounds");
  const parks = useMemo(
    () => (mode === "all" ? allParks : allParks.filter(hasPlayground)),
    [allParks, mode],
  );
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("town");
  const [smart, setSmart] = useState<string[]>([]);
  const [here, setHere] = useState<LatLng | null>(null);
  const [menuFor, setMenuFor] = useState<ParkSummary | null>(null);
  const [toast, setToast] = useState<{ text: string; href?: string } | null>(
    null,
  );
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const closeMilestone = useCallback(() => setMilestone(null), []);

  const done = parks.filter((p) => state(p) === "done").length;
  const crossed = parks.filter((p) => state(p) === "crossed").length;
  const total = parks.length;
  const resolved = done + crossed;
  // The other count on her paper list ("Y of 90 parks total"), and vice versa.
  const other =
    mode === "all"
      ? tally(allParks.filter(hasPlayground), (p) => !!p.lastVisit)
      : tally(allParks, (p) => !!p.lastVisit);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return parks.filter((p) => {
      if (show !== "all" && state(p) !== show) return false;
      if (needle && !`${p.name} ${p.city}`.toLowerCase().includes(needle))
        return false;
      const scores = attributeScores(p.features, p.reports);
      return smart.every((k) => matchesSmartFilter(k, scores));
    });
  }, [parks, q, show, smart]);

  const groups = useMemo(() => {
    if (sort === "near" && here) {
      const sorted = [...visible].sort(
        (a, b) => milesBetween(here, a) - milesBetween(here, b),
      );
      return [{ town: "Closest first", parks: sorted }];
    }
    const byTown = new Map<string, ParkSummary[]>();
    for (const p of visible)
      byTown.set(p.city, [...(byTown.get(p.city) ?? []), p]);
    // Inside a town: to-do first, then colored in, then crossed off.
    const order = { todo: 0, done: 1, crossed: 2 };
    return [...byTown.entries()].map(([town, ps]) => ({
      town,
      parks: ps.sort(
        (a, b) =>
          order[state(a)] - order[state(b)] || a.name.localeCompare(b.name),
      ),
    }));
  }, [visible, sort, here]);

  const townTotals = useMemo(() => {
    const m = new Map<string, { total: number; resolved: number }>();
    for (const p of parks) {
      const t = m.get(p.city) ?? { total: 0, resolved: 0 };
      t.total++;
      if (state(p) !== "todo") t.resolved++;
      m.set(p.city, t);
    }
    return m;
  }, [parks]);

  function nearMe() {
    if (sort === "near") return setSort("town");
    if (here) return setSort("near");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSort("near");
      },
      () =>
        setToast({ text: "Couldn't find you. Check location permissions." }),
      { timeout: 10000, maximumAge: 300000 },
    );
  }

  function flash(t: { text: string; href?: string }) {
    setToast(t);
    setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 4000);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        lead="The"
        accent="Bucket List"
        color="blue"
        underline="green"
        subtitle={
          <p className="text-balance">
            Every playground in Central Oregon. Every last one.
          </p>
        }
      />

      <div
        role="tablist"
        aria-label="What counts"
        className="doodle-box-alt mx-auto grid w-full max-w-sm grid-cols-2 p-1"
      >
        {(
          [
            ["playgrounds", "🛝 Playgrounds"],
            ["all", "🌳 Every park"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={`min-h-11 rounded-[var(--radius-wobbly)] font-hand text-xl transition-colors ${
              mode === k
                ? "wax bg-crayon-yellow shadow-[2px_2px_0_#2b2a33]"
                : ""
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ProgressCard
        noun={mode === "all" ? "parks" : "playgrounds"}
        total={total}
        done={done}
        crossed={crossed}
        resolved={resolved}
        other={
          other.total > 0 && other.total !== total
            ? `${mode === "all" ? "🛝" : "🌳"} ${other.done} of ${other.total} ${mode === "all" ? "playgrounds" : "parks total"}`
            : null
        }
      />

      {/* Sticky search + filters */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-2 bg-paper/95 px-4 pt-2 pb-2 backdrop-blur">
        <input
          className="field"
          type="search"
          placeholder="🔍 Find a park or town…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search parks"
        />
        <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1">
          {(
            [
              ["all", `All ${total}`],
              ["todo", `To do ${total - resolved}`],
              ["done", `✅ Visited ${done}`],
              ["crossed", `✗ Crossed off ${crossed}`],
            ] as [Show, string][]
          )
            .filter(([k]) => k !== "crossed" || crossed > 0 || show === k)
            .map(([k, label]) => (
              <button
                key={k}
                className="chip"
                aria-pressed={show === k}
                onClick={() => setShow(k)}
              >
                {label}
              </button>
            ))}
          <button
            className="chip"
            aria-pressed={sort === "near"}
            onClick={nearMe}
          >
            📍 Nearest
          </button>
        </div>
        <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1">
          {SMART_FILTERS.map((f) => (
            <button
              key={f.key}
              className="chip text-base"
              aria-pressed={smart.includes(f.key)}
              onClick={() =>
                setSmart((s) =>
                  s.includes(f.key)
                    ? s.filter((x) => x !== f.key)
                    : [...s, f.key],
                )
              }
            >
              {f.emoji} {f.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 && (
        <div className="doodle-box flex flex-col items-center gap-2 p-8 text-center">
          <span className="text-5xl">🔎</span>
          <p className="font-hand text-2xl">Nothing matches that.</p>
          <button
            className="font-hand text-lg text-crayon-blue underline"
            onClick={() => (setQ(""), setShow("all"), setSmart([]))}
          >
            Show everything
          </button>
        </div>
      )}

      {groups.map(({ town, parks: ps }) => {
        const tt = townTotals.get(town);
        const color = CRAYONS[townCrayon(town)];
        return (
          <section key={town} aria-label={town} className="flex flex-col gap-1">
            <div className="flex items-end justify-between gap-3 px-1">
              <h2 className="flex items-center gap-2 text-3xl">
                {sort !== "near" && (
                  <span
                    className="wax inline-block h-5 w-5 rotate-6"
                    style={{
                      background: color,
                      borderRadius: "var(--radius-blob)",
                    }}
                  />
                )}
                {town}
              </h2>
              {tt && sort !== "near" && (
                <span className="font-hand text-lg text-ink-soft">
                  {tt.resolved === tt.total
                    ? "🏆 all done!"
                    : `${tt.resolved}/${tt.total}`}
                </span>
              )}
            </div>
            {tt && sort !== "near" && (
              <MiniBar value={tt.resolved / tt.total} color={color} />
            )}
            <ul className="doodle-box-alt mt-1 divide-y-2 divide-dashed divide-[#2b2a33]/15 px-1">
              {ps.map((p) => (
                <Row
                  key={p.id}
                  park={p}
                  here={sort === "near" ? here : null}
                  signedIn={signedIn}
                  onMenu={() => setMenuFor(p)}
                  onStamped={() => {
                    const m = stampMilestone(allParks, p.id);
                    if (m) setMilestone(m);
                    flash({
                      text: `Stamped ${p.name}! ${resolved + 1} of ${total} done.`,
                      href: `/parks/${p.slug}#review`,
                    });
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {signedIn && (
        <Link
          href="/parks/new"
          className="crayon-btn wax self-center bg-crayon-yellow"
        >
          ➕ Add a missing park
        </Link>
      )}

      {menuFor && (
        <CrossOffSheet
          park={menuFor}
          signedIn={signedIn}
          onClose={() => setMenuFor(null)}
          onDone={(text) => (setMenuFor(null), flash({ text }))}
        />
      )}

      {milestone && (
        <MilestoneCard milestone={milestone} onClose={closeMilestone} />
      )}

      {toast && (
        <div
          role="status"
          className="doodle-box fixed inset-x-4 bottom-28 z-[1001] mx-auto flex max-w-md animate-pop-in items-center justify-between gap-3 bg-[#fffdf7] px-4 py-3 shadow-[3px_4px_0_#2b2a33]"
        >
          <span className="font-hand text-lg">{toast.text}</span>
          {toast.href && (
            <Link
              href={toast.href}
              className="shrink-0 font-hand text-lg text-crayon-blue underline"
            >
              Rate it ⭐
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressCard({
  noun,
  total,
  done,
  crossed,
  resolved,
  other,
}: {
  noun: string;
  total: number;
  done: number;
  crossed: number;
  resolved: number;
  /** The other count, e.g. "🌳 4 of 9 parks total". */
  other: string | null;
}) {
  const pct = total ? Math.round((resolved / total) * 100) : 0;
  return (
    <div className="doodle-box relative flex flex-col gap-2 p-4 shadow-[3px_4px_0_#2b2a33]">
      <div className="flex items-end justify-between">
        <p className="font-hand text-6xl leading-none">
          {resolved}
          <span className="text-2xl text-ink-soft">
            {" "}
            / {total} {noun}
          </span>
        </p>
        <p className="font-hand text-3xl text-crayon-green">
          {total > 0 && resolved === total ? "🏆 100%!" : `${pct}% done`}
        </p>
      </div>
      {/* the bar: green = colored in, gray scribble = crossed off */}
      <svg
        viewBox="0 0 300 26"
        className="h-7 w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <rect
          x="2"
          y="3"
          width="296"
          height="20"
          rx="9"
          fill="#fffdf7"
          stroke="#2b2a33"
          strokeWidth="2.5"
          filter="url(#wobble)"
        />
        {total > 0 && (
          <>
            <rect
              x="5"
              y="6"
              width={Math.max(0, (290 * done) / total)}
              height="14"
              rx="6"
              fill="#3aa35b"
              filter="url(#crayon)"
            />
            <rect
              x={5 + (290 * done) / total}
              y="6"
              width={(290 * crossed) / total}
              height="14"
              rx="6"
              fill="#9a98a6"
              filter="url(#crayon)"
            />
          </>
        )}
      </svg>
      <p className="font-hand text-lg text-ink-soft">
        ✅ {done} colored in{crossed > 0 ? ` · ✗ ${crossed} crossed off` : ""} ·{" "}
        {total - resolved} to go
      </p>
      {other && (
        <p className="-mt-1 font-hand text-lg text-ink-soft">{other}</p>
      )}
    </div>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="mx-1 h-2 overflow-hidden rounded-full border-2 border-[#2b2a33]/70 bg-[#fffdf7]">
      <div
        className="wax h-full rounded-full transition-[width]"
        style={{ width: `${value * 100}%`, background: color }}
      />
    </div>
  );
}

function Row({
  park,
  here,
  signedIn,
  onMenu,
  onStamped,
}: {
  park: ParkSummary;
  here: LatLng | null;
  signedIn: boolean;
  onMenu: () => void;
  onStamped: () => void;
}) {
  const [pending, start] = useTransition();
  const [justChecked, setJustChecked] = useState(false);
  const s = justChecked ? "done" : state(park);
  const headsUps = Object.entries(attributeScores(park.features, park.reports))
    .filter(([k, n]) => n > 0 && ATTRIBUTES[k]?.kind === "heads_up")
    .map(([k]) => ATTRIBUTES[k]);

  return (
    <li className="flex items-center gap-2 py-1.5">
      <button
        className="grid h-12 w-12 shrink-0 place-items-center"
        aria-label={
          s === "todo"
            ? `Mark ${park.name} as visited today`
            : s === "done"
              ? "Visited"
              : "Crossed off"
        }
        disabled={pending || s !== "todo" || !signedIn}
        onClick={() =>
          start(async () => {
            const r = await logVisit({
              parkId: park.id,
              visitedOn: todayLocal(),
            });
            if (r.ok) {
              sfx.stamp();
              setJustChecked(true);
              navigator.vibrate?.(15);
              onStamped();
            }
          })
        }
      >
        <CheckBox state={s} pending={pending} />
      </button>
      <Link href={`/parks/${park.slug}`} className="min-w-0 flex-1 py-1">
        <span
          className={`relative inline-block max-w-full text-lg leading-tight ${s === "crossed" ? "text-ink-soft" : ""}`}
        >
          <span className="block truncate">{park.name}</span>
          {s === "crossed" && <Strike />}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
          {s === "crossed" ? (
            <span>
              {
                CROSS_OFF_REASONS[park.status as keyof typeof CROSS_OFF_REASONS]
                  ?.emoji
              }{" "}
              {CROSS_OFF_REASONS[park.status as keyof typeof CROSS_OFF_REASONS]
                ?.label ?? "Crossed off"}
            </span>
          ) : (
            <>
              {playOf(park) !== "playground" && (
                <span>
                  {PLAY_TYPES[playOf(park)].emoji}{" "}
                  {PLAY_TYPES[playOf(park)].label}
                </span>
              )}
              {park.avgTenths != null && (
                <span>⭐ {formatStars(park.avgTenths)}</span>
              )}
              {here && <span>🚗 {formatMiles(milesBetween(here, park))}</span>}
              {here && <span>{park.city}</span>}
              {park.lastVisit && (
                <span>
                  visited{" "}
                  {new Date(`${park.lastVisit}T12:00`).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric" },
                  )}
                </span>
              )}
              {headsUps.slice(0, 2).map((a) => (
                <span
                  key={a.label}
                  className="text-crayon-orange"
                  title={a.label}
                >
                  {a.emoji} {a.label}
                </span>
              ))}
            </>
          )}
        </span>
      </Link>
      <button
        className="grid h-11 w-11 shrink-0 place-items-center font-hand text-2xl text-ink-soft"
        aria-label={`More for ${park.name}`}
        onClick={onMenu}
      >
        ⋯
      </button>
    </li>
  );
}

function CheckBox({
  state,
  pending,
}: {
  state: "todo" | "done" | "crossed";
  pending: boolean;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={`h-9 w-9 ${pending ? "animate-wiggle" : ""}`}
      aria-hidden
    >
      <path
        d="M7 8 C 15 6, 26 7, 33 7 C 34 15, 33 25, 34 33 C 25 34, 14 33, 6 34 C 7 25, 6 15, 7 8 Z"
        fill={state === "done" ? "#e6f5ea" : "#fffdf7"}
        stroke="#2b2a33"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {state === "done" && (
        <path
          d="M10 21 L 17 29 L 36 4"
          fill="none"
          stroke="#3aa35b"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="draw-in"
          style={{ ["--len" as string]: 60 }}
          filter="url(#crayon)"
        />
      )}
      {state === "crossed" && (
        <g
          stroke="#9a98a6"
          strokeWidth="4"
          strokeLinecap="round"
          filter="url(#crayon)"
        >
          <path d="M11 11 L 29 29" />
          <path d="M29 11 L 11 29" />
        </g>
      )}
    </svg>
  );
}

/** A scribbled-out line through a crossed-off park name. */
function Strike() {
  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 top-1/2 h-3 w-full -translate-y-1/2"
      aria-hidden
    >
      <path
        d="M1 6 C 20 3, 40 8, 60 4 S 90 6, 99 4 M3 7 C 30 5, 70 8, 97 6"
        stroke="#e5432f"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CrossOffSheet({
  park,
  signedIn,
  onClose,
  onDone,
}: {
  park: ParkSummary;
  signedIn: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [pending, start] = useTransition();
  const crossed = isCrossedOff(park);
  const play = playOf(park);
  const act = (status: "active" | keyof typeof CROSS_OFF_REASONS) =>
    start(async () => {
      const r = await setParkStatus({ parkId: park.id, status });
      if (!r.ok) sfx.oops();
      else if (status === "active") sfx.undo();
      else if (status === "no_playground") sfx.scribble();
      else sfx.strike();
      onDone(
        !r.ok
          ? r.error
          : status === "active"
            ? `${park.name} is back on the list!`
            : status === "no_playground"
              ? `Fixed! ${park.name} is a park without a playground.`
              : `Crossed off ${park.name}. One less to go!`,
      );
    });
  const hasPlayground = () =>
    start(async () => {
      const r = await setParkPlay({ parkId: park.id, play: "playground" });
      if (r.ok) sfx.pop();
      else sfx.oops();
      onDone(r.ok ? `Ooh! ${park.name} has a playground now.` : r.error);
    });

  return (
    <div
      className="fixed inset-0 z-[1002] flex items-end bg-[#2b2a33]/30"
      onClick={onClose}
    >
      <div
        className="doodle-box mx-auto mb-4 flex w-[calc(100%-2rem)] max-w-md animate-pop-in flex-col gap-3 p-5 pb-6 shadow-[4px_5px_0_#2b2a33]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Options for ${park.name}`}
      >
        <h3 className="text-3xl">{park.name}</h3>
        <Link
          href={`/parks/${park.slug}`}
          className="crayon-btn bg-paper text-lg"
        >
          📖 Open park page
        </Link>
        {!signedIn ? (
          <p className="text-ink-soft">
            Join a crew to cross parks off the list.
          </p>
        ) : crossed ? (
          <>
            {park.statusNote && (
              <p className="text-ink-soft">{park.statusNote}</p>
            )}
            <button
              className="crayon-btn wax bg-crayon-green text-lg text-white"
              disabled={pending}
              onClick={() => act("active")}
            >
              ↩️ Put it back on the list
            </button>
          </>
        ) : (
          <>
            <p className="font-hand text-xl text-ink-soft">
              Something off? Fix the list.
            </p>
            {play === "none" ? (
              <button
                className="crayon-btn wax justify-start bg-crayon-green text-lg text-white"
                disabled={pending}
                onClick={hasPlayground}
              >
                🛝 Actually, there&apos;s a playground!
              </button>
            ) : (
              <button
                className="crayon-btn justify-start bg-paper text-lg"
                disabled={pending}
                onClick={() => act("no_playground")}
              >
                🌳 No playground, just a park
              </button>
            )}
            <p className="mt-1 text-sm text-ink-soft">
              Gone for good? Cross it off. It still counts as done.
            </p>
            {CROSS_OFF_KEYS.map((k) => (
              <button
                key={k}
                className="crayon-btn justify-start bg-paper text-lg"
                disabled={pending}
                onClick={() => act(k)}
              >
                {CROSS_OFF_REASONS[k].emoji} {CROSS_OFF_REASONS[k].label}
              </button>
            ))}
          </>
        )}
        <button
          className="min-h-11 font-hand text-lg text-ink-soft underline"
          onClick={onClose}
        >
          Never mind
        </button>
      </div>
    </div>
  );
}
