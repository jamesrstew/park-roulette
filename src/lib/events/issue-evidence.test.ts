import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanIssue } from "@/lib/inbox/extract";
import type { FetchResult } from "@/lib/news/validate";
import { samePage } from "./dedupe";
import { type EventInput, issueId } from "./model";
import { judgeListing } from "./state";
import { type EventsContext, validateEvents } from "./validate";

/**
 * A listing event (verified_via "listing") may stand on a newsletter
 * issue in our own inbox, cited as "issue:<id>", with the listing rules:
 * the quote is in the stored issue's text and names the event, a printed
 * weekday is the date's own, and the issue was sent within 6 weeks
 * before the event. An issue is never a link, and never public.
 */
const NOW = new Date("2026-11-20T15:00:00Z");
const ORG = "https://www.example-parks.org/events/winter-lights";
const ISSUE_TEXT = cleanIssue({
  html: readFileSync(
    path.join(__dirname, "../inbox/__fixtures__/newsletter-weekly.html"),
    "utf8",
  ),
  plain: readFileSync(
    path.join(__dirname, "../inbox/__fixtures__/newsletter-weekly.txt"),
    "utf8",
  ),
}).text;
const QUOTE =
  "Saturday, November 21 • 12-7pm • Winter Lights • Family-friendly";

const page = (url: string, over: Partial<FetchResult> = {}): FetchResult => ({
  status: 200,
  finalUrl: url,
  text: "",
  ...over,
});
const walled = page(ORG, {
  status: 403,
  blocked: "an Akamai firewall",
  blockedKind: "bot_check",
});

function ctx(
  issues: Record<number, { text: string; day: string }>,
  pages: Record<string, FetchResult> = { [ORG]: walled },
): EventsContext {
  return {
    catalog: {
      link_domains: ["example-parks.org"],
      lead_domains: ["the-weekly.beehiiv.com"],
      listing_domains: ["the-weekly.beehiiv.com"],
      not_organizer_domains: [],
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    fetcher: async (u) => pages[u] ?? page(u, { status: 404 }),
    issue: async (id) => issues[id] ?? null,
  };
}

const event = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Winter Lights",
  dates: [{ day: "2026-11-21", start: "12:00", end: "19:00" }],
  venue: { name: "Riverside Park", town: "Bend" },
  setting: "outdoor",
  what: "Kids stroll a glowing path, warm up by a fire and say hello to Santa before dark.",
  url: ORG,
  verified_via: "listing",
  evidence: [{ url: "issue:7", quote: QUOTE }],
  ...over,
});
const stored = { 7: { text: ISSUE_TEXT, day: "2026-11-19" } };
const one = async (e: EventInput, c = ctx(stored)) =>
  (await validateEvents({ events: [e] }, c)).events[0];

describe("issue evidence", () => {
  it("verifies a quote from a stored issue when the organizer is walled", async () => {
    const v = await one(event());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.event?.url).toBe(ORG);
    expect(v.event?.targets?.["2026-11-21"]).toEqual({
      url: "issue:7",
      quote: QUOTE,
    });
  });

  it("cuts a quote that isn't in the issue, or an issue we don't have", async () => {
    const wrong = await one(
      event({
        evidence: [
          {
            url: "issue:7",
            quote: "Saturday, November 21 • 12-7pm • Winter Lights • Indoors",
          },
        ],
      }),
    );
    expect(wrong.problems.join(" ")).toMatch(/isn't in issue:7/);
    const gone = await one(
      event({ evidence: [{ url: "issue:8", quote: QUOTE }] }),
    );
    expect(gone.problems.join(" ")).toMatch(/isn't a stored newsletter issue/);
  });

  it("needs the quote to name the event", async () => {
    const v = await one(
      event({
        evidence: [
          { url: "issue:7", quote: QUOTE },
          {
            url: "issue:7",
            quote: "Entry, the light walk, and the bonfire are free.",
          },
        ],
      }),
    );
    expect(v.problems.join(" ")).toMatch(/must name the event/);
  });

  it("needs the printed weekday to be the date's own", async () => {
    const v = await one(
      event({ dates: [{ day: "2026-11-28", start: "12:00" }] }),
    );
    // Nov 28 isn't printed at all; a "Saturday, November 21" quote for a
    // Friday the 21st (another year) would print the wrong weekday:
    expect(v.ok).toBe(false);
    const friday = await one(
      event({
        dates: [{ day: "2025-11-21", start: "12:00" }],
      }),
      { ...ctx(stored), now: new Date("2025-11-20T15:00:00Z") },
    );
    expect(friday.problems.join(" ")).toMatch(
      /weekday that isn't 2025-11-21's/,
    );
  });

  it("needs the issue sent within 6 weeks before the event", async () => {
    const early = await one(
      event(),
      ctx({ 7: { text: ISSUE_TEXT, day: "2026-09-30" } }),
    );
    expect(early.problems.join(" ")).toMatch(
      /isn't within 6 weeks before 2026-11-21/,
    );
    const after = await one(
      event(),
      ctx({ 7: { text: ISSUE_TEXT, day: "2026-11-22" } }),
    );
    expect(after.problems.join(" ")).toMatch(/isn't within 6 weeks/);
  });

  it("takes an issue sent up to 42 days before, the same day, never 43", async () => {
    const at = (day: string) =>
      one(event(), ctx({ 7: { text: ISSUE_TEXT, day } }));
    expect((await at("2026-10-10")).problems).toEqual([]); // 42 days
    expect((await at("2026-11-21")).problems).toEqual([]); // same day
    expect((await at("2026-10-09")).problems.join(" ")).toMatch(
      /isn't within 6 weeks before 2026-11-21/,
    ); // 43 days
  });

  it("caps a series on an issue at the issue day + 42", async () => {
    const weekly = (days: string[]) =>
      event({
        title: "Winter Lights",
        series: true,
        dates: days.map((day) => ({ day, start: "12:00" })),
        evidence: [
          {
            url: "issue:7",
            quote: "Winter Lights every Saturday, Nov 21 to Jan 30, 12-7pm",
          },
        ],
      });
    const text = `${ISSUE_TEXT} Winter Lights every Saturday, Nov 21 to Jan 30, 12-7pm.`;
    const c = (now: Date) => ({
      ...ctx({ 7: { text, day: "2026-11-19" } }),
      now,
    });
    const ok = await one(
      weekly(["2026-11-21", "2026-12-26"]),
      c(new Date("2026-11-20T15:00:00Z")),
    );
    expect(ok.problems).toEqual([]);
    // Dec 31 is 42 days after Nov 19; Jan 2 is past it.
    const past = await one(
      weekly(["2026-11-21", "2027-01-02"]),
      c(new Date("2026-11-20T15:00:00Z")),
    );
    expect(past.problems.join(" ")).toMatch(
      /2027-01-02 is more than 6 weeks after the issue it stands on \(2026-12-31 at most\)/,
    );
  });

  it("needs verified_via listing, and is never the event's link", async () => {
    const plain = await one(event({ verified_via: undefined }));
    expect(plain.problems.join(" ")).toMatch(
      /only with verified_via "listing"/,
    );
    const asLink = await one(event({ url: "issue:7" }));
    expect(asLink.ok).toBe(false);
    expect(asLink.problems.join(" ")).toMatch(/url/);
  });

  it("keeps our own words off the issue's", async () => {
    const v = await one(
      event({
        what: "Entry, the light walk, and the bonfire are free.",
      }),
    );
    expect(v.problems.join(" ")).toMatch(/too close to the listing/);
  });

  it("checks a discovery issue's words too", async () => {
    const v = await one(
      event({
        discovery_url: "issue:7",
        what: "Santa arrives at 2pm for photos & visits. Lights on and a bonfire.",
      }),
    );
    expect(v.problems.join(" ")).toMatch(/too close/);
    const missing = await one(event({ discovery_url: "issue:99" }));
    expect(missing.problems.join(" ")).toMatch(/isn't a stored issue/);
  });

  it("never makes two events one page by sharing an issue", () => {
    expect(
      samePage(
        { url: "https://a.org/1", targetUrls: ["issue:7"] },
        { url: "https://b.org/2", targetUrls: ["issue:7"] },
        [],
        [],
      ),
    ).toBe(false);
    expect(issueId("issue:7")).toBe(7);
    expect(issueId("issue:0")).toBe(null);
    expect(issueId("https://x.org/issue:7")).toBe(null);
  });
});

describe("the nightly check of an issue", () => {
  it("is seen while the issue is stored, unknown once it's pruned", () => {
    const issuePage = { status: 200, finalUrl: "issue:7", text: ISSUE_TEXT };
    expect(
      judgeListing(walled, issuePage, QUOTE, "Winter Lights", "2026-11-21"),
    ).toBe("seen");
    expect(
      judgeListing(walled, null, QUOTE, "Winter Lights", "2026-11-21"),
    ).toBe("unknown");
  });
});
