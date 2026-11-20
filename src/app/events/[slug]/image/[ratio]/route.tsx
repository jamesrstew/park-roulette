import { ImageResponse } from "next/og";
import { handFont } from "@/components/me/og-card";
import { eventBySlug } from "@/lib/events/store";
import { shortDate, upcomingDates } from "@/lib/events/model";

/**
 * The event's own image, in our crayon style (Google wants an image about
 * the event, never the venue's photo): its name, next date and venue, at
 * 1:1, 4:3 and 16:9 for Event markup, and 16:9 for link previews.
 */
const SIZES: Record<string, { width: number; height: number }> = {
  "1x1": { width: 1200, height: 1200 },
  "4x3": { width: 1200, height: 900 },
  "16x9": { width: 1200, height: 675 },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; ratio: string }> },
) {
  const { slug, ratio } = await params;
  const size = SIZES[ratio];
  const row = size ? await eventBySlug(slug) : null;
  if (!row || !size)
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  const e = row.data;
  const next = upcomingDates(e, new Date())[0] ?? e.dates[e.dates.length - 1];
  const fonts = await handFont();
  const big = size.height >= 900;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#fffaf0",
        fontFamily: fonts.length ? "Gochi" : "sans-serif",
        color: "#2b2a33",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 40,
          top: 40,
          right: 40,
          bottom: 40,
          display: "flex",
          border: "6px solid #2b2a33",
          borderRadius: "40px 18px 46px 16px",
          background: "#fffdf7",
          boxShadow: "10px 12px 0 #2b2a33",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 520,
          top: 22,
          width: 160,
          height: 44,
          background: "rgba(247, 201, 51, 0.55)",
          transform: "rotate(-3deg)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          top: big ? 160 : 110,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 44, color: "#3aa35b", display: "flex" }}>
          Kids&apos; event
        </div>
        <div
          style={{
            fontSize: e.title.length > 28 ? 84 : 104,
            lineHeight: 1.05,
            display: "flex",
            marginTop: 8,
          }}
        >
          {e.title}
        </div>
        <div style={{ fontSize: 56, marginTop: 30, display: "flex" }}>
          {shortDate(next.day)}
        </div>
        <div
          style={{
            fontSize: 48,
            marginTop: 8,
            color: "#5d5a6b",
            display: "flex",
          }}
        >
          {`${e.venue.name}, ${e.venue.town}`}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 90,
          bottom: 80,
          fontSize: 40,
          display: "flex",
        }}
      >
        parkroulette.quest
      </div>
    </div>,
    {
      ...size,
      fonts,
      headers: {
        "cache-control":
          "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
