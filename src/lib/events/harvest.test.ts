import { describe, expect, it } from "vitest";
import {
  type FetchResult,
  quoteHasDay,
  quoteHasTime,
} from "@/lib/news/validate";
import { dedupe, type KnownEvent, titleOverlap } from "./dedupe";
import { ageTags } from "./ages";
import { type EventInput, type EventRow, seriesKey, storedFrom } from "./model";
import { planEvents } from "./plan-events";
import { judge } from "./state";
import { icsText, jsonLdText, jsonText, onPage } from "./structured";
import {
  type EventsContext,
  MAX_DAYS_AHEAD,
  quotePrintsDate,
  quotePrintsTime,
  seriesMatches,
  validateEvents,
} from "./validate";

/**
 * Batch 6 events: the series-key fix, structured evidence, the relaxed
 * quote rules, leads, site aliases, de-duplication and the nightly
 * check's walls.
 */

const DPL = "https://www.deschuteslibrary.org/calendar/";
const DPL_EVENT = "https://dpl.libnet.info/event/12345";
const NOW = new Date("2026-11-19T20:00:00Z"); // Thursday

const story = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Family Story Time",
  dates: [{ day: "2026-11-21", start: "13:00", end: "13:40" }],
  venue: { name: "Downtown Bend Library", town: "Bend" },
  what: "Songs, rhymes and a picture book for little ones and their grown-ups.",
  url: DPL,
  evidence: [
    { url: DPL_EVENT, quote: "Saturday, November 21 1:00pm - 1:40pm" },
  ],
  ...over,
});

function ctx(over: Partial<EventsContext> = {}): EventsContext {
  return {
    catalog: {
      link_domains: [
        "deschuteslibrary.org",
        "dpl.libnet.info",
        "highdesertmuseum.org",
        "hdm.mux.earth",
      ],
      lead_domains: ["bendbuzz.com", "bendfamilyloop.com"],
      site_aliases: {
        "dpl.libnet.info": "deschuteslibrary.org",
        "hdm.mux.earth": "highdesertmuseum.org",
      },
      event_series: [
        {
          id: "series-dpl-family-story-time",
          name: "Deschutes Public Library story times",
          town: "Bend",
          what: "",
          months: [],
          url: DPL,
          source: null,
          verified: true,
        },
        {
          id: "series-pavilion-family-skate",
          name: "Family Skate at The Pavilion",
          town: "Bend",
          what: "",
          months: [],
          url: "https://www.bendparksandrec.org/facility/the-pavilion/",
          source: null,
          venues: ["The Pavilion"],
          verified: true,
        },
      ],
    },
    fetchGapMs: 0,
    parks: new Map(),
    now: NOW,
    ...over,
  };
}

const quick = async (e: EventInput, c = ctx()) =>
  (await validateEvents({ events: [e] }, c)).events[0];

describe("the series key never merges venues or programs (writer fix 1)", () => {
  it("gives one series_id at two branches two keys", () => {
    const a = story({ series_id: "series-dpl-family-story-time" });
    const b = story({
      series_id: "series-dpl-family-story-time",
      venue: { name: "Redmond Library", town: "Redmond" },
    });
    expect(seriesKey(a)).not.toBe(seriesKey(b));
  });

  it("gives two programs at one branch two keys", () => {
    const a = story({ series_id: "series-dpl-family-story-time" });
    const b = story({
      series_id: "series-dpl-family-story-time",
      title: "Baby Storytime",
    });
    expect(seriesKey(a)).not.toBe(seriesKey(b));
    expect(seriesKey(story())).not.toBe(
      seriesKey(story({ title: "Baby Storytime" })),
    );
  });

  it("refuses a series_id whose town, venue or program doesn't match", async () => {
    const v = await quick(
      story({
        series_id: "series-dpl-family-story-time",
        venue: { name: "Redmond Library", town: "Redmond" },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.problems).toContain(
      `"Family Story Time" at Redmond Library isn't the catalog series "Deschutes Public Library story times". Leave series_id out.`,
    );
    expect(
      seriesMatches(
        {
          title: "Family Skate",
          venue: { name: "Juniper Pool", town: "Bend" },
        },
        ctx().catalog.event_series[1],
      ),
    ).toBe(false);
    expect(
      seriesMatches(
        { title: "Teen Gaming", venue: { name: "Downtown", town: "Bend" } },
        ctx().catalog.event_series[0],
      ),
    ).toBe(false);
    // "Story" and "time" alone never tie a library program to a series.
    const dpl = await quick(
      story({ series_id: "series-dpl-family-story-time" }),
    );
    expect(dpl.problems.join(" ")).toMatch(/isn't the catalog series/);
    expect(
      seriesMatches(
        {
          title: "Family Skate",
          venue: {
            name: "The Pavilion - Bend Park and Recreation District",
            town: "Bend",
          },
        },
        ctx().catalog.event_series[1],
      ),
    ).toBe(true);
  });
});

describe("quotes and dates", () => {
  it("reads the library's own date line", () => {
    const q = "Saturday, November 21 1:00pm - 1:40pm";
    expect(quotePrintsDate(q, "2026-11-21")).toBe(true);
    expect(quotePrintsTime(q, "13:00", "start")).toBe(true);
    expect(quotePrintsTime(q, "13:40", "end")).toBe(true);
    expect(quotePrintsTime(q, "13:40", "start")).toBe(false);
  });

  it("reads a zero-padded day (lesson 46: the library and Wix print them)", () => {
    expect(quotePrintsDate("Wednesday, December 02 4:00pm", "2026-12-02")).toBe(
      true,
    );
    expect(quotePrintsDate("Dec 06, 2026 at 10am", "2026-12-06")).toBe(true);
    expect(quotePrintsDate("12/02/2026", "2026-12-02")).toBe(true);
    expect(quotePrintsDate("01/09", "2027-01-09")).toBe(true);
    // Never a different day or year.
    expect(quotePrintsDate("December 02", "2026-12-20")).toBe(false);
    expect(quotePrintsDate("December 20", "2026-12-02")).toBe(false);
    expect(quotePrintsDate("Dec 06, 2025", "2026-12-06")).toBe(false);
    expect(quotePrintsDate("12/021", "2026-12-02")).toBe(false);
  });

  it("reads machine dates and times from organizer data", () => {
    expect(quotePrintsDate("2026-11-21T10:30:00-08:00", "2026-11-21")).toBe(
      true,
    );
    expect(quotePrintsDate("DTSTART 20261121T103000", "2026-11-21")).toBe(true);
    expect(quotePrintsDate("2026-11-21", "2026-11-22")).toBe(false);
    expect(quotePrintsTime("2026-11-21T10:30:00-08:00", "10:30")).toBe(true);
    expect(quotePrintsTime("2026-11-21 10:30:00", "10:30")).toBe(true);
    expect(quotePrintsTime("20261121T103000", "10:30")).toBe(true);
    expect(quotePrintsTime("2026-11-21T10:30:00", "10:00")).toBe(false);
  });

  it("takes an 8-character quote that prints a date and a time", async () => {
    const e = story({
      dates: [{ day: "2026-12-06", start: "10:00" }],
      evidence: [{ url: DPL, quote: "Dec 6 10am" }],
    });
    expect((await quick(e)).problems).toEqual([]);
    // On another page it could be any event's: it must name this one.
    const elsewhere = await quick(
      story({
        dates: [{ day: "2026-12-06", start: "10:00" }],
        evidence: [{ url: DPL_EVENT, quote: "Dec 6 10am" }],
      }),
    );
    expect(elsewhere.problems.join(" ")).toMatch(
      /must come from the event's own page/,
    );
    const short = await quick(
      story({
        dates: [{ day: "2026-12-06", start: "10:00" }],
        evidence: [
          { url: DPL, quote: "Dec 6 10am" },
          { url: DPL, quote: "Dec 6 2026" },
        ],
      }),
    );
    expect(short.problems.join(" ")).toMatch(/"Dec 6 2026" is too short/);
  });

  it("lets a series carry up to 30 quotes, a one-off 8", async () => {
    const days = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 10, 21 + i * 2));
      return d.toISOString().slice(0, 10);
    });
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const quote = (day: string) =>
      `${months[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))} · 1:00pm - 1:40pm`;
    const series = story({
      series: true,
      dates: days.map((day) => ({ day, start: "13:00", end: "13:40" })),
      evidence: days.map((day) => ({
        url: `${DPL_EVENT}${day}`,
        quote: quote(day),
      })),
    });
    expect((await quick(series)).problems).toEqual([]);
    const oneOff = story({
      series: false,
      evidence: Array.from({ length: 9 }, () => ({
        url: DPL_EVENT,
        quote: "Saturday, November 21 1:00pm - 1:40pm",
      })),
    });
    expect((await quick(oneOff)).problems.join(" ")).toMatch(
      /A one-off takes at most 8 quotes/,
    );
  });

  it("holds the horizon at 60 days", async () => {
    expect(MAX_DAYS_AHEAD).toBe(60);
    const v = await quick(
      story({
        dates: [{ day: "2027-01-20", start: "13:00", end: "13:40" }],
        evidence: [
          { url: DPL_EVENT, quote: "Wednesday, January 20 1:00pm - 1:40pm" },
        ],
      }),
    );
    expect(v.problems.join(" ")).toMatch(/more than 60 days out/);
  });
});

describe("leads, aliases and names", () => {
  it("counts the library's calendar host as the library", async () => {
    const e = story({ url: DPL });
    expect((await quick(e)).problems).toEqual([]);
    const noAlias = ctx();
    noAlias.catalog.site_aliases = {};
    expect((await quick(e, noAlias)).problems.join(" ")).toMatch(
      /must come from the same site/,
    );
  });

  it("refuses a competitor as a link or evidence but takes it as a lead", async () => {
    const bad = await quick(
      story({
        evidence: [
          { url: DPL_EVENT, quote: "Saturday, November 21 1:00pm - 1:40pm" },
          {
            url: "https://bendbuzz.com/events/x",
            quote: "Story time Saturday",
          },
        ],
      }),
    );
    expect(bad.problems.join(" ")).toMatch(/bendbuzz\.com is a lead only/);
    const lead = await quick(
      story({ discovery_url: "https://bendbuzz.com/events" }),
    );
    expect(lead.problems).toEqual([]);
    expect(lead.event).not.toHaveProperty("discovery_url");
  });

  it("never names another newsletter", async () => {
    const v = await quick(
      story({
        what: "Songs and a picture book, as featured in The Bend Buzz this week.",
      }),
    );
    expect(v.problems.join(" ")).toMatch(/never name another newsletter/);
  });
});

describe("structured evidence", () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"HDM"},
    {"@type":"Event","name":"Otter Encounter","startDate":"2026-11-28T11:00:00-08:00",
     "location":{"@type":"Place","name":"High Desert Museum","address":{"streetAddress":"59800 S Hwy 97","addressLocality":"Bend"}},
     "offers":{"@type":"Offer","price":"5"},"description":"<p>Meet the <b>otters</b>.</p>"}]}
    </script></head><body><div id="app"></div></body></html>`;

  it("reads JSON-LD Events, one line each", () => {
    const t = jsonLdText(html);
    expect(t).toContain("Otter Encounter | 2026-11-28T11:00:00-08:00");
    expect(t).toContain("High Desert Museum | 59800 S Hwy 97 | Bend");
    expect(t).toContain("Meet the otters.");
    expect(t).not.toContain("HDM");
    expect(jsonLdText("<script type='application/ld+json'>{bad</script>")).toBe(
      "",
    );
  });

  it("reads a CMS JSON endpoint and an .ics feed", () => {
    const j = jsonText(
      JSON.stringify({
        data: [
          { title: "Raptor Talk", start: "2026-12-05 10:30:00", room: "Hall" },
        ],
      }),
    );
    expect(j).toContain("Raptor Talk | 2026-12-05 10:30:00 | Hall");
    const ics = icsText(
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Lego Club\\, ages 6+\r\nDTSTART;TZID=America/Los_Angeles:20261203T153000\r\nLOCATION:East Bend \r\n Library\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
    );
    expect(ics).toBe(
      "Lego Club, ages 6+ | 20261203T153000 | East Bend Library",
    );
  });

  it("checks a quote against a page's data when its text is empty", async () => {
    const URL_ = "https://hdm.mux.earth/api/events/otter";
    const data = jsonLdText(html);
    const e: EventInput = {
      title: "Otter Encounter",
      dates: [{ day: "2026-11-28", start: "11:00" }],
      venue: { name: "High Desert Museum", town: "Bend" },
      what: "Kids watch the river otters play and learn what they eat.",
      url: "https://www.highdesertmuseum.org/otters",
      evidence: [
        { url: URL_, quote: "Otter Encounter | 2026-11-28T11:00:00-08:00" },
      ],
    };
    const fetcher = async (u: string): Promise<FetchResult> => ({
      status: 200,
      finalUrl: u,
      text: "",
      data,
    });
    const v = (await validateEvents({ events: [e] }, ctx({ fetcher })))
      .events[0];
    expect(v.problems).toEqual([]);
    expect(onPage({ text: "", data }, "Otter Encounter | 2026-11-29")).toBe(
      false,
    );
  });
});

describe("the nightly check and walls", () => {
  const Q = "Saturday, November 21 1:00pm - 1:40pm";
  it("never counts a wall as a miss", () => {
    expect(
      judge({ status: 200, text: "Just a moment...", blocked: "x" }, Q),
    ).toBe("unknown");
    expect(judge({ status: 403, text: "" }, Q)).toBe("unknown");
    expect(
      judge({ status: 200, text: "Attention Required! | Cloudflare" }, Q),
    ).toBe("unknown");
    expect(judge({ status: 200, text: "Welcome" }, Q, { walled: true })).toBe(
      "unknown",
    );
    expect(judge({ status: 200, text: "Welcome" }, Q)).toBe("miss");
    expect(judge({ status: 404, text: "" }, Q)).toBe("miss");
  });

  it("sees a quote in structured data", () => {
    expect(judge({ status: 200, text: "", data: `x | ${Q} | y` }, Q)).toBe(
      "seen",
    );
  });
});

describe("de-duplication", () => {
  const known: KnownEvent = {
    slug: "family-story-time-downtown-bend-library",
    key: seriesKey(story()),
    title: "Family Story Time",
    url: DPL_EVENT,
    venue: { name: "Downtown Bend Library", town: "Bend" },
    point: { lat: 44.058, lng: -121.313 },
    dates: [{ day: "2026-11-21", start: "13:00" }],
    targetUrls: [DPL_EVENT],
  };

  it("cuts the same venue, day and start under another title", async () => {
    const r = await validateEvents(
      { events: [story({ title: "Saturday Stories" })] },
      ctx(),
    );
    dedupe(r.events, [known]);
    expect(r.events[0].ok).toBe(false);
    expect(r.events[0].problems[0]).toMatch(
      /Already on \/events as family-story-time-downtown-bend-library/,
    );
  });

  it("joins its own page quietly, and warns on a shared page or a near-duplicate", async () => {
    const same = await validateEvents({ events: [story()] }, ctx());
    dedupe(same.events, [known]);
    expect(same.events[0].ok).toBe(true);
    expect(same.events[0].warnings).not.toContainEqual(
      expect.stringMatching(/Looks like/),
    );

    const near = await validateEvents(
      {
        events: [
          story({
            title: "Family Story Time Special",
            dates: [{ day: "2026-11-21", start: "13:15" }],
            evidence: [
              {
                url: DPL,
                quote: "Saturday, November 21 1:15pm",
              },
            ],
            url: DPL,
            venue: {
              name: "Downtown Library",
              town: "Bend",
              lat: 44.0585,
              lng: -121.3135,
            },
          }),
        ],
      },
      ctx(),
    );
    dedupe(near.events, [known]);
    expect(near.events[0].ok).toBe(true);
    expect(near.events[0].warnings.join(" ")).toMatch(
      /Looks like family-story-time-downtown-bend-library/,
    );

    const shared = await validateEvents(
      {
        events: [
          story({
            title: "Lego Club",
            venue: { name: "East Bend Library", town: "Bend" },
          }),
        ],
      },
      ctx(),
    );
    dedupe(shared.events, [known]);
    expect(shared.events[0].warnings.join(" ")).toMatch(
      /Its official page is also the page of/,
    );
  });

  it("catches duplicates within one hand-in", async () => {
    const r = await validateEvents(
      { events: [story(), story({ title: "Saturday Stories" })] },
      ctx(),
    );
    dedupe(r.events, []);
    expect(r.events[0].ok).toBe(true);
    expect(r.events[1].ok).toBe(false);
    expect(r.events[1].problems[0]).toMatch(/as #0 in this hand-in/);
  });

  it("measures title overlap on words", () => {
    expect(titleOverlap("Family Story Time", "Story Time for Families")).toBe(
      1,
    );
    expect(titleOverlap("Lego Club", "Family Story Time")).toBe(0);
  });
});

describe("plan.events: the next 14 days", () => {
  const row = (
    slug: string,
    days: string[],
    over: Partial<EventRow> = {},
  ): EventRow => {
    const e = story({ dates: days.map((day) => ({ day, start: "10:30" })) });
    return {
      id: 1,
      slug,
      kind: "series",
      data: {
        ...storedFrom(e, null, e.evidence[0].quote),
        setting: "indoor",
        ages_text: "Ages 0-5",
        ages: ageTags("Ages 0-5"),
        cost: { text: "Free", prices: [], free: true },
        targets: Object.fromEntries(
          days.map((d) => [d, { url: `${DPL_EVENT}/${d}`, quote: `q ${d}` }]),
        ),
      },
      status: "scheduled",
      confirm: "ok",
      lastSeenAt: null,
      factsChangedAt: NOW,
      stateChangedAt: null,
      ...over,
    };
  };

  it("lists listed events dated from the issue through 14 days, with what the writer needs", () => {
    const out = planEvents(
      [
        row("later", ["2026-12-01"]),
        row("soon", ["2026-11-14", "2026-11-21", "2026-11-28"]),
        row("too-far", ["2026-12-20"]),
        row("unconfirmed", ["2026-11-21"], { confirm: "unconfirmed" }),
      ],
      "2026-11-19",
      { from: "2026-11-20", to: "2026-11-22" },
      NOW,
    );
    expect(out.map((e) => e.slug)).toEqual(["soon", "later"]);
    expect(out[0]).toMatchObject({
      days: ["2026-11-21", "2026-11-28"],
      weekend: true,
      setting: "indoor",
      cost: "Free",
      free: true,
      town: "Bend",
      evidence: { url: `${DPL_EVENT}/2026-11-21`, quote: "q 2026-11-21" },
    });
    expect(out[0].ages.length).toBeGreaterThan(0);
    expect(out[1].weekend).toBe(false);
  });
});

describe("the issue checker reads structured evidence too", () => {
  it("finds a day and a time in organizer data", () => {
    expect(quoteHasDay("Crafternoon | 2026-11-21T13:00", "2026-11-21")).toBe(
      true,
    );
    expect(quoteHasDay("Crafternoon | 2026-11-22T13:00", "2026-11-21")).toBe(
      false,
    );
    expect(quoteHasTime("Crafternoon | 2026-11-21T13:00", "1 pm")).toBe(true);
    expect(quoteHasTime("Crafternoon | 2026-11-21T13:00", "1 am")).toBe(false);
    expect(quoteHasTime("20261121T093000", "9:30 am")).toBe(true);
  });
});
