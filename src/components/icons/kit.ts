import rough from "roughjs";
import { CRAYONS, type CrayonName } from "@/lib/crayons";

/**
 * The crayon icon kit. Every icon is drawn on a 24-unit grid as a short list
 * of parts, then "colored in" once with a seeded rough.js generator:
 *
 *  - fill(color, d)  a region colored in with a crayon: a faint wash of the
 *                    color plus back-and-forth crayon strokes, nudged a hair
 *                    off the outline the way a kid colors (slightly outside).
 *  - ink(d)          the thick wobbly ink outline (rough.js, low roughness).
 *  - line(d)         a plain stroke, for tiny details rough.js would mangle.
 *  - solid(color, d) a flat fill, for pupils, holes and tiny bits.
 *
 * Output is deterministic (seeded per icon + part), cached per icon, and
 * needs no filters, ids or client JS, so it renders in server components.
 */

export const INK = "#2b2a33";
export const PAPER = "#fffdf7";
/** Outline weight on the 24-unit grid. */
export const INK_W = 2.3;

export type Tone = CrayonName | "ink" | "paper";

export function tone(t: Tone): string {
  if (t === "ink") return INK;
  if (t === "paper") return PAPER;
  return CRAYONS[t];
}

export type Part =
  | {
      kind: "fill";
      color: Tone;
      d: string;
      /** Crayon stroke spacing (default 1.75). */
      gap?: number;
      /** Crayon stroke angle in degrees (default -50). */
      angle?: number;
      t?: string;
    }
  | { kind: "solid"; color: Tone; d: string; t?: string; opacity?: number }
  | {
      kind: "ink";
      d: string;
      w?: number;
      color?: Tone;
      /** 0 = clean geometry, 1 = default wobble. */
      rough?: number;
      t?: string;
    }
  | {
      kind: "line";
      d: string;
      w?: number;
      color?: Tone;
      t?: string;
      dash?: string;
    };

export const fill = (
  color: Tone,
  d: string,
  o: { gap?: number; angle?: number; t?: string } = {},
): Part => ({ kind: "fill", color, d, ...o });
export const solid = (
  color: Tone,
  d: string,
  o: { t?: string; opacity?: number } = {},
): Part => ({ kind: "solid", color, d, ...o });
export const ink = (
  d: string,
  o: { w?: number; color?: Tone; rough?: number; t?: string } = {},
): Part => ({ kind: "ink", d, ...o });
export const line = (
  d: string,
  o: { w?: number; color?: Tone; t?: string; dash?: string } = {},
): Part => ({ kind: "line", d, ...o });

/** Fill + outline of the same shape, the most common pairing. */
export const shape = (
  color: Tone,
  d: string,
  o: { gap?: number; angle?: number; t?: string; w?: number } = {},
): Part[] =>
  color === "paper" || color === "ink"
    ? [solid(color, d, { t: o.t }), ink(d, { t: o.t, w: o.w })]
    : [fill(color, d, o), ink(d, { t: o.t, w: o.w })];

// ---------- geometry helpers (24-unit grid) ----------

const n = (v: number) => +v.toFixed(2);

export function circle(cx: number, cy: number, r: number) {
  return `M${n(cx - r)} ${n(cy)} A${r} ${r} 0 1 0 ${n(cx + r)} ${n(cy)} A${r} ${r} 0 1 0 ${n(cx - r)} ${n(cy)} Z`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number) {
  return `M${n(cx - rx)} ${n(cy)} A${rx} ${ry} 0 1 0 ${n(cx + rx)} ${n(cy)} A${rx} ${ry} 0 1 0 ${n(cx - rx)} ${n(cy)} Z`;
}

export function rect(x: number, y: number, w: number, h: number, r = 0) {
  if (!r)
    return `M${x} ${y} L${n(x + w)} ${y} L${n(x + w)} ${n(y + h)} L${x} ${n(y + h)} Z`;
  return [
    `M${n(x + r)} ${y}`,
    `L${n(x + w - r)} ${y}`,
    `Q${n(x + w)} ${y} ${n(x + w)} ${n(y + r)}`,
    `L${n(x + w)} ${n(y + h - r)}`,
    `Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}`,
    `L${n(x + r)} ${n(y + h)}`,
    `Q${x} ${n(y + h)} ${x} ${n(y + h - r)}`,
    `L${x} ${n(y + r)}`,
    `Q${x} ${y} ${n(x + r)} ${y}`,
    "Z",
  ].join(" ");
}

export function poly(...pts: [number, number][]) {
  return `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L")} Z`;
}

export function star(cx: number, cy: number, outer: number, inner: number) {
  const pts: [number, number][] = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  return poly(...pts);
}

/** A four-point sparkle. */
export function sparkle(cx: number, cy: number, r: number) {
  const k = r * 0.28;
  return `M${n(cx)} ${n(cy - r)} Q${n(cx + k)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} Q${n(cx + k)} ${n(cy + k)} ${n(cx)} ${n(cy + r)} Q${n(cx - k)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} Q${n(cx - k)} ${n(cy - k)} ${n(cx)} ${n(cy - r)} Z`;
}

/** Pie wedge from angle a0 to a1 (degrees, 0 = up, clockwise). */
export function wedge(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
) {
  const p = (a: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return `${n(cx + r * Math.cos(rad))} ${n(cy + r * Math.sin(rad))}`;
  };
  return `M${cx} ${cy} L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`;
}

// ---------- compile ----------

export type Mark = {
  d: string;
  fill?: string;
  stroke?: string;
  sw?: number;
  opacity?: number;
  t?: string;
  dash?: string;
  rule?: "evenodd";
};

/** How far the crayon strays from the lines. */
const STRAY = "translate(0.3 0.35)";

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 2147483646) + 1;
}

const trim = (d: string) => d.replace(/-?\d+\.\d+/g, (m) => String(n(+m)));

const gen = rough.generator();

export function compile(name: string, parts: Part[]): Mark[] {
  const marks: Mark[] = [];
  parts.forEach((p, i) => {
    const seed = hash(`${name}:${i}`);
    if (p.kind === "fill") {
      const color = tone(p.color);
      const t = p.t ? `${p.t} ${STRAY}` : STRAY;
      marks.push({ d: p.d, fill: color, opacity: 0.38, t, rule: "evenodd" });
      const drawable = gen.path(p.d, {
        seed,
        stroke: "none",
        fill: color,
        fillStyle: "zigzag",
        fillWeight: 1.15,
        hachureGap: p.gap ?? 1.75,
        hachureAngle: (p.angle ?? -50) + ((seed % 9) - 4),
        roughness: 0.6,
        maxRandomnessOffset: 0.35,
        disableMultiStrokeFill: true,
      });
      for (const info of gen.toPaths(drawable)) {
        if (info.stroke === "none") continue;
        marks.push({
          d: trim(info.d),
          stroke: color,
          sw: 1.15,
          opacity: 0.92,
          t,
        });
      }
    } else if (p.kind === "solid") {
      marks.push({ d: p.d, fill: tone(p.color), t: p.t, opacity: p.opacity });
    } else if (p.kind === "ink") {
      const r = p.rough ?? 1;
      const color = tone(p.color ?? "ink");
      const sw = p.w ?? INK_W;
      if (r === 0) {
        marks.push({ d: p.d, stroke: color, sw, t: p.t });
        return;
      }
      const drawable = gen.path(p.d, {
        seed,
        stroke: color,
        strokeWidth: sw,
        roughness: 0.55 * r,
        bowing: 0.6,
        maxRandomnessOffset: 0.55 * r,
        disableMultiStroke: true,
        preserveVertices: true,
      });
      for (const info of gen.toPaths(drawable)) {
        if (info.stroke === "none") continue;
        marks.push({ d: trim(info.d), stroke: color, sw, t: p.t });
      }
    } else {
      marks.push({
        d: p.d,
        stroke: tone(p.color ?? "ink"),
        sw: p.w ?? INK_W,
        t: p.t,
        dash: p.dash,
      });
    }
  });
  return marks;
}
