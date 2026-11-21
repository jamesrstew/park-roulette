import { ImageResponse } from "next/og";
import { handFont } from "@/components/me/og-card";
import {
  Scribble,
  Temp,
  WeatherGlyph,
  type WeatherIcon,
} from "@/components/news/WeatherCard";

/**
 * The issue's link preview, 1200 x 630 (iMessage shows a landscape image
 * this size large, full width). Drawn from the frozen issue only:
 *
 *   top band   the "Bend Playground Passport" wordmark and the date
 *   left 640   the featured park's photo, its credit drawn on at 22 px
 *   right 560  the crayon weather card, Saturday and Sunday, highs 64+ px
 *
 * An Indoor week, or a week with no photo, runs the card full width,
 * lettered "Indoor pick: {Venue}" or the park's name.
 */

export const PREVIEW_SIZE = { width: 1200, height: 630 };

export type PreviewDay = {
  /** "Saturday" */
  label: string;
  condition: string;
  icon: WeatherIcon;
  high: number;
  low: number | null;
};

export type PreviewInput = {
  /** "Dec 10, 2026" */
  dateLabel: string;
  days: PreviewDay[];
  /** The photo as a data URI (already cropped), and its credit line. */
  photo: { uri: string; credit: string } | null;
  /** Lettering for the full-width card: "Indoor pick: ..." or the park. */
  title: string;
};

const INK = "#2b2a33";
const SOFT = "#5d5a6b";
const PAPER = "#fffaf0";
const CARD = "#fffdf7";
const DAY_CRAYONS = ["#2f78d4", "#3aa35b"];
const BAND = 92;

function Day({
  day,
  color,
  big,
}: {
  day: PreviewDay;
  color: string;
  big: boolean;
}) {
  const long = day.condition.length > 11;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: big ? 330 : 236,
      }}
    >
      <div style={{ display: "flex", fontSize: 46, lineHeight: 1 }}>
        {day.label}
      </div>
      <div style={{ display: "flex", marginTop: -2 }}>
        <Scribble color={color} width={big ? 190 : 160} />
      </div>
      <div style={{ display: "flex", marginTop: 6 }}>
        <WeatherGlyph icon={day.icon} size={big ? 124 : 140} />
      </div>
      <div
        style={{
          display: "flex",
          fontSize: long ? (big ? 42 : 34) : big ? 46 : 40,
          lineHeight: 1,
          marginTop: 6,
          whiteSpace: "nowrap",
        }}
      >
        {day.condition}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          marginTop: 8,
        }}
      >
        <Temp value={day.high} size={big ? 90 : 84} color={INK} />
        {day.low != null && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              marginLeft: 8,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 44,
                lineHeight: 1,
                color: SOFT,
                marginRight: 6,
              }}
            >
              /
            </div>
            <Temp value={day.low} size={44} color={SOFT} />
          </div>
        )}
      </div>
    </div>
  );
}

/** A two-pass yellow highlighter swipe behind a line of lettering. */
function Lettering({ text, size }: { text: string; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        fontSize: size,
        lineHeight: 1.05,
        maxWidth: 1060,
        textAlign: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -8,
          right: -8,
          bottom: 4,
          height: Math.round(size * 0.42),
          background: "rgba(247, 201, 51, 0.7)",
          transform: "rotate(-1deg)",
          borderRadius: 10,
          display: "flex",
        }}
      />
      <div style={{ display: "flex", position: "relative" }}>{text}</div>
    </div>
  );
}

function titleSize(t: string) {
  if (t.length <= 24) return 68;
  if (t.length <= 34) return 58;
  if (t.length <= 44) return 48;
  return 40;
}

export function IssuePreview({ dateLabel, days, photo, title }: PreviewInput) {
  const full = !photo;
  const two = days.slice(0, 2);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: PAPER,
        fontFamily: "Gochi",
        color: INK,
        position: "relative",
      }}
    >
      {/* top band: the wordmark and the date */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          height: BAND,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 34px",
          borderBottom: `5px solid ${INK}`,
          background: PAPER,
        }}
      >
        <div style={{ display: "flex", position: "relative", fontSize: 54 }}>
          <div
            style={{
              position: "absolute",
              left: -6,
              right: -6,
              bottom: 8,
              height: 22,
              background: "rgba(247, 201, 51, 0.75)",
              transform: "rotate(-1.2deg)",
              borderRadius: 8,
              display: "flex",
            }}
          />
          <div style={{ display: "flex", position: "relative" }}>
            Bend Playground Passport
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 42, color: SOFT }}>
          {dateLabel}
        </div>
      </div>

      {/* left 640: the photo, with its credit drawn on */}
      {photo && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: BAND,
            width: 640,
            height: 630 - BAND,
            display: "flex",
            borderRight: `5px solid ${INK}`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori */}
          <img
            src={photo.uri}
            width={640}
            height={630 - BAND}
            alt=""
            style={{ objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              display: "flex",
              padding: "6px 14px 8px 14px",
              background: "rgba(43, 42, 51, 0.78)",
              color: "#fffaf0",
              fontSize: 22,
              lineHeight: 1.1,
              maxWidth: 635,
            }}
          >
            {photo.credit}
          </div>
        </div>
      )}

      {/* the crayon card: right 560, or full width */}
      <div
        style={{
          position: "absolute",
          left: full ? 30 : 664,
          right: 34,
          top: BAND + 20,
          bottom: 30,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          border: `6px solid ${INK}`,
          borderRadius: "40px 18px 46px 16px",
          background: CARD,
          boxShadow: `9px 10px 0 ${INK}`,
        }}
      >
        {full && (
          <div style={{ display: "flex", marginBottom: two.length ? 14 : 0 }}>
            <Lettering text={title} size={titleSize(title)} />
          </div>
        )}
        {two.length ? (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              gap: full ? 60 : 8,
            }}
          >
            {two.map((d, i) => (
              <Day key={d.label} day={d} color={DAY_CRAYONS[i]} big={full} />
            ))}
          </div>
        ) : (
          !full && <Lettering text={title} size={titleSize(title) - 16} />
        )}
      </div>
    </div>
  );
}

/** The preview as a PNG (the route turns it into a JPEG). */
export async function renderIssuePreview(input: PreviewInput) {
  const res = new ImageResponse(<IssuePreview {...input} />, {
    ...PREVIEW_SIZE,
    fonts: await handFont(),
  });
  return Buffer.from(await res.arrayBuffer());
}
