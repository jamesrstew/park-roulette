import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FetchResult } from "@/lib/news/validate";
import { coverage } from "./coverage";
import { type EventInput } from "./model";
import {
  flightRows,
  jsonText,
  nextDataText,
  structuredText,
} from "./structured";
import { type EventsContext, validateEvents } from "./validate";

/**
 * Community one-offs (events-coverage, November 2026): the pages that
 * print nothing without JavaScript, read honestly from the organizer's own
 * data. Sunriver Resort's Grand Illumination is the case that was missing.
 */

const NOW = new Date("2026-11-21T15:00:00Z"); // Saturday morning in Bend
const LW =
  "https://api.live.onaws.letsway.com/v1/catalogs/01a11cd6-0ade-73ca-9fb6-f740033680b5/items?limit=100";
const PAGE =
  "https://www.sunriverresort.com/things-to-do?experienceId=grand-illumination-71c73139";
// The resort's experience catalog record, as its things-to-do page loads it
// (trimmed to the fields the line is made of; November 21, 2026).
const RECORD = readFileSync(
  path.join(__dirname, "fixtures/sunriver-grand-illumination.json"),
  "utf8",
);

function ctx(over: Partial<EventsContext> = {}): EventsContext {
  return {
    catalog: {
      link_domains: ["sunriverresort.com", "api.live.onaws.letsway.com"],
      site_aliases: { "api.live.onaws.letsway.com": "sunriverresort.com" },
      alias_paths: {
        "api.live.onaws.letsway.com": [
          "/v1/catalogs/01a11cd6-0ade-73ca-9fb6-f740033680b5/",
        ],
      },
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    fetcher: async (u: string): Promise<FetchResult> =>
      u === LW
        ? {
            status: 200,
            finalUrl: u,
            text: "",
            contentType: "application/json",
            data: jsonText(RECORD),
          }
        : u === PAGE
          ? { status: 200, finalUrl: u, text: "", contentType: "text/html" }
          : { status: 404, finalUrl: u, text: "" },
    ...over,
  };
}

/** The hand-in the harvest would send for Grand Illumination. */
const grand = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Grand Illumination",
  dates: [{ day: "2026-11-21", start: "12:00", end: "19:00" }],
  venue: {
    name: "The Lodge at Sunriver Resort",
    town: "Sunriver",
    street: "17600 Center Dr",
    postal: "97707",
    lat: 43.8740068,
    lng: -121.4464867,
  },
  setting: "outdoor",
  annual: true,
  what: "Kids ride the little train, pet the farm animals and visit Santa, then count down to the big tree lighting and fireworks.",
  url: PAGE,
  organizer: {
    name: "Sunriver Resort",
    url: "https://www.sunriverresort.com/",
  },
  evidence: [
    {
      url: LW,
      quote:
        "Saturday, November 21, 2026 Holiday fun for the entire family at Grand Illumination",
    },
    { url: LW, quote: "12 - 7 PM | Food and beverage vendors available" },
  ],
  ...over,
});

describe("Sunriver Resort's experience catalog (Grand Illumination)", () => {
  it("reads the record the resort's page loads, one line naming the event", () => {
    const line = jsonText(RECORD)
      .split("\n")
      .find((l) => l.startsWith("Grand Illumination |"))!;
    expect(line).toContain("Saturday, November 21, 2026");
    expect(line).toContain("12 - 7 PM | Food and beverage vendors available");
    expect(line).toContain("5:40 PM | Tree lighting and fireworks");
    // How far the booking calendar is filled in is not an event date.
    expect(line).not.toContain("2027-02-19");
    // A list of plain dates is one value of the record, read as its date.
    expect(line.startsWith("Grand Illumination | 2026-11-21 |")).toBe(true);
  });

  it("verifies the hand-in on the resort's own data", async () => {
    const r = await validateEvents({ events: [grand()] }, ctx());
    expect(r.events[0].problems).toEqual([]);
    expect(r.events[0].ok).toBe(true);
  });

  it("refuses another brand's catalog on the same host", async () => {
    const other =
      "https://api.live.onaws.letsway.com/v1/catalogs/0000-other-brand/items";
    const r = await validateEvents(
      {
        events: [
          grand({
            evidence: grand().evidence.map((x) => ({ ...x, url: other })),
          }),
        ],
      },
      ctx(),
    );
    expect(r.events[0].problems.join(" ")).toMatch(
      /must be the organizer's own data/,
    );
  });

  it("keeps the catalog host to evidence: the link is the resort's page", async () => {
    const r = await validateEvents({ events: [grand({ url: LW })] }, ctx());
    expect(r.events[0].problems.join(" ")).toMatch(
      /api.live.onaws.letsway.com is sunriverresort.com's data host/,
    );
  });
});

describe("Next.js flight data (client-rendered organizer pages)", () => {
  // What a Next.js App Router page ships: flight chunks, with a text row
  // ("1a:T<hex length>,") that has no newline after it.
  const tRow = JSON.stringify({ "@type": "WebPage", name: "Traditions" });
  const len = new TextEncoder().encode(tRow).length.toString(16);
  const rows =
    `0:["$","div",null,{"children":"Loading"}]\n` +
    `1a:T${len},${tRow}` +
    `5:["$","$L15",null,{"title":"Holiday Highlights","slides":[{"slideSupertitle":"Saturday, December 12","slideTitle":"Gingerbread Decorating – Café","slideLink":"/things-to-do"}]}]\n`;
  const html = `<html><body><div id="app"></div><script>self.__next_f.push([1,${JSON.stringify(
    rows.slice(0, 40),
  )}])</script><script>self.__next_f.push([1,${JSON.stringify(
    rows.slice(40),
  )}])</script></body></html>`;

  it("splits rows, text rows by their byte length", () => {
    expect(flightRows(rows)).toEqual([
      `["$","div",null,{"children":"Loading"}]`,
      tRow,
      `["$","$L15",null,{"title":"Holiday Highlights","slides":[{"slideSupertitle":"Saturday, December 12","slideTitle":"Gingerbread Decorating – Café","slideLink":"/things-to-do"}]}]`,
    ]);
  });

  it("reads the page's own records as data lines", () => {
    const t = nextDataText(html);
    expect(t).toContain(
      "Holiday Highlights | Saturday, December 12 | Gingerbread Decorating - Café | /things-to-do",
    );
    expect(t).toContain("Traditions");
    expect(structuredText(html, "text/html")).toContain(
      "Saturday, December 12 | Gingerbread Decorating",
    );
  });

  it("reads the Pages Router's __NEXT_DATA__ too", () => {
    const page = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          pageProps: {
            event: {
              title: "Tree Lighting",
              startDate: "2026-12-05T17:00:00-08:00",
            },
          },
        },
      },
    )}</script>`;
    expect(nextDataText(page)).toBe(
      "Tree Lighting | 2026-12-05T17:00:00-08:00",
    );
  });

  it("a broken chunk or row is just not evidence", () => {
    expect(
      nextDataText(
        `<script>self.__next_f.push([1,"0:[broken\\n"])</script><script id="__NEXT_DATA__">{bad</script>`,
      ),
    ).toBe("");
  });
});

describe("the community target (at least 10 one-offs in 30 days)", () => {
  const page = (
    kind: string,
    day: string,
    url = "https://www.oldmilldistrict.com/e/",
    confirm = "ok",
  ) => ({
    kind,
    confirm,
    url,
    dates: [{ day }],
  });
  it("counts listed one-off and annual pages with a date in the next 30 days", () => {
    const today = "2026-11-21";
    const c = coverage(
      [
        page("one_off", "2026-11-21"),
        page("annual", "2026-12-21"),
        page("annual", "2026-12-22"), // 31 days out
        page("one_off", "2026-11-28", undefined, "unconfirmed"),
        page(
          "series",
          "2026-11-25",
          "https://www.deschuteslibrary.org/calendar/",
        ),
        page("series", "2026-11-20"), // passed
      ],
      today,
    );
    expect(c).toEqual({
      window_days: 30,
      listed: 3,
      community: 2,
      community_target: 10,
      community_met: false,
      library: 1,
    });
    expect(
      coverage(
        Array.from({ length: 10 }, () => page("one_off", "2026-11-30")),
        today,
      ).community_met,
    ).toBe(true);
  });
});
