import { describe, expect, it } from "vitest";
import { type FetchResult, pageText } from "@/lib/news/validate";
import { eventLinkLabel, type EventInput } from "./model";
import {
  type EventsContext,
  eventPageKind,
  issueLinksEvent,
  socialLinkOk,
  validateEvents,
} from "./validate";

/**
 * For a small organizer, an Instagram or Facebook page, a booking or
 * ticket platform, or a chamber of commerce's event listing IS its
 * official page. A social or ticket page may be an event's link only
 * when the event stands on an issue in our inbox that links it for the
 * event: a link on its name, or the first link after its name in its own
 * item. Social pages are never fetched; a ticket page is, and only a
 * dead one is cut. A chamber's listing is an organizer's page like any
 * other. Shown as "Event page" or "Tickets".
 *
 * The issue below is invented, in a weekly newsletter's layout.
 */
const SKI =
  "https://www.hisawyer.com/snow-hall/schedules/activity-set/100/drop-in/200/?day=2026-11-24&view=cal";
const TODDLER_SKI =
  "https://www.hisawyer.com/snow-hall/schedules/activity-set/101/drop-in/201/?day=2026-11-23&view=cal";
const GYM =
  "https://store.unleashedbrands.com/tumble-gym/bend/schedule/class?eventType=Camps&date=2026-11-27";
const ART =
  "https://www.hisawyer.com/sun-art-studio/schedules/activity-set/300?day=2026-11-28&view=cal";
const TREES_SAT =
  "https://exploresisters.com/event/ridge-ranch-tree-hunt/2026-11-28/";
const TREES_SUN =
  "https://exploresisters.com/event/ridge-ranch-tree-hunt/2026-11-29/";
const IG_POST = "https://www.instagram.com/p/AbCdEf123/";

const item = (
  emoji: string,
  title: string,
  line: string,
  anchor: string | null,
  href: string,
  venue: string,
) =>
  `<tr><td><p> ${emoji}<b> ${title}</b><br><i>${line} • </i>${anchor ? `<a href="${href.replace(/&/g, "&amp;")}"><i><b>${anchor}</b></i></a>` : ""}<br>📍 ${venue} </p></td></tr><tr><td><p> A few words on what kids do there. </p></td></tr>`;
const day = (h: string) => `<tr><td><h3><b>${h}</b></h3></td></tr>`;
const HTML = [
  "<html><body><table><tr><td><p>November 22, 2026</p></td></tr>",
  day("Monday 11/23"),
  item(
    "🎨",
    "Teen Art Hours",
    "1pm-5pm • Ages 11+ • Free",
    "More info",
    "https://www.hisawyer.com/teen-center/schedules/activity-set/9",
    "Teen Center (1 Art St)",
  ),
  item(
    "⛷️",
    "Mini Skiers Drop In",
    "3pm-3:40pm • Ages 3-5",
    "Book now",
    SKI,
    "Snow Hall (5 Slope St)",
  ),
  item(
    "⛷️",
    "Toddler Ski School",
    "4pm-4:40pm • Ages 1-3",
    "Book now",
    TODDLER_SKI,
    "Snow Hall (5 Slope St)",
  ),
  day("Friday 11/27"),
  item(
    "🥷",
    "Obstacle Course Camp",
    "12pm • Ages 6-13",
    null,
    "",
    "Climb Co (2 Rock Rd)",
  ),
  item(
    "🤸",
    "Drop &amp; Shop Holiday Camp",
    "1pm-4pm • Ages 3-12",
    "Register",
    GYM,
    "Tumble Gym (3 Flip Ave)",
  ),
  `<tr><td><p> 🎄<a href="${IG_POST}"><b> Courtyard Tree Lighting</b></a><br><i>5pm • All ages • Free</i><br>📍 Old Courtyard </p></td></tr>`,
  day("Saturday 11/28"),
  item(
    "🎨",
    "Family Art Play",
    "9:15am-10:15am • Ages 0-6",
    "Book now",
    ART,
    "Sun Art Studio (7 Easel Dr)",
  ),
  item(
    "🌲",
    "Ridge Ranch Tree Hunt",
    "10am-4pm • All ages",
    "More info",
    TREES_SAT,
    "Ridge Ranch (9 Fir Rd, Sisters)",
  ),
  day("Sunday 11/29"),
  item(
    "🌲",
    "Ridge Ranch Tree Hunt",
    "10am-4pm • All ages",
    "More info",
    TREES_SUN,
    "Ridge Ranch (9 Fir Rd, Sisters)",
  ),
  "</table></body></html>",
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
type Pages = Record<string, Partial<FetchResult>>;
function ctx(html = HTML, pages: Pages = {}): EventsContext {
  return {
    catalog: {
      link_domains: [],
      lead_domains: ["weekly-news.test"],
      listing_domains: ["weekly-news.test"],
      not_organizer_domains: ["bit.ly", "docs.google.com"],
      event_page_domains: { ...PAGES },
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    fetcher: async (u): Promise<FetchResult> => {
      fetched.push(u);
      // A booking page draws its calendar with a script: no event text.
      return { status: 200, finalUrl: u, text: "Loading…", ...pages[u] };
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
const skiers = (over: Partial<EventInput> = {}): EventInput => ({
  ...base,
  title: "Mini Skiers Drop In",
  dates: [{ day: "2026-11-23", start: "15:00", end: "15:40" }],
  venue: { name: "Snow Hall", town: "Bend" },
  what: "Little ones get their first feel for skis or a snowboard on a small indoor slope with a coach.",
  url: SKI,
  evidence: [
    { url: "issue:2", quote: "Mini Skiers Drop In 3pm-3:40pm • Ages 3-5" },
    { url: "issue:2", quote: "Monday 11/23" },
  ],
  ...over,
});
const gym: EventInput = {
  ...base,
  title: "Drop & Shop Holiday Camp",
  dates: [{ day: "2026-11-27", start: "13:00", end: "16:00" }],
  venue: { name: "Tumble Gym", town: "Bend" },
  what: "Kids tumble, climb and play games with coaches for an afternoon while grown-ups run errands.",
  url: GYM,
  evidence: [
    { url: "issue:2", quote: "Drop & Shop Holiday Camp 1pm-4pm • Ages 3-12" },
    { url: "issue:2", quote: "Friday 11/27" },
  ],
};
const art: EventInput = {
  ...base,
  title: "Family Art Play",
  dates: [{ day: "2026-11-28", start: "09:15", end: "10:15" }],
  venue: { name: "Sun Art Studio", town: "Bend" },
  what: "Toddlers and preschoolers squish, paint and explore messy art stations next to a grown-up.",
  url: ART,
  evidence: [
    {
      url: "issue:2",
      quote: "Saturday 11/28 🎨 Family Art Play 9:15am-10:15am • Ages 0-6",
    },
  ],
};
const trees: EventInput = {
  ...base,
  setting: "outdoor",
  title: "Ridge Ranch Tree Hunt",
  dates: [
    { day: "2026-11-28", start: "10:00", end: "16:00" },
    { day: "2026-11-29", start: "10:00", end: "16:00" },
  ],
  venue: { name: "Ridge Ranch", town: "Sisters" },
  what: "Families hike a ranch to pick and saw down their own Christmas tree, then warm up by a fire.",
  url: TREES_SAT,
  evidence: [
    { url: "issue:2", quote: "Ridge Ranch Tree Hunt 10am-4pm • All ages" },
    { url: "issue:2", quote: "Saturday 11/28" },
    { url: "issue:2", quote: "Sunday 11/29" },
  ],
};
const courtyard = (over: Partial<EventInput> = {}): EventInput => ({
  ...base,
  setting: "outdoor",
  title: "Courtyard Tree Lighting",
  dates: [{ day: "2026-11-27", start: "17:00" }],
  venue: { name: "Old Courtyard", town: "Bend" },
  what: "Families count down together and watch a tall tree light up, with carols and cocoa nearby.",
  url: IG_POST,
  evidence: [
    { url: "issue:2", quote: "Courtyard Tree Lighting 5pm • All ages • Free" },
    { url: "issue:2", quote: "Friday 11/27" },
  ],
  ...over,
});

describe("event pages on social, ticket and chamber hosts", () => {
  it("knows the kinds", () => {
    expect(eventPageKind(SKI, PAGES)).toBe("tickets");
    expect(eventPageKind(IG_POST, PAGES)).toBe("social");
    expect(eventPageKind(TREES_SAT, PAGES)).toBe("chamber");
    expect(eventPageKind("https://example.org/", PAGES)).toBe(null);
  });

  it("takes a Sawyer page linked in the event's item; a script-drawn one leaves the issue carrying it", async () => {
    const v = await one(skiers());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.event?.url).toBe(SKI);
    expect(v.warnings.join(" ")).toMatch(/Trusted the issue: www.hisawyer.com/);
  });

  it("cuts a dead booking page", async () => {
    const v = await one(skiers(), ctx(HTML, { [SKI]: { status: 404 } }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/404/);
  });

  it("takes a booking store's page and a first item's own link", async () => {
    for (const e of [gym, art]) {
      const v = await one(e);
      expect([e.title, v.problems]).toEqual([e.title, []]);
    }
  });

  it("takes a linked title, with its own href, and never fetches a social page", async () => {
    fetched.length = 0;
    const v = await one(courtyard());
    expect(v.problems).toEqual([]);
    expect(fetched).not.toContain(IG_POST);
    expect(
      issueLinksEvent(
        HTML,
        IG_POST,
        ["Courtyard Tree Lighting 5pm"],
        "Courtyard Tree Lighting",
      ),
    ).toBe(true);
  });

  it("refuses a linkless item: never the next item's link", () => {
    // Obstacle Course Camp has no link; the next link is the gym's.
    const lines = ["Obstacle Course Camp 12pm • Ages 6-13"];
    expect(issueLinksEvent(HTML, GYM, lines, "Obstacle Course Camp")).toBe(
      false,
    );
  });

  it("refuses a quote running on into the next item's link", () => {
    const BOOK =
      "https://www.hisawyer.com/beta-studio/schedules/activity-set/7";
    const html = `<html><body><table><tr><td><p>November 22, 2026</p></td></tr><tr><td><h3><b>Monday 11/23</b></h3></td></tr><tr><td><p> 🎨<b> Alpha Camp</b><br><i>1pm-2pm • Ages 3-5</i><br>📍 Somewhere </p></td></tr><tr><td><p> 🎨<b> Beta Camp</b><br><i>3pm-4pm • </i><a href="${BOOK}"><i><b>Book now</b></i></a></p></td></tr></table></body></html>`;
    const probe =
      "Alpha Camp 1pm-2pm • Ages 3-5 📍 Somewhere 🎨 Beta Camp 3pm-4pm • Book now";
    expect(pageText(html)).toContain(probe);
    expect(issueLinksEvent(html, BOOK, [probe], "Alpha Camp")).toBe(false);
    expect(
      issueLinksEvent(
        html,
        BOOK,
        ["Beta Camp 3pm-4pm • Book now"],
        "Beta Camp",
      ),
    ).toBe(true);
  });

  it("cuts a page the issue links for another event", async () => {
    const v = await one(skiers({ url: TODDLER_SKI }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/No issue in the evidence links/);
    const w = await one(skiers({ url: ART }));
    expect(w.ok).toBe(false);
  });

  it("cuts one with no issue evidence, or no html to tell", async () => {
    const listing = await one(
      skiers({
        evidence: [
          {
            url: "https://weekly-news.test/p/week-of-nov-23",
            quote: "Monday 11/23 Mini Skiers Drop In 3pm-3:40pm",
          },
        ],
      }),
    );
    expect(listing.problems.join(" ")).toMatch(
      /only when the event stands on an issue in our inbox/,
    );
    const nohtml = await one(skiers(), ctx(""));
    expect(nohtml.ok).toBe(false);
    expect(nohtml.problems.join(" ")).toMatch(/No issue in the evidence links/);
  });

  it("checks a chamber listing like any organizer's page, on an issue or a listing page", async () => {
    // Readable and printing the event: verified there.
    const readable = {
      [TREES_SAT]: {
        text: "Ridge Ranch Tree Hunt. Saturday, November 28 and Sunday, November 29, 2026, 10am to 4pm.",
      },
    };
    const v = await one(trees, ctx(HTML, readable));
    expect(v.problems).toEqual([]);
    // A listing page's evidence, as a stored chamber event has.
    const holiday: EventInput = {
      ...base,
      setting: "outdoor",
      title: "Tour of Gingerbread Homes",
      dates: [{ day: "2026-12-05", start: "10:00", end: "16:00" }],
      venue: { name: "Downtown", town: "Sisters" },
      what: "Families stroll downtown shops to spot gingerbread houses built by local bakers and kids.",
      url: "https://exploresisters.com/event/gingerbread-tour/",
      evidence: [
        {
          url: "https://weekly-news.test/events/gingerbread-tour",
          quote:
            "Tour of Gingerbread Homes | 2026-12-05T10:00:00-08:00 | 2026-12-05T16:00:00-08:00",
        },
      ],
    };
    const g = await one(
      holiday,
      ctx(HTML, {
        "https://weekly-news.test/events/gingerbread-tour": {
          text: "Tour of Gingerbread Homes",
          data: "Tour of Gingerbread Homes | 2026-12-05T10:00:00-08:00 | 2026-12-05T16:00:00-08:00",
        },
        [holiday.url]: { status: 403, blocked: "a bot check" },
      }),
    );
    expect(g.problems).toEqual([]);
    expect(g.ok).toBe(true);
  });

  it("refuses social redirect shims and paths that aren't a page or post", async () => {
    for (const u of [
      "https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org",
      "https://lm.facebook.com/l.php?u=x",
      "https://www.facebook.com/l.php?u=https%3A%2F%2Fexample.org",
      "https://www.facebook.com/sharer/sharer.php?u=x",
      "https://www.facebook.com/somepage?u=https%3A%2F%2Fexample.org",
      "https://l.instagram.com/?u=https%3A%2F%2Fexample.org",
      "https://www.instagram.com/explore/tags/bend/",
      "https://www.instagram.com/reel/AbC/",
    ])
      expect([u, socialLinkOk(u)]).toEqual([u, false]);
    for (const u of [
      "https://www.facebook.com/events/1569086671906031/",
      "https://www.facebook.com/RidgeRanchFarm",
      "https://www.facebook.com/profile.php?id=10001",
      "https://www.instagram.com/ridgeranchfarm/",
      IG_POST,
    ])
      expect([u, socialLinkOk(u)]).toEqual([u, true]);
    const v = await one(
      courtyard({
        url: "https://l.instagram.com/?u=https%3A%2F%2Fexample.org",
      }),
    );
    expect(v.problems.join(" ")).toMatch(/never a redirect link/);
  });

  it("still refuses shorteners and forms, and social pages as an organizer", async () => {
    const short = await one(skiers({ url: "https://bit.ly/3xYz" }));
    expect(short.problems.join(" ")).toMatch(/bit.ly is never an event's link/);
    const org = await one({
      ...art,
      verified_via: undefined,
      url: "https://example.org/family-art-play",
      organizer: { name: "Sun Art", url: "https://www.instagram.com/sunart/" },
    });
    expect(org.problems.join(" ")).toMatch(/never an organizer link/);
  });

  it("finds the event's own link on each day it's listed", () => {
    const sat = "Ridge Ranch Tree Hunt 10am-4pm";
    const t = "Ridge Ranch Tree Hunt";
    expect(issueLinksEvent(HTML, TREES_SAT, [sat], t)).toBe(true);
    expect(issueLinksEvent(HTML, TREES_SUN, [sat], t)).toBe(true);
    // The link after Family Art Play is its own, not the next item's.
    expect(
      issueLinksEvent(HTML, TREES_SAT, ["Family Art Play"], "Family Art Play"),
    ).toBe(false);
  });

  it("labels the link Event page or Tickets, never Official page", () => {
    expect(eventLinkLabel(SKI).label).toBe("Tickets");
    expect(eventLinkLabel(IG_POST)).toEqual({
      label: "Event page",
      noun: "event page",
      byIssue: true,
    });
    expect(eventLinkLabel("https://www.facebook.com/events/1/").label).toBe(
      "Event page",
    );
    expect(eventLinkLabel(TREES_SAT)).toEqual({
      label: "Event page",
      noun: "event page",
      byIssue: false,
    });
    expect(eventLinkLabel("https://www.bendparksandrec.org/x").label).toBe(
      "Official page",
    );
  });
});
