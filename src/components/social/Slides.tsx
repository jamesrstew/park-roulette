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
  commonBody,
  CONTENT,
  EVENT,
  eventFit,
  hostSize,
  IDEA,
  ideaFit,
  ITEM,
  itemFit,
  itemHostSize,
  itemPlaceSize,
  oneLine,
  PAIR,
  pairFit,
  STORY_CONTENT,
  STORY_PAIR,
  STORY_TYPE,
  textWidth,
  TOP_ROW,
  venueSize,
} from "./fit";
import { placeLine } from "@/lib/social/compose";
import { COPY, FEED, type SlideSpec, STORY } from "@/lib/social/model";

export const INK = "#2b2a33";
export const PAPER = "#fffaf0";
export const CARD = "#fffdf7";
export const SOFT = "#5d5a6b";
/** The event slide's host line: one step darker than SOFT, still quieter than ink. */
const HOST_GRAY = "#4a4756";
/** The date tile's height on an event slide (header, date, borders). */
const DATE_TILE_HEIGHT = 196;
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

export function Tape({
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
export function SwipeArrow({ color }: { color: string }) {
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
export function Scribble({ width, color }: { width: number; color: string }) {
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

/**
 * Where the card, its content and its footer sit: on the 4:5 feed slide,
 * and on the 9:16 Story frame (the Story echo). On a Story, Instagram's
 * own top and bottom bands (about 250 px each) cover the frame, so the
 * card's words and footer stay between 290 and 1630; only the card's
 * edge reaches into them.
 */
export const FRAME = {
  feed: {
    ...FEED,
    card: { top: 34, bottom: 48 },
    stripe: 120,
    content: { top: 92, bottom: 170 },
    foot: 82,
  },
  story: {
    ...STORY,
    card: { top: 210, bottom: 210 },
    stripe: 296,
    content: { top: 290, bottom: 1920 - 290 - STORY_CONTENT.height },
    foot: 290,
  },
} as const;

/** Props every slide takes: its page count, and whether it's a Story frame. */
type Where = { page?: { n: number; of: number }; story?: boolean };

/** The paper card every slide sits on, with the brand and page count. */
export function Frame({
  children,
  page,
  color,
  story = false,
}: {
  children: ReactNode;
  page?: { n: number; of: number };
  color: string;
  story?: boolean;
}) {
  const f = story ? FRAME.story : FRAME.feed;
  return (
    <div
      style={{
        width: f.width,
        height: f.height,
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
          top: f.card.top,
          right: 48,
          bottom: f.card.bottom,
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
          top: f.stripe,
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
          top: f.content.top,
          right: 100,
          bottom: f.content.bottom,
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
          bottom: f.foot,
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
            bottom: f.foot + 8,
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
export function HeadlineWords({
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

/** A line never breaks right before "&": it stays with the word before it. */
const keepAmp = (t: string) => t.replace(/ &/g, "\u00a0&");

/**
 * A width that wraps these words into balanced lines (never a last word
 * alone): the even share of their width per line, plus the widest word's
 * slack, capped at the card. Words are flex items here, so CSS balance
 * can't do it.
 */
function balancedWidth(
  words: string[],
  size: number,
  gap: number,
  max: number = CONTENT.width,
): number {
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
  const n = linesAt(max);
  if (n <= 1) return max;
  // The narrowest box that still wraps into the same number of lines.
  let box = Math.max(...widths);
  while (box < max && linesAt(box) > n) box += 4;
  return Math.min(max, box + 6);
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
  sunTop,
}: {
  width: number;
  height: number;
  seed?: number;
  /** Where the grass starts, from the top (0 to 1). */
  ground?: number;
  /** The sun's top, px (default: near the top edge). */
  sunTop?: number;
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
          top: sunTop ?? height * 0.06,
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
  sunTop,
}: {
  src: string | null;
  width: number;
  height: number;
  seed: number;
  ground?: number;
  sunTop?: number;
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
    <CrayonParkArt
      width={width}
      height={height}
      seed={seed}
      ground={ground}
      sunTop={sunTop}
    />
  );
}

// --- Feed slides -------------------------------------------------------------

function HeadlineSlide({
  s,
  page,
  story,
}: Where & {
  s: Extract<SlideSpec, { t: "headline" }>;
}) {
  const color = SLIDE_CRAYONS[0];
  return (
    <Frame page={page} color={color} story={story}>
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
        {s.pairIcon && s.icon ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <AnyIcon name={s.icon} size={160} />
            <div
              style={{
                display: "flex",
                fontSize: 100,
                color: CRAYONS.red,
                marginTop: -10,
              }}
            >
              +
            </div>
            <SlideIcon name="playground" size={160} />
          </div>
        ) : (
          <AnyIcon name={s.icon ?? "spin"} size={170} />
        )}
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
      {/* A swipe on a Story skips to the next account: no "Swipe" there. */}
      {s.swipe && !story ? (
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
  story,
}: Where & {
  s: Extract<SlideSpec, { t: "item" }>;
}) {
  const color = SLIDE_CRAYONS[s.n % SLIDE_CRAYONS.length];
  const fit = story
    ? itemFit(s, {
        whats: [...STORY_TYPE.itemWhat, ...ITEM.what],
        names: [...STORY_TYPE.itemName, ...ITEM.name],
        height: STORY_CONTENT.height,
      })
    : itemFit(s);
  const chips = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        flexShrink: 0,
        gap: 16,
        marginTop: story ? ITEM.chipsGap + 16 : ITEM.chipsGap,
      }}
    >
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
  );
  return (
    <Frame page={page} color={color} story={story}>
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
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            fontSize: fit.name,
            lineHeight: 1.04,
            textWrap: "balance",
          }}
        >
          {keepAmp(s.name)}
        </div>
        <div style={{ display: "flex", flexShrink: 0, marginTop: 4 }}>
          <Scribble width={360} color={color} />
        </div>
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            fontSize: fit.what,
            lineHeight: 1.2,
            marginTop: ITEM.whatGap,
            textWrap: "balance",
          }}
        >
          {keepAmp(s.what)}
        </div>
        {/* An event's where and who, as the roundup prints them. */}
        {s.place ? (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              fontSize: itemPlaceSize(fit.what),
              lineHeight: 1.15,
              marginTop: ITEM.placeGap,
              textWrap: "balance",
            }}
          >
            {keepAmp(s.place)}
          </div>
        ) : null}
        {s.place && s.host ? (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              fontSize: itemHostSize(fit.what),
              color: HOST_GRAY,
              lineHeight: 1.15,
              marginTop: ITEM.hostGap,
              textWrap: "balance",
            }}
          >
            {keepAmp(`Hosted by ${s.host}`)}
          </div>
        ) : null}
        {/* On a Story frame's tall card the chips stay with their words. */}
        {story ? chips : null}
      </div>
      {story ? null : chips}
    </Frame>
  );
}

/**
 * One park pairing: the place, "+" the park, in big type; how far apart
 * and the place's details as chips; then the park's own trait under a
 * small label. The theme's icon and the playground meet in the top row.
 */
function PairSlide({
  s,
  page,
  story,
}: Where & {
  s: Extract<SlideSpec, { t: "pair" }>;
}) {
  const color = SLIDE_CRAYONS[s.n % SLIDE_CRAYONS.length];
  const copy = {
    place: s.place,
    park: s.park,
    chips: [s.apart, ...s.chips],
    trait: s.trait,
  };
  // The carousel's own sizes (storySizes sets a Story frame's); a slide
  // stored without them fits itself.
  const fit =
    s.nameSize && s.body
      ? { name: s.nameSize, body: s.body }
      : pairFit(copy, story ? { height: STORY_CONTENT.height } : {});
  return (
    <Frame page={page} color={color} story={story}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: PAIR.header - 30,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <NumberBlob n={s.n} color={color} size={120} />
          <div style={{ display: "flex", fontSize: 54, color: SOFT }}>
            {s.town}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <AnyIcon name={s.icon} size={150} />
          <div
            style={{
              display: "flex",
              fontSize: 96,
              color: CRAYONS.red,
              marginTop: -10,
            }}
          >
            +
          </div>
          <SlideIcon name="playground" size={150} />
        </div>
      </div>
      {/* Top-aligned under the header, so every slide's names and chips
          sit at the same height and any spare room falls above the footer. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "flex-start",
          marginTop: 40,
        }}
      >
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            width: CONTENT.width,
            fontSize: fit.name,
            lineHeight: 1.04,
            textWrap: "balance",
          }}
        >
          {keepAmp(s.place)}
        </div>
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            width: CONTENT.width,
            fontSize: fit.name,
            lineHeight: 1.04,
          }}
        >
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              color: CRAYONS.red,
              width: fit.name * PAIR.plus,
            }}
          >
            +
          </div>
          <div
            style={{
              display: "flex",
              flexShrink: 1,
              width: CONTENT.width - fit.name * PAIR.plus,
              textWrap: "balance",
            }}
          >
            {keepAmp(s.park)}
          </div>
        </div>
        <div style={{ display: "flex", flexShrink: 0, marginTop: 4 }}>
          <Scribble width={360} color={color} />
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            flexShrink: 0,
            gap: 16,
            marginTop: PAIR.chipsGap,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: PAIR.chip,
              padding: "6px 22px 10px 14px",
              border: `5px solid ${INK}`,
              borderRadius: "26px 18px 28px 16px",
              background: tint(color, 0.3),
            }}
          >
            <SlideIcon name={s.walk ? "trail" : "car"} size={52} />
            <span>{s.apart}</span>
          </div>
          {s.chips.map((c) => (
            <Chip key={c} text={c} fill={CARD} />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            fontSize: PAIR.label,
            color: SOFT,
            marginTop: PAIR.traitGap,
          }}
        >
          At the park
        </div>
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            fontSize: fit.body,
            lineHeight: 1.2,
            marginTop: 6,
            textWrap: "balance",
          }}
        >
          {keepAmp(s.trait)}
        </div>
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
  story,
}: Where & {
  s: Extract<SlideSpec, { t: "idea" }>;
}) {
  const color = SLIDE_CRAYONS[s.n % SLIDE_CRAYONS.length];
  const payoff = s.payoff ?? "";
  const fit = ideaFit(
    { ...s, payoff },
    s.body ? [s.body] : undefined,
    story ? STORY_CONTENT.height : undefined,
  );
  const body = fit.body;
  return (
    <Frame page={page} color={color} story={story}>
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
  story,
}: Where & {
  s: Extract<SlideSpec, { t: "event" }>;
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
    story ? STORY_CONTENT.height : undefined,
  );
  return (
    <Frame page={page} color={color} story={story}>
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
            // With "Also": both lines from the tile's top. Without: the
            // time alone, centered on the tile's height.
            ...(s.also
              ? { marginTop: 4 }
              : { height: DATE_TILE_HEIGHT, justifyContent: "center" }),
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
      {/*
        One connected block under the date and time: what it is (title,
        scribble, descriptor), a short rule, then where and for whom (venue,
        host, chips), with fixed gaps inside. It sits centered between the
        header and the footer, so spare room falls evenly above and below.
      */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          position: "absolute",
          left: 0,
          right: 0,
          top: EVENT.top,
          bottom: EVENT.foot,
        }}
      >
        {/*
          Words as items, broken only at spaces ("Sing-Along" never splits
          at its hyphen; the font has no non-breaking hyphen), in balanced
          lines no wider than the title measure.
        */}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            flexWrap: "wrap",
            width: balancedWidth(
              keepAmp(s.title).split(/ +/),
              fit.title,
              fit.title * 0.24,
              EVENT.titleWidth,
            ),
            fontSize: fit.title,
            lineHeight: 1.06,
            columnGap: fit.title * 0.24,
          }}
        >
          {keepAmp(s.title)
            .split(/ +/)
            .map((w, i) => (
              <span key={i}>{w}</span>
            ))}
        </div>
        <div style={{ display: "flex", flexShrink: 0, marginTop: -2 }}>
          <Scribble width={340} color={color} />
        </div>
        {s.desc ? (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              fontSize: fit.body,
              lineHeight: 1.2,
              marginTop: EVENT.descGap,
              textWrap: "balance",
            }}
          >
            {keepAmp(s.desc)}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            width: 120,
            height: 6,
            borderRadius: 3,
            background: tint(SOFT, 0.45),
            marginTop: EVENT.ruleGap,
            marginBottom: EVENT.rule - 6,
          }}
        />
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            fontSize: venueSize(fit.body),
            lineHeight: 1.15,
            textWrap: "balance",
          }}
        >
          {keepAmp(place)}
        </div>
        {s.host ? (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              fontSize: hostSize(fit.body),
              color: HOST_GRAY,
              marginTop: EVENT.hostGap,
              lineHeight: 1.15,
              textWrap: "balance",
            }}
          >
            {keepAmp(`Hosted by ${s.host}`)}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
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
  story,
}: Where & {
  s: Extract<SlideSpec, { t: "cta" }>;
}) {
  // A Story has no comments (and a Story reply only answers PICK): its
  // close points at the bio link instead.
  const cta = story && s.cta === COPY.commentSlide ? COPY.bio : s.cta;
  return (
    <Frame page={page} color={CRAYONS.blue} story={story}>
      {/*
        The roundup's close (with fine print) is one group centered on the
        card: icon, line, link, tagline, fine print, then the button close
        under it. Other closes keep the button at the foot.
      */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          // A Story frame centers the whole close: its card is tall.
          marginTop: s.fine || story ? "auto" : 20,
        }}
      >
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
          marginTop: s.fine || story ? 40 : "auto",
          marginBottom: s.fine || story ? "auto" : 60,
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
        {cta}
      </div>
    </Frame>
  );
}

function WeatherSlide({
  s,
  page,
  story,
}: Where & {
  s: Extract<SlideSpec, { t: "weather" }>;
}) {
  const colors = [CRAYONS.orange, CRAYONS.blue, CRAYONS.green];
  return (
    <Frame page={page} color={CRAYONS.teal} story={story}>
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
          <DayCard
            key={d.label}
            d={d}
            color={colors[i]}
            width={282}
            tall={story}
          />
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
  story,
}: Where & {
  s: Extract<SlideSpec, { t: "park" }>;
  photo: string | null;
}) {
  const w = 890;
  // The Story frame's taller card gives the picture the room.
  const h = story ? 760 : 560;
  return (
    <Frame page={page} color={CRAYONS.green} story={story}>
      {/* On a Story frame the picture and its words sit centered on the card. */}
      <div
        style={{
          display: "flex",
          position: "relative",
          alignSelf: "center",
          ...(story ? { marginTop: "auto" } : {}),
        }}
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
          ...(story ? { marginBottom: "auto" } : {}),
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
  story,
}: {
  s: Extract<SlideSpec, { t: "parkcard" }>;
  photo: string | null;
  story?: boolean;
}) {
  if (story) return <ParkCardStory s={s} photo={photo} />;
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

/**
 * The park post on a Story frame: the photo (or the crayon card) fills the
 * top of the frame at about the feed's own scale (the catalog photos are
 * landscape: a full 9:16 bleed would blow them up), and the same taped
 * label sits across its foot, with the credit under it, all above the
 * band Instagram draws over the bottom.
 */
const PARKCARD_STORY = { picture: 1400, label: 1290 } as const;

function ParkCardStory({
  s,
  photo,
}: {
  s: Extract<SlideSpec, { t: "parkcard" }>;
  photo: string | null;
}) {
  return (
    <div
      style={{
        width: STORY.width,
        height: STORY.height,
        display: "flex",
        position: "relative",
        fontFamily: "Gochi",
        color: INK,
        background: PAPER,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          display: "flex",
          borderBottom: `7px solid ${INK}`,
        }}
      >
        <Picture
          src={photo}
          width={STORY.width}
          height={PARKCARD_STORY.picture}
          seed={0}
          // Below Instagram's own top bar and its close button.
          sunTop={300}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 70,
          right: 70,
          top: PARKCARD_STORY.label,
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
            left: 0,
            right: 0,
            top: PARKCARD_STORY.label + 270,
            display: "flex",
            justifyContent: "center",
            fontSize: 36,
            color: SOFT,
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
  tall = false,
}: {
  d: Extract<SlideSpec, { t: "story" }>["days"][number];
  color: string;
  width: number;
  /** On a Story frame's taller card: a bigger glyph and more air. */
  tall?: boolean;
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
        padding: tall ? "24px 8px 34px" : "10px 8px 18px",
        gap: tall ? 10 : 0,
      }}
    >
      <div style={{ display: "flex", fontSize: big || tall ? 58 : 52 }}>
        {d.label}
      </div>
      <div style={{ display: "flex", marginTop: -6 }}>
        <Scribble width={160} color={color} />
      </div>
      <WeatherGlyph
        icon={ok ? (d.icon as WeatherIcon) : "unknown"}
        size={tall ? 200 : big ? 140 : 150}
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
        <div style={{ display: "flex", fontSize: big ? 58 : tall ? 68 : 62 }}>
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

/**
 * A slide's pixel size: Stories 9:16, everything else 4:5, and any slide
 * drawn as a Story frame (the Story echo) 9:16.
 */
export function slideSize(
  s: SlideSpec,
  frame: SlideFrame = "feed",
): { width: number; height: number } {
  return s.t === "story" || frame === "story" ? { ...STORY } : { ...FEED };
}

/** How a slide is drawn: as the feed post's slide, or as a Story frame. */
export type SlideFrame = "feed" | "story";

/**
 * A carousel's slides with their Story-frame type sizes: one body (and
 * one event title) for the whole set, as on the feed, but the largest
 * that fits the taller Story card, never smaller than the feed's.
 */
export function storySizes(slides: SlideSpec[]): SlideSpec[] {
  const ideas = slides.flatMap((s) => (s.t === "idea" ? [s] : []));
  const events = slides.flatMap((s) => (s.t === "event" ? [s] : []));
  const ideaCopy = (s: Extract<SlideSpec, { t: "idea" }>) => ({
    ...s,
    payoff: s.payoff ?? "",
  });
  const ideaBody = commonBody(
    ideas.map((s) =>
      ideaFit(
        ideaCopy(s),
        [
          ...STORY_TYPE.ideaBody,
          ...IDEA.body.filter((b) => b >= (s.body ?? 0)),
        ],
        STORY_CONTENT.height,
      ),
    ),
  );
  const eventCopy = (s: Extract<SlideSpec, { t: "event" }>) => ({
    title: s.title,
    desc: s.desc,
    place: placeLine(s.venue, s.town),
    chips: [...s.ages, ...(s.cost ? [s.cost] : [])],
    host: s.host,
    also: s.also,
  });
  const atLeast = (ladder: readonly number[], floor?: number) =>
    ladder.filter((v) => v >= (floor ?? 0));
  const eventBody = commonBody(
    events.map((s) =>
      eventFit(
        eventCopy(s),
        [...STORY_TYPE.eventBody, ...atLeast(EVENT.body, s.body)],
        [...STORY_TYPE.eventTitle, ...atLeast(EVENT.title, s.titleSize)],
        STORY_CONTENT.height,
      ),
    ),
  );
  const eventTitle =
    eventBody === undefined
      ? undefined
      : Math.min(
          ...events.map(
            (s) =>
              eventFit(
                eventCopy(s),
                [eventBody],
                [
                  ...STORY_TYPE.eventTitle,
                  ...atLeast(EVENT.title, s.titleSize),
                ],
                STORY_CONTENT.height,
              ).title,
          ),
        );
  const pairs = slides.flatMap((s) => (s.t === "pair" ? [s] : []));
  const pairCopy = (s: Extract<SlideSpec, { t: "pair" }>) => ({
    place: s.place,
    park: s.park,
    chips: [s.apart, ...s.chips],
    trait: s.trait,
  });
  const pairBody = commonBody(
    pairs.map((s) =>
      pairFit(pairCopy(s), {
        names: [...STORY_PAIR.name, ...atLeast(PAIR.name, s.nameSize)],
        bodies: [...STORY_PAIR.body, ...atLeast(PAIR.body, s.body)],
        height: STORY_CONTENT.height,
      }),
    ),
  );
  const pairName =
    pairBody === undefined
      ? undefined
      : Math.min(
          ...pairs.map(
            (s) =>
              pairFit(pairCopy(s), {
                names: [...STORY_PAIR.name, ...atLeast(PAIR.name, s.nameSize)],
                bodies: [pairBody],
                height: STORY_CONTENT.height,
              }).name,
          ),
        );
  return slides.map((s) =>
    s.t === "pair" && pairBody !== undefined
      ? { ...s, body: pairBody, nameSize: pairName }
      : s.t === "idea" && ideaBody !== undefined
        ? { ...s, body: ideaBody }
        : s.t === "event" && eventBody !== undefined
          ? { ...s, body: eventBody, titleSize: eventTitle }
          : s,
  );
}

/**
 * Draw slide `i` of `slides`. `photo` is a data: URL of the checked photo
 * the slide names (null draws the crayon card, with no credit). `frame`
 * "story" draws the same slide re-laid out for a 9:16 Story frame (the
 * Story echo): the same words and picture, a taller card.
 */
export function Slide({
  slides,
  i,
  photo,
  frame = "feed",
}: {
  slides: SlideSpec[];
  i: number;
  photo: string | null;
  frame?: SlideFrame;
}) {
  const story = frame === "story";
  const s = story ? storySizes(slides)[i] : slides[i];
  const page = slides.length > 1 ? { n: i + 1, of: slides.length } : undefined;
  const w = { page, story };
  switch (s.t) {
    case "headline":
      return <HeadlineSlide s={s} {...w} />;
    case "item":
      return <ItemSlide s={s} {...w} />;
    case "pair":
      return <PairSlide s={s} {...w} />;
    case "idea":
      return <IdeaSlide s={s} {...w} />;
    case "event":
      return <EventSlide s={s} {...w} />;
    case "cta":
      return <CtaSlide s={s} {...w} />;
    case "weather":
      return <WeatherSlide s={s} {...w} />;
    case "park":
      return <ParkSlide s={s} photo={photo} {...w} />;
    case "parkcard":
      return <ParkCardSlide s={s} photo={photo} story={story} />;
    case "story":
      return <StorySlide s={s} photo={photo} />;
  }
}
