import rough from "roughjs";
import { CRAYONS } from "./crayons";

/**
 * The app icon: the Park Roulette wheel, colored in with crayon like the one
 * in the app. Drawn as an SVG string (rough.js, seeded so it never changes),
 * then rasterized by the icon routes.
 *
 *  - full-bleed warm paper: iOS rounds the corners itself and turns any
 *    transparency black, so the square is always filled
 *  - six big wedges: readable down to the 60pt Home Screen size
 *  - `safe` shrinks the art into Android's maskable safe zone (inner 80%)
 *  - `tiny` (favicons) skips the crayon hatching, which is just noise at 32px
 */
const INK = "#2b2a33";
const WEDGES = [
  CRAYONS.red,
  CRAYONS.orange,
  CRAYONS.yellow,
  CRAYONS.green,
  CRAYONS.blue,
  CRAYONS.purple,
];

const f = (n: number) => Math.round(n * 100) / 100;

function wedge(cx: number, cy: number, r: number, i: number, n: number) {
  const seg = (Math.PI * 2) / n;
  const a0 = i * seg - Math.PI / 2;
  const a1 = a0 + seg;
  return `M${f(cx)},${f(cy)} L${f(cx + r * Math.cos(a0))},${f(cy + r * Math.sin(a0))} A${f(r)},${f(r)} 0 0 1 ${f(cx + r * Math.cos(a1))},${f(cy + r * Math.sin(a1))} Z`;
}

export function appIconSvg({ safe = false, tiny = false } = {}): string {
  const gen = rough.generator();
  const scale = safe ? 0.8 : 1;
  const cx = 50;
  const cy = 54 + (safe ? -2 : 0);
  const R = 34 * scale;
  const ink = (tiny ? 4.2 : 2.8) * (safe ? 0.9 : 1);
  const parts: string[] = [];

  // background: warm paper with a soft glow
  parts.push(`<defs><radialGradient id="bg" cx="50%" cy="38%" r="75%">
    <stop offset="0%" stop-color="#fffbef"/><stop offset="100%" stop-color="#fbe7b8"/></radialGradient></defs>`);
  parts.push(`<rect width="100" height="100" fill="url(#bg)"/>`);

  // shadow
  parts.push(
    `<ellipse cx="${f(cx + 2.5)}" cy="${f(cy + 4)}" rx="${f(R + 4)}" ry="${f(R + 3)}" fill="${INK}" opacity="0.14"/>`,
  );
  // rim
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${f(R + 3.6)}" fill="#fffdf7" stroke="${INK}" stroke-width="${f(ink)}"/>`,
  );

  WEDGES.forEach((color, i) => {
    const d = wedge(cx, cy, R, i, WEDGES.length);
    parts.push(`<path d="${d}" fill="${color}" opacity="${tiny ? 1 : 0.55}"/>`);
    if (!tiny) {
      const hatch = gen.path(d, {
        seed: 11 + i * 5,
        stroke: "none",
        fill: color,
        fillStyle: "zigzag",
        hachureGap: 3.6 * scale,
        hachureAngle: 60 * i + 30,
        fillWeight: 1.9 * scale,
        roughness: 1.1,
      });
      for (const p of gen.toPaths(hatch)) {
        if (p.stroke === "none") continue;
        parts.push(
          `<path d="${p.d}" fill="none" stroke="${color}" stroke-width="${p.strokeWidth}" stroke-linecap="round"/>`,
        );
      }
    }
    const outline = gen.path(d, {
      seed: 40 + i,
      stroke: INK,
      strokeWidth: ink,
      roughness: tiny ? 0.2 : 0.7,
      bowing: 0.8,
      disableMultiStroke: true,
    });
    for (const p of gen.toPaths(outline)) {
      if (p.stroke === "none") continue;
      parts.push(
        `<path d="${p.d}" fill="none" stroke="${INK}" stroke-width="${f(ink)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  });

  // pegs between wedges
  if (!tiny) {
    WEDGES.forEach((_, i) => {
      const a = (i * Math.PI * 2) / WEDGES.length - Math.PI / 2;
      parts.push(
        `<circle cx="${f(cx + (R + 1.6) * Math.cos(a))}" cy="${f(cy + (R + 1.6) * Math.sin(a))}" r="${f(2.1 * scale)}" fill="${CRAYONS.yellow}" stroke="${INK}" stroke-width="${f(1.3 * scale)}"/>`,
      );
    });
  }

  // hub
  const hub = (tiny ? 9 : 8.5) * scale;
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${f(hub)}" fill="${CRAYONS.yellow}" stroke="${INK}" stroke-width="${f(ink)}"/>`,
  );
  if (!tiny)
    parts.push(
      `<circle cx="${f(cx - hub * 0.35)}" cy="${f(cy - hub * 0.35)}" r="${f(hub * 0.28)}" fill="#fff" opacity="0.7"/>`,
    );

  // the crayon pointer, tip just biting into the top wedge
  const top = cy - R - 3.6;
  const w = (tiny ? 13 : 10) * scale;
  const body = 13 * scale;
  const tip = 8 * scale;
  const y0 = top - body + tip * 0.55;
  parts.push(`<g stroke="${INK}" stroke-width="${f(ink * 0.85)}" stroke-linejoin="round">
    <rect x="${f(cx - w / 2)}" y="${f(y0)}" width="${f(w)}" height="${f(body)}" rx="${f(1.6 * scale)}" fill="${CRAYONS.red}"/>
    <path d="M${f(cx - w / 2)},${f(y0 + body)} L${f(cx + w / 2)},${f(y0 + body)} L${cx},${f(y0 + body + tip)} Z" fill="#f4c7a1"/>
  </g>`);
  if (!tiny)
    parts.push(
      `<rect x="${f(cx - w / 2)}" y="${f(y0 + body * 0.3)}" width="${f(w)}" height="${f(body * 0.16)}" fill="${INK}" opacity="0.3"/>`,
      `<path d="M${f(cx - w * 0.17)},${f(y0 + body + tip * 0.62)} L${f(cx + w * 0.17)},${f(y0 + body + tip * 0.62)} L${cx},${f(y0 + body + tip)} Z" fill="${CRAYONS.red}"/>`,
    );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${parts.join("")}</svg>`;
}

export function appIconDataUri(opts?: { safe?: boolean; tiny?: boolean }) {
  return `data:image/svg+xml;base64,${Buffer.from(appIconSvg(opts)).toString("base64")}`;
}
