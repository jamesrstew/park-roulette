/**
 * Design: /tmp/pr-news/weather-graphic (final, critiqued 2026-11-19). Kept
 * as delivered; only lint comments added.
 *
 * "The weekend ahead": a 3-day crayon forecast card for the Bend Playground
 * Passport email. Pure JSX + inline styles + inline SVG, so it drops straight
 * into next/og ImageResponse (Satori). Gochi Hand is the only font.
 *
 *   new ImageResponse(<WeatherCard days={days} />, {
 *     ...WEATHER_SIZE,
 *     fonts: [{ name: "Gochi", data, weight: 400, style: "normal" }],
 *   });
 *
 * Designed at 2x for a 600px email column: 1200 x 640 (15:8). Shown at 536px
 * on desktop and ~340px on phones, so every word is at least 48px here
 * (about 14px on a phone).
 */

import type { ReactNode } from "react";

export type WeatherIcon =
  | "sun"
  | "partly"
  | "cloudy"
  | "rain"
  | "snow"
  | "mixed"
  | "storm"
  | "fog"
  | "wind"
  | "smoke";

export type WeatherDay = {
  /** "Friday" */
  label: string;
  /** Short condition word, at most 13 characters: "Snow showers". */
  condition: string;
  icon: WeatherIcon;
  /** Daytime high, °F. */
  high: number;
  /** The low that night, °F. null if NWS hasn't published it. */
  low: number | null;
  /** Daytime chance of precipitation, 0-100. Shown only at 20 or more. */
  pop: number | null;
  /** True when the forecast for this day is missing (draws a placeholder). */
  missing?: boolean;
};

export type WeatherCardProps = { days: WeatherDay[]; note?: string };

/**
 * 1200 wide always. 640 tall (15:8) when any day shows a rain/snow chip,
 * 560 tall (15:7) when none does; +100 when a note is drawn in. Use this for
 * both the ImageResponse size and the <img width/height> in the email.
 */
export function weatherSize(days: WeatherDay[], note?: string) {
  const chips = days.slice(0, 3).some(hasChip);
  return { width: 1200, height: (chips ? 640 : 560) + (note ? 100 : 0) };
}
const hasChip = (d: WeatherDay) =>
  !d.missing && d.pop != null && d.pop >= POP_MIN;

const INK = "#2b2a33";
const SOFT = "#5d5a6b";
const CARD = "#fffdf7";
const C = {
  red: "#e5432f",
  orange: "#f58a2c",
  yellow: "#f7c933",
  green: "#3aa35b",
  teal: "#1fa4a8",
  blue: "#2f78d4",
  purple: "#8a5cc6",
  pink: "#ee6aa7",
  brown: "#9a6a3f",
};
/** One crayon per column, left to right, for the day's scribble underline. */
const DAY_CRAYONS = [C.orange, C.blue, C.green];
export const POP_MIN = 20;
const HOT = 90;
const FROZEN = 20;

/* ------------------------------------------------------------------ */
/* Crayon drawing kit (100 x 100 grid)                                 */
/* ------------------------------------------------------------------ */

const OUT = 4.6; // ink outline weight

/** A hand-wobbled circle as a smooth closed path. */
function blob(cx: number, cy: number, r: number, seed = 1) {
  const n = 14;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr =
      r *
      (1 + 0.035 * Math.sin(a * 3 + seed) + 0.02 * Math.cos(a * 5 + seed * 2));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const mid = (p: [number, number], q: [number, number]) =>
    `${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2).toFixed(1)}`;
  let d = `M${mid(pts[n - 1], pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${mid(p, pts[(i + 1) % n])}`;
  }
  return d + " Z";
}

const CLOUD =
  "M24 72 C9 72 7 55 20 51 C17 37 33 29 44 37 C50 22 73 23 77 41 C91 41 95 60 85 68 C83 71 80 72 76 72 Z";

let uid = 0;

/**
 * A region colored in with a crayon: paper underneath, a pale wash, then
 * back-and-forth hatch strokes clipped to the shape, then a wobbly ink
 * outline drawn twice (a heavy pass and a light, offset sketch pass).
 */
function Crayon({
  d,
  color,
  angle = -50,
  gap = 5.2,
  wash = 0.22,
  outline = true,
}: {
  d: string;
  color: string;
  angle?: number;
  gap?: number;
  wash?: number;
  outline?: boolean;
}) {
  const id = `c${++uid}`;
  const lines: string[] = [];
  for (let y = -60, i = 0; y <= 160; y += gap, i++) {
    const j = (i % 3) - 1; // tiny jitter so it isn't ruled paper
    lines.push(`M-60 ${y + j * 0.6} Q50 ${y + 1.6 * j + 1} 160 ${y - j * 0.5}`);
  }
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <path d={d} />
        </clipPath>
      </defs>
      <path d={d} fill={CARD} />
      <path d={d} fill={color} fillOpacity={wash} />
      <g clipPath={`url(#${id})`}>
        <g transform={`rotate(${angle} 50 50)`}>
          {lines.map((l) => (
            <path
              key={l}
              d={l}
              fill="none"
              stroke={color}
              strokeWidth={2.8}
              strokeOpacity={0.8}
              strokeLinecap="round"
            />
          ))}
        </g>
      </g>
      {outline && (
        <g>
          <path
            d={d}
            fill="none"
            stroke={INK}
            strokeWidth={OUT}
            strokeLinejoin="round"
          />
          <path
            d={d}
            fill="none"
            stroke={INK}
            strokeWidth={1.6}
            strokeOpacity={0.45}
            strokeLinejoin="round"
            transform="translate(1.2 -0.9)"
          />
        </g>
      )}
    </g>
  );
}

/** A thick crayon stroke (rays, drops, wind). */
function Stroke({ d, color, w = 6 }: { d: string; color: string; w?: number }) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={d}
        fill="none"
        stroke={INK}
        strokeWidth={1.4}
        strokeOpacity={0.35}
        strokeLinecap="round"
        transform="translate(0.8 0.6)"
      />
    </g>
  );
}

function Sun({
  cx,
  cy,
  r,
  rays = true,
  color = C.yellow,
}: {
  cx: number;
  cy: number;
  r: number;
  rays?: boolean;
  color?: string;
}) {
  const out: string[] = [];
  if (rays) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const r0 = r + 7;
      const r1 = r + (i % 2 ? 13 : 17);
      out.push(
        `M${(cx + Math.cos(a) * r0).toFixed(1)} ${(cy + Math.sin(a) * r0).toFixed(1)} L${(cx + Math.cos(a) * r1).toFixed(1)} ${(cy + Math.sin(a) * r1).toFixed(1)}`,
      );
    }
  }
  return (
    <g>
      {out.map((d) => (
        <g key={d}>{Stroke({ d, color: C.orange, w: 5.5 })}</g>
      ))}
      {Crayon({ d: blob(cx, cy, r, cx), color: color, wash: 0.55, angle: -35 })}
    </g>
  );
}

function Cloud({
  x = 0,
  y = 0,
  s = 1,
  color = C.blue,
}: {
  x?: number;
  y?: number;
  s?: number;
  color?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {Crayon({ d: CLOUD, color: color, wash: 0.16, gap: 6.5, angle: -40 })}
    </g>
  );
}

function Drop({
  x,
  y,
  color = C.blue,
}: {
  x: number;
  y: number;
  color?: string;
}) {
  return Stroke({ d: `M${x + 5} ${y} L${x - 3} ${y + 16}`, color, w: 8 });
}

function Flake({
  x,
  y,
  color = C.teal,
  r = 9,
}: {
  x: number;
  y: number;
  color?: string;
  r?: number;
}) {
  const arms = [0, 60, 120].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return `M${(x - Math.cos(a) * r).toFixed(1)} ${(y - Math.sin(a) * r).toFixed(1)} L${(x + Math.cos(a) * r).toFixed(1)} ${(y + Math.sin(a) * r).toFixed(1)}`;
  });
  return (
    <g>
      {arms.map((d) => (
        <g key={d}>{Stroke({ d, color, w: 6.4 })}</g>
      ))}
    </g>
  );
}

const wave = (x0: number, x1: number, y: number, amp = 3) => {
  const w = (x1 - x0) / 4;
  return `M${x0} ${y} q${w / 2} ${-amp} ${w} 0 t${w} 0 t${w} 0 t${w} 0`;
};

/** The hand-drawn weather icons, each in a 100 x 100 box. */
export function WeatherGlyph({
  icon,
  size,
}: {
  icon: WeatherIcon | "unknown";
  size: number;
}) {
  let body: ReactNode;
  switch (icon) {
    case "sun":
      body = Sun({ cx: 50, cy: 50, r: 22 });
      break;
    case "partly":
      body = (
        <g>
          {Sun({ cx: 36, cy: 36, r: 17 })}
          {Cloud({ x: 20, y: 22, s: 0.78 })}
        </g>
      );
      break;
    case "cloudy":
      body = (
        <g>
          {Cloud({ x: 26, y: -6, s: 0.66, color: C.purple })}
          {Cloud({ x: 2, y: 8, s: 0.88 })}
        </g>
      );
      break;
    case "rain":
      body = (
        <g>
          {Cloud({ x: 0, y: -18, s: 1 })}
          {Drop({ x: 28, y: 68 })}
          {Drop({ x: 50, y: 76 })}
          {Drop({ x: 72, y: 68 })}
        </g>
      );
      break;
    case "snow":
      body = (
        <g>
          {Cloud({ x: 0, y: -18, s: 1 })}
          {Flake({ x: 18, y: 78, r: 10 })}
          {Flake({ x: 50, y: 88, r: 10, color: C.blue })}
          {Flake({ x: 82, y: 78, r: 10 })}
        </g>
      );
      break;
    case "mixed":
      body = (
        <g>
          {Cloud({ x: 0, y: -18, s: 1, color: C.purple })}
          {Drop({ x: 28, y: 68 })}
          {Flake({ x: 50, y: 80, r: 11 })}
          {Drop({ x: 72, y: 68 })}
        </g>
      );
      break;
    case "storm":
      body = (
        <g>
          {Cloud({ x: 0, y: -20, s: 1, color: C.purple })}
          <g transform="translate(0 2)">
            {Crayon({
              d: "M54 56 L40 78 L51 78 L44 96 L66 70 L54 70 L61 56 Z",
              color: C.yellow,
              wash: 0.6,
              gap: 4,
            })}
          </g>
          {Drop({ x: 26, y: 70 })}
          {Drop({ x: 76, y: 70 })}
        </g>
      );
      break;
    case "fog":
      body = (
        <g>
          {Cloud({ x: 8, y: -12, s: 0.84 })}
          {Stroke({ d: wave(14, 86, 66), color: C.teal, w: 6 })}
          {Stroke({ d: wave(22, 78, 78), color: C.purple, w: 6 })}
          {Stroke({ d: wave(12, 88, 90), color: C.teal, w: 6 })}
        </g>
      );
      break;
    case "wind":
      body = (
        <g>
          {Stroke({
            d: "M10 34 L58 34 C72 34 74 16 62 15 C54 14 52 22 56 26",
            color: C.teal,
            w: 6.5,
          })}
          {Stroke({
            d: "M10 52 L78 52 C92 52 94 70 82 72 C74 73 71 66 74 62",
            color: C.blue,
            w: 6.5,
          })}
          {Stroke({
            d: "M18 70 L50 70 C60 70 62 84 53 86 C47 87 45 82 47 79",
            color: C.teal,
            w: 6.5,
          })}
        </g>
      );
      break;
    case "smoke":
      body = (
        <g>
          {Sun({ cx: 50, cy: 42, r: 20, rays: false, color: C.orange })}
          {Stroke({ d: wave(8, 92, 40, 4), color: C.brown, w: 7 })}
          {Stroke({ d: wave(14, 86, 58, 4), color: C.brown, w: 7 })}
          {Stroke({ d: wave(8, 92, 76, 4), color: C.brown, w: 7 })}
        </g>
      );
      break;
    default:
      body = (
        <g>
          <path
            d={blob(50, 50, 30, 3)}
            fill="none"
            stroke={SOFT}
            strokeWidth={4}
            strokeDasharray="7 7"
            strokeLinecap="round"
          />
          <path
            d="M40 40 C40 28 60 28 60 40 C60 49 50 49 50 58"
            fill="none"
            stroke={SOFT}
            strokeWidth={5.5}
            strokeLinecap="round"
          />
          <circle cx={50} cy={69} r={3.5} fill={SOFT} />
        </g>
      );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ overflow: "visible" }}
    >
      {body}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

/** A two-pass crayon scribble under the day name, like <PageTitle>. */
function Scribble({ color, width }: { color: string; width: number }) {
  return (
    <svg
      width={width}
      height={22}
      viewBox="0 0 100 22"
      preserveAspectRatio="none"
    >
      <path
        d="M3 9 C22 4 40 13 58 8 S88 5 97 9"
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
      />
      <path
        d="M8 16 C30 12 52 18 72 14 S90 13 94 15"
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeOpacity={0.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function Divider() {
  return (
    <svg width={16} height={470} viewBox="0 0 16 470">
      <path
        d="M8 4 C4 80 12 160 7 240 S11 400 8 466"
        fill="none"
        stroke={SOFT}
        strokeOpacity={0.45}
        strokeWidth={3.5}
        strokeDasharray="14 12"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A number with a hand-drawn degree ring. */
function Temp({
  value,
  size,
  color,
}: {
  value: number;
  size: number;
  color: string;
}) {
  const ring = Math.round(size * 0.24);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", color }}>
      <div
        style={{ display: "flex", fontSize: size, lineHeight: 1 }}
      >{`${Math.round(value)}`}</div>
      <div
        style={{
          display: "flex",
          width: ring,
          height: ring,
          marginTop: Math.round(size * 0.1),
          marginLeft: Math.round(size * 0.04),
          border: `${Math.max(4, Math.round(size * 0.075))}px solid ${color}`,
          borderRadius: ring,
        }}
      />
    </div>
  );
}

/** What the chip's % is a chance of. Mixed or unknown types say "chance". */
const CHIP_NOUN: Partial<Record<WeatherIcon, string>> = {
  rain: "rain",
  snow: "snow",
  storm: "storms",
};

function PopChip({
  pop,
  snow,
  noun,
}: {
  pop: number;
  snow: boolean;
  noun: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "4px 24px 6px 16px",
        border: `3.5px solid ${INK}`,
        borderRadius: "22px 16px 24px 14px",
        background: "rgba(47, 120, 212, 0.16)",
        fontSize: 48,
        lineHeight: 1,
      }}
    >
      {snow ? (
        <svg width={40} height={40} viewBox="0 0 40 40">
          {[0, 60, 120].map((deg) => {
            const a = (deg * Math.PI) / 180;
            const dx = (Math.cos(a) * 15).toFixed(1);
            const dy = (Math.sin(a) * 15).toFixed(1);
            return (
              <path
                key={deg}
                d={`M${20 - +dx} ${20 - +dy} L${20 + +dx} ${20 + +dy}`}
                stroke={C.blue}
                strokeWidth={6}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      ) : (
        <svg width={34} height={40} viewBox="0 0 34 40">
          <path
            d="M17 3 C12 13 5 20 5 27 C5 34 11 38 17 38 C23 38 29 34 29 27 C29 20 22 13 17 3 Z"
            fill={C.blue}
            stroke={INK}
            strokeWidth={3.2}
            strokeLinejoin="round"
          />
        </svg>
      )}
      <div style={{ display: "flex" }}>{`${Math.round(pop)}% ${noun}`}</div>
    </div>
  );
}

function highColor(high: number) {
  if (high >= HOT) return C.red;
  if (high <= FROZEN) return C.blue;
  return INK;
}

function Day({
  day,
  color,
  chipRow,
}: {
  day: WeatherDay;
  color: string;
  chipRow: boolean;
}) {
  const showPop = !day.missing && day.pop != null && day.pop >= POP_MIN;
  const long = day.condition.length > 11;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 360,
      }}
    >
      {/* day name + scribble */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: 66, lineHeight: 1 }}>
          {day.label}
        </div>
        <div style={{ display: "flex", marginTop: -4 }}>
          <Scribble
            color={color}
            width={Math.max(150, day.label.length * 30)}
          />
        </div>
      </div>
      {/* icon */}
      <div style={{ display: "flex", marginTop: 10 }}>
        <WeatherGlyph icon={day.missing ? "unknown" : day.icon} size={186} />
      </div>
      {/* condition word */}
      <div
        style={{
          display: "flex",
          fontSize: long ? 50 : 56,
          lineHeight: 1,
          marginTop: 8,
          color: day.missing ? SOFT : INK,
          whiteSpace: "nowrap",
        }}
      >
        {day.missing ? "No forecast" : day.condition}
      </div>
      {/* high / low */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          marginTop: 6,
          height: 118,
        }}
      >
        {day.missing ? (
          <div style={{ display: "flex", fontSize: 104, color: SOFT }}>--</div>
        ) : (
          <>
            <Temp value={day.high} size={116} color={highColor(day.high)} />
            {day.low != null && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  marginLeft: 14,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 62,
                    lineHeight: 1,
                    color: SOFT,
                    marginRight: 10,
                  }}
                >
                  /
                </div>
                <Temp value={day.low} size={62} color={SOFT} />
              </div>
            )}
          </>
        )}
      </div>
      {/* chance of precipitation (the row is kept, so columns line up,
          whenever any day has a chip) */}
      {chipRow && (
        <div
          style={{
            display: "flex",
            height: 66,
            alignItems: "center",
            marginTop: 4,
          }}
        >
          {showPop && (
            <PopChip
              pop={day.pop as number}
              snow={day.icon === "snow"}
              noun={CHIP_NOUN[day.icon] ?? "chance"}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Always three columns: a missing day keeps its slot with a placeholder. */
export function WeatherCard({ days, note }: WeatherCardProps) {
  // Satori renders this once per image on the server (no React re-renders),
  // so resetting the clip-path id counter per card is safe.
  // eslint-disable-next-line react-hooks/globals
  uid = 0;
  const three = days.slice(0, 3);
  const height = weatherSize(days, note).height;
  const chipRow = three.some(hasChip);
  return (
    <div
      style={{
        width: 1200,
        height,
        display: "flex",
        // Transparent, not paper #fffaf0: on a cream inbox it looks the same, and on a
        // dark-mode inbox the card's rounded corners float instead of sitting
        // in a cream rectangle.
        fontFamily: "Gochi",
        color: INK,
        position: "relative",
      }}
    >
      {/* the paper card, with a crayon border and an offset ink shadow so it
          holds its edge on a dark-mode inbox */}
      <div
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          right: 20,
          bottom: 20,
          display: "flex",
          border: `6px solid ${INK}`,
          borderRadius: "40px 18px 46px 16px",
          background: CARD,
          boxShadow: `10px 11px 0 ${INK}`,
        }}
      />
      {/* tape */}
      <div
        style={{
          position: "absolute",
          left: 530,
          top: -6,
          width: 150,
          height: 40,
          background: "rgba(247, 201, 51, 0.6)",
          transform: "rotate(-3deg)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 14,
          top: 42,
          right: 26,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
          }}
        >
          {three.map((d, i) => (
            <div key={`${d.label}-${i}`} style={{ display: "flex" }}>
              {i > 0 && (
                <div style={{ display: "flex", margin: "10px 12px 0 12px" }}>
                  <Divider />
                </div>
              )}
              <Day day={d} color={DAY_CRAYONS[i % 3]} chipRow={chipRow} />
            </div>
          ))}
        </div>
        {note && (
          <div
            style={{
              display: "flex",
              marginTop: 18,
              padding: "8px 30px 12px 30px",
              fontSize: 54,
              lineHeight: 1,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 6,
                right: 6,
                top: 26,
                bottom: 6,
                background: "rgba(247, 201, 51, 0.7)",
                transform: "rotate(-1deg)",
                borderRadius: 10,
                display: "flex",
              }}
            />
            <div style={{ display: "flex", position: "relative" }}>{note}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Text: alt text and the NWS condition mapping                        */
/* ------------------------------------------------------------------ */

const PRECIP_NOUN: Partial<Record<WeatherIcon, string>> = {
  rain: "rain",
  snow: "snow",
  mixed: "rain or snow",
  storm: "storms",
};

/**
 * The forecast in one readable sentence per day, for the <img alt>:
 * "Weekend forecast for Bend. Friday: sunny, high 44°F, low 28°F. ..."
 */
export function weatherAlt(days: WeatherDay[]): string {
  const parts = days.slice(0, 3).map((d) => {
    if (d.missing) return `${d.label}: no forecast yet.`;
    let s = `${d.label}: ${d.condition.toLowerCase()}, high ${Math.round(d.high)}°F`;
    if (d.low != null) s += `, low ${Math.round(d.low)}°F`;
    if (d.pop != null && d.pop >= POP_MIN)
      s += `, ${Math.round(d.pop)}% chance of ${PRECIP_NOUN[d.icon] ?? "rain or snow"}`;
    return s + ".";
  });
  return ["Weekend forecast for Bend.", ...parts].join(" ");
}

/**
 * NWS shortForecast ("Chance Snow Showers then Mostly Sunny") to a short
 * condition word and icon. Read in priority order; the first match wins.
 * When the day's chance of precipitation is under 20%, precipitation words
 * are ignored and the sky clause is used, so a "Slight Chance Snow then
 * Partly Sunny" day reads "Partly sunny".
 */
export function conditionFromNws(
  shortForecast: string,
  pop: number | null,
): { condition: string; icon: WeatherIcon } {
  const all = shortForecast.toLowerCase();
  const wet = (pop ?? 0) >= POP_MIN;
  const has = (re: RegExp) => re.test(all);
  if (has(/smoke/)) return { condition: "Smoky", icon: "smoke" };
  if (has(/haze|hazy/)) return { condition: "Hazy", icon: "smoke" };
  if (wet) {
    if (has(/thunder|t-storm/)) return { condition: "Storms", icon: "storm" };
    if (has(/freezing (rain|drizzle)/))
      return { condition: "Icy rain", icon: "mixed" };
    if (has(/sleet|wintry|ice pellets/))
      return { condition: "Sleet", icon: "mixed" };
    if (has(/snow|flurr/) && has(/rain|drizzle/))
      return { condition: "Rain and snow", icon: "mixed" };
    if (has(/blizzard/)) return { condition: "Blizzard", icon: "snow" };
    if (has(/snow showers/)) return { condition: "Snow showers", icon: "snow" };
    if (has(/flurr/)) return { condition: "Flurries", icon: "snow" };
    if (has(/snow/)) return { condition: "Snow", icon: "snow" };
    if (has(/drizzle/)) return { condition: "Drizzle", icon: "rain" };
    if (has(/showers/)) return { condition: "Showers", icon: "rain" };
    if (has(/rain/)) return { condition: "Rain", icon: "rain" };
  }
  if (has(/fog/)) return { condition: "Foggy", icon: "fog" };
  if (has(/blowing|windy|breezy|blustery/))
    return { condition: "Windy", icon: "wind" };
  if (has(/mostly (sunny|clear)/))
    return { condition: "Mostly sunny", icon: "sun" };
  if (has(/partly (sunny|cloudy|clear)/))
    return { condition: "Partly sunny", icon: "partly" };
  if (has(/mostly cloudy/))
    return { condition: "Mostly cloudy", icon: "cloudy" };
  if (has(/cloudy|overcast/)) return { condition: "Cloudy", icon: "cloudy" };
  if (has(/sunny|clear/)) return { condition: "Sunny", icon: "sun" };
  // Precipitation words below 20%, with no sky clause: call it cloudy.
  return { condition: "Cloudy", icon: "cloudy" };
}
