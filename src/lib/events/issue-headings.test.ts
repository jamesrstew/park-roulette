import { describe, expect, it } from "vitest";
import type { FetchResult } from "@/lib/news/validate";
import type { EventInput } from "./model";
import {
  type EventsContext,
  headingHeadsLine,
  isDayHeading,
  validateEvents,
} from "./validate";

/**
 * A weekly issue lists its events under day headings ("Thursday 11/26"),
 * and only the heading prints the date: the second and later items under
 * it never do. A day heading quoted from the issue proves the date of the
 * event's own line from the same issue when it is the nearest day heading
 * before the event's name (the same day section, no other day heading
 * between), and its weekday is the date's own.
 *
 * The text below has issue 2's structure (Bend Family Loop, sent Nov 22,
 * 2026: the items as they read, descriptions shortened in our words).
 */
const ISSUE = [
  "Activities & Events Here's what's happening this week!",
  "Wednesday 11/25 🛹 Free Community Skate at The Pavilion 6pm-9pm • All ages • Free • More info 📍 The Pavilion (1001 SW Bradbury Way) An evening skate session for every level.",
  "Thursday 11/26 🥧 I Like Pie Thanksgiving Fun Run 7:30am-9:30am • All ages • Register 📍 Riverbend Park (Bend) A morning fun run with pie at the finish.",
  "🦃 Redmond Turkey Trot 8am • All ages • Register 📍 Sam Johnson Park (333 SW 15th St, Redmond) A 5K, 10K or 1K kids run through the canyon. The kids run is free!",
  "Friday 11/27 🚁 Santa Flies In 10am • All ages • Free • More info 📍 West Event Lawn, Old Mill District Santa lands by helicopter.",
  "🦃 Turkey Trot 5K Fun Run 11am-1pm • All ages • More info 📍 Black Butte Ranch (13899 Bishops Cap, Sisters) A short course and a long course through the meadow.",
  "🌲 Christmas Tree Lighting & Caroling 5:30pm-6pm • All ages • Free • More info 📍 Black Butte Ranch (13899 Bishops Cap, Sisters) Caroling under the pines before the tree lighting.",
  "Saturday 11/28 🎨 Family Art Play 9:15am-10:15am • Ages 0-6 • Book now 📍 Two Suns Art Studio (70 SW Century Dr) Open art play for the whole family.",
].join(" ");

const NOW = new Date("2026-11-22T20:00:00Z");
const ORG = "https://www.example-run.org/turkey-trot";
const page = (url: string, over: Partial<FetchResult> = {}): FetchResult => ({
  status: 200,
  finalUrl: url,
  text: "",
  ...over,
});
const walled = (url: string) =>
  page(url, { status: 403, blocked: "a bot check", blockedKind: "bot_check" });

function ctx(text = ISSUE): EventsContext {
  return {
    catalog: {
      link_domains: ["example-run.org"],
      lead_domains: ["bendfamilyloop.com"],
      listing_domains: ["bendfamilyloop.com"],
      not_organizer_domains: [],
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    fetcher: async (u) => walled(u),
    issue: async (id) => (id === 2 ? { text, day: "2026-11-22" } : null),
  };
}

const TROT = "Redmond Turkey Trot 8am • All ages • Register";
const trot = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Redmond Turkey Trot",
  dates: [{ day: "2026-11-26", start: "08:00" }],
  venue: { name: "Sam Johnson Park", town: "Redmond" },
  setting: "outdoor",
  what: "Families run or walk a holiday morning loop, and the youngest racers get a short course of their own.",
  url: ORG,
  verified_via: "listing",
  evidence: [
    { url: "issue:2", quote: TROT },
    { url: "issue:2", quote: "Thursday 11/26" },
  ],
  ...over,
});
const CAROL = "Christmas Tree Lighting & Caroling 5:30pm-6pm • All ages";
const carol = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Christmas Tree Lighting & Caroling",
  dates: [{ day: "2026-11-27", start: "17:30", end: "18:00" }],
  venue: { name: "Black Butte Ranch", town: "Sisters" },
  setting: "outdoor",
  what: "A school choir leads holiday songs outdoors, then everyone watches the big tree light up.",
  url: "https://www.example-run.org/tree-lighting",
  verified_via: "listing",
  evidence: [
    { url: "issue:2", quote: CAROL },
    { url: "issue:2", quote: "Friday 11/27" },
  ],
  ...over,
});
const one = async (e: EventInput, c = ctx()) =>
  (await validateEvents({ events: [e] }, c)).events[0];

describe("day headings in an issue", () => {
  it("knows a bare day heading", () => {
    expect(isDayHeading("Thursday 11/26")).toBe(true);
    expect(isDayHeading("Thursday, Nov 26")).toBe(true);
    expect(isDayHeading("Fri, November 27th")).toBe(true);
    expect(isDayHeading("Thursday 11/26 🦃 Redmond Turkey Trot")).toBe(false);
    expect(isDayHeading("Black Friday Ninja Camp")).toBe(false);
    expect(isDayHeading("11/26")).toBe(false);
  });

  it("proves the Turkey Trot's date by its day heading", async () => {
    const v = await one(trot());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    // Tonight's check reads the event's own line, never the heading.
    expect(v.event?.targets?.["2026-11-26"]).toEqual({
      url: "issue:2",
      quote: TROT,
    });
  });

  it("proves a Black Butte Ranch event, the third item under Friday", async () => {
    const v = await one(carol());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("cuts a heading whose weekday isn't the date's own", async () => {
    const text = ISSUE.replace("Thursday 11/26", "Wednesday 11/26");
    const v = await one(
      trot({
        evidence: [
          { url: "issue:2", quote: TROT },
          { url: "issue:2", quote: "Wednesday 11/26" },
        ],
      }),
      ctx(text),
    );
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/weekday that isn't 2026-11-26's/);
  });

  it("cuts a heading with another day heading between it and the event", async () => {
    // Wednesday's heading, then Thursday's, then the Turkey Trot.
    const v = await one(
      trot({
        dates: [{ day: "2026-11-25", start: "08:00" }],
        evidence: [
          { url: "issue:2", quote: TROT },
          { url: "issue:2", quote: "Wednesday 11/25" },
        ],
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(
      /isn't the day heading over "Redmond Turkey Trot"/,
    );
  });

  it("cuts an event listed under a different day", async () => {
    // The tree lighting is under Friday, not Thursday.
    const v = await one(
      carol({
        dates: [{ day: "2026-11-26", start: "17:30", end: "18:00" }],
        evidence: [
          { url: "issue:2", quote: CAROL },
          { url: "issue:2", quote: "Thursday 11/26" },
        ],
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/isn't the day heading over/);
  });

  it("needs the event's own line from the same issue", async () => {
    const v = await one(
      trot({ evidence: [{ url: "issue:2", quote: "Thursday 11/26" }] }),
    );
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(
      /proves a date only with the event's own line/,
    );
  });

  it("anchors at the event's name, not where its quote starts", () => {
    // A quote that starts in Thursday's section and runs into Friday's
    // names Santa Flies In under Friday.
    const q = "The kids run is free! Friday 11/27 🚁 Santa Flies In 10am";
    expect(headingHeadsLine(ISSUE, "Friday 11/27", [q], "Santa Flies In")).toBe(
      true,
    );
    expect(
      headingHeadsLine(ISSUE, "Thursday 11/26", [q], "Santa Flies In"),
    ).toBe(false);
  });

  it("takes any place the line sits: a session listed on two days", () => {
    const text = `${ISSUE} Sunday 11/29 🛹 Free Community Skate at The Pavilion 6pm-9pm • All ages`;
    const line = "Free Community Skate at The Pavilion 6pm-9pm";
    const title = "Free Community Skate at The Pavilion";
    expect(headingHeadsLine(text, "Wednesday 11/25", [line], title)).toBe(true);
    expect(headingHeadsLine(text, "Sunday 11/29", [line], title)).toBe(true);
    expect(headingHeadsLine(text, "Friday 11/27", [line], title)).toBe(false);
  });
});
