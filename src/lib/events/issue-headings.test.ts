import { describe, expect, it } from "vitest";
import { type FetchResult, pageText } from "@/lib/news/validate";
import type { EventInput } from "./model";
import {
  type EventsContext,
  headingHeadsLine,
  isDayHeading,
  issueMap,
  validateEvents,
} from "./validate";

/**
 * A weekly issue lists its events under day headings ("Thursday 11/26"),
 * and only the heading prints the date: the second and later items under
 * it never do. A day heading quoted from the issue proves the date of the
 * event's own line from the same issue when it is the nearest break
 * before the event's name (no other day heading, printed date, heading
 * element or bold-only line between), its weekday is the date's own, and
 * the line prints no other date.
 *
 * The issue below is invented, in a weekly newsletter's layout: day
 * headings as h3, each item a paragraph (emoji, bold title, time and
 * ages, a link, the venue), then a paragraph about it.
 */
const item = (emoji: string, title: string, line: string, venue: string) =>
  `<tr><td><p> ${emoji}<b> ${title}</b><br><i>${line} • </i><a href="https://example-org.test/${encodeURIComponent(title)}"><i><b>More info</b></i></a><br>📍 ${venue} </p></td></tr><tr><td><p> A few words on what kids do there. </p></td></tr>`;
const day = (h: string) => `<tr><td><h3><b>${h}</b></h3></td></tr>`;
const issueHtml = (...parts: string[]) =>
  `<html><body><table><tr><td><p>November 22, 2026</p></td></tr>${parts.join("")}</table></body></html>`;
const PARTS = [
  day("Wednesday 11/25"),
  item(
    "🛹",
    "Open Skate at the Rink",
    "6pm-9pm • All ages • Free",
    "Riverside Rink (100 Main St)",
  ),
  day("Thursday 11/26"),
  item(
    "🥧",
    "Pie Dash Fun Run",
    "7:30am-9:30am • All ages",
    "Pine Park (Bend)",
  ),
  item(
    "🦃",
    "Canyon Turkey Trot",
    "8am • All ages",
    "Canyon Park (300 Canyon Rd, Redmond)",
  ),
  day("Friday 11/27"),
  item("🚁", "Santa's Big Landing", "10am • All ages • Free", "North Lawn"),
  item(
    "🦃",
    "Meadow 5K Fun Run",
    "11am-1pm • All ages",
    "Pine Meadow Ranch (1 Ranch Rd, Sisters)",
  ),
  item(
    "🌲",
    "Tree Lighting & Caroling",
    "5:30pm-6pm • All ages • Free",
    "Pine Meadow Ranch (1 Ranch Rd, Sisters)",
  ),
];
const HTML = issueHtml(...PARTS);
const TEXT = pageText(HTML);

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

function ctx(html = HTML): EventsContext {
  return {
    catalog: {
      link_domains: ["example-run.org"],
      lead_domains: ["weekly-news.test"],
      listing_domains: ["weekly-news.test"],
      not_organizer_domains: [],
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    fetcher: async (u) => walled(u),
    issue: async (id) =>
      id === 2 ? { text: pageText(html), day: "2026-11-22", html } : null,
  };
}

const TROT = "Canyon Turkey Trot 8am • All ages";
const trot = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Canyon Turkey Trot",
  dates: [{ day: "2026-11-26", start: "08:00" }],
  venue: { name: "Canyon Park", town: "Redmond" },
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
const CAROL = "Tree Lighting & Caroling 5:30pm-6pm • All ages";
const carol = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Tree Lighting & Caroling",
  dates: [{ day: "2026-11-27", start: "17:30", end: "18:00" }],
  venue: { name: "Pine Meadow Ranch", town: "Sisters" },
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
const heads = (
  html: string,
  heading: string,
  line: string,
  title: string,
): boolean => headingHeadsLine(pageText(html), heading, [line], title, html);

describe("day headings in an issue", () => {
  it("knows a bare day heading", () => {
    expect(isDayHeading("Thursday 11/26")).toBe(true);
    expect(isDayHeading("Thursday, Nov 26")).toBe(true);
    expect(isDayHeading("Fri, November 27th")).toBe(true);
    expect(isDayHeading("Thursday 11/26 🦃 Canyon Turkey Trot")).toBe(false);
    expect(isDayHeading("Black Friday Ninja Camp")).toBe(false);
    expect(isDayHeading("11/26")).toBe(false);
  });

  it("reads the issue's html as its stored text", () => {
    expect(issueMap(HTML)?.text).toBe(TEXT);
  });

  it("proves the second item's date by its day heading", async () => {
    const v = await one(trot());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    // Tonight's check reads the event's own line, never the heading.
    expect(v.event?.targets?.["2026-11-26"]).toEqual({
      url: "issue:2",
      quote: TROT,
    });
  });

  it("proves the third item under Friday", async () => {
    const v = await one(carol());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("cuts a heading whose weekday isn't the date's own", async () => {
    const html = HTML.replace("Thursday 11/26", "Wednesday 11/26");
    const v = await one(
      trot({
        evidence: [
          { url: "issue:2", quote: TROT },
          { url: "issue:2", quote: "Wednesday 11/26" },
        ],
      }),
      ctx(html),
    );
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/weekday that isn't 2026-11-26's/);
  });

  it("cuts a heading with another day heading between it and the event", async () => {
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
      /isn't the day heading over "Canyon Turkey Trot"/,
    );
  });

  it("cuts an event listed under a different day", async () => {
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

  it("cuts a line that prints another date than its heading's", () => {
    const stray = issueHtml(
      ...PARTS,
      day("Thursday 11/26"),
      item("🎄", "Tree Lighting Sat 11/28", "5pm • All ages", "Town Square"),
    );
    expect(
      heads(
        stray,
        "Thursday 11/26",
        "Tree Lighting Sat 11/28 5pm • All ages",
        "Tree Lighting",
      ),
    ).toBe(false);
    // Without the stray date it is Thursday's.
    const plain = stray.replace(
      "Tree Lighting Sat 11/28",
      "Tree Lighting Fest",
    );
    expect(
      heads(
        plain,
        "Thursday 11/26",
        "Tree Lighting Fest 5pm • All ages",
        "Tree Lighting Fest",
      ),
    ).toBe(true);
  });

  it("reads the item's own dates past a title-only quote", () => {
    const html = issueHtml(
      ...PARTS,
      day("Thursday 11/26"),
      item("🎄", "Tree Lighting", "Sat 11/28 5pm • All ages", "Town Square"),
    );
    expect(
      heads(html, "Thursday 11/26", "Tree Lighting", "Tree Lighting"),
    ).toBe(false);
    const plain = html.replace("Sat 11/28 5pm", "5pm");
    expect(
      heads(plain, "Thursday 11/26", "Tree Lighting", "Tree Lighting"),
    ).toBe(true);
  });

  it("stops at a printed date: a save-the-date item after the last heading", () => {
    const html = issueHtml(
      ...PARTS,
      item(
        "🩰",
        "Save the date: Dec 12 Nutcracker",
        "2pm • All ages",
        "Old Theater",
      ),
    );
    expect(
      heads(
        html,
        "Friday 11/27",
        "Save the date: Dec 12 Nutcracker 2pm",
        "Nutcracker",
      ),
    ).toBe(false);
  });

  it("stops at a heading element or a bold-only line", () => {
    const after = (brk: string) =>
      issueHtml(
        ...PARTS,
        brk,
        item("🎭", "Puppet Matinee", "1pm • Ages 3+", "Old Theater"),
      );
    const line = "Puppet Matinee 1pm • Ages 3+";
    for (const brk of [
      "<tr><td><h2>Ongoing</h2></td></tr>",
      "<tr><td><p><b>Next week</b></p></td></tr>",
      "<tr><td><p> <strong>Save the date</strong> </p></td></tr>",
    ])
      expect([
        brk,
        heads(after(brk), "Friday 11/27", line, "Puppet Matinee"),
      ]).toEqual([brk, false]);
    // With nothing between, it's Friday's.
    expect(heads(after(""), "Friday 11/27", line, "Puppet Matinee")).toBe(true);
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
    const q =
      "A few words on what kids do there. Friday 11/27 🚁 Santa's Big Landing 10am";
    const t = "Santa's Big Landing";
    expect(heads(HTML, "Friday 11/27", q, t)).toBe(true);
    expect(heads(HTML, "Thursday 11/26", q, t)).toBe(false);
  });

  it("takes any place the line sits: a session listed on two days", () => {
    const html = issueHtml(
      ...PARTS,
      day("Sunday 11/29"),
      item(
        "🛹",
        "Open Skate at the Rink",
        "6pm-9pm • All ages • Free",
        "Riverside Rink (100 Main St)",
      ),
    );
    const line = "Open Skate at the Rink 6pm-9pm";
    const t = "Open Skate at the Rink";
    expect(heads(html, "Wednesday 11/25", line, t)).toBe(true);
    expect(heads(html, "Sunday 11/29", line, t)).toBe(true);
    expect(heads(html, "Friday 11/27", line, t)).toBe(false);
  });
});
