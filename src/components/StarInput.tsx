"use client";

import confetti from "canvas-confetti";
import rough from "roughjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatStars, toTenths, verdict } from "@/lib/rating";
import { sfx, unlockAudio } from "@/lib/sound";

/**
 * The star crayon. Color the stars in to rate a park, to the tenth.
 *
 *  - tap a star        → that many whole stars
 *  - drag across them  → a crayon follows your finger, tenth by tenth
 *  - the ruler         → nudge .0 – .9 exactly
 *
 * Every tenth plays a note (higher = happier), whole stars pop with
 * sparkles, a doodle face reacts live, and a perfect 5.0 gets fireworks.
 * Starts blank ("?.?") so nobody saves a 0.0 by accident.
 */

const STAR_W = 60;
const GAP = 8;
const W = STAR_W * 5 + GAP * 4;
const H = STAR_W;

const round2 = (n: number) => Math.round(n * 100) / 100;

function starPoints(
  cx: number,
  cy: number,
  outer = 28,
  inner = 12.5,
): [number, number][] {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    // Rounded: Math.cos can differ in the last bits between the server and
    // the phone, which would make React's hydration complain.
    return [round2(cx + r * Math.cos(a)), round2(cy + r * Math.sin(a))] as [
      number,
      number,
    ];
  });
}

const starCenter = (i: number) => i * (STAR_W + GAP) + STAR_W / 2;

/** x position (in viewBox units) of the fill edge for a rating. */
function edgeX(tenths: number) {
  const whole = Math.floor(tenths / 10);
  const part = (tenths % 10) / 10;
  if (whole >= 5) return W;
  return whole * (STAR_W + GAP) + part * STAR_W;
}

/** viewBox x → tenths, so the gaps between stars don't count. */
function tenthsAt(x: number) {
  const slot = STAR_W + GAP;
  const i = Math.min(4, Math.max(0, Math.floor(x / slot)));
  const within = Math.min(1, Math.max(0, (x - i * slot) / STAR_W));
  return toTenths(i + within);
}

// ---------- the component ----------

type Sparkle = { id: number; x: number; angle: number; color: string };

export function StarInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (stars: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tenths = value == null ? null : toTenths(value);
  const [drawing, setDrawing] = useState(false);
  const [popStar, setPopStar] = useState<number | null>(null);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const [bump, setBump] = useState(0);
  const press = useRef<{ x: number; moved: boolean } | null>(null);
  const prev = useRef<number | null>(tenths);
  const sparkleId = useRef(0);

  // Rough.js scribbles: seeded, so the stars look hand-colored but never jitter.
  const art = useMemo(() => {
    const gen = rough.generator();
    return [0, 1, 2, 3, 4].map((i) => {
      const pts = starPoints(starCenter(i), H / 2 + 1);
      const fill = gen.polygon(pts, {
        seed: 40 + i,
        stroke: "none",
        fill: i % 2 ? "#f7b51e" : "#f7c933",
        fillStyle: "hachure",
        hachureAngle: -50 + i * 9,
        hachureGap: 3.4,
        fillWeight: 2.4,
        roughness: 1.6,
      });
      const outline = gen.polygon(pts, {
        seed: 90 + i,
        stroke: "#2b2a33",
        strokeWidth: 2.4,
        roughness: 1.1,
        bowing: 1.5,
      });
      return {
        pts: pts.map((p) => p.join(",")).join(" "),
        fill: gen.toPaths(fill),
        outline: gen.toPaths(outline),
      };
    });
  }, []);

  // React to every change: notes, pops, sparkles, fireworks.
  useEffect(() => {
    const before = prev.current;
    prev.current = tenths;
    if (tenths == null || before === tenths) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    sfx.note(tenths);
    navigator.vibrate?.(3);
    const wholeNow = Math.floor(tenths / 10);
    const wholeBefore = before == null ? 0 : Math.floor(before / 10);
    if (wholeNow > wholeBefore && wholeNow > 0) {
      const i = wholeNow - 1;
      sfx.star(wholeNow);
      setPopStar(i);
      if (!reduce) {
        const colors = ["#f7c933", "#f58a2c", "#ee6aa7", "#2f78d4"];
        setSparkles((s) => [
          ...s.slice(-12),
          ...[0, 1, 2, 3].map((k) => ({
            id: ++sparkleId.current,
            x: starCenter(Math.min(i, 4)),
            angle: k * 90 + 45 + (sparkleId.current % 5) * 6,
            color: colors[(i + k) % colors.length],
          })),
        ]);
      }
    }
    if (tenths === 50 && before !== 50) {
      sfx.fanfare();
      if (!reduce) {
        const box = svgRef.current?.getBoundingClientRect();
        confetti({
          particleCount: 90,
          spread: 100,
          startVelocity: 35,
          shapes: ["star"],
          colors: ["#f7c933", "#f58a2c", "#ffe58a"],
          scalar: 1.3,
          origin: box
            ? {
                x: (box.left + box.width / 2) / window.innerWidth,
                y: (box.top + box.height / 2) / window.innerHeight,
              }
            : { y: 0.5 },
        });
      }
    }
    setBump((b) => b + 1);
  }, [tenths]);

  function toViewX(clientX: number) {
    const box = svgRef.current!.getBoundingClientRect();
    return ((clientX - box.left) / box.width) * (W + 8) - 4;
  }

  function set(t: number) {
    onChange(Math.min(50, Math.max(0, t)) / 10);
  }

  const shown = tenths ?? 0;
  const whole = tenths == null ? null : Math.min(4, Math.floor(tenths / 10));
  const edge = edgeX(shown);

  return (
    <div className="flex w-full flex-col items-center gap-3 select-none">
      {/* face + number */}
      <div className="flex items-center gap-4" aria-live="polite">
        <Face tenths={tenths} />
        <div className="flex min-w-[9.5rem] flex-col items-start">
          <span
            key={bump}
            className="animate-pop-in font-hand text-7xl leading-none tabular-nums"
          >
            {tenths == null ? "?.?" : formatStars(tenths)}
          </span>
          <span className="font-hand text-2xl leading-tight text-ink-soft">
            {tenths == null
              ? "Color in the stars!"
              : tenths === 50
                ? "LEGENDARY!!"
                : verdict(tenths)}
          </span>
        </div>
      </div>

      {/* the stars */}
      <div className="relative w-full max-w-[22rem] pt-6">
        <svg
          ref={svgRef}
          viewBox={`-4 -6 ${W + 8} ${H + 12}`}
          className="w-full cursor-crosshair touch-none overflow-visible outline-none focus-visible:outline-3 focus-visible:outline-crayon-blue focus-visible:outline-dashed"
          role="slider"
          tabIndex={0}
          aria-label="Star rating. Tap a star, or drag to color in tenths."
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={tenths == null ? undefined : tenths / 10}
          aria-valuetext={
            tenths == null ? "Not rated yet" : `${formatStars(tenths)} stars`
          }
          onPointerDown={(e) => {
            unlockAudio();
            e.currentTarget.setPointerCapture(e.pointerId);
            press.current = { x: e.clientX, moved: false };
          }}
          onPointerMove={(e) => {
            const p = press.current;
            if (!p) return;
            if (!p.moved && Math.abs(e.clientX - p.x) < 6) return;
            p.moved = true;
            setDrawing(true);
            set(tenthsAt(toViewX(e.clientX)));
          }}
          onPointerUp={(e) => {
            const p = press.current;
            press.current = null;
            setDrawing(false);
            if (p && !p.moved) {
              // A tap means whole stars: tap the 4th star → 4.0
              const x = toViewX(e.clientX);
              const i = Math.min(
                4,
                Math.max(0, Math.floor((x + GAP / 2) / (STAR_W + GAP))),
              );
              set((i + 1) * 10);
            }
          }}
          onPointerCancel={() => {
            press.current = null;
            setDrawing(false);
          }}
          onKeyDown={(e) => {
            unlockAudio();
            const step = e.shiftKey ? 10 : 1;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              set((tenths ?? 0) + step);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              set((tenths ?? 0) - step);
            } else if (/^[0-5]$/.test(e.key)) {
              set(Number(e.key) * 10);
            }
          }}
        >
          <defs>
            <clipPath id="star-crayon-clip">
              <rect x="-4" y="-6" width={edge + 4} height={H + 12} />
            </clipPath>
          </defs>
          {art.map((a, i) => (
            <g
              key={i}
              style={{
                transformOrigin: `${starCenter(i)}px ${H / 2}px`,
                transformBox: "view-box",
              }}
              className={
                popStar === i
                  ? "animate-[star-pop_0.45s_cubic-bezier(0.2,1.6,0.4,1)]"
                  : ""
              }
              onAnimationEnd={() => setPopStar(null)}
            >
              <polygon points={a.pts} fill="#fff8e1" />
              <g clipPath="url(#star-crayon-clip)">
                <polygon points={a.pts} fill="#fde68a" opacity="0.7" />
                {a.fill.map((p, j) => (
                  <path
                    key={j}
                    d={p.d}
                    stroke={p.stroke}
                    strokeWidth={p.strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                  />
                ))}
              </g>
              {a.outline.map((p, j) => (
                <path
                  key={j}
                  d={p.d}
                  stroke={p.stroke}
                  strokeWidth={p.strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          ))}

          {/* sparkles flying out of a freshly colored star */}
          {sparkles.map((s) => (
            <g key={s.id} transform={`translate(${s.x} ${H / 2})`}>
              <g
                style={{ ["--a" as string]: `${s.angle}deg` }}
                className="animate-[sparkle_0.7s_ease-out_forwards]"
                onAnimationEnd={() =>
                  setSparkles((all) => all.filter((x) => x.id !== s.id))
                }
              >
                <path
                  d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2 Z"
                  fill={s.color}
                  stroke="#2b2a33"
                  strokeWidth="1"
                />
              </g>
            </g>
          ))}

          {/* the crayon, parked right at the coloring edge */}
          {tenths != null && (
            <g
              style={{
                transform: `translate(${Math.min(edge, W - 2)}px, ${H * 0.62}px)`,
                transition: drawing ? "none" : "transform 0.25s ease",
              }}
              pointerEvents="none"
            >
              <g
                className={
                  drawing ? "animate-[scribble_0.12s_linear_infinite]" : ""
                }
              >
                <g transform="rotate(-35) translate(-6 -54)">
                  <rect
                    x="0"
                    y="0"
                    width="12"
                    height="40"
                    rx="2"
                    fill="#f7c933"
                    stroke="#2b2a33"
                    strokeWidth="2"
                  />
                  <rect
                    x="0"
                    y="9"
                    width="12"
                    height="4"
                    fill="#2b2a33"
                    opacity="0.3"
                  />
                  <rect
                    x="0"
                    y="27"
                    width="12"
                    height="4"
                    fill="#2b2a33"
                    opacity="0.3"
                  />
                  <path
                    d="M0 40 L12 40 L6 54 Z"
                    fill="#f4c7a1"
                    stroke="#2b2a33"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path d="M3.6 48.5 L8.4 48.5 L6 54 Z" fill="#f7c933" />
                </g>
              </g>
            </g>
          )}
        </svg>
      </div>

      {/* fine-tune ruler */}
      <div className="flex w-full max-w-[22rem] flex-col items-center gap-1">
        <div
          className="doodle-box-alt flex w-full items-stretch justify-between px-1 py-1"
          role="group"
          aria-label="Fine-tune tenths"
        >
          {Array.from({ length: 10 }, (_, d) => {
            const t = (whole ?? 3) * 10 + d;
            const selected = tenths != null && tenths < 50 && tenths === t;
            return (
              <button
                key={d}
                type="button"
                onClick={() => (unlockAudio(), set(t))}
                aria-label={`${formatStars(t)} stars`}
                aria-pressed={selected}
                className={`relative flex h-11 flex-1 flex-col items-center justify-end rounded-lg font-hand text-base transition-transform active:scale-90 ${
                  selected ? "text-ink" : "text-ink-soft"
                }`}
              >
                {selected && (
                  <span
                    className="wax absolute inset-x-0.5 inset-y-1 rounded-[var(--radius-blob)] border-2 border-[#2b2a33] bg-crayon-yellow"
                    aria-hidden
                  />
                )}
                <span
                  className={`absolute top-0.5 w-[2px] rounded bg-[#2b2a33] ${d === 0 || d === 5 ? "h-4" : "h-2.5"}`}
                  aria-hidden
                />
                <span className="relative">.{d}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => (unlockAudio(), set(50))}
            aria-label="5.0 stars"
            aria-pressed={tenths === 50}
            className={`ml-1 h-11 rounded-lg px-2 font-hand text-base ${
              tenths === 50
                ? "wax border-2 border-[#2b2a33] bg-crayon-yellow"
                : "text-ink-soft"
            }`}
          >
            5★
          </button>
        </div>
        <p className="text-sm text-ink-soft">
          {tenths == null
            ? "Tap a star, or drag the crayon for tenths"
            : `Fine-tune between ${whole}.0 and ${whole}.9`}
        </p>
      </div>

      <style>{`
        @keyframes star-pop { 0% { transform: scale(1) } 45% { transform: scale(1.28) rotate(-8deg) } 100% { transform: scale(1) } }
        @keyframes sparkle {
          from { transform: rotate(var(--a)) translateY(0) scale(0.4); opacity: 1 }
          to { transform: rotate(var(--a)) translateY(-44px) scale(1.1); opacity: 0 }
        }
        @keyframes scribble { 0% { transform: translate(0,0) } 25% { transform: translate(1px,-1.5px) } 50% { transform: translate(-1px,1px) } 75% { transform: translate(1.5px,1px) } 100% { transform: translate(0,0) } }
      `}</style>
    </div>
  );
}

/** A doodle face that goes from grumpy to starry-eyed. */
function Face({ tenths }: { tenths: number | null }) {
  const t = tenths ?? 25;
  const curve = ((t - 25) / 25) * 13; // -13 frown … +13 grin
  const starEyes = tenths != null && tenths >= 48;
  const sad = tenths != null && tenths < 15;
  return (
    <svg
      viewBox="0 0 80 80"
      className={`h-20 w-20 shrink-0 ${tenths === 50 ? "animate-wiggle [animation-iteration-count:3]" : ""}`}
      aria-hidden
    >
      <g filter="url(#wobble)">
        <circle
          cx="40"
          cy="40"
          r="33"
          fill={tenths == null ? "#fff8e1" : "#f7c933"}
          stroke="#2b2a33"
          strokeWidth="3"
        />
        {tenths != null && tenths >= 40 && (
          <>
            <ellipse
              cx="22"
              cy="48"
              rx="6"
              ry="3.5"
              fill="#ee6aa7"
              opacity="0.55"
            />
            <ellipse
              cx="58"
              cy="48"
              rx="6"
              ry="3.5"
              fill="#ee6aa7"
              opacity="0.55"
            />
          </>
        )}
        {tenths == null ? (
          <>
            <circle cx="29" cy="29" r="4" fill="#2b2a33" />
            <circle cx="51" cy="29" r="4" fill="#2b2a33" />
            <circle
              cx="40"
              cy="52"
              r="5"
              fill="none"
              stroke="#2b2a33"
              strokeWidth="3"
            />
          </>
        ) : starEyes ? (
          [29, 51].map((cx) => (
            <path
              key={cx}
              transform={`translate(${cx} 31)`}
              d="M0 -8 L2.4 -2.5 L8 -2.5 L3.5 1.2 L5 7 L0 3.6 L-5 7 L-3.5 1.2 L-8 -2.5 L-2.4 -2.5 Z"
              fill="#e5432f"
              stroke="#2b2a33"
              strokeWidth="1.2"
            />
          ))
        ) : (
          <>
            <circle cx="29" cy={sad ? 33 : 31} r="4" fill="#2b2a33" />
            <circle cx="51" cy={sad ? 33 : 31} r="4" fill="#2b2a33" />
            {sad && (
              <>
                <path
                  d="M22 24 L33 27"
                  stroke="#2b2a33"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d="M58 24 L47 27"
                  stroke="#2b2a33"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </>
            )}
          </>
        )}
        {tenths != null && (
          <path
            d={`M24 ${50 - curve / 3} Q40 ${50 + curve} 56 ${50 - curve / 3}`}
            fill={curve > 8 ? "#fffdf7" : "none"}
            stroke="#2b2a33"
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}
      </g>
    </svg>
  );
}
