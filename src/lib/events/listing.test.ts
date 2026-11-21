import { describe, expect, it } from "vitest";
import type { FetchResult } from "@/lib/news/validate";
import { samePage } from "./dedupe";
import { type EventInput } from "./model";
import { judgeListing } from "./state";
import {
  type EventsContext,
  organizerVerdict,
  validateEvents,
} from "./validate";

/**
 * Events verified on a local newsletter's listing (verified_via
 * "listing", James 2026-11-21): when the organizer's site keeps our
 * checker out, the newsletter's own listing is the evidence and the
 * organizer's link is the event's page. A wall is never a miss; a dead
 * link or a page that clearly lacks the event still is. We never get past
 * a wall.
 */

const NOW = new Date("2026-11-21T15:00:00Z");
const ISSUE =
  "https://bendfamilyloop.beehiiv.com/p/bend-family-loop-weekend-of-nov-27-29";
const SHARC = "https://www.sunriversharc.com/events/holiday-lights-swim";
const LISTING =
  "Holiday Lights Swim at SHARC Saturday, Nov 28, 5 to 8 pm. Glow sticks, music and a visit from Santa in the indoor pool. $12 per swimmer.";

type Pages = Record<string, FetchResult>;
const page = (url: string, over: Partial<FetchResult> = {}): FetchResult => ({
  status: 200,
  finalUrl: url,
  text: "",
  ...over,
});

function ctx(pages: Pages, over: Partial<EventsContext> = {}): EventsContext {
  return {
    catalog: {
      link_domains: ["sunriversharc.com", "deschuteslibrary.org"],
      lead_domains: [
        "bendbuzz.com",
        "bendfamilyloop.com",
        "bendfamilyloop.beehiiv.com",
        "visitbend.com",
      ],
      listing_domains: ["bendbuzz.com", "bendfamilyloop.beehiiv.com"],
      not_organizer_domains: ["eventbrite.com", "hisawyer.com"],
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    fetcher: async (u) => pages[u] ?? page(u, { status: 404 }),
    ...over,
  };
}

const swim = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Holiday Lights Swim",
  dates: [{ day: "2026-11-28", start: "17:00", end: "20:00" }],
  venue: { name: "SHARC", town: "Sunriver" },
  setting: "indoor",
  cost: {
    text: "$12 per swimmer",
    prices: [{ label: "swimmer", amount: 12 }],
    free: false,
  },
  what: "Kids splash under colored lights with glow sticks, music and a poolside hello from Santa.",
  url: SHARC,
  verified_via: "listing",
  evidence: [{ url: ISSUE, quote: LISTING }],
  ...over,
});

const listingPage = page(ISSUE, {
  text: `Bend Family Loop weekend Nov 19, 2026 ... ${LISTING} ... more events`,
});
const one = async (e: EventInput, pages: Pages) =>
  (await validateEvents({ events: [e] }, ctx(pages))).events[0];

describe("verified on a newsletter's listing", () => {
  it("trusts the listing when the organizer shows a bot wall", async () => {
    const v = await one(swim(), {
      [ISSUE]: listingPage,
      [SHARC]: page(SHARC, {
        status: 403,
        blocked: "an Akamai firewall",
        blockedKind: "bot_check",
      }),
    });
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/Trusted the listing/);
    expect(v.event?.verified_via).toBe("listing");
    expect(v.event?.url).toBe(SHARC);
  });

  it("trusts it on a 403, 429 or 503, a reset or a timeout too", async () => {
    for (const p of [
      page(SHARC, { status: 403 }),
      page(SHARC, { status: 429 }),
      page(SHARC, { status: 503 }),
      page(SHARC, { status: 0, unreachable: "connection reset" }),
      page(SHARC, { status: 0, unreachable: "timed out" }),
      page(SHARC, { text: "Just a moment... Checking your browser" }),
    ]) {
      const v = await one(swim(), { [ISSUE]: listingPage, [SHARC]: p });
      expect(v.problems).toEqual([]);
    }
  });

  it("cuts a dead organizer link, or a loaded page that lacks the event", async () => {
    const dead = await one(swim(), { [ISSUE]: listingPage });
    expect(dead.problems.join(" ")).toMatch(/answered 404: a dead link/);
    const lacks = await one(swim(), {
      [ISSUE]: listingPage,
      [SHARC]: page(SHARC, {
        text:
          "SHARC hours and passes. ".repeat(20) + "Lap swim and water park.",
      }),
    });
    expect(lacks.problems.join(" ")).toMatch(
      /doesn't name "Holiday Lights Swim"/,
    );
    const names = await one(swim(), {
      [ISSUE]: listingPage,
      [SHARC]: page(SHARC, {
        text:
          "Winter events at SHARC. ".repeat(10) +
          "Holiday Lights Swim returns Saturday, Nov 28.",
      }),
    });
    expect(names.problems).toEqual([]);
  });

  it("still checks every quote on the listing", async () => {
    const v = await one(swim(), {
      [ISSUE]: page(ISSUE, { text: "This weekend: crafts and cocoa." }),
      [SHARC]: page(SHARC, { status: 403 }),
    });
    expect(v.problems.join(" ")).toMatch(/isn't on/);
    const gone = await one(swim(), { [SHARC]: page(SHARC, { status: 403 }) });
    expect(gone.problems.join(" ")).toMatch(/answered 404/);
  });

  it("keeps our words our own", async () => {
    const v = await one(
      swim({
        what: "Glow sticks, music and a visit from Santa in the indoor pool.",
      }),
      { [ISSUE]: listingPage, [SHARC]: page(SHARC, { status: 403 }) },
    );
    expect(v.problems.join(" ")).toMatch(/too close to the listing/);
  });

  it("takes an organizer link off the allowlist, never a newsletter, aggregator or reseller", async () => {
    const off = "https://www.tulamovementarts.com/youthevents/";
    const ok = await one(swim({ url: off }), {
      [ISSUE]: listingPage,
      [off]: page(off, { status: 0, unreachable: "connection reset" }),
    });
    expect(ok.problems).toEqual([]);
    for (const url of [
      ISSUE,
      "https://www.visitbend.com/event/holiday-lights-swim/",
      "https://www.eventbrite.com/e/holiday-lights-swim-123",
      "https://www.hisawyer.com/sharc/schedules/1",
    ]) {
      const v = await one(swim({ url }), { [ISSUE]: listingPage });
      expect(v.ok, url).toBe(false);
    }
  });

  it("needs the flag for listing evidence, and the listing for the flag", async () => {
    const noFlag = await one(swim({ verified_via: undefined }), {
      [ISSUE]: listingPage,
    });
    expect(noFlag.problems.join(" ")).toMatch(
      /evidence only with verified_via/,
    );
    const noListing = await one(
      swim({ evidence: [{ url: SHARC, quote: LISTING }] }),
      { [SHARC]: page(SHARC, { status: 403 }) },
    );
    expect(noListing.problems.join(" ")).toMatch(
      /needs the newsletter's own listing/,
    );
  });

  it("never names the newsletter in anything we keep", async () => {
    const v = await one(
      swim({ what: "As seen in Bend Family Loop: kids splash under lights." }),
      { [ISSUE]: listingPage, [SHARC]: page(SHARC, { status: 403 }) },
    );
    expect(v.problems.join(" ")).toMatch(/never name another newsletter/);
  });
});

describe("a listing's date belongs to its event", () => {
  it("needs the date quoted with the event's name", async () => {
    const v = await one(
      swim({
        evidence: [
          { url: ISSUE, quote: "Saturday, Nov 28 and Sunday, Nov 29" },
          { url: ISSUE, quote: LISTING },
        ],
      }),
      { [ISSUE]: listingPage, [SHARC]: page(SHARC, { status: 403 }) },
    );
    expect(v.problems.join(" ")).toMatch(
      /prints a date but not the event's name/,
    );
  });
});

describe("the organizer's page, judged", () => {
  it("reads walls as trust and dead links as cuts", () => {
    const ev = { title: "Holiday Lights Swim", dates: [{ day: "2026-11-28" }] };
    expect(organizerVerdict(null, ev).cut).toBeTruthy();
    expect(organizerVerdict(page(SHARC, { status: 410 }), ev).cut).toMatch(
      /410/,
    );
    // A client-rendered page with nothing to read: cut (review item 1).
    expect(organizerVerdict(page(SHARC, { text: "Loading" }), ev).cut).toMatch(
      /nothing we can read/,
    );
  });
});

describe("the nightly check for a listing event", () => {
  const q = LISTING;
  const t = "Holiday Lights Swim";
  const wall = page(SHARC, { status: 403, blocked: "an Akamai firewall" });
  it("a wall at the organizer is never a miss", () => {
    expect(judgeListing(wall, listingPage, q, t, "2026-11-28")).toBe("seen");
    expect(
      judgeListing(wall, page(ISSUE, { status: 503 }), q, t, "2026-11-28"),
    ).toBe("unknown");
  });
  it("a listing that's gone is unknown, not a miss", () => {
    expect(
      judgeListing(wall, page(ISSUE, { status: 404 }), q, t, "2026-11-28"),
    ).toBe("unknown");
    expect(
      judgeListing(wall, page(ISSUE, { status: 410 }), q, t, "2026-11-28"),
    ).toBe("unknown");
  });
  it("a dead organizer link, or a loaded listing without the quote, is a miss", () => {
    expect(
      judgeListing(
        page(SHARC, { status: 404 }),
        listingPage,
        q,
        t,
        "2026-11-28",
      ),
    ).toBe("miss");
    expect(
      judgeListing(
        wall,
        page(ISSUE, { text: "This weekend: crafts and cocoa, and more." }),
        q,
        t,
        "2026-11-28",
      ),
    ).toBe("miss");
  });
  it("an organizer page that names the event is seen even when the listing is gone", () => {
    const named = page(SHARC, {
      text:
        "Winter at SHARC. ".repeat(20) +
        "Holiday Lights Swim returns Saturday, Nov 28.",
    });
    expect(
      judgeListing(named, page(ISSUE, { status: 404 }), q, t, "2026-11-28"),
    ).toBe("seen");
  });
});

describe("dedupe and newsletter issues", () => {
  it("two events from one issue aren't one page", () => {
    const a = { url: SHARC, targetUrls: [ISSUE] };
    const b = {
      url: "https://www.sunriversharc.com/events/other",
      targetUrls: [ISSUE],
    };
    expect(samePage(a, b, ["bendfamilyloop.beehiiv.com"])).toBe(false);
    expect(
      samePage(a, { url: SHARC, targetUrls: [ISSUE] }, [
        "bendfamilyloop.beehiiv.com",
      ]),
    ).toBe(true);
  });
});
