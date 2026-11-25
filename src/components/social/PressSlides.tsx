import type { ReactNode } from "react";
import { WheelArt } from "@/components/me/brand-art";
import { CRAYONS } from "@/lib/crayons";
import { STORY } from "@/lib/social/model";
import type { PressPost } from "@/lib/social/press";
import {
  CARD,
  Frame,
  HeadlineWords,
  INK,
  PAPER,
  Scribble,
  SlideIcon,
  SOFT,
  SwipeArrow,
  Tape,
  tint,
} from "./Slides";

/**
 * A one-off press post (lib/social/press.ts) in the feed's crayon style:
 * slide 1 is "We made the paper" over a clipping of the story's headline,
 * slide 2 is one quote and the close; the Story puts both on one 9:16
 * card. No photos and no outlet logos: a plain drawn newspaper and the
 * outlet's name in our own hand.
 */

/** A plain crayon newspaper (no masthead, no logo). */
function Newspaper({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path
        d="M16 18 L 84 14 L 86 82 C 86 88, 82 90, 76 90 L 22 90 C 16 90, 12 86, 13 80 Z"
        fill={CARD}
        stroke={INK}
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
      <path
        d="M22 27 L 76 25"
        stroke={INK}
        strokeWidth={6}
        strokeLinecap="round"
      />
      <rect
        x={23}
        y={36}
        width={26}
        height={22}
        rx={3}
        fill={tint(CRAYONS.green, 0.5)}
        stroke={INK}
        strokeWidth={3.5}
      />
      {[38, 46, 54].map((y) => (
        <path
          key={y}
          d={`M56 ${y} L 76 ${y - 0.5}`}
          stroke={SOFT}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
      ))}
      {[66, 74, 82].map((y) => (
        <path
          key={y}
          d={`M23 ${y} L 76 ${y - 1}`}
          stroke={SOFT}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** The story's headline as a taped clipping. */
function Clipping({
  p,
  width,
  size,
  rotate,
}: {
  p: PressPost;
  width: number;
  size: number;
  rotate: number;
}) {
  return (
    <div style={{ display: "flex", position: "relative", width }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width,
          background: "#ffffff",
          border: `6px solid ${INK}`,
          borderRadius: "14px 8px 18px 6px",
          boxShadow: `10px 12px 0 ${INK}`,
          padding: "34px 40px 32px",
          transform: `rotate(${rotate}deg)`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 36,
            color: SOFT,
            borderBottom: `4px solid ${INK}`,
            paddingBottom: 10,
          }}
        >
          <span>{p.outlet}</span>
          <span>{p.date}</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: size,
            lineHeight: 1.18,
            marginTop: 18,
          }}
        >
          {p.headline}
        </div>
        <div
          style={{ display: "flex", fontSize: 36, color: SOFT, marginTop: 16 }}
        >
          {`By ${p.byline}`}
        </div>
      </div>
      <Tape left={width / 2 - 95} top={-26} />
    </div>
  );
}

/** A quote with a big crayon quote mark and who said it. */
function Quote({
  text,
  who,
  where,
  size,
  color,
}: {
  text: string;
  who: string;
  where: string;
  size: number;
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          fontSize: 220,
          lineHeight: 0.8,
          height: 120,
          color,
        }}
      >
        {"“"}
      </div>
      <div style={{ display: "flex", fontSize: size, lineHeight: 1.22 }}>
        {text}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 44,
          color: SOFT,
          marginTop: 26,
        }}
      >
        {`${who}, in ${where}`}
      </div>
    </div>
  );
}

function Button({ text, size }: { text: string; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        background: CRAYONS.yellow,
        border: `7px solid ${INK}`,
        borderRadius: "34px 22px 38px 20px",
        boxShadow: `8px 10px 0 ${INK}`,
        padding: "14px 44px 22px",
      }}
    >
      {text}
    </div>
  );
}

export function PressCover({ p, of }: { p: PressPost; of: number }) {
  const color = CRAYONS.orange;
  return (
    <Frame page={{ n: 1, of }} color={color}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 10,
        }}
      >
        <div style={{ display: "flex", fontSize: 54, color: SOFT }}>
          {`As seen in ${p.outlet}`}
        </div>
        <Newspaper size={150} />
      </div>
      <div style={{ display: "flex", marginTop: -6 }}>
        <Scribble width={300} color={color} />
      </div>
      <div style={{ display: "flex", marginTop: 24 }}>
        <HeadlineWords words="We made the paper" highlight="paper" size={132} />
      </div>
      <div style={{ display: "flex", marginTop: 50, marginLeft: 6 }}>
        <Clipping p={p} width={860} size={56} rotate={-1.5} />
      </div>
      <div
        style={{
          display: "flex",
          alignSelf: "flex-end",
          alignItems: "center",
          gap: 16,
          fontSize: 58,
          marginTop: "auto",
        }}
      >
        <span>Swipe</span>
        <SwipeArrow color={CRAYONS.red} />
      </div>
    </Frame>
  );
}

export function PressQuote({
  p,
  quote,
  n,
  of,
}: {
  p: PressPost;
  quote: number;
  n: number;
  of: number;
}) {
  const q = p.quotes[quote];
  return (
    <Frame page={{ n, of }} color={CRAYONS.blue}>
      <div style={{ display: "flex", marginTop: 10 }}>
        <Quote
          text={q.text}
          who={q.who}
          where={p.outlet}
          size={68}
          color={CRAYONS.blue}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginTop: "auto",
          marginBottom: 10,
          gap: 30,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 46,
          }}
        >
          <SlideIcon name="map" size={84} />
          <span>110 parks across Central Oregon. Free.</span>
        </div>
        <Button text="Spin the wheel: link in bio" size={60} />
      </div>
    </Frame>
  );
}

/** Instagram's top and bottom bands cover about 250 px each. */
const STORY_SAFE = 250;

/**
 * A feed slide's content re-laid out for a 9:16 Story frame: the same
 * paper card and crayon stripe, with every word between the safe bands.
 */
function StoryFrame({
  children,
  color,
}: {
  children: ReactNode;
  color: string;
}) {
  return (
    <div
      style={{
        width: STORY.width,
        height: STORY.height,
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
          top: STORY_SAFE - 60,
          right: 48,
          bottom: STORY_SAFE - 60,
          display: "flex",
          border: `7px solid ${INK}`,
          borderRadius: "46px 20px 52px 18px",
          background: CARD,
          boxShadow: `12px 14px 0 ${INK}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 34,
          top: STORY_SAFE + 30,
          width: 14,
          height: 260,
          background: color,
          borderRadius: 8,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 90,
          top: STORY_SAFE + 20,
          right: 100,
          bottom: STORY_SAFE + 20,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div
      style={{
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
  );
}

/** Story frame 1: the cover slide, re-flowed for 9:16. */
export function PressStoryCover({ p }: { p: PressPost }) {
  const color = CRAYONS.orange;
  return (
    <StoryFrame color={color}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: 56, color: SOFT }}>
          {`As seen in ${p.outlet}`}
        </div>
        <Newspaper size={150} />
      </div>
      <div style={{ display: "flex", marginTop: -6 }}>
        <Scribble width={300} color={color} />
      </div>
      <div style={{ display: "flex", marginTop: 60 }}>
        <HeadlineWords words="We made the paper" highlight="paper" size={150} />
      </div>
      <div style={{ display: "flex", marginTop: 110, marginLeft: 6 }}>
        <Clipping p={p} width={860} size={60} rotate={-1.5} />
      </div>
      <div style={{ display: "flex", marginTop: "auto" }}>
        <Brand />
      </div>
    </StoryFrame>
  );
}

/** Story frame 2: the quote slide, re-flowed, with the link-in-bio cue. */
export function PressStoryQuote({ p, quote }: { p: PressPost; quote: number }) {
  const q = p.quotes[quote];
  return (
    <StoryFrame color={CRAYONS.blue}>
      <div style={{ display: "flex", marginTop: 40 }}>
        <Quote
          text={q.text}
          who={q.who}
          where={p.outlet}
          size={76}
          color={CRAYONS.blue}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginTop: "auto",
          gap: 34,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 48,
          }}
        >
          <SlideIcon name="map" size={88} />
          <span>110 parks across Central Oregon. Free.</span>
        </div>
        <Button text="Spin the wheel: link in bio" size={62} />
      </div>
      <div style={{ display: "flex", marginTop: 50 }}>
        <Brand />
      </div>
    </StoryFrame>
  );
}
