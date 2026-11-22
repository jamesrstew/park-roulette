import { describe, expect, it } from "vitest";
import { outingAges } from "@/lib/news/template";
import type { FetchResult } from "@/lib/news/validate";
import {
  costChip,
  eventJsonLd,
  type EventInput,
  type EventRow,
  eventSlug,
  eventTitle,
  groupOf,
  icsFile,
  seriesKey,
  storedFrom,
  weeklyPattern,
  whenLine,
} from "./model";
import { closestLine, nearbyPlaygrounds } from "./nearby";
import { afterCheck, eventChanges, judge, listed } from "./state";
import { containment, validateEvents, type EventsContext } from "./validate";

const URL_ = "https://www.highdesertmuseum.org/fall-family-day";
const base = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Fall Family Day",
  dates: [{ day: "2026-11-21", start: "10:00", end: "14:00" }],
  venue: {
    name: "High Desert Museum",
    town: "Bend",
    street: "59800 S Highway 97",
    postal: "97702",
    lat: 43.9666,
    lng: -121.3423,
  },
  setting: "indoor",
  cost: {
    text: "$13 kids, $20 grown-ups, under 3 free",
    prices: [
      { label: "kids", amount: 13 },
      { label: "grown-ups", amount: 20 },
    ],
    free: false,
  },
  ages_text: "Ages 3 to 10",
  what: "Kids meet the porcupines up close, then make a pine-cone bird feeder to take home.",
  url: URL_,
  evidence: [
    {
      url: URL_,
      quote:
        "Saturday, November 21, 10 am to 2 pm. Ages 3 to 10. Admission $13 kids, $20 adults.",
    },
  ],
  ...over,
});

const NOW = new Date("2026-11-19T20:00:00Z"); // Thursday
const PAGE =
  "Fall Family Day at the museum. Saturday, November 21, 10 am to 2 pm. Ages 3 to 10. Admission $13 kids, $20 adults. Families explore animal exhibits and crafts.";

function ctx(over: Partial<EventsContext> = {}): EventsContext {
  return {
    catalog: {
      link_domains: ["highdesertmuseum.org", "deschuteslibrary.org"],
      event_series: [],
    },
    fetchGapMs: 0,
    parks: new Map([
      ["juniper-park-bend", { lat: 44.05, lng: -121.29, name: "Juniper Park" }],
    ]),
    now: NOW,
    fetcher: async (url): Promise<FetchResult> =>
      url === URL_
        ? { status: 200, finalUrl: url, text: PAGE }
        : url.includes("beehiiv")
          ? {
              status: 200,
              finalUrl: url,
              text: "Roundup: Kids meet the porcupines up close, then make a pine-cone bird feeder to take home.",
            }
          : { status: 404, finalUrl: url, text: "" },
    ...over,
  };
}

const row = (e: EventInput, over: Partial<EventRow> = {}): EventRow => ({
  id: 1,
  slug: eventSlug(e),
  kind: "one_off",
  data: storedFrom(e, { lat: 43.9666, lng: -121.3423 }, e.evidence[0].quote),
  status: "scheduled",
  confirm: "ok",
  lastSeenAt: NOW,
  factsChangedAt: NOW,
  stateChangedAt: null,
  ...over,
});

describe("the events validator (shared rules)", () => {
  it("passes a primary-source event and maps its printed ages", async () => {
    const r = await validateEvents({ events: [base()] }, ctx());
    expect(r.events[0].problems).toEqual([]);
    expect(r.events[0].event?.ages?.tags).toEqual([
      "Ages 0-3",
      "Ages 4-7",
      "Ages 8-12",
    ]);
    expect(r.events[0].slug).toBe("fall-family-day-high-desert-museum-2026");
  });
  it("cuts other newsletters, off-allowlist links and evidence from another site", async () => {
    const r = await validateEvents(
      {
        events: [
          base({ url: "https://bendfamilyloop.beehiiv.com/p/x" }),
          base({
            evidence: [
              {
                url: "https://www.deschuteslibrary.org/x",
                quote: base().evidence[0].quote,
              },
            ],
          }),
          base({ url: "https://example.com/x" }),
        ],
      },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/another newsletter/);
    expect(r.events[1].problems.join(" ")).toMatch(/same site/);
    expect(r.events[2].problems.join(" ")).toMatch(/allowlist/);
  });
  it("needs dates, times, prices and ages printed in a quote", async () => {
    const r = await validateEvents(
      {
        events: [
          base({ dates: [{ day: "2026-11-22", start: "10:00" }] }),
          base({ dates: [{ day: "2026-11-21", start: "15:00" }] }),
          base({
            cost: {
              text: "$15 kids",
              prices: [{ label: "kids", amount: 15 }],
              free: false,
            },
          }),
          base({ ages_text: "Ages 2 to 5" }),
          base({
            ages_text: "18+",
            evidence: [
              {
                url: URL_,
                quote:
                  "Saturday, November 21, 10 am. 18+ only. $13 kids, $20 adults.",
              },
            ],
          }),
        ],
      },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/2026-11-22/);
    expect(r.events[1].problems.join(" ")).toMatch(/start time/);
    expect(r.events[2].problems.join(" ")).toMatch(/\$15/);
    expect(r.events[3].problems.join(" ")).toMatch(/word for word/);
    expect(r.events[4].problems.join(" ")).toMatch(/Not a kids' event/);
  });
  it("takes a library program's printed ages from its event page, never its audience label (events-ages)", async () => {
    // What dpl.libnet.info/event/{id} prints (November 2026): the
    // program's own age words, then the library's AGE GROUP label.
    const EV = "https://dpl.libnet.info/event/17804701";
    const CAL = "https://www.deschuteslibrary.org/calendar/";
    const page =
      "Baby Story Time A gentle story time for infant and caregiver. 0-18 mo. Central Library - Youth Programing (2nd Floor) Saturday, November 21 10:30am - 11:05am Add to Calendar This workshop is intended for children ages 0-5, and all children must be accompanied by a caregiver. AGE GROUP: | Baby | EVENT TYPE: | Story Time |";
    const lib = (ages_text: string, quote: string): EventInput =>
      base({
        title: "Baby Story Time",
        dates: [{ day: "2026-11-21", start: "10:30", end: "11:05" }],
        venue: { name: "Central Library", town: "Bend" },
        cost: undefined,
        ages_text,
        url: CAL,
        what: "Babies and their grown-ups share simple stories, songs and rhymes around a parachute.",
        evidence: [
          { url: EV, quote: "Saturday, November 21 10:30am - 11:05am" },
          { url: EV, quote },
        ],
      });
    const r = await validateEvents(
      {
        events: [
          lib(
            "0-18 mo.",
            "A gentle story time for infant and caregiver. 0-18 mo.",
          ),
          // The audience label has no numbers: never an age.
          lib("Baby", "AGE GROUP: | Baby | EVENT TYPE: | Story Time |"),
          // The age words with the condition: copy only the age words.
          lib(
            "children ages 0-5, and all children must be accompanied by a caregiver",
            "This workshop is intended for children ages 0-5, and all children must be accompanied by a caregiver.",
          ),
          lib(
            "children ages 0-5",
            "This workshop is intended for children ages 0-5, and all children must be accompanied by a caregiver.",
          ),
        ],
      },
      ctx({
        catalog: {
          link_domains: ["deschuteslibrary.org", "dpl.libnet.info"],
          event_series: [],
          site_aliases: { "dpl.libnet.info": "deschuteslibrary.org" },
        },
        fetcher: async (url): Promise<FetchResult> =>
          url === EV
            ? { status: 200, finalUrl: url, text: page }
            : url === CAL
              ? { status: 200, finalUrl: url, text: "Library calendar" }
              : { status: 404, finalUrl: url, text: "" },
      }),
    );
    const problems = r.events.map((e) => e.problems.join(" "));
    expect(problems[0]).toBe("");
    expect(r.events[0].event?.ages?.tags).toEqual(["Ages 0-3"]);
    expect(problems[1]).toMatch(/doesn't say an age/);
    expect(problems[2]).toMatch(/doesn't say an age/);
    expect(problems[3]).toBe("");
  });
  it("cuts a what-kids-do line too close to the roundup it was found in", async () => {
    const r = await validateEvents(
      {
        events: [
          base({
            discovery_url: "https://bendfamilyloop.beehiiv.com/p/nov-20",
          }),
        ],
      },
      ctx(),
    );
    expect(r.events[0].problems.join(" ")).toMatch(
      /too close to where we found/,
    );
    expect(containment("a b c d e f", "x a b c d e f y")).toBe(1);
  });
  it("cuts a quote that isn't on the page anymore", async () => {
    const r = await validateEvents(
      { events: [base()] },
      ctx({
        fetcher: async (u) => ({
          status: 200,
          finalUrl: u,
          text: "Nothing here.",
        }),
      }),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/isn't on/);
  });
  it("names a competitor nowhere, and no em dashes", async () => {
    const r = await validateEvents(
      {
        events: [
          base({
            what: "As seen in Bend Family Loop, kids make crafts all morning long.",
          }),
        ],
      },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/another newsletter/);
  });
});

describe("series, slugs and dates", () => {
  it("keys a series on the catalog id or venue + title stem, never per occurrence", () => {
    const a = base({
      title: "Story Time: Dinosaurs",
      dates: [{ day: "2026-11-21" }, { day: "2026-11-28" }],
    });
    const b = base({
      title: "Story Time: Snow",
      dates: [{ day: "2026-12-05" }, { day: "2026-12-12" }],
    });
    expect(seriesKey(a)).toBe(seriesKey(b));
    // A series_id links the catalog; it's never the key (writer fix 1).
    expect(seriesKey(base({ series_id: "series-x" }))).toBe(
      "venue:venue-high-desert-museum:fall-family-day",
    );
    expect(eventSlug(base({ annual: true }))).toBe(
      "fall-family-day-high-desert-museum",
    );
  });
  it("groups in date order and drops an event at its end time", () => {
    expect(groupOf("2026-11-19", "2026-11-19")).toBe("week");
    expect(groupOf("2026-11-21", "2026-11-19")).toBe("weekend");
    expect(groupOf("2026-11-24", "2026-11-19")).toBe("next");
    expect(groupOf("2026-12-10", "2026-11-19")).toBe("later");
    expect(groupOf("2026-11-21", "2026-11-20")).toBe("weekend");
    const r = row(base());
    expect(listed(r, new Date("2026-11-21T21:59:00Z"))).toBe(true);
    expect(listed(r, new Date("2026-11-21T22:01:00Z"))).toBe(false);
  });
  it("says when plainly", () => {
    expect(whenLine({ day: "2026-11-21", start: "10:00", end: "14:00" })).toBe(
      "Sat, Nov 21 · 10 am to 2 pm",
    );
    expect(whenLine({ day: "2026-11-26", start: "08:30" })).toBe(
      "Thu, Nov 26 · Start time 8:30 am",
    );
    expect(whenLine({ day: "2026-12-01", end_day: "2026-12-06" })).toBe(
      "Dec 1 to Dec 6",
    );
    expect(
      weeklyPattern([
        { day: "2026-11-21", start: "10:30" },
        { day: "2026-11-28", start: "10:30" },
        { day: "2026-12-05", start: "10:30" },
      ]),
    ).toBe("Saturdays, 10:30 am");
    expect(costChip(storedFrom(base(), null, ""))).toBe("$13 kids");
  });
  it("never understates: kids' prices, fees, adults, from, family, commas", () => {
    const priced = (
      text: string,
      prices: { label: string; amount: number }[],
      free = false,
    ) => costChip(storedFrom(base({ cost: { text, prices, free } }), null, ""));
    // "$10 adults, kids free" isn't $10.
    expect(
      priced("$10 adults, kids free", [
        { label: "adults", amount: 10 },
        { label: "kids", amount: 0 },
      ]),
    ).toBe("Kids free");
    expect(
      priced("$10 adults, kids free", [{ label: "adults", amount: 10 }]),
    ).toBe("Kids free");
    expect(priced("$10 adults", [{ label: "adults", amount: 10 }])).toBe(
      "$10 adults",
    );
    // A fee isn't part of the price.
    expect(
      priced("$15 + $2.50 fee", [
        { label: "ticket", amount: 15 },
        { label: "fee", amount: 2.5 },
      ]),
    ).toBe("$15");
    expect(
      priced("$20, $5 parking, $10 deposit", [
        { label: "class", amount: 20 },
        { label: "parking", amount: 5 },
        { label: "deposit", amount: 10 },
      ]),
    ).toBe("$20");
    // "Adult with child" is a grown-up's price, not a kid's.
    expect(
      priced("$12 adult with child, $6 child", [
        { label: "adult with child", amount: 12 },
        { label: "child", amount: 6 },
      ]),
    ).toBe("$6 kids");
    // A lone starting price.
    expect(priced("From $5", [{ label: "from", amount: 5 }])).toBe("From $5");
    expect(
      priced("Classes starting at $25", [{ label: "class", amount: 25 }]),
    ).toBe("From $25");
    // A family price.
    expect(
      priced("$10 per family", [{ label: "per family", amount: 10 }]),
    ).toBe("$10 family");
    // The thousands comma.
    expect(
      priced("$1,250 per camp week", [{ label: "camp week", amount: 1250 }]),
    ).toBe("$1,250");
    expect(
      priced("$1,250 to $1,500", [
        { label: "camp", amount: 1250 },
        { label: "camp", amount: 1500 },
      ]),
    ).toBe("$1,250 to $1,500");
  });
  it("shows the printed price range, never just the low end", () => {
    const priced = (
      text: string,
      prices: { label: string; amount: number }[],
    ) =>
      costChip(
        storedFrom(base({ cost: { text, prices, free: false } }), null, ""),
      );
    // TEAL prints "Price From $5.00 to $20.00".
    expect(
      priced("Price From $5.00 to $20.00", [
        { label: "from", amount: 5 },
        { label: "to", amount: 20 },
      ]),
    ).toBe("$5 to $20");
    expect(
      priced("$8 to $12 kids, $20 grown-ups", [
        { label: "kids", amount: 8 },
        { label: "kids", amount: 12 },
        { label: "grown-ups", amount: 20 },
      ]),
    ).toBe("$8 to $12 kids");
    expect(priced("$4.50", [{ label: "admission", amount: 4.5 }])).toBe(
      "$4.50",
    );
    expect(
      priced("$5 per child", [
        { label: "per child", amount: 5 },
        { label: "per child", amount: 5 },
      ]),
    ).toBe("$5 kids");
  });
  it("trims the title, never the date or town", () => {
    const long = storedFrom(
      base({
        title: "An Extremely Long Event Name For The Whole Family Day Out",
      }),
      null,
      "",
    );
    const t = eventTitle(long, "one_off", long.dates[0]);
    expect(t.length).toBeLessThanOrEqual(65);
    expect(t).toMatch(/, Nov 21 in Bend$/);
    expect(
      eventTitle(storedFrom(base(), null, ""), "one_off", base().dates[0]),
    ).toBe("Fall Family Day, Nov 21 in Bend | Park Roulette");
  });
});

describe("Event JSON-LD and the calendar file", () => {
  it("marks up an upcoming, confirmed event with every price and a Pacific time", () => {
    const [ld] = eventJsonLd(
      row(base()),
      NOW,
      "https://parkroulette.quest",
    ) as Record<string, unknown>[];
    expect(ld.startDate).toBe("2026-11-21T10:00:00-08:00");
    expect(ld.eventStatus).toBe("https://schema.org/EventScheduled");
    expect((ld.offers as unknown[]).length).toBe(2);
    expect(ld.typicalAgeRange).toBe("3-10");
    expect(ld).not.toHaveProperty("availability");
    expect((ld.location as { address: object }).address).toMatchObject({
      addressRegion: "OR",
      postalCode: "97702",
    });
  });
  it("uses a date alone without a printed time, never ships an empty street, and nothing when unconfirmed", () => {
    const e = base({
      dates: [{ day: "2026-11-21" }],
      venue: { name: "Wanoga Sno-Park", town: "Bend" },
    });
    const [ld] = eventJsonLd(row(e), NOW, "https://x") as Record<
      string,
      unknown
    >[];
    expect(ld.startDate).toBe("2026-11-21");
    expect(JSON.stringify(ld)).not.toContain("streetAddress");
    expect(
      eventJsonLd(row(base(), { confirm: "unconfirmed" }), NOW, "https://x"),
    ).toEqual([]);
    const [c] = eventJsonLd(
      row(base(), { status: "canceled" }),
      NOW,
      "https://x",
    ) as Record<string, unknown>[];
    expect(c.eventStatus).toBe("https://schema.org/EventCancelled");
  });
  it("writes a calendar file with the official link", () => {
    const ics = icsFile(
      storedFrom(base(), null, ""),
      base().dates[0],
      "https://parkroulette.quest/events/x",
      NOW,
    );
    expect(ics).toContain("DTSTART:20261121T180000Z");
    expect(ics).toContain("DTEND:20261121T220000Z");
    expect(ics).toContain("SUMMARY:Fall Family Day");
  });
});

describe("the nightly re-check", () => {
  it("counts timeouts, 5xx and bot walls as unknown, and needs two real misses", () => {
    const q = "Saturday, November 21";
    expect(judge(null, q)).toBe("unknown");
    expect(judge({ status: 503, text: "" }, q)).toBe("unknown");
    expect(judge({ status: 403, text: "" }, q)).toBe("unknown");
    expect(judge({ status: 404, text: "" }, q)).toBe("miss");
    expect(judge({ status: 200, text: "Moved on." }, q)).toBe("miss");
    expect(judge({ status: 200, text: `It's ${q}.` }, q)).toBe("seen");
    let s = { confirm: "ok" as const, misses: 0 };
    const one = afterCheck(s, "miss");
    expect(one.confirm).toBe("ok");
    expect(afterCheck(one, "unknown")).toMatchObject({
      confirm: "ok",
      misses: 1,
    });
    expect(afterCheck(one, "miss").confirm).toBe("unconfirmed");
    s = { confirm: "ok", misses: 1 };
    expect(afterCheck(s, "seen")).toMatchObject({
      confirm: "ok",
      misses: 0,
      seen: true,
    });
  });
  it("tells IndexNow about passed, canceled and unconfirmed pages", () => {
    const since = new Date("2026-11-21T00:00:00Z");
    const now = new Date("2026-11-22T14:00:00Z");
    const ch = eventChanges(
      [
        row(base()),
        row(base({ title: "Other" }), {
          slug: "other",
          status: "canceled",
          stateChangedAt: new Date("2026-11-21T05:00:00Z"),
        }),
      ],
      since,
      now,
      "https://parkroulette.quest",
    );
    expect(ch.map((c) => c.why).sort()).toEqual([
      "canceled",
      "passed",
      "passed",
    ]);
  });
});

describe("playgrounds nearby (one function for card and page)", () => {
  const parks = [
    {
      slug: "a",
      name: "Near Park",
      city: "Bend",
      lat: 43.97,
      lng: -121.34,
      play: "playground",
      status: "active",
      features: ["swings", "slides", "busy_road"],
      avgTenths: 42,
      reviewCount: 5,
    },
    {
      slug: "b",
      name: "Far Park",
      city: "Bend",
      lat: 44.3,
      lng: -121.0,
      play: "playground",
      status: "active",
      features: [],
      avgTenths: 50,
      reviewCount: 1,
    },
    {
      slug: "c",
      name: "No Play",
      city: "Bend",
      lat: 43.967,
      lng: -121.342,
      play: "none",
      status: "active",
      features: [],
      avgTenths: null,
      reviewCount: 0,
    },
  ];
  it("lists parks with play within 10 miles, stars only with 3+ ratings", () => {
    const near = nearbyPlaygrounds({ lat: 43.9666, lng: -121.3423 }, parks);
    expect(near.map((n) => n.slug)).toEqual(["a"]);
    expect(near[0].stars).toBe(4.2);
    expect(near[0].features).toEqual(["Swings", "Slides"]);
    const line = closestLine(
      storedFrom(base(), { lat: 43.9666, lng: -121.3423 }, ""),
      parks,
    );
    expect(line?.text).toBe(
      `Closest playground: Near Park, ${near[0].miles.toFixed(1)} mi`,
    );
    expect(line?.label).toMatch(/miles away$/);
  });
  it("says Playground on site when the venue is a park with play", () => {
    const e = storedFrom(
      base({ venue: { name: "Near Park", town: "Bend", park: "a" } }),
      null,
      "",
    );
    expect(closestLine(e, parks)?.text).toBe("Playground on site");
  });
});

describe("age tags in the email", () => {
  it("shows code's tags from printed words, never free text, and old issues as they were", () => {
    expect(outingAges({ ages_text: "Ages 5 and under" })).toBe(
      "Ages 0-3, Ages 4-7",
    );
    expect(outingAges({ ages_text: "All ages" })).toBe("All ages");
    expect(outingAges({})).toBeNull();
    expect(outingAges({ ages: "Ages 5 and under" })).toBe("Ages 5 and under");
  });
});

describe("event start times as printed", () => {
  it("needs am or pm (or noon), never a bare number", async () => {
    const { quotePrintsTime } = await import("./validate");
    expect(quotePrintsTime("Saturday, 10 am to 2 pm", "10:00")).toBe(true);
    expect(quotePrintsTime("Sat. 1 to 3 p.m.", "13:00")).toBe(true);
    expect(quotePrintsTime("4:30 pm at the green", "16:30")).toBe(true);
    expect(quotePrintsTime("Starts at noon", "12:00")).toBe(true);
    expect(quotePrintsTime("Ages 3 to 10", "15:00")).toBe(false);
    expect(quotePrintsTime("10 am", "22:00")).toBe(false);
  });
});

describe("release 2 review: events rules", () => {
  it("never takes our own site, roads or weather as an event's page (H1)", async () => {
    const own = "https://parkroulette.quest/events/x";
    const r = await validateEvents(
      {
        events: [
          base({
            url: own,
            evidence: [{ url: own, quote: base().evidence[0].quote }],
          }),
          base({
            organizer: { name: "Us", url: "https://parkroulette.quest/" },
          }),
        ],
      },
      ctx({
        fetcher: undefined,
        catalog: {
          link_domains: [
            "highdesertmuseum.org",
            "parkroulette.quest",
            "weather.gov",
          ],
          event_series: [],
        },
      }),
    );
    for (const v of r.events)
      expect(v.problems.join(" ")).toMatch(/Our own site/);
  });
  it("needs the month and day printed; a weekday counts only for a series in a printed span (H2)", async () => {
    const onlyWeekday = base({
      evidence: [
        {
          url: URL_,
          quote: "Saturday, 10 am to 2 pm. Ages 3 to 10. $13 kids, $20 adults.",
        },
      ],
    });
    const series = base({
      title: "Story Time",
      dates: [
        { day: "2026-11-21", start: "10:00", end: "14:00" },
        { day: "2026-11-28", start: "10:00", end: "14:00" },
      ],
      cost: undefined,
      evidence: [
        {
          url: URL_,
          quote:
            "Every Saturday, Nov 7 to Dec 19, 10 am to 2 pm. Ages 3 to 10.",
        },
      ],
    });
    const outside = base({
      ...series,
      dates: [
        { day: "2026-12-26", start: "10:00", end: "14:00" },
        { day: "2027-01-02", start: "10:00", end: "14:00" },
      ],
    });
    const endDay = base({
      dates: [
        {
          day: "2026-11-21",
          start: "10:00",
          end: "14:00",
          end_day: "2026-11-23",
        },
      ],
    });
    const r = await validateEvents(
      { events: [onlyWeekday, series, outside, endDay] },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/month and day/);
    expect(r.events[1].problems).toEqual([]);
    expect(r.events[2].problems.join(" ")).toMatch(/month and day/);
    expect(r.events[3].problems.join(" ")).toMatch(/end date/);
  });
  it("checks end times, and a start time must open its range (L2)", async () => {
    const { quotePrintsTime } = await import("./validate");
    expect(quotePrintsTime("10 am to 2 pm", "14:00", "start")).toBe(false);
    expect(quotePrintsTime("10 am to 2 pm", "14:00", "end")).toBe(true);
    expect(quotePrintsTime("10 am to 2 pm", "10:00", "start")).toBe(true);
    const r = await validateEvents(
      {
        events: [
          base({
            dates: [{ day: "2026-11-21", start: "10:00", end: "15:00" }],
          }),
        ],
      },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/end time/);
  });
  it("Free needs admission words and no price; cents count (M1, M2)", async () => {
    let n = 0;
    const free = (quote: string, text = "Free") =>
      base({
        title: `Free day ${++n}`,
        cost: { text, prices: [], free: true },
        evidence: [{ url: URL_, quote }],
      });
    const day = "Saturday, November 21, 10 am to 2 pm. Ages 3 to 10.";
    const r = await validateEvents(
      {
        events: [
          free(`${day} Free parking.`),
          free(`${day} Free admission.`),
          free(`${day} Free admission.`, "Free, $5 for crafts"),
          base({
            title: "Cents one",
            cost: {
              text: "$13.50 kids",
              prices: [{ label: "kids", amount: 13.5 }],
              free: false,
            },
            evidence: [{ url: URL_, quote: `${day} $13 kids.` }],
          }),
          base({
            title: "Cents two",
            cost: {
              text: "$13 kids",
              prices: [{ label: "kids", amount: 13 }],
              free: false,
            },
            evidence: [{ url: URL_, quote: `${day} $13.00 kids.` }],
          }),
        ],
      },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/admission/);
    expect(r.events[1].problems).toEqual([]);
    expect(r.events[2].problems.join(" ")).toMatch(/price in the cost/);
    expect(r.events[3].problems.join(" ")).toMatch(/13\.5/);
    expect(r.events[4].problems).toEqual([]);
  });
  it("reads status quotes carefully (L4)", async () => {
    const day =
      "Saturday, November 21, 10 am to 2 pm. Ages 3 to 10. $13 kids, $20 adults.";
    const st = (
      kind: "canceled" | "postponed" | "rescheduled",
      quote: string,
      previous_day?: string,
    ) =>
      base({
        status: { kind, quote, previous_day },
        evidence: [{ url: URL_, quote: `${day} ${quote}` }],
      });
    const r = await validateEvents(
      {
        events: [
          st("canceled", "No cancellations for weather."),
          st("postponed", "This event is canceled."),
          st("rescheduled", "Rescheduled to a new date.", "2026-11-14"),
          st("canceled", "This event is canceled."),
        ],
      },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/not canceled/);
    expect(r.events[1].problems.join(" ")).toMatch(/must say postponed/);
    expect(r.events[2].problems.join(" ")).toMatch(/old date/);
    expect(r.events[3].problems).toEqual([]);
    expect(r.events[3].event?.statusByDay).toEqual({
      "2026-11-21": "canceled",
    });
  });
  it("compares short lines on word pairs, and a discovery page that won't load fails the copy check (L3)", async () => {
    expect(
      containment("porcupine crafts", "see the porcupine crafts today"),
    ).toBe(1);
    const r = await validateEvents(
      { events: [base({ discovery_url: "https://example.org/roundup" })] },
      ctx(),
    );
    expect(r.events[0].problems.join(" ")).toMatch(/copy check couldn't run/);
  });
  it("keys single-date hand-ins of one series together unless series: false (H3)", () => {
    const a = base({
      title: "Story Time: Dinosaurs",
      dates: [{ day: "2026-11-21" }],
    });
    const b = base({
      title: "Story Time: Snow",
      dates: [{ day: "2026-11-28" }],
    });
    expect(seriesKey(a)).toBe(seriesKey(b));
    expect(seriesKey(base({ series: false }))).toMatch(/^one:/);
  });
  it("marks up date-only starts and ends together, with a per-date anchor (L9)", () => {
    const e = base({
      dates: [{ day: "2026-11-21", start: "10:00", end_day: "2026-11-23" }],
    });
    const [ld] = eventJsonLd(row(e), NOW, "https://x") as Record<
      string,
      string
    >[];
    expect(ld.startDate).toBe("2026-11-21");
    expect(ld.endDate).toBe("2026-11-23");
    expect(ld.url).toMatch(/#2026-11-21-1000$/);
  });
  it("writes a clean calendar file: no line breaks, folded lines, cancellations, all-day spans (L1)", async () => {
    const { icsFold } = await import("./model");
    const e = storedFrom(
      base({
        what: "Line one.\r\nLine two, with commas; and more words to make this long enough to fold over seventy five octets.",
      }),
      null,
      "",
    );
    const ics = icsFile(
      e,
      {
        day: "2026-11-21",
        start: "10:00",
        end: "14:00",
        end_day: "2026-11-23",
      },
      "https://x/events/y",
      NOW,
      "canceled",
    );
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261121");
    expect(ics).toContain("DTEND;VALUE=DATE:20261124");
    for (const line of ics.split("\r\n"))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics).not.toMatch(/Line one\.\r\nLine/);
    expect(icsFold("x".repeat(80)).split("\r\n ")).toHaveLength(2);
  });
});

describe("release 2 review: the nightly check", () => {
  it("needs two seen nights to confirm again after couldn't-confirm (L10)", () => {
    const s = { confirm: "unconfirmed" as const, misses: 2, seenStreak: 0 };
    const one = afterCheck(s, "seen");
    expect(one.confirm).toBe("unconfirmed");
    expect(afterCheck(one, "seen").confirm).toBe("ok");
    expect(afterCheck(one, "unknown").seenStreak).toBe(1);
  });
  it("checks the next date's own quote, or the status quote (H4)", async () => {
    const { checkTarget } = await import("./state");
    const e = base({
      dates: [{ day: "2026-11-21" }, { day: "2026-12-05" }],
      evidence: [
        {
          url: URL_,
          quote: "Saturday, November 21. Ages 3 to 10. $13 kids, $20 adults.",
        },
        { url: `${URL_}/dec`, quote: "Saturday, December 5. Ages 3 to 10." },
      ],
    });
    const r = row(e, { kind: "series" });
    r.data.targets = {
      "2026-11-21": { url: URL_, quote: e.evidence[0].quote },
      "2026-12-05": { url: `${URL_}/dec`, quote: e.evidence[1].quote },
    };
    expect(checkTarget(r, new Date("2026-11-25T12:00:00Z"))?.url).toBe(
      `${URL_}/dec`,
    );
    r.data.status = { kind: "canceled", quote: "This event is canceled." };
    r.data.statusByDay = { "2026-12-05": "canceled" };
    expect(checkTarget(r, new Date("2026-11-25T12:00:00Z"))?.quote).toBe(
      "This event is canceled.",
    );
  });
  it("lists an event's entry into the 60-day window for lastmod and IndexNow (M12)", async () => {
    const { eventLastmod } = await import("./state");
    const e = base({ dates: [{ day: "2027-01-10" }] });
    const r = row(e, { factsChangedAt: new Date("2026-10-01T00:00:00Z") });
    expect(
      eventLastmod(r, new Date("2026-11-19T12:00:00Z"))
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-11-11");
    const ch = eventChanges(
      [r],
      new Date("2026-11-10T00:00:00Z"),
      new Date("2026-11-19T12:00:00Z"),
      "https://x",
    );
    expect(ch.map((c) => c.why)).toContain("listed");
  });
});

describe("the final review: printed years and negated weekdays (M5)", () => {
  it("refuses a date printed with another year, and a weekday the page says isn't on", async () => {
    const { quotePrintsDate, datePrinted } = await import("./validate");
    expect(
      quotePrintsDate("Friday, November 28, 2025, 5 pm", "2026-11-28"),
    ).toBe(false);
    expect(
      quotePrintsDate("Friday, November 28, 2026, 5 pm", "2026-11-28"),
    ).toBe(true);
    expect(quotePrintsDate("When: 11/28/2025", "2026-11-28")).toBe(false);
    expect(quotePrintsDate("When: 11/28/26", "2026-11-28")).toBe(true);
    expect(quotePrintsDate("Nov 28", "2026-11-28")).toBe(true);
    expect(
      datePrinted(
        ["Story time every Saturday", "Fall session Sept 6 - Dec 13"],
        "2026-12-05",
        true,
      ),
    ).toBe(true);
    expect(
      datePrinted(
        ["No story time Saturdays in December", "Fall session Nov 1 - Dec 20"],
        "2026-12-05",
        true,
      ),
    ).toBe(false);
    expect(
      datePrinted(
        ["Open daily except Saturdays", "Nov 1 - Dec 20"],
        "2026-12-05",
        true,
      ),
    ).toBe(false);
  });
});

describe("the writer's first live run", () => {
  it("merges one series handed in as several objects, instead of failing", async () => {
    const one = (day: string, start: string) =>
      base({
        title: "Story Time",
        cost: undefined,
        dates: [{ day, start }],
        evidence: [
          {
            url: URL_,
            quote: `Saturday, ${day === "2026-11-21" ? "November 21" : "November 28"}, ${start === "10:30" ? "10:30 am" : "1 pm"}. Ages 3 to 10.`,
          },
        ],
      });
    const r = await validateEvents(
      {
        events: [
          one("2026-11-21", "10:30"),
          one("2026-11-28", "10:30"),
          one("2026-11-28", "13:00"),
        ],
      },
      ctx({ fetcher: undefined }),
    );
    expect(r.ok).toBe(true);
    expect(r.events[0].event?.dates.map((d) => `${d.day} ${d.start}`)).toEqual([
      "2026-11-21 10:30",
      "2026-11-28 10:30",
      "2026-11-28 13:00",
    ]);
    expect(r.events[1].merged).toBe(0);
    expect(r.events[0].kind).toBe("series");
  });
  it("takes a bare Free next to the title or date, and short quotes with a price and a date", async () => {
    const free = (quote: string, title = "Santa Flies In") =>
      base({
        title,
        cost: { text: "Free", prices: [], free: true },
        ages_text: undefined,
        dates: [{ day: "2026-12-06" }],
        evidence: [{ url: URL_, quote }],
      });
    const r = await validateEvents(
      {
        events: [
          free("Santa Flies In · Dec 6 · Free"),
          free("Dec 6 · Free", "Short One"),
          free("Dec 6. Free parking for everyone who comes.", "Parking Day"),
        ],
      },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems).toEqual([]);
    expect(r.events[1].problems).toEqual([]);
    expect(r.events[2].problems.join(" ")).toMatch(/Free/);
    const short = await validateEvents(
      { events: [free("Dec 6 hi", "Tiny Quote")] },
      ctx({ fetcher: undefined }),
    );
    expect(short.events[0].problems.join(" ")).toMatch(/too short/);
  });
  it("allows up to 8 evidence quotes", async () => {
    const ev = Array.from({ length: 8 }, () => base().evidence[0]);
    const r = await validateEvents(
      { events: [base({ evidence: ev })] },
      ctx({ fetcher: undefined }),
    );
    expect(r.events[0].problems).toEqual([]);
  });
});

describe("batch 6: listings sites and hosts that don't answer", () => {
  it("refuses a visitbend link or evidence, and accepts it as discovery_url (item 3)", async () => {
    const vb = "https://www.visitbend.com/event/fall-family-day/";
    const c = ctx({
      fetcher: undefined,
      catalog: {
        link_domains: ["highdesertmuseum.org"],
        lead_domains: ["visitbend.com"],
        event_series: [],
      },
    });
    const linked = await validateEvents({ events: [base({ url: vb })] }, c);
    expect(linked.events[0].problems).toContain(
      "visitbend.com is a lead only: never a link or evidence. Find the organizer's own page.",
    );
    const found = await validateEvents(
      { events: [base({ discovery_url: vb })] },
      c,
    );
    expect(found.events[0].problems).toEqual([]);
  });

  it("names a reset and reports the host as blocked (item 4)", async () => {
    const r = await validateEvents(
      { events: [base()] },
      ctx({
        fetcher: async (url) => ({
          status: 0,
          finalUrl: url,
          text: "",
          unreachable: "connection reset",
          blockedKind: "reset",
        }),
      }),
    );
    expect(r.events[0].ok).toBe(false);
    expect(r.events[0].problems).toContain(
      "www.highdesertmuseum.org didn't answer (connection reset).",
    );
    expect(r.events[0].blocked).toEqual({
      host: "www.highdesertmuseum.org",
      kind: "reset",
      url: URL_,
    });
  });
});

describe("guardrails end to end: validateEvents (review M6)", () => {
  const c = () =>
    ctx({
      fetcher: undefined,
      catalog: {
        link_domains: ["highdesertmuseum.org", "deschuteslibrary.org"],
        lead_domains: ["visitbend.com"],
        event_series: [],
      },
    });
  const problems = async (e: EventInput) =>
    (await validateEvents({ events: [e] }, c())).events[0].problems;

  it("refuses a competitor link", async () => {
    expect(
      await problems(base({ url: "https://bendfamilyloop.beehiiv.com/p/1" })),
    ).toContain(
      "bendfamilyloop.beehiiv.com is another newsletter. Link the primary source.",
    );
  });

  it("refuses visitbend as the link and as evidence", async () => {
    const want =
      "visitbend.com is a lead only: never a link or evidence. Find the organizer's own page.";
    const vb = "https://www.visitbend.com/event/fall-family-day/";
    expect(await problems(base({ url: vb }))).toContain(want);
    expect(
      await problems(base({ evidence: [{ ...base().evidence[0], url: vb }] })),
    ).toContain(want);
  });

  it("refuses a 7-character quote and evidence from another host", async () => {
    const r = await validateEvents(
      { events: [base({ evidence: [{ url: URL_, quote: "Free $5" }] })] },
      c(),
    );
    expect(r.events[0].ok).toBe(false);
    expect(r.events[0].problems.join(" ")).toMatch(/evidence\.0\.quote/);
    const lib = "https://www.deschuteslibrary.org/calendar/1";
    expect(
      await problems(base({ evidence: [{ ...base().evidence[0], url: lib }] })),
    ).toContain(
      "The evidence (www.deschuteslibrary.org) must come from the same site as the link (www.highdesertmuseum.org).",
    );
  });
});

describe("a hand-in's short line", () => {
  it("stores a good short, and drops a bad one with a warning, keeping the event", async () => {
    const good = await validateEvents(
      { events: [base({ short: "Kids meet the porcupines up close" })] },
      ctx(),
    );
    expect(good.events[0].ok).toBe(true);
    expect(good.events[0].event?.short).toBe(
      "Kids meet the porcupines up close",
    );
    const bad = await validateEvents(
      { events: [base({ short: "Kids meet the porcupines, then make" })] },
      ctx(),
    );
    expect(bad.events[0].ok).toBe(true);
    expect(bad.events[0].event?.short).toBeUndefined();
    expect(bad.events[0].warnings.join(" ")).toMatch(/Left out short/);
  });
  it("a short over 120 characters, or not text at all, never refuses the event", async () => {
    for (const short of [
      "Kids meet the porcupines up close ".repeat(5),
      null,
      42,
    ]) {
      const r = await validateEvents(
        { events: [base({ short } as Partial<EventInput>)] },
        ctx(),
      );
      expect(r.events[0].ok, String(short)).toBe(true);
      expect(r.events[0].event?.short).toBeUndefined();
      expect(r.events[0].warnings.join(" ")).toMatch(/Left out short/);
    }
  });
});
