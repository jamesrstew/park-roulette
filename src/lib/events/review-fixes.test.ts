import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FetchResult } from "@/lib/news/validate";
import { coverage } from "./coverage";
import { samePage } from "./dedupe";
import { type EventInput } from "./model";
import { afterCheck, issueDay, judgeListing, listingUnseenDays } from "./state";
import { jsonText, nextDataText } from "./structured";
import {
  COMPETITOR_NAMES,
  type EventsContext,
  organizerVerdict,
  validateEvents,
} from "./validate";

/** The fresh-eyes review of 7009ab6 (items 1 to 6): red first. */

const NOW = new Date("2026-11-21T15:00:00Z");
const ISSUE = "https://bendfamilyloop.beehiiv.com/p/weekend-of-nov-27-29";
const ORG = "https://www.sunriversharc.com/events/holiday-lights-swim";
const QUOTE = "Saturday 11/28 Holiday Lights Swim 5pm to 8pm";
const ISSUE_TEXT = `Bend Family Loop: Weekend of Nov. 27-29 Megan Nov 19, 2026 • 6 min read ${QUOTE} and more`;

const page = (url: string, over: Partial<FetchResult> = {}): FetchResult => ({
  status: 200,
  finalUrl: url,
  text: "",
  ...over,
});

function ctx(
  pages: Record<string, FetchResult>,
  seen: { url: string; domains: readonly string[] }[] = [],
): EventsContext {
  return {
    catalog: {
      link_domains: ["sunriversharc.com", "sunriverresort.com"],
      evidence_domains: ["api.live.onaws.letsway.com"],
      lead_domains: [
        "bendbuzz.com",
        "bendfamilyloop.beehiiv.com",
        "visitbend.com",
      ],
      listing_domains: ["bendbuzz.com", "bendfamilyloop.beehiiv.com"],
      not_organizer_domains: ["eventbrite.com", "facebook.com"],
      site_aliases: { "api.live.onaws.letsway.com": "sunriverresort.com" },
      alias_paths: {
        "api.live.onaws.letsway.com": [
          "/v1/catalogs/01a11cd6-0ade-73ca-9fb6-f740033680b5/",
          "/v1/catalogs/01a13650-495f-75d5-8c47-331c8470da6c/",
        ],
      },
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    fetcher: async (url, domains) => {
      seen.push({ url, domains });
      return pages[url] ?? page(url, { status: 404 });
    },
  };
}

const swim = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Holiday Lights Swim",
  dates: [{ day: "2026-11-28", start: "17:00", end: "20:00" }],
  venue: { name: "SHARC", town: "Sunriver" },
  what: "Kids splash under colored lights with glow sticks and music at the indoor pool.",
  url: ORG,
  verified_via: "listing",
  evidence: [{ url: ISSUE, quote: QUOTE }],
  ...over,
});
const wall = page(ORG, { status: 403 });
const one = async (
  e: EventInput,
  pages: Record<string, FetchResult>,
  seen?: { url: string; domains: readonly string[] }[],
) => (await validateEvents({ events: [e] }, ctx(pages, seen))).events[0];
const issue = page(ISSUE, { text: ISSUE_TEXT });

describe("1. the organizer's page", () => {
  const t = {
    title: "Holiday Lights Swim",
    dates: [{ day: "2026-11-28" }],
    url: ORG,
  };
  it("cuts a host that won't resolve and a redirect off its site, separately", () => {
    expect(organizerVerdict(page(ORG, { status: 0 }), t).cut).toMatch(
      /didn't resolve|refused/,
    );
    expect(
      organizerVerdict(
        page(ORG, { status: 0, finalUrl: "https://elsewhere.example/x" }),
        t,
      ).cut,
    ).toMatch(/redirects off its site to elsewhere\.example/);
  });
  it("trusts only 403, 429, 5xx, a bot check, a reset or a timeout", () => {
    for (const s of [403, 429, 500, 503])
      expect(
        organizerVerdict(page(ORG, { status: s }), t).trusted,
      ).toBeTruthy();
    for (const s of [400, 401, 405, 451])
      expect(organizerVerdict(page(ORG, { status: s }), t).cut).toBeTruthy();
    expect(
      organizerVerdict(
        page(ORG, { status: 403, blocked: "a Cloudflare bot check" }),
        t,
      ).trusted,
    ).toBeTruthy();
    expect(
      organizerVerdict(
        page(ORG, { status: 0, unreachable: "connection reset" }),
        t,
      ).trusted,
    ).toBeTruthy();
    expect(
      organizerVerdict(page(ORG, { status: 0, unreachable: "timed out" }), t)
        .trusted,
    ).toBeTruthy();
    expect(
      organizerVerdict(page(ORG, { status: 0, unreachable: "TLS error" }), t)
        .cut,
    ).toBeTruthy();
  });
  it("names the event within one sentence or record, not across the page", () => {
    const scattered =
      "Holiday hours at the pool. ".repeat(5) +
      "Lights out at nine. Swim lessons on Mondays, Nov 28 too.";
    expect(organizerVerdict(page(ORG, { text: scattered }), t).cut).toMatch(
      /doesn't name/,
    );
  });
  it("a page that names the event must print its date", () => {
    const wrong =
      "Winter at SHARC. ".repeat(15) + "Holiday Lights Swim is Friday, Nov 27.";
    expect(organizerVerdict(page(ORG, { text: wrong }), t).cut).toMatch(
      /doesn't print/,
    );
    const right =
      "Winter at SHARC. ".repeat(15) +
      "Holiday Lights Swim is Saturday, Nov 28.";
    expect(organizerVerdict(page(ORG, { text: right }), t)).toEqual({});
  });
  it("follows redirects within the organizer's own domain", async () => {
    const seen: { url: string; domains: readonly string[] }[] = [];
    const url = "https://events.tulamovementarts.com/youth/";
    await one(swim({ url }), { [ISSUE]: issue }, seen);
    expect(seen.find((s) => s.url === url)?.domains).toContain(
      "tulamovementarts.com",
    );
  });
});

describe("2. listing dates", () => {
  it("cuts a printed weekday that isn't the day", async () => {
    const q = "Friday 11/28 Holiday Lights Swim 5pm to 8pm";
    const v = await one(swim({ evidence: [{ url: ISSUE, quote: q }] }), {
      [ISSUE]: page(ISSUE, { text: ISSUE_TEXT.replace(QUOTE, q) }),
      [ORG]: wall,
    });
    expect(v.problems.join(" ")).toMatch(/weekday/);
  });
  it("takes a year-less quote only from an issue dated within 6 weeks before", async () => {
    expect(
      (await one(swim(), { [ISSUE]: issue, [ORG]: wall })).problems,
    ).toEqual([]);
    const old = await one(swim(), {
      [ISSUE]: page(ISSUE, {
        text: ISSUE_TEXT.replace("Nov 19, 2026", "Aug 1, 2026"),
      }),
      [ORG]: wall,
    });
    expect(old.problems.join(" ")).toMatch(/6 weeks/);
    const undated = await one(swim(), {
      [ISSUE]: page(ISSUE, { text: ISSUE_TEXT.replace("Nov 19, 2026", "") }),
      [ORG]: wall,
    });
    expect(undated.problems.join(" ")).toMatch(/issue's date/);
    // A quote with its year (a listing page's JSON-LD) needs no issue date.
    const BB = "https://bendbuzz.com/events/holiday-lights-swim-2026-11-28";
    const line =
      "Holiday Lights Swim | 2026-11-28T17:00:00-08:00 | 2026-11-28T20:00:00-08:00";
    const v = await one(swim({ evidence: [{ url: BB, quote: line }] }), {
      [BB]: page(BB, { text: "Holiday Lights Swim", data: line }),
      [ORG]: wall,
    });
    expect(v.problems).toEqual([]);
  });
  it("a listing's time or weekly pattern counts only next to the event's name", async () => {
    const v = await one(
      swim({
        evidence: [
          { url: ISSUE, quote: "Holiday Lights Swim Saturday 11/28" },
          { url: ISSUE, quote: "5pm to 8pm, glow sticks provided" },
        ],
      }),
      {
        [ISSUE]: page(ISSUE, {
          text: `Nov 19, 2026 Holiday Lights Swim Saturday 11/28 ... 5pm to 8pm, glow sticks provided`,
        }),
        [ORG]: wall,
      },
    );
    expect(v.problems.join(" ")).toMatch(/start time/);
  });
});

describe("3. links", () => {
  it("strips tracking and fragments before storing", async () => {
    const v = await one(
      swim({
        url: `${ORG}?utm_source=bendbuzz&utm_medium=email&fbclid=x&mc_eid=1&ref=y#top`,
      }),
      { [ISSUE]: issue, [ORG]: wall },
    );
    expect(v.problems).toEqual([]);
    expect(v.event?.url).toBe(ORG);
  });
  it("refuses a link that still carries a newsletter in its path or query", async () => {
    for (const url of [
      `${ORG}?from=bendfamilyloop`,
      "https://www.sunriversharc.com/bend-buzz-readers/",
      `${ORG}?src=bendfamilyloop.beehiiv.com`,
    ]) {
      const v = await one(swim({ url }), { [ISSUE]: issue, [url]: wall });
      expect(v.ok, url).toBe(false);
    }
  });
  it("names: Family Loop and The Buzz too", () => {
    expect(COMPETITOR_NAMES.test("as seen in the Family Loop")).toBe(true);
    expect(COMPETITOR_NAMES.test("via The Buzz")).toBe(true);
  });
});

describe("4. Sunriver's catalog paths", () => {
  const RECORD = readFileSync(
    path.join(__dirname, "fixtures/sunriver-grand-illumination.json"),
    "utf8",
  );
  const base = "https://api.live.onaws.letsway.com/v1/catalogs/";
  const ID = "01a11cd6-0ade-73ca-9fb6-f740033680b5";
  const PAGE =
    "https://www.sunriverresort.com/things-to-do?experienceId=grand-illumination-71c73139";
  const grand = (url: string): EventInput => ({
    title: "Grand Illumination",
    dates: [{ day: "2026-11-21", start: "12:00", end: "19:00" }],
    venue: { name: "The Lodge at Sunriver Resort", town: "Sunriver" },
    what: "Kids ride the little train, pet the farm animals and visit Santa, then watch the fireworks.",
    url: PAGE,
    evidence: [
      {
        url,
        quote:
          "Saturday, November 21, 2026 Holiday fun for the entire family at Grand Illumination",
      },
      { url, quote: "12 - 7 PM | Food and beverage vendors available" },
    ],
  });
  const pages = (url: string) => ({
    [url]: page(url, {
      contentType: "application/json",
      data: jsonText(RECORD),
    }),
    [PAGE]: page(PAGE),
  });
  it("takes exactly the items path of an allowed catalog", async () => {
    const ok = `${base}${ID}/items?limit=100`;
    expect((await one(grand(ok), pages(ok))).problems).toEqual([]);
    for (const bad of [
      `${base}${ID}/items/../../other/items`,
      `${base}${ID}%2F..%2Fother/items`,
      `${base}${ID}/items/extra`,
      `${base}${ID}/items%5c`,
      `${base}${ID}/%2e%2e/items`,
    ]) {
      const v = await one(grand(bad), pages(bad));
      expect(v.problems.join(" "), bad).toMatch(/organizer's own data/);
    }
  });
  it("needs the record to belong to the catalog in the path", async () => {
    // The fixture's record is catalog 01a11cd6, not 01a13650.
    const other = `${base}01a13650-495f-75d5-8c47-331c8470da6c/items?limit=100`;
    const v = await one(grand(other), pages(other));
    expect(v.problems.join(" ")).toMatch(/catalog/);
  });
});

describe("5. the nightly check of a listing event", () => {
  const t = "Holiday Lights Swim";
  it("an organizer page that says canceled is canceled", () => {
    const org = page(ORG, {
      text:
        "Winter at SHARC. ".repeat(15) +
        "The Holiday Lights Swim on Nov 28 is canceled.",
    });
    expect(judgeListing(org, issue, QUOTE, t, "2026-11-28")).toBe("canceled");
  });
  it("an organizer page that names it on another date is a miss", () => {
    const org = page(ORG, {
      text:
        "Winter at SHARC. ".repeat(15) +
        "Holiday Lights Swim: Saturday, Dec 5.",
    });
    expect(judgeListing(org, issue, QUOTE, t, "2026-11-28")).toBe("miss");
  });
  it("unknown for 14 days, or an issue older than 8 weeks, unconfirms", () => {
    const ok = { confirm: "ok" as const, misses: 0 };
    expect(
      afterCheck(ok, "unknown", listingUnseenDays(10, null, "2026-11-21"))
        .confirm,
    ).toBe("ok");
    expect(
      afterCheck(ok, "unknown", listingUnseenDays(15, null, "2026-11-21"))
        .confirm,
    ).toBe("unconfirmed");
    expect(
      afterCheck(
        ok,
        "unknown",
        listingUnseenDays(1, "2026-09-20", "2026-11-21"),
      ).confirm,
    ).toBe("unconfirmed");
    expect(issueDay(ISSUE_TEXT)).toBe("2026-11-19");
  });
});

describe("6. structured data", () => {
  it("passes a title down one level only in page data", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        page: {
          title: "Holiday Market",
          section: { label: "x", deep: { date: "2026-12-05", note: "Raffle" } },
        },
      },
    )}</script>`;
    const t = nextDataText(html);
    expect(t).toContain("Holiday Market | x");
    expect(t).not.toMatch(/Holiday Market \| 2026-12-05/);
  });
  it("ignores dates inside URLs and paths, and blackout or closed dates", () => {
    const t = jsonText(
      JSON.stringify({
        title: "Gingerbread Build",
        link: "https://example.org/events/2026-12-24/gingerbread",
        path: "/events/2026-12-23/",
        blackoutDates: ["2026-12-25"],
        closedOn: "2026-12-26",
        excludedDates: "2026-12-27",
        start: "2026-12-05T10:00",
      }),
    );
    for (const d of [
      "2026-12-23",
      "2026-12-24",
      "2026-12-25",
      "2026-12-26",
      "2026-12-27",
    ])
      expect(t, d).not.toContain(d);
    expect(t).toContain("Gingerbread Build | 2026-12-05T10:00");
  });
});

describe("10. dedupe: only a known calendar page is shared", () => {
  it("two events sharing any other link are one page", () => {
    const CAL = "https://www.deschuteslibrary.org/calendar/";
    const a = { url: CAL, targetUrls: ["https://dpl.libnet.info/event/1"] };
    const b = { url: CAL, targetUrls: ["https://dpl.libnet.info/event/2"] };
    expect(samePage(a, b, [], [CAL])).toBe(false);
    const x = { url: ORG, targetUrls: ["https://www.sunriversharc.com/a"] };
    const y = { url: ORG, targetUrls: ["https://www.sunriversharc.com/b"] };
    expect(samePage(x, y, [], [CAL])).toBe(true);
  });
});

describe("low: coverage", () => {
  it("skips grown-up pages and canceled dates, and counts a page once", () => {
    const e = (over = {}) => ({
      slug: "a",
      kind: "one_off",
      confirm: "ok",
      url: ORG,
      dates: [{ day: "2026-11-28" }],
      ...over,
    });
    const c = coverage(
      [
        e(),
        e(),
        e({ slug: "b", kids: false }),
        e({ slug: "c", statusByDay: { "2026-11-28": "canceled" } }),
      ],
      "2026-11-21",
    );
    expect(c.community).toBe(1);
  });
});

describe("7 and 9: exclusive items, and where a link lands", () => {
  const LW =
    "https://api.live.onaws.letsway.com/v1/catalogs/01a11cd6-0ade-73ca-9fb6-f740033680b5/items?limit=100";
  const PAGE =
    "https://www.sunriverresort.com/things-to-do?experienceId=letters-to-santa";
  it("cuts a resort item for guests and owners only", async () => {
    const data = jsonText(
      JSON.stringify({
        items: [
          {
            catalogId: "01a11cd6-0ade-73ca-9fb6-f740033680b5",
            title: "Letters to Santa",
            description:
              "Saturday, November 28, 2026 Kids write letters to Santa, 10 am to noon.",
            tags: [{ name: "Exclusive to Caldera Springs Guests & Owners" }],
          },
        ],
      }),
    );
    const v = await one(
      {
        title: "Letters to Santa",
        dates: [{ day: "2026-11-28", start: "10:00" }],
        venue: { name: "Caldera Springs", town: "Sunriver" },
        what: "Kids decorate a letter for Santa and drop it in the big red mailbox.",
        url: PAGE,
        evidence: [
          {
            url: LW,
            quote:
              "Saturday, November 28, 2026 Kids write letters to Santa, 10 am to noon.",
          },
        ],
      },
      { [LW]: page(LW, { data }), [PAGE]: page(PAGE) },
    );
    expect(v.problems.join(" ")).toMatch(/guests, owners or members only/);
  });
  it("cuts a link that lands on a reseller", async () => {
    const v = await one(swim(), {
      [ISSUE]: issue,
      [ORG]: page("https://www.facebook.com/events/1", { status: 403 }),
    });
    expect(v.problems.join(" ")).toMatch(/lands on facebook\.com/);
  });
});
