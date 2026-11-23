import { describe, expect, it } from "vitest";
import { type FetchResult, pageText } from "@/lib/news/validate";
import { eventLinkLabel, type EventInput } from "./model";
import {
  type EventsContext,
  eventPageKind,
  issueLinksEvent,
  validateEvents,
} from "./validate";

/**
 * For a small organizer, an Instagram or Facebook page, a booking or
 * ticket platform, or a chamber of commerce's event listing IS its
 * official page. Such a page may be an event's link only when the event
 * stands on an issue in our inbox that links it next to the event's name
 * (the first link after it, no day heading between). Never fetched: the
 * issue carries the event. Shown as "Event page" or "Tickets".
 *
 * The issue below has issue 2's structure and its links (Bend Family
 * Loop, sent Nov 22, 2026; descriptions shortened in our words).
 */
const SAWYER_SHREDDERS =
  "https://www.hisawyer.com/shredder-bend/schedules/activity-set/2095142/drop-in/23856500/?day=2026-11-24&view=cal&source=camps";
const SAWYER_YETI =
  "https://www.hisawyer.com/shredder-bend/schedules/activity-set/2095141/drop-in/23856479/?day=2026-11-23&view=cal&source=camps";
const LITTLE_GYM =
  "https://store.unleashedbrands.com/the-little-gym/bendor/schedule/class?eventType=Camps&date=2026-11-27";
const TWO_SUNS =
  "https://www.hisawyer.com/two-suns-art-studio/schedules/activity-set/2058633?day=2026-11-28&view=cal&source=all-activities";
const KALAMATACA_SAT =
  "https://exploresisters.com/event/kalamataca-ranch-tree-hunt-2/2026-11-28/";
const KALAMATACA_SUN =
  "https://exploresisters.com/event/kalamataca-ranch-tree-hunt-2/2026-11-29/";

const item = (
  emoji: string,
  title: string,
  line: string,
  anchor: string,
  href: string,
  venue: string,
) =>
  `<p>${emoji} <strong>${title}</strong></p><p>${line} • <a href="${href.replace(/&/g, "&amp;")}" target="_blank">${anchor}</a></p><p>📍 ${venue}</p><p>A short note on what kids do.</p>`;
const day = (h: string) => `<h3>${h}</h3>`;
const HTML = [
  "<html><body><p>November 22, 2026</p>",
  day("Monday 11/23"),
  item(
    "🎨",
    "Teen Open Art Hours",
    "1pm-5pm • Ages 11+ • Free",
    "More info",
    "https://www.hisawyer.com/the-open-arts-center/schedules/activity-set/2009892?day=2026-11-23",
    "OAC Teen Center (999 NE 2nd St)",
  ),
  item(
    "⛷️",
    "Little Shredders Drop In",
    "3pm-3:40pm • Ages 3-5",
    "Book now",
    SAWYER_SHREDDERS,
    "Shredder Bend (575 SE 9th St)",
  ),
  item(
    "⛷️",
    "Yeti School Drop In",
    "4pm-4:40pm • Ages 1-3",
    "Book now",
    SAWYER_YETI,
    "Shredder Bend (575 SE 9th St)",
  ),
  day("Friday 11/27"),
  item(
    "🥷",
    "Black Friday Ninja Camp",
    "12pm &amp; 2:30pm • Ages 6-13",
    "Register",
    "https://freespiritbend.pike13.com/group_classes/369159",
    "Free Spirit (320 SW Powerhouse Dr #150)",
  ),
  item(
    "🤸",
    "Drop &amp; Shop Black Friday Camp",
    "1pm-4pm • Ages 3-12",
    "Register",
    LITTLE_GYM,
    "The Little Gym (61334 S Hwy 97)",
  ),
  day("Saturday 11/28"),
  item(
    "🎨",
    "Family Art Play",
    "9:15am-10:15am • Ages 0-6",
    "Book now",
    TWO_SUNS,
    "Two Suns Art Studio (70 SW Century Dr)",
  ),
  item(
    "🌲",
    "Kalamataca Ranch Tree Hunt",
    "10am-4pm • All ages",
    "More info",
    KALAMATACA_SAT,
    "Kalamataca Ranch (70425 McAllister Rd, Sisters)",
  ),
  day("Sunday 11/29"),
  item(
    "🌲",
    "Kalamataca Ranch Tree Hunt",
    "10am-4pm • All ages",
    "More info",
    KALAMATACA_SUN,
    "Kalamataca Ranch (70425 McAllister Rd, Sisters)",
  ),
  "</body></html>",
].join("\n");
const TEXT = pageText(HTML);

const NOW = new Date("2026-11-22T20:00:00Z");
const PAGES = {
  "instagram.com": "social",
  "facebook.com": "social",
  "hisawyer.com": "tickets",
  "unleashedbrands.com": "tickets",
  "exploresisters.com": "chamber",
} as const;
const fetched: string[] = [];
function ctx(html: string | undefined = HTML): EventsContext {
  return {
    catalog: {
      link_domains: [],
      lead_domains: ["bendfamilyloop.com"],
      listing_domains: ["bendfamilyloop.com"],
      not_organizer_domains: ["bit.ly", "docs.google.com"],
      event_page_domains: {
        "instagram.com": "social",
        "facebook.com": "social",
        "hisawyer.com": "tickets",
        "unleashedbrands.com": "tickets",
        "exploresisters.com": "chamber",
      },
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    fetcher: async (u): Promise<FetchResult> => {
      fetched.push(u);
      return { status: 200, finalUrl: u, text: "Log in to see this page." };
    },
    issue: async (id) =>
      id === 2
        ? { text: TEXT, day: "2026-11-22", ...(html ? { html } : {}) }
        : null,
  };
}
const one = async (e: EventInput, c = ctx()) =>
  (await validateEvents({ events: [e] }, c)).events[0];

const base = {
  setting: "indoor" as const,
  verified_via: "listing" as const,
};
const shredders = (over: Partial<EventInput> = {}): EventInput => ({
  ...base,
  title: "Little Shredders Drop In",
  dates: [{ day: "2026-11-23", start: "15:00", end: "15:40" }],
  venue: { name: "Shredder Bend", town: "Bend" },
  what: "Little ones get their first feel for skis or a snowboard on a small indoor slope with a coach.",
  url: SAWYER_SHREDDERS,
  evidence: [
    { url: "issue:2", quote: "Little Shredders Drop In 3pm-3:40pm • Ages 3-5" },
    { url: "issue:2", quote: "Monday 11/23" },
  ],
  ...over,
});
const littleGym: EventInput = {
  ...base,
  title: "Drop & Shop Black Friday Camp",
  dates: [{ day: "2026-11-27", start: "13:00", end: "16:00" }],
  venue: { name: "The Little Gym", town: "Bend" },
  what: "Kids tumble, climb and play games with coaches for an afternoon while grown-ups run errands.",
  url: LITTLE_GYM,
  evidence: [
    {
      url: "issue:2",
      quote: "Drop & Shop Black Friday Camp 1pm-4pm • Ages 3-12",
    },
    { url: "issue:2", quote: "Friday 11/27" },
  ],
};
const twoSuns: EventInput = {
  ...base,
  title: "Family Art Play",
  dates: [{ day: "2026-11-28", start: "09:15", end: "10:15" }],
  venue: { name: "Two Suns Art Studio", town: "Bend" },
  what: "Toddlers and preschoolers squish, paint and explore messy art stations next to a grown-up.",
  url: TWO_SUNS,
  evidence: [
    {
      url: "issue:2",
      quote: "Saturday 11/28 🎨 Family Art Play 9:15am-10:15am • Ages 0-6",
    },
  ],
};
const kalamataca: EventInput = {
  ...base,
  setting: "outdoor",
  title: "Kalamataca Ranch Tree Hunt",
  dates: [
    { day: "2026-11-28", start: "10:00", end: "16:00" },
    { day: "2026-11-29", start: "10:00", end: "16:00" },
  ],
  venue: { name: "Kalamataca Ranch", town: "Sisters" },
  what: "Families hike a ranch to pick and saw down their own Christmas tree, then warm up by a fire.",
  url: KALAMATACA_SAT,
  evidence: [
    { url: "issue:2", quote: "Kalamataca Ranch Tree Hunt 10am-4pm • All ages" },
    { url: "issue:2", quote: "Saturday 11/28" },
    { url: "issue:2", quote: "Sunday 11/29" },
  ],
};

describe("event pages on social, ticket and chamber hosts", () => {
  it("knows the kinds", () => {
    expect(eventPageKind(SAWYER_SHREDDERS, PAGES)).toBe("tickets");
    expect(eventPageKind("https://www.instagram.com/p/AbC/", PAGES)).toBe(
      "social",
    );
    expect(eventPageKind(KALAMATACA_SAT, PAGES)).toBe("chamber");
    expect(eventPageKind("https://example.org/", PAGES)).toBe(null);
  });

  it("takes Shredder Bend's Sawyer page, linked next to the event", async () => {
    fetched.length = 0;
    const v = await one(shredders());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.event?.url).toBe(SAWYER_SHREDDERS);
    expect(v.warnings.join(" ")).toMatch(/Trusted the issue: www.hisawyer.com/);
    // Never fetched: the issue carries it.
    expect(fetched).toEqual([]);
  });

  it("takes The Little Gym's booking page, Two Suns' Sawyer page and Kalamataca's chamber listing", async () => {
    for (const e of [littleGym, twoSuns, kalamataca]) {
      const v = await one(e);
      expect([e.title, v.problems]).toEqual([e.title, []]);
    }
  });

  it("cuts a page the issue links for another event", async () => {
    // Yeti School's link, handed in for Little Shredders.
    const v = await one(shredders({ url: SAWYER_YETI }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/No issue in the evidence links/);
    // Two Suns' link for Little Shredders.
    const w = await one(shredders({ url: TWO_SUNS }));
    expect(w.ok).toBe(false);
  });

  it("cuts one with no issue evidence, or no html to tell", async () => {
    const page = await one(
      shredders({
        evidence: [
          {
            url: "https://bendfamilyloop.com/p/week-of-nov-23",
            quote: "Monday 11/23 Little Shredders Drop In 3pm-3:40pm",
          },
        ],
      }),
    );
    expect(page.problems.join(" ")).toMatch(
      /only when the event stands on an issue in our inbox/,
    );
    const nohtml = await one(shredders(), ctx(""));
    expect(nohtml.ok).toBe(false);
    expect(nohtml.problems.join(" ")).toMatch(/No issue in the evidence links/);
  });

  it("still refuses shorteners and forms, and social pages as an organizer", async () => {
    const short = await one(shredders({ url: "https://bit.ly/3xYz" }));
    expect(short.problems.join(" ")).toMatch(/bit.ly is never an event's link/);
    const org = await one({
      ...twoSuns,
      verified_via: undefined,
      url: "https://example.org/family-art-play",
      organizer: {
        name: "Two Suns",
        url: "https://www.instagram.com/twosunsart/",
      },
    });
    expect(org.problems.join(" ")).toMatch(/never an organizer link/);
  });

  it("finds the link after the event's name, before the next day heading", () => {
    const sat = "Kalamataca Ranch Tree Hunt 10am-4pm";
    const t = "Kalamataca Ranch Tree Hunt";
    expect(issueLinksEvent(HTML, KALAMATACA_SAT, [sat], t)).toBe(true);
    expect(issueLinksEvent(HTML, KALAMATACA_SUN, [sat], t)).toBe(true);
    // The link after Family Art Play is Two Suns', not the next item's.
    expect(
      issueLinksEvent(
        HTML,
        KALAMATACA_SAT,
        ["Family Art Play"],
        "Family Art Play",
      ),
    ).toBe(false);
  });

  it("labels the link Event page or Tickets, never Official page", () => {
    expect(eventLinkLabel(SAWYER_SHREDDERS).label).toBe("Tickets");
    expect(eventLinkLabel("https://www.instagram.com/p/AbC/").label).toBe(
      "Event page",
    );
    expect(eventLinkLabel("https://www.facebook.com/events/1/").label).toBe(
      "Event page",
    );
    expect(eventLinkLabel(KALAMATACA_SAT).label).toBe("Event page");
    expect(eventLinkLabel("https://www.bendparksandrec.org/x").label).toBe(
      "Official page",
    );
  });
});
