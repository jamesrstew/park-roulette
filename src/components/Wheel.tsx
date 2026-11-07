"use client";

import rough from "roughjs";
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { crayon } from "@/lib/crayons";

export type WheelItem = { id: number; label: string; color: string };
export type WheelHandle = { spin: (velocity?: number) => void };

type Props = {
  items: WheelItem[];
  onSpinStart?: () => void;
  onResult: (id: number) => void;
  disabled?: boolean;
};

const SIZE = 360;
const C = SIZE / 2;
const R = 160;
/** Radial room for a label between the hub and the rim. */
const LABEL_SPACE = 92;

function wedgePath(i: number, n: number) {
  const seg = (Math.PI * 2) / n;
  const a0 = i * seg - Math.PI / 2;
  const a1 = a0 + seg;
  const x0 = C + R * Math.cos(a0);
  const y0 = C + R * Math.sin(a0);
  const x1 = C + R * Math.cos(a1);
  const y1 = C + R * Math.sin(a1);
  const large = seg > Math.PI ? 1 : 0;
  return `M${C},${C} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z`;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Tiny "tick" made with WebAudio so we ship no sound files. */
function useTicker() {
  const ctxRef = useRef<AudioContext | null>(null);
  return {
    unlock() {
      if (!ctxRef.current && typeof window !== "undefined") {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (Ctor) ctxRef.current = new Ctor();
      }
      void ctxRef.current?.resume();
    },
    tick(pitch = 1) {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(900 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(380 * pitch, t + 0.04);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    },
    tada() {
      const ctx = ctxRef.current;
      if (!ctx) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const t = ctx.currentTime + i * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.26);
      });
    },
  };
}

/** Ease out with a tiny overshoot so the wheel "settles" like a real one. */
function settle(t: number) {
  const c1 = 0.9;
  const c3 = c1 + 1;
  const back = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  const quart = 1 - Math.pow(1 - t, 4);
  return t < 0.85 ? quart * 0.6 + back * 0.4 : back;
}

export const Wheel = forwardRef<WheelHandle, Props>(function Wheel(
  { items, onSpinStart, onResult, disabled },
  ref,
) {
  const rotor = useRef<SVGGElement>(null);
  const pointer = useRef<SVGGElement>(null);
  const rotation = useRef(0);
  const spinning = useRef(false);
  const drag = useRef<{
    startAngle: number;
    startRot: number;
    lastAngle: number;
    lastT: number;
    vel: number;
  } | null>(null);
  const ticker = useTicker();
  const n = items.length;
  const seg = 360 / Math.max(n, 1);

  // Rough.js gives each wedge a scribbled crayon fill. Seeded, so it doesn't jitter between renders.
  const wedges = useMemo(() => {
    const gen = rough.generator();
    return items.map((item, i) => {
      const d = wedgePath(i, n);
      const color = crayon(item.color);
      const drawable = gen.path(d, {
        seed: 17 + i * 7,
        roughness: 1.4,
        bowing: 1.2,
        stroke: "#2b2a33",
        strokeWidth: 2.2,
        fill: color,
        fillStyle: i % 2 ? "zigzag" : "hachure",
        hachureGap: 4.5,
        hachureAngle: (i * seg + seg / 2) % 180,
        fillWeight: 2.6,
      });
      return { item, d, color, paths: gen.toPaths(drawable) };
    });
  }, [items, n, seg]);

  function setRotation(deg: number) {
    rotation.current = deg;
    rotor.current?.setAttribute("transform", `rotate(${deg} ${C} ${C})`);
  }

  function indexAt(deg: number) {
    const a = (((-deg % 360) + 360) % 360) / seg;
    return Math.floor(a) % n;
  }

  function flickPointer() {
    const p = pointer.current;
    if (!p) return;
    p.animate(
      [
        { transform: "rotate(0deg)" },
        { transform: "rotate(-18deg)" },
        { transform: "rotate(0deg)" },
      ],
      {
        duration: 110,
        easing: "ease-out",
      },
    );
  }

  function spin(velocity = 0) {
    if (spinning.current || disabled || n === 0) return;
    spinning.current = true;
    ticker.unlock();
    onSpinStart?.();
    const winner = Math.floor(Math.random() * n);
    const jitter = (Math.random() - 0.5) * seg * 0.7;
    const landAt = -(winner * seg + seg / 2 + jitter);
    const start = rotation.current;
    const extra =
      360 *
      (5 + Math.min(4, Math.abs(velocity) * 3) + Math.floor(Math.random() * 2));
    const target = start + extra + ((((landAt - start) % 360) + 360) % 360);
    const duration = 4600 + Math.random() * 900;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const t0 = performance.now();
    let lastIdx = indexAt(start);

    const frame = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - t0) / duration);
      const deg = start + (target - start) * settle(t);
      setRotation(deg);
      const idx = indexAt(deg);
      if (idx !== lastIdx) {
        lastIdx = idx;
        ticker.tick(1 + (1 - t) * 0.3);
        flickPointer();
        if (t > 0.6) navigator.vibrate?.(4);
      }
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        spinning.current = false;
        ticker.tada();
        navigator.vibrate?.([20, 40, 30]);
        onResult(items[indexAt(deg)].id);
      }
    };
    requestAnimationFrame(frame);
  }

  useImperativeHandle(ref, () => ({ spin }));

  // Grab-and-flick: drag the wheel around, let go fast enough and it spins.
  function angleOf(e: React.PointerEvent) {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = e.clientX - (box.left + box.width / 2);
    const y = e.clientY - (box.top + box.height / 2);
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  const labelSize = n > 10 ? 13 : n > 6 ? 15 : 18;
  const labelChars = n > 10 ? 15 : n > 6 ? 17 : 20;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(92vw,420px)] select-none">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE + 10}`}
        className="h-full w-full touch-none overflow-visible"
        onPointerDown={(e) => {
          if (spinning.current || disabled) return;
          ticker.unlock();
          e.currentTarget.setPointerCapture(e.pointerId);
          const a = angleOf(e);
          drag.current = {
            startAngle: a,
            startRot: rotation.current,
            lastAngle: a,
            lastT: performance.now(),
            vel: 0,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const a = angleOf(e);
          let delta = a - d.lastAngle;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          const now = performance.now();
          d.vel = delta / Math.max(1, now - d.lastT);
          d.lastAngle = a;
          d.lastT = now;
          setRotation(rotation.current + delta);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d && Math.abs(d.vel) > 0.25) spin(d.vel);
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        {/* shadow */}
        <ellipse
          cx={C + 6}
          cy={C + 10}
          rx={R + 8}
          ry={R + 6}
          fill="#2b2a33"
          opacity="0.12"
        />
        {/* The rim is round, so it sits outside the rotor: its filter is drawn
            once instead of on every frame of a spin. */}
        <circle
          cx={C}
          cy={C}
          r={R + 10}
          fill="#fffdf7"
          stroke="#2b2a33"
          strokeWidth="3"
          filter="url(#wobble)"
        />
        <g ref={rotor} style={{ willChange: "transform" }}>
          {wedges.map(({ item, d, color, paths }, i) => {
            const mid = i * seg + seg / 2 - 90;
            const label = truncate(
              item.label.replace(/ Park$/, ""),
              labelChars,
            );
            return (
              <g key={item.id}>
                <path d={d} fill={color} opacity="0.32" />
                {paths.map((p, j) => (
                  <path
                    key={j}
                    d={p.d}
                    stroke={p.stroke}
                    strokeWidth={p.strokeWidth}
                    fill={p.fill ?? "none"}
                    strokeLinecap="round"
                  />
                ))}
                <g transform={`rotate(${mid} ${C} ${C})`}>
                  <text
                    x={C + R - 14}
                    y={C}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="font-hand"
                    fontSize={labelSize}
                    fill="#2b2a33"
                    stroke="#fffdf7"
                    strokeWidth="4"
                    paintOrder="stroke"
                    strokeLinejoin="round"
                    {...(label.length * labelSize * 0.47 > LABEL_SPACE
                      ? {
                          textLength: LABEL_SPACE,
                          lengthAdjust: "spacingAndGlyphs",
                        }
                      : {})}
                  >
                    {label}
                  </text>
                </g>
              </g>
            );
          })}
          {/* pegs */}
          {items.map((_, i) => {
            const a = ((i * seg - 90) * Math.PI) / 180;
            return (
              <circle
                key={i}
                cx={C + (R + 3) * Math.cos(a)}
                cy={C + (R + 3) * Math.sin(a)}
                r="4.5"
                fill="#f7c933"
                stroke="#2b2a33"
                strokeWidth="2"
              />
            );
          })}
        </g>
        {/* pointer: a crayon pointing down at the winner */}
        <g
          ref={pointer}
          style={{ transformOrigin: `${C}px 8px`, transformBox: "view-box" }}
        >
          <g transform={`translate(${C - 14} -18)`} filter="url(#wobble)">
            <rect
              x="4"
              y="0"
              width="20"
              height="30"
              rx="3"
              fill="#e5432f"
              stroke="#2b2a33"
              strokeWidth="2.5"
            />
            <rect
              x="4"
              y="7"
              width="20"
              height="5"
              fill="#2b2a33"
              opacity="0.35"
            />
            <rect
              x="4"
              y="19"
              width="20"
              height="5"
              fill="#2b2a33"
              opacity="0.35"
            />
            <path
              d="M4 30 L24 30 L14 50 Z"
              fill="#f4c7a1"
              stroke="#2b2a33"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d="M10.5 43 L17.5 43 L14 50 Z"
              fill="#e5432f"
              stroke="#2b2a33"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </svg>
      {/* hub button */}
      <button
        type="button"
        onClick={() => spin(0)}
        disabled={disabled || n === 0}
        className="crayon-btn wax absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-[calc(50%+5px)] rounded-full! bg-crayon-yellow p-0 font-sketch text-3xl font-bold"
        style={{ borderRadius: "50% 48% 52% 50% / 48% 52% 50% 50%" }}
        aria-label="Spin the wheel"
      >
        SPIN!
      </button>
    </div>
  );
});
