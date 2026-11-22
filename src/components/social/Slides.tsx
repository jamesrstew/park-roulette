/**
 * Instagram slides for next/og (Satori): inline styles and plain SVG only.
 * 1080 x 1350 feed slides (4:5) and the 1080 x 1920 Story frame,
 * every word inside the center 1012 px. The design system: paper #fffaf0,
 * ink #2b2a33, the crayon box, Gochi Hand, the hand-drawn icon set. No
 * emoji, ever.
 *
 * The @nowbam pattern: a 4 to 8 word headline with one highlighted word,
 * then one point per slide, then the close.
 */

import type { ReactNode } from "react";
import { WheelArt } from "@/components/me/brand-art";
import { WeatherGlyph, type WeatherIcon } from "@/components/news/WeatherCard";
import { ALIASES, DRAWINGS } from "@/components/icons/drawings";
import { compile, type Mark } from "@/components/icons/kit";
import { CRAYONS } from "@/lib/crayons";
import {
  CONTENT,
  EVENT,
  eventFit,
  hostSize,
  IDEA,
  ideaFit,
  oneLine,
  textWidth,
  TOP_ROW,
  venueSize,
} from "./fit";
import { placeLine } from "@/lib/social/compose";
import { COPY, FEED, type SlideSpec, STORY } from "@/lib/social/model";

export const INK = "#2b2a33";
export const PAPER = "#fffaf0";
const CARD = "#fffdf7";
const SOFT = "#5d5a6b";
const MARKER = "rgba(247, 201, 51, 0.8)";
const TAPE = "rgba(247, 201, 51, 0.55)";

/** A crayon washed into the card color (Satori has no color-mix). */
export function tint(hex: string, share: number, base = CARD): string {
  const rgb = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [rgb(hex), rgb(base)];
  const mix = a.map((v, i) => Math.round(v * share + b[i] * (1 - share)));
  return `rgb(${mix.join(", ")})`;
}

/** One crayon per slide, in order, so a carousel reads like a crayon box. */
const SLIDE_CRAYONS = [
  CRAYONS.orange,
  CRAYONS.blue,
  CRAYONS.green,
  CRAYONS.pink,
  CRAYONS.purple,
  CRAYONS.teal,
  CRAYONS.red,
];

// --- Icons (the app's crayon set, compiled for Satori) --------------------

const iconCache = new Map<string, Mark[]>();

export function SlideIcon({ name, size }: { name: string; size: number }) {
  const named = Object.hasOwn(ALIASES, name)
    ? ALIASES[name as keyof typeof ALIASES]
    : name;
  const key = (
    Object.hasOwn(DRAWINGS, named) ? named : "sparkles"
  ) as keyof typeof DRAWINGS;
  let marks = iconCache.get(key);
  if (!marks) {
    marks = compile(key, DRAWINGS[key]);
    iconCache.set(key, marks);
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -1 26 26"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {marks.map((m, i) => (
        <path
          key={i}
          d={m.d}
          fill={m.fill ?? "none"}
          fillRule={m.rule}
          stroke={m.stroke}
          strokeWidth={m.sw}
          strokeDasharray={m.dash}
          opacity={m.opacity}
          transform={m.t}
        />
      ))}
    </svg>
  );
}

/** A crayon icon, or a weather glyph for the weather words (snow, rain, sun). */
function AnyIcon({ name, size }: { name: string; size: number }) {
  // "sun" in the crayon set is the frowning no-shade sun: draw the weather one.
  return name === "snow" || name === "rain" || name === "sun" ? (
    <WeatherGlyph icon={name} size={size} />
  ) : (
    <SlideIcon name={name} size={size} />
  );
}

// --- Shared pieces -----------------------------------------------------------

function Tape({
  left,
  top,
  width = 190,
  rotate = -4,
}: {
  left: number;
  top: number;
  width?: number;
  rotate?: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height: 54,
        background: TAPE,
        transform: `rotate(${rotate}deg)`,
        display: "flex",
      }}
    />
  );
}

/** A hand-drawn arrow pointing right, for "Swipe". */
function SwipeArrow({ color }: { color: string }) {
  return (
    <svg width={150} height={70} viewBox="0 0 150 70">
      <path
        d="M6 38 C 40 30, 80 44, 132 34"
        stroke={color}
        strokeWidth={9}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M108 12 L 140 34 L 106 58"
        stroke={color}
        strokeWidth={9}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A two-pass crayon scribble underline. */
function Scribble({ width, color }: { width: number; color: string }) {
  return (
    <svg width={width} height={34} viewBox={`0 0 ${width} 34`}>
      <path
        d={`M6 20 C ${width * 0.25} 8, ${width * 0.5} 30, ${width * 0.75} 14 S ${width - 20} 22, ${width - 6} 12`}
        stroke={color}
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The paper card every feed slide sits on, with the brand and page count. */
function Frame({
  children,
  page,
  color,
}: {
  children: ReactNode;
  page?: { n: number; of: number };
  color: string;
}) {
  return (
    <div
      style={{
        width: FEED.width,
        height: FEED.height,
        display: "flex",
        background: PAPER,
        fontFamily: "Gochi",
        color: INK,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 34,
          top: 34,
          right: 48,
          bottom: 48,
          display: "flex",
          border: `7px solid ${INK}`,
          borderRadius: "46px 20px 52px 18px",
          background: CARD,
          boxShadow: `12px 14px 0 ${INK}`,
        }}
      />
      {/* a crayon stripe down the left edge: this slide's color */}
      <div
        style={{
          position: "absolute",
          left: 34,
          top: 120,
          width: 14,
          height: 220,
          background: color,
          borderRadius: 8,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 90,
          top: 92,
          right: 100,
          bottom: 170,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          left: 86,
          bottom: 82,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 40,
          color: SOFT,
        }}
      >
        <WheelArt size={64} />
        <span>Park Roulette</span>
      </div>
      {page ? (
        <div
          style={{
            position: "absolute",
            right: 104,
            bottom: 90,
            display: "flex",
            fontSize: 38,
            color: SOFT,
          }}
        >
          {`${page.n} / ${page.of}`}
        </div>
      ) : null}
    </div>
  );
}

/** Headline words in a wrapping row, one of them over a marker stroke. */
function HeadlineWords({
  words,
  highlight,
  size,
}: {
  words: string;
  highlight: string;
  size: number;
}) {
  const want = highlight.toLowerCase().replace(/[^a-z0-9'-]/g, "");
  const parts = words.split(/\s+/);
  const clean = (w: string) => w.toLowerCase().replace(/[^a-z0-9'-]/g, "");
  const markAt = parts.findIndex((w) => clean(w) === want);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        fontSize: size,
        lineHeight: 1.08,
        columnGap: size * 0.26,
        width: balancedWidth(parts, size, size * 0.26),
      }}
    >
      {parts.map((w, i) => {
        const hit = i === markAt;
        return (
          <div key={i} style={{ display: "flex", position: "relative" }}>
            {hit ? (
              <div
                style={{
                  position: "absolute",
                  left: -12,
                  right: -12,
                  bottom: size * 0.1,
                  height: size * 0.42,
                  background: MARKER,
                  transform: "rotate(-2deg)",
                  borderRadius: 10,
                  display: "flex",
                }}
              />
            ) : null}
            <span style={{ position: "relative" }}>{w}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Town names in lines we break ourselves (about 30 characters each, the
 * width of the card at 50 px), joined by " · " inside a line only, so no
 * line starts or ends on a dot and no town splits.
 */
export function townLines(towns: readonly string[], max = 30): string[] {
  const wrap = (limit: number) => {
    const lines: string[] = [];
    for (const t of towns) {
      const last = lines[lines.length - 1];
      if (last != null && `${last} · ${t}`.length <= limit)
        lines[lines.length - 1] = `${last} · ${t}`;
      else lines.push(t);
    }
    return lines;
  };
  // As many lines as the width needs, then as even as they'll go: never
  // one town alone under a full line ("Bend · Sisters · Sunriver /
  // Redmond" becomes "Bend · Sisters / Sunriver · Redmond").
  const n = wrap(max).length;
  const longest = Math.max(...towns.map((t) => t.length));
  for (let limit = longest; limit < max; limit++)
    if (wrap(limit).length === n) return wrap(limit);
  return wrap(max);
}

/**
 * A width that wraps these words into balanced lines (never a last word
 * alone): the even share of their width per line, plus the widest word's
 * slack, capped at the card. Words are flex items here, so CSS balance
 * can't do it.
 */
function balancedWidth(words: string[], size: number, gap: number): number {
  // The font's own widths, no safety margin: this aims for balance, and
  // the box is never wider than the card, so nothing can overflow.
  const widths = words.map((w) => textWidth(w, size, 1));
  const linesAt = (box: number) => {
    let n = 1;
    let x = 0;
    for (const w of widths) {
      if (x && x + gap + w > box) {
        n++;
        x = w;
      } else x += (x ? gap : 0) + w;
    }
    return n;
  };
  const n = linesAt(CONTENT.width);
  if (n <= 1) return CONTENT.width;
  // The narrowest box that still wraps into the same number of lines.
  let box = Math.max(...widths);
  while (box < CONTENT.width && linesAt(box) > n) box += 4;
  return Math.min(CONTENT.width, box + 6);
}

/** Headline size by length: as big as fits in the safe width. */
function headlineSize(words: string): number {
  const n = words.length;
  if (n <= 24) return 140;
  if (n <= 36) return 124;
  if (n <= 48) return 108;
  return 92;
}

/** The crayon park card: drawn when there's no checked photo. */
export function CrayonParkArt({
  width,
  height,
  seed = 0,
  ground = 0.64,
}: {
  width: number;
  height: number;
  seed?: number;
  /** Where the grass starts, from the top (0 to 1). */
  ground?: number;
}) {
  const g = height * ground;
  const sky = [CRAYONS.blue, CRAYONS.teal, CRAYONS.purple][seed % 3];
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        background: tint(sky, 0.14),
        overflow: "hidden",
      }}
    >
      {/* grass */}
      <div
        style={{
          position: "absolute",
          left: -40,
          right: -40,
          top: g,
          height: height - g + 40,
          background: tint(CRAYONS.green, 0.45),
          borderRadius: "50% 50% 0 0",
          borderTop: `7px solid ${INK}`,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: width * 0.08,
          top: height * 0.06,
          display: "flex",
        }}
      >
        <WeatherGlyph icon="sun" size={Math.round(width * 0.22)} />
      </div>
      <div
        style={{
          position: "absolute",
          left: width * 0.04,
          top: g - width * 0.22,
          display: "flex",
        }}
      >
        <SlideIcon name="park" size={Math.round(width * 0.24)} />
      </div>
      <div
        style={{
          position: "absolute",
          left: width * 0.28,
          top: g - width * 0.36,
          display: "flex",
        }}
      >
        <SlideIcon name="playground" size={Math.round(width * 0.46)} />
      </div>
      <div
        style={{
          position: "absolute",
          right: width * 0.03,
          top: g - width * 0.17,
          display: "flex",
        }}
      >
        <SlideIcon name="swings" size={Math.round(width * 0.2)} />
      </div>
    </div>
  );
}

/** A photo (cover-cropped), or the crayon card when there's none. */
function Picture({
  src,
  width,
  height,
  seed,
  ground,
}: {
  src: string | null;
  width: number;
  height: number;
  seed: number;
  ground?: number;
}) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      src={src}
      width={width}
      height={height}
      style={{ width, height, objectFit: "cover" }}
    />
  ) : (
    <CrayonParkArt width={width} height={height} seed={seed} ground={ground} />
  );
}

// --- Feed slides -------------------------------------------------------------

function HeadlineSlide({
  s,
  page,
}: {
  s: Extract<SlideSpec, { t: "headline" }>;
  page?: { n: number; of: number };
}) {
  const color = SLIDE_CRAYONS[0];
  return (
    <Frame page={page} color={color}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginTop: 20,
        }}
      >
        <div style={{ display: "flex", fontSize: 50, color: SOFT }}>
          {s.kicker}
        </div>
        <AnyIcon name={s.icon ?? "spin"} size={170} />
      </div>
      <div style={{ display: "flex", marginTop: 6 }}>
        <Scribble width={300} color={color} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
        }}
      >
        <HeadlineWords
          words={s.words}
          highlight={s.highlight}
          size={headlineSize(s.words)}
        />
        {s.sub?.length ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 54,
              color: SOFT,
              marginTop: 30,
              lineHeight: 1.25,
            }}
          >
            {townLines(s.sub).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        ) : null}
      </div>
      {s.swipe ? (
        <div
          style={{
            display: "flex",
            alignSelf: "flex-end",
            alignItems: "center",
            gap: 16,
            fontSize: 58,
          }}
        >
          <span>{COPY.swipe}</span>
          <SwipeArrow color={CRAYONS.red} />
        </div>
      ) : null}
    </Frame>
  );
}

function ItemSlide({
  s,
  page,
}: {
  s: Extract<SlideSpec, { t: "item" }>;
  page?: { n: number; of: number };
}) {
  const color = SLIDE_CRAYONS[s.n % SLIDE_CRAYONS.length];
  const nameSize = s.name.length > 34 ? 80 : s.name.length > 22 ? 92 : 108;
  return (
    <Frame page={page} color={color}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: "50% 46% 52% 48%",
            border: `7px solid ${INK}`,
            background: tint(color, 0.35),
            fontSize: 76,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {String(s.n)}
        </div>
        <SlideIcon name={s.icon} size={250} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: nameSize, lineHeight: 1.04 }}>
          {s.name}
        </div>
        <div style={{ display: "flex", marginTop: 4 }}>
          <Scribble width={360} color={color} />
        </div>
        <div
          style={{
            display: "flex",
            fontSize: s.what.length > 70 ? 60 : 68,
            lineHeight: 1.2,
            marginTop: 22,
          }}
        >
          {s.what}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {s.facts.map((f, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              fontSize: 48,
              padding: "6px 22px 10px",
              border: `5px solid ${INK}`,
              borderRadius: "26px 18px 28px 16px",
              background: i === 0 ? tint(color, 0.22) : CARD,
            }}
          >
            {f}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** A number in a hand-drawn circle (the slide's place, or a step). */
function NumberBlob({
  n,
  color,
  size,
}: {
  n: number;
  color: string;
  size: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50% 46% 52% 48%",
        border: `${size > 80 ? 7 : 5}px solid ${INK}`,
        background: tint(color, 0.35),
        fontSize: Math.round(size * 0.62),
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {String(n)}
    </div>
  );
}

function Chip({
  text,
  fill,
  size = 48,
}: {
  text: string;
  fill: string;
  size?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        padding: "6px 22px 10px",
        border: `5px solid ${INK}`,
        borderRadius: "26px 18px 28px 16px",
        background: fill,
      }}
    >
      {text}
    </div>
  );
}

/** The small line above a slide's title ("Idea 1 of 4"). */
function Kicker({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", fontSize: 50, color: SOFT }}>{text}</div>
  );
}

/**
 * An "at home" idea, laid out like a recipe card: the place and ages, the
 * name, what you need, 2 or 3 numbered steps, then the payoff as the
 * ending, in its own starred box, and code's safety line last. Type sizes
 * come from fit.ts: the largest that fits this idea's words.
 */
function IdeaSlide({
  s,
  page,
}: {
  s: Extract<SlideSpec, { t: "idea" }>;
  page?: { n: number; of: number };
}) {
  const color = SLIDE_CRAYONS[s.n % SLIDE_CRAYONS.length];
  const payoff = s.payoff ?? "";
  const fit = ideaFit({ ...s, payoff }, s.body ? [s.body] : undefined);
  const body = fit.body;
  return (
    <Frame page={page} color={color}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: IDEA.header,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Kicker text={`Idea ${s.n} of ${s.of}`} />
          <Chip text={s.ages} fill={tint(color, 0.3)} />
        </div>
        <AnyIcon name={s.icon} size={100} />
      </div>
      <div
        style={{
          display: "flex",
          fontSize: fit.title,
          lineHeight: 1.04,
          marginTop: 8,
        }}
      >
        {s.title}
      </div>
      <div style={{ display: "flex", marginTop: -8 }}>
        <Scribble width={300} color={color} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: IDEA.gap,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            background: tint(color, 0.12),
            border: `4px solid ${INK}`,
            borderRadius: "24px 16px 26px 14px",
            padding: "8px 24px 14px",
          }}
        >
          <div
            style={{
              display: "flex",
              width: IDEA.needLabelW,
              flexShrink: 0,
              fontSize: 42,
              color: SOFT,
              marginTop: Math.round((body - 42) / 2) + 4,
            }}
          >
            You need
          </div>
          <div
            style={{
              display: "flex",
              fontSize: body,
              lineHeight: 1.18,
              flex: 1,
            }}
          >
            {s.need}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {s.steps.map((step, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "flex-start", gap: 20 }}
            >
              <NumberBlob n={i + 1} color={color} size={56} />
              <div
                style={{
                  display: "flex",
                  fontSize: body,
                  lineHeight: 1.16,
                  flex: 1,
                }}
              >
                {step}
              </div>
            </div>
          ))}
        </div>
        {payoff ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              background: tint(color, 0.35),
              border: `6px solid ${INK}`,
              borderRadius: "30px 18px 34px 16px",
              boxShadow: `8px 10px 0 ${INK}`,
              padding: "8px 22px 14px",
            }}
          >
            <SlideIcon name="star" size={60} />
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", fontSize: 40, color: SOFT }}>
                {COPY.payoffLabel}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: body + 2,
                  lineHeight: 1.16,
                }}
              >
                {payoff}
              </div>
            </div>
          </div>
        ) : null}
        {s.safety ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 46,
              background: tint(CRAYONS.yellow, 0.35),
              border: `4px solid ${INK}`,
              borderRadius: "20px 14px 22px 12px",
              padding: "6px 20px 10px",
            }}
          >
            <SlideIcon name="heads_up" size={52} />
            <span>{s.safety}</span>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

/**
 * One event of the roundup. Every event slide has the same fixed layout
 * (date block, title from the same line, the same chip row), so no event
 * stands out from the others.
 */
function EventSlide({
  s,
  page,
}: {
  s: Extract<SlideSpec, { t: "event" }>;
  page?: { n: number; of: number };
}) {
  const color = SLIDE_CRAYONS[s.n % SLIDE_CRAYONS.length];
  const place = placeLine(s.venue, s.town);
  const fit = eventFit(
    {
      title: s.title,
      desc: s.desc,
      place,
      chips: [...s.ages, ...(s.cost ? [s.cost] : [])],
      host: s.host,
      also: s.also,
    },
    s.body ? [s.body] : undefined,
    s.titleSize ? [s.titleSize] : undefined,
  );
  return (
    <Frame page={page} color={color}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 40 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: 250,
            flexShrink: 0,
            border: `7px solid ${INK}`,
            borderRadius: "26px 16px 30px 14px",
            background: CARD,
            boxShadow: `8px 10px 0 ${INK}`,
            overflow: "hidden",
            transform: "rotate(-2deg)",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "center",
              background: tint(color, 0.75),
              borderBottom: `6px solid ${INK}`,
              fontSize: 60,
              padding: "2px 0 6px",
            }}
          >
            {s.weekday}
          </div>
          <div style={{ display: "flex", fontSize: 68, padding: "6px 0 12px" }}>
            {s.date}
          </div>
        </div>
        {/* The time lines up with the date block's top on every slide. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginTop: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: oneLine(s.time, TOP_ROW.time, TOP_ROW.width),
              lineHeight: 1.1,
            }}
          >
            {s.time}
          </div>
          {s.also ? (
            <div
              style={{
                display: "flex",
                fontSize: oneLine(s.also, TOP_ROW.also, TOP_ROW.width),
                color: SOFT,
                marginTop: 6,
              }}
            >
              {s.also}
            </div>
          ) : null}
        </div>
      </div>
      {/* What it is: the title, its scribble, and the descriptor close under it. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          left: 0,
          right: 0,
          top: EVENT.top,
        }}
      >
        <div
          style={{
            display: "flex",
            width: EVENT.titleWidth,
            fontSize: fit.title,
            lineHeight: 1.06,
            textWrap: "balance",
          }}
        >
          {s.title}
        </div>
        <div style={{ display: "flex", marginTop: -2 }}>
          <Scribble width={340} color={color} />
        </div>
        {s.desc ? (
          <div
            style={{
              display: "flex",
              fontSize: fit.body,
              lineHeight: 1.2,
              marginTop: EVENT.descGap,
              textWrap: "pretty",
            }}
          >
            {s.desc}
          </div>
        ) : null}
      </div>
      {/*
        Where, who and for whom, pinned to the card's foot: the venue and
        its host as a pair, then the chips last, so the chips sit at the
        same height on every slide of the carousel.
      */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          left: 0,
          right: 0,
          bottom: EVENT.foot,
        }}
      >
        <div
          style={{
            display: "flex",
            width: 120,
            height: 6,
            borderRadius: 3,
            background: tint(SOFT, 0.45),
            marginBottom: EVENT.rule - 6,
          }}
        />
        <div
          style={{
            display: "flex",
            fontSize: venueSize(fit.body),
            lineHeight: 1.15,
            textWrap: "pretty",
          }}
        >
          {place}
        </div>
        {s.host ? (
          <div
            style={{
              display: "flex",
              fontSize: hostSize(fit.body),
              color: SOFT,
              marginTop: EVENT.hostGap,
              lineHeight: 1.15,
              textWrap: "pretty",
            }}
          >
            {`Hosted by ${s.host}`}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 18,
            marginTop: EVENT.chipGap,
          }}
        >
          {s.ages.map((a) => (
            <Chip key={a} text={a} fill={tint(color, 0.3)} size={EVENT.chip} />
          ))}
          {s.cost ? <Chip text={s.cost} fill={CARD} size={EVENT.chip} /> : null}
        </div>
      </div>
    </Frame>
  );
}

function CtaSlide({
  s,
  page,
}: {
  s: Extract<SlideSpec, { t: "cta" }>;
  page?: { n: number; of: number };
}) {
  return (
    <Frame page={page} color={CRAYONS.blue}>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
        <SlideIcon name={s.icon ?? "mail"} size={s.url ? 190 : 230} />
      </div>
      <div
        style={{
          display: "flex",
          fontSize: s.url ? 84 : s.line.length > 30 ? 84 : 120,
          lineHeight: 1.1,
          textAlign: "center",
          justifyContent: "center",
          marginTop: 30,
        }}
      >
        {s.line}
      </div>
      {s.url ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            fontSize: 66,
            whiteSpace: "nowrap",
            marginTop: 6,
          }}
        >
          <span
            style={{
              borderBottom: `6px solid ${CRAYONS.blue}`,
              paddingBottom: 2,
            }}
          >
            {s.url}
          </span>
        </div>
      ) : null}
      {s.sub ? (
        <div
          style={{
            display: "flex",
            fontSize: 58,
            color: SOFT,
            justifyContent: "center",
            textAlign: "center",
            marginTop: 24,
          }}
        >
          {s.sub}
        </div>
      ) : null}
      {s.fine ? (
        <div
          style={{
            display: "flex",
            fontSize: 40,
            color: SOFT,
            justifyContent: "center",
            textAlign: "center",
            textWrap: "balance",
            marginTop: 20,
          }}
        >
          {s.fine}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          marginBottom: 60,
          alignSelf: "center",
          fontSize: 56,
          background: CRAYONS.yellow,
          border: `7px solid ${INK}`,
          borderRadius: "34px 22px 38px 20px",
          boxShadow: `8px 10px 0 ${INK}`,
          padding: "18px 40px 24px",
          textAlign: "center",
        }}
      >
        {s.cta}
      </div>
    </Frame>
  );
}

function WeatherSlide({
  s,
  page,
}: {
  s: Extract<SlideSpec, { t: "weather" }>;
  page?: { n: number; of: number };
}) {
  const colors = [CRAYONS.orange, CRAYONS.blue, CRAYONS.green];
  return (
    <Frame page={page} color={CRAYONS.teal}>
      <div style={{ display: "flex", fontSize: 96, marginTop: 10 }}>
        {s.title}
      </div>
      <div style={{ display: "flex" }}>
        <Scribble width={420} color={CRAYONS.teal} />
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {s.days.slice(0, 3).map((d, i) => (
          <DayCard key={d.label} d={d} color={colors[i]} width={282} />
        ))}
      </div>
      <div style={{ display: "flex", fontSize: 42, color: SOFT }}>
        Forecast: National Weather Service, Bend
      </div>
    </Frame>
  );
}

function ParkSlide({
  s,
  photo,
  page,
}: {
  s: Extract<SlideSpec, { t: "park" }>;
  photo: string | null;
  page?: { n: number; of: number };
}) {
  const w = 890;
  const h = 560;
  return (
    <Frame page={page} color={CRAYONS.green}>
      <div
        style={{ display: "flex", position: "relative", alignSelf: "center" }}
      >
        <div
          style={{
            display: "flex",
            border: `7px solid ${INK}`,
            borderRadius: "26px 14px 30px 12px",
            overflow: "hidden",
            transform: "rotate(-1.5deg)",
          }}
        >
          <Picture src={photo} width={w} height={h} seed={1} />
        </div>
        <Tape left={w / 2 - 95} top={-26} />
      </div>
      {photo && s.photo?.credit ? (
        <div
          style={{
            display: "flex",
            fontSize: 34,
            color: SOFT,
            marginTop: 14,
            alignSelf: "center",
          }}
        >
          {s.photo.credit}
        </div>
      ) : null}
      <div
        style={{ display: "flex", fontSize: 48, color: SOFT, marginTop: 18 }}
      >
        This week&apos;s pick
      </div>
      <div style={{ display: "flex", fontSize: 84, lineHeight: 1.04 }}>
        {`${s.park}, ${s.town}`}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: s.why.length > 180 ? 40 : s.why.length > 110 ? 46 : 54,
          lineHeight: 1.2,
          marginTop: 12,
        }}
      >
        {s.why}
      </div>
    </Frame>
  );
}

// --- The park post and the Story ---------------------------------------------

/**
 * Monday's park post: the checked photo (or the crayon park card) full
 * bleed, a taped crayon label, and the credit only when the photo itself
 * is drawn.
 */
function ParkCardSlide({
  s,
  photo,
}: {
  s: Extract<SlideSpec, { t: "parkcard" }>;
  photo: string | null;
}) {
  return (
    <div
      style={{
        width: FEED.width,
        height: FEED.height,
        display: "flex",
        position: "relative",
        fontFamily: "Gochi",
        color: INK,
        background: PAPER,
      }}
    >
      <Picture src={photo} width={FEED.width} height={FEED.height} seed={0} />
      <div
        style={{
          position: "absolute",
          left: 70,
          right: 70,
          bottom: 150,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: CARD,
          border: `7px solid ${INK}`,
          borderRadius: "40px 18px 46px 16px",
          boxShadow: `12px 14px 0 ${INK}`,
          padding: "26px 30px 30px",
          transform: "rotate(-2deg)",
        }}
      >
        <div
          style={{ display: "flex", fontSize: s.park.length > 22 ? 84 : 100 }}
        >
          {s.park}
        </div>
        <div style={{ display: "flex", fontSize: 56, color: SOFT }}>
          {`${s.town}, Oregon`}
        </div>
      </div>
      {photo && s.photo?.credit ? (
        <div
          style={{
            position: "absolute",
            left: 70,
            bottom: 70,
            display: "flex",
            fontSize: 36,
            background: "rgba(255, 253, 247, 0.92)",
            border: `4px solid ${INK}`,
            borderRadius: 16,
            padding: "4px 16px 8px",
          }}
        >
          {s.photo.credit}
        </div>
      ) : null}
    </div>
  );
}

function DayCard({
  d,
  color,
  width,
}: {
  d: Extract<SlideSpec, { t: "story" }>["days"][number];
  color: string;
  width: number;
}) {
  const ok = !d.missing && d.high != null;
  const pop = ok && d.precip != null && d.precip >= 20 ? d.precip : null;
  const big = width > 320;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width,
        background: CARD,
        border: `6px solid ${INK}`,
        borderRadius: "34px 18px 38px 16px",
        boxShadow: `6px 8px 0 ${INK}`,
        padding: "10px 8px 18px",
      }}
    >
      <div style={{ display: "flex", fontSize: big ? 58 : 52 }}>{d.label}</div>
      <div style={{ display: "flex", marginTop: -6 }}>
        <Scribble width={160} color={color} />
      </div>
      <WeatherGlyph
        icon={ok ? (d.icon as WeatherIcon) : "unknown"}
        size={big ? 140 : 150}
      />
      <div
        style={{
          display: "flex",
          fontSize: big ? 44 : 40,
          textAlign: "center",
          justifyContent: "center",
        }}
      >
        {ok ? d.condition : "No forecast yet"}
      </div>
      {ok ? (
        <div style={{ display: "flex", fontSize: big ? 58 : 62 }}>
          {`${d.high}°${d.low != null ? ` / ${d.low}°` : ""}`}
        </div>
      ) : null}
      {pop != null ? (
        <div style={{ display: "flex", fontSize: 34, color: SOFT }}>
          {`${pop}% ${d.icon === "snow" ? "snow" : "rain"}`}
        </div>
      ) : null}
    </div>
  );
}

function StorySlide({
  s,
  photo,
}: {
  s: Extract<SlideSpec, { t: "story" }>;
  photo: string | null;
}) {
  const w = 900;
  const h = 520;
  return (
    <div
      style={{
        width: STORY.width,
        height: STORY.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: PAPER,
        fontFamily: "Gochi",
        color: INK,
        paddingTop: 200,
        paddingBottom: 210,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 116,
          lineHeight: 1.25,
          transform: "rotate(-2deg)",
        }}
      >
        {COPY.storyKicker}
      </div>
      <div style={{ display: "flex", marginTop: 6 }}>
        <Scribble width={500} color={CRAYONS.orange} />
      </div>
      <div style={{ display: "flex", position: "relative", marginTop: 24 }}>
        <div
          style={{
            display: "flex",
            border: `7px solid ${INK}`,
            borderRadius: "26px 14px 30px 12px",
            overflow: "hidden",
            transform: "rotate(1.5deg)",
            boxShadow: `10px 12px 0 ${INK}`,
          }}
        >
          <Picture src={photo} width={w} height={h} seed={2} />
        </div>
        <Tape left={w / 2 - 95} top={-24} />
      </div>
      {photo && s.photo?.credit ? (
        <div
          style={{ display: "flex", fontSize: 34, color: SOFT, marginTop: 18 }}
        >
          {s.photo.credit}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          fontSize: s.park.length > 24 ? 80 : 96,
          lineHeight: 1.25,
          marginTop: 10,
        }}
      >
        {s.park}
      </div>
      <div
        style={{ display: "flex", fontSize: 50, color: SOFT, marginTop: 18 }}
      >
        {`${s.town}, Oregon`}
      </div>
      {s.days.length ? (
        <div style={{ display: "flex", gap: 34, marginTop: 22 }}>
          {s.days.slice(0, 2).map((d, i) => (
            <DayCard
              key={d.label}
              d={d}
              color={i ? CRAYONS.green : CRAYONS.blue}
              width={400}
            />
          ))}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginTop: "auto",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", fontSize: 56 }}>{COPY.story}</div>
        <div
          style={{
            display: "flex",
            fontSize: 78,
            background: CRAYONS.yellow,
            border: `7px solid ${INK}`,
            borderRadius: "40px 24px 44px 22px",
            boxShadow: `8px 10px 0 ${INK}`,
            padding: "6px 56px 16px",
          }}
        >
          {s.cta}
        </div>
      </div>
    </div>
  );
}

// --- One entry point -----------------------------------------------------------

/** A slide's pixel size: Stories 9:16, everything else 4:5. */
export function slideSize(s: SlideSpec): { width: number; height: number } {
  return s.t === "story" ? { ...STORY } : { ...FEED };
}

/**
 * Draw slide `i` of `slides`. `photo` is a data: URL of the checked photo
 * the slide names (null draws the crayon card, with no credit).
 */
export function Slide({
  slides,
  i,
  photo,
}: {
  slides: SlideSpec[];
  i: number;
  photo: string | null;
}) {
  const s = slides[i];
  const page = slides.length > 1 ? { n: i + 1, of: slides.length } : undefined;
  switch (s.t) {
    case "headline":
      return <HeadlineSlide s={s} page={page} />;
    case "item":
      return <ItemSlide s={s} page={page} />;
    case "idea":
      return <IdeaSlide s={s} page={page} />;
    case "event":
      return <EventSlide s={s} page={page} />;
    case "cta":
      return <CtaSlide s={s} page={page} />;
    case "weather":
      return <WeatherSlide s={s} page={page} />;
    case "park":
      return <ParkSlide s={s} photo={photo} page={page} />;
    case "parkcard":
      return <ParkCardSlide s={s} photo={photo} />;
    case "story":
      return <StorySlide s={s} photo={photo} />;
  }
}
