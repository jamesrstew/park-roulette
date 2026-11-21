import { describe, expect, it } from "vitest";
import { isLocalDb, testDbOn } from "@/lib/local-db";
import {
  type FetchResult,
  quoteHasDay,
  quoteHasTime,
} from "@/lib/news/validate";
import { lineNamesEvent } from "./binding";
import { dedupe, type KnownEvent, screenEdits, titleJaccard } from "./dedupe";
import { planLegacySplit, resolveFromJsonLd } from "./legacy-split";
import { machineMoments } from "./machine-time";
import {
  type EventInput,
  keyStem,
  seriesKey,
  storedFrom,
  venueKey,
} from "./model";
import { afterCheck, cancellationOf, judge } from "./state";
import { jsonText, onPage } from "./structured";
import {
  type EventsContext,
  pagePool,
  quotePrintsDate,
  quotePrintsTime,
  seriesMatches,
  validateEvents,
} from "./validate";

/** The fixes from the feat/b6-events review (scrutiny-events.md). */

const CAL = "https://www.deschuteslibrary.org/calendar/";
const EV = "https://dpl.libnet.info/event/1";
const NOW = new Date("2026-11-19T20:00:00Z");

const story = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Family Story Time",
  dates: [{ day: "2026-11-21", start: "10:30" }],
  venue: { name: "Downtown Bend Library", town: "Bend" },
  what: "Songs, rhymes and a picture book for little ones and their grown-ups.",
  url: CAL,
  evidence: [{ url: EV, quote: "Saturday, November 21 10:30am - 11:00am" }],
  ...over,
});

const ctx = (over: Partial<EventsContext> = {}): EventsContext => ({
  catalog: {
    link_domains: [
      "deschuteslibrary.org",
      "dpl.libnet.info",
      "highdesertmuseum.org",
      "hdm.mux.earth",
    ],
    site_aliases: {
      "dpl.libnet.info": "deschuteslibrary.org",
      "hdm.mux.earth": "highdesertmuseum.org",
    },
    alias_pins: { "hdm.mux.earth": { site: "www.highdesertmuseum.org" } },
    lead_domains: ["bendbuzz.com"],
    event_series: [],
  },
  parks: new Map(),
  now: NOW,
  fetchGapMs: 0,
  ...over,
});

const one = async (e: EventInput, c = ctx()) =>
  (await validateEvents({ events: [e] }, c)).events[0];

describe("blocker 1: time zones in structured evidence", () => {
  it("reads Z and offsets in Pacific time, and zoneless values as local", () => {
    expect(machineMoments("2026-11-22T01:00:00Z")).toEqual([
      { day: "2026-11-21", time: "17:00" },
    ]);
    expect(machineMoments("2026-11-21T10:00:00-08:00")).toEqual([
      { day: "2026-11-21", time: "10:00" },
    ]);
    expect(machineMoments("2026-11-21T13:00:00+00:00")).toEqual([
      { day: "2026-11-21", time: "05:00" },
    ]);
    expect(machineMoments("20261122T010000Z")).toEqual([
      { day: "2026-11-21", time: "17:00" },
    ]);
    expect(machineMoments("2026-11-21 10:30:00 | 20261121T103000")).toEqual([
      { day: "2026-11-21", time: "10:30" },
      { day: "2026-11-21", time: "10:30" },
    ]);
  });

  it("2026-11-22T01:00:00Z proves Nov 21 at 5 pm, not Nov 22 at 1 am (events)", () => {
    const q = "Lantern Walk | 2026-11-22T01:00:00Z";
    expect(quotePrintsDate(q, "2026-11-21")).toBe(true);
    expect(quotePrintsDate(q, "2026-11-22")).toBe(false);
    expect(quotePrintsTime(q, "17:00")).toBe(true);
    expect(quotePrintsTime(q, "01:00")).toBe(false);
  });

  it("2026-11-22T01:00:00Z proves Nov 21 at 5 pm (the issue checker)", () => {
    const q = "Lantern Walk | 2026-11-22T01:00:00Z";
    expect(quoteHasDay(q, "2026-11-21")).toBe(true);
    expect(quoteHasDay(q, "2026-11-22")).toBe(false);
    expect(quoteHasTime(q, "5 pm")).toBe(true);
    expect(quoteHasTime(q, "1 am")).toBe(false);
  });
});

describe("blocker 2: JSON evidence is tied to its record", () => {
  const body = JSON.stringify({
    items: [
      {
        title: "Lego Club",
        updated_at: "2026-11-21T10:00:00",
        dates: [{ start: "2026-11-28T15:30:00" }],
      },
      { title: "Chess Club", start: "2026-11-21T10:00:00" },
    ],
  });

  it("drops bookkeeping times and gives nested dates their parent's title", () => {
    const t = jsonText(body);
    expect(t).not.toContain("2026-11-21T10:00:00 | Lego");
    expect(t.split("\n")).toContain("Lego Club | 2026-11-28T15:30:00");
    expect(t.split("\n")).toContain("Chess Club | 2026-11-21T10:00:00");
    expect(t).not.toMatch(/Lego Club[^\n]*2026-11-21/);
  });

  it("prefers known start and end keys over other dates in a record", () => {
    const t = jsonText(
      JSON.stringify({
        name: "Otters",
        startDate: "2026-12-05T11:00:00-08:00",
        last_seen: "2026-12-01T09:00:00",
      }),
    );
    expect(t).toBe("Otters | 2026-12-05T11:00:00-08:00");
  });

  it("an updated_at never proves a date (probe)", async () => {
    const data = jsonText(body);
    const fetcher = async (u: string): Promise<FetchResult> => ({
      status: 200,
      finalUrl: u,
      text: u === CAL ? "Library calendar" : "",
      data: u === CAL ? undefined : data,
    });
    const mk = (day: string, start: string, quote: string) =>
      story({
        title: "Lego Club",
        dates: [{ day, start }],
        evidence: [{ url: EV, quote }],
      });
    // The update time isn't in the data at all.
    const bad = await one(
      mk("2026-11-21", "10:00", "Lego Club | 2026-11-21T10:00:00"),
      ctx({ fetcher }),
    );
    expect(bad.problems.join(" ")).toMatch(/isn't on/);
    // Chess Club's date, quoted for Lego Club: on the page, but not on a
    // line that names Lego Club.
    const other = await one(
      mk("2026-11-21", "10:00", "2026-11-21T10:00:00"),
      ctx({ fetcher }),
    );
    expect(other.problems.join(" ")).toMatch(/isn't on/);
    const good = await one(
      mk("2026-11-28", "15:30", "Lego Club | 2026-11-28T15:30:00"),
      ctx({ fetcher }),
    );
    expect(good.problems).toEqual([]);
  });

  it("binds the nightly check the same way", () => {
    const data = "Chess Club | 2026-11-21T10:00:00";
    expect(
      judge({ status: 200, text: "", data }, "2026-11-21T10:00:00", {
        title: "Lego Club",
      }),
    ).toBe("miss");
    expect(
      judge({ status: 200, text: "", data }, "2026-11-21T10:00:00", {
        title: "Chess Club",
      }),
    ).toBe("seen");
    expect(
      lineNamesEvent(
        "Exhibition Opening: Dime Store Stories | x",
        "Dime Store Stories Opening",
      ),
    ).toBe(true);
    expect(onPage({ text: "", data }, "2026-11-21T10:00:00", "Lego Club")).toBe(
      false,
    );
  });
});

describe("high 3: the series key", () => {
  it("keeps audience qualifiers and normalizes spelling", () => {
    expect(keyStem("Story Time: Babies")).toBe(keyStem("Baby Storytime"));
    expect(keyStem("Storytime")).toBe(keyStem("Story Time"));
    expect(keyStem("Story Times")).toBe(keyStem("Story Time"));
    expect(keyStem("Story Time: Toddlers")).not.toBe(keyStem("Story Time"));
    expect(keyStem("Story Time (Ages 3-5)")).not.toBe(
      keyStem("Story Time (Ages 0-2)"),
    );
    expect(keyStem("Spanish Story Time")).not.toBe(keyStem("Story Time"));
    expect(keyStem("Sensory Story Time")).not.toBe(keyStem("Story Time"));
    expect(keyStem("Teen Gaming")).not.toBe(keyStem("Tween Gaming"));
    // A themed title still joins its program.
    expect(keyStem("Story Time: Dinosaurs")).toBe(keyStem("Story Time"));
  });

  it("canonicalizes the venue: catalog id, branch aliases, word order", () => {
    expect(venueKey({ name: "Downtown Bend Library", town: "Bend" })).toBe(
      venueKey({ name: "Bend Downtown Library", town: "Bend" }),
    );
    expect(venueKey({ name: "Downtown Library", town: "Bend" })).toBe(
      "dpl-downtown-bend",
    );
    expect(
      venueKey({
        name: "The Pavilion - Bend Park and Recreation District",
        town: "Bend",
      }),
    ).toBe("venue-the-pavilion");
    expect(
      venueKey({
        name: "Redmond Library (Deschutes Public Library)",
        town: "Redmond",
      }),
    ).toBe("venue-redmond-library");
    expect(venueKey({ name: "Downtown Bend Library", town: "Bend" })).not.toBe(
      venueKey({ name: "East Bend Library", town: "Bend" }),
    );
    expect(
      seriesKey(
        story({ venue: { name: "Bend Downtown Library", town: "Bend" } }),
      ),
    ).toBe(seriesKey(story({ title: "Family Storytime" })));
  });
});

describe("high 5: de-duplication", () => {
  const known = (over: Partial<KnownEvent> = {}): KnownEvent => ({
    slug: "lego-club-downtown",
    key: "venue:dpl-downtown-bend:lego-club",
    title: "Lego Club",
    url: "https://www.deschuteslibrary.org/other/",
    venue: { name: "Downtown Bend Library", town: "Bend" },
    point: null,
    dates: [{ day: "2026-11-21", start: "10:30" }],
    targetUrls: ["https://dpl.libnet.info/event/2"],
    ...over,
  });

  it("refuses the same venue, day and start only for similar titles or the same page", async () => {
    const r = await validateEvents({ events: [story()] }, ctx());
    dedupe(r.events, [known()]);
    expect(r.events[0].ok).toBe(true);
    expect(r.events[0].warnings.join(" ")).toMatch(
      /lego-club-downtown is at the same venue, day and start/,
    );

    const similar = await validateEvents({ events: [story()] }, ctx());
    dedupe(similar.events, [known({ title: "Family Story Time!" })]);
    expect(similar.events[0].ok).toBe(false);

    const samePage = await validateEvents({ events: [story()] }, ctx());
    dedupe(samePage.events, [known({ targetUrls: [EV] })]);
    expect(samePage.events[0].ok).toBe(false);
    expect(titleJaccard("Family Story Time", "Lego Club")).toBe(0);
  });

  it("never lets a legacy row's (other venues') dates block", async () => {
    const r = await validateEvents({ events: [story()] }, ctx());
    dedupe(r.events, [
      known({ title: "Family Story Time", targetUrls: [EV], legacy: true }),
    ]);
    expect(r.events[0].ok).toBe(true);
  });
});

describe("high 4: admin repairs stick", () => {
  it("leaves out trimmed dates, and cuts a page removed in the last 60 days", async () => {
    const e = story({
      series: true,
      dates: [
        { day: "2026-11-21", start: "10:30" },
        { day: "2026-11-28", start: "10:30" },
      ],
      evidence: [
        { url: EV, quote: "Saturday, November 21 10:30am - 11:00am" },
        { url: EV, quote: "Saturday, November 28 10:30am - 11:00am" },
      ],
    });
    const r = await validateEvents({ events: [e] }, ctx());
    const key = r.events[0].key!;
    const blocks = {
      trimmed: new Map([[key, new Set(["2026-11-28-1030"])]]),
      removed: [],
    };
    screenEdits(r.events, blocks);
    screenEdits(r.events, blocks); // twice changes nothing more
    expect(r.events[0].event!.dates.map((d) => d.day)).toEqual(["2026-11-21"]);
    expect(r.events[0].warnings.filter((w) => /admin/.test(w))).toHaveLength(1);

    const all = await validateEvents({ events: [e] }, ctx());
    screenEdits(all.events, {
      trimmed: new Map([
        [key, new Set(["2026-11-21-1030", "2026-11-28-1030"])],
      ]),
      removed: [],
    });
    expect(all.events[0].ok).toBe(false);

    const gone = await validateEvents({ events: [e] }, ctx());
    screenEdits(gone.events, {
      trimmed: new Map(),
      removed: [{ slug: "x", key, at: "2026-11-18" }],
    });
    expect(gone.events[0].problems[0]).toMatch(/An admin removed x/);
  });
});

describe("medium 6: unknown ages out; cancellations count", () => {
  it("unconfirms after more than 7 days unseen", () => {
    const p = { confirm: "ok" as const, misses: 0, seenStreak: 3 };
    expect(afterCheck(p, "unknown", 7).confirm).toBe("ok");
    expect(afterCheck(p, "unknown", 7.5).confirm).toBe("unconfirmed");
  });

  it("reads a cancellation page as a status change", () => {
    const page = {
      status: 200,
      text: "Events. Lego Club is cancelled this week due to the holiday. See you soon.",
    };
    expect(judge(page, "Saturday, November 21", { title: "Lego Club" })).toBe(
      "canceled",
    );
    expect(cancellationOf(page, "Lego Club")).toBe(
      "Lego Club is cancelled this week due to the holiday.",
    );
    expect(
      judge(
        { status: 200, text: "Lego Club has not been canceled. Come on by!" },
        "Saturday, November 21",
        { title: "Lego Club" },
      ),
    ).toBe("miss");
    expect(
      judge(
        { status: 200, text: "Chess Club is canceled." },
        "Saturday, November 21",
        { title: "Lego Club" },
      ),
    ).toBe("miss");
    expect(afterCheck({ confirm: "ok", misses: 1 }, "canceled")).toMatchObject({
      confirm: "ok",
      misses: 0,
      seen: true,
    });
  });
});

describe("medium 7: per-host pacing", () => {
  it("starts fetches on one host at least the gap apart", async () => {
    const starts: number[] = [];
    const get = pagePool(
      async (u) => {
        starts.push(Date.now());
        return { status: 200, finalUrl: u, text: "" };
      },
      2,
      120,
    );
    await Promise.all(
      ["a", "b", "c"].map((p) => get(`https://x.org/${p}`, ["x.org"])),
    );
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(110);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(110);
  });
});

describe("medium 8, medium 9, low 10, low 11: the validator", () => {
  it("keeps alias hosts to evidence, and pins hdm.mux.earth's site", async () => {
    const v = await one(story({ url: EV }));
    expect(v.problems.join(" ")).toMatch(
      /dpl.libnet.info is deschuteslibrary.org's data host/,
    );
    const hdm = (site: string) =>
      story({
        title: "Otters",
        venue: { name: "High Desert Museum", town: "Bend" },
        url: "https://www.highdesertmuseum.org/otters/",
        evidence: [
          {
            url: `https://hdm.mux.earth/public/v2/find-path/?html_path=/x/&site=${site}`,
            quote: "Otters | 2026-11-21T10:30:00-08:00",
          },
        ],
      });
    expect((await one(hdm("www.highdesertmuseum.org"))).problems).toEqual([]);
    expect((await one(hdm("evil.example"))).problems.join(" ")).toMatch(
      /needs site=www.highdesertmuseum.org/,
    );
  });

  it("needs the whole stem or a distinctive word for a catalog series", () => {
    const s = { name: "Family Skate at The Pavilion", town: "Bend" };
    const at = { name: "The Pavilion", town: "Bend" };
    expect(seriesMatches({ title: "Family Skate", venue: at }, s)).toBe(true);
    expect(seriesMatches({ title: "Family Fun Night", venue: at }, s)).toBe(
      false,
    );
    expect(
      seriesMatches(
        { title: "Family Story Time", venue: at },
        { name: "Library story times", town: "Bend" },
      ),
    ).toBe(false);
  });

  it("catches competitor names in any spelling, in every text field", async () => {
    for (const over of [
      { what: "Songs and a picture book, as seen in BendBuzz this week." },
      { ages_text: "Ages 0-5 (Bend-Buzz pick)" },
      { venue: { name: "BendFamilyLoop Hall", town: "Bend" } },
      { organizer: { name: "bend family loop", url: CAL } },
    ] as Partial<EventInput>[])
      expect((await one(story(over))).problems.join(" ")).toMatch(
        /never name another newsletter/,
      );
  });

  it("ties a short date-and-time quote to the event's page or name", async () => {
    const own = await one(
      story({
        dates: [{ day: "2026-11-21", start: "10:00" }],
        evidence: [{ url: CAL, quote: "Nov 21 10am" }],
      }),
    );
    expect(own.problems.join(" ")).not.toMatch(/short quote/);
    const named = await one(
      story({
        title: "Lego",
        evidence: [{ url: EV, quote: "Lego Nov 21 10am" }],
      }),
    );
    expect(named.problems.join(" ")).not.toMatch(/short quote/);
    const loose = await one(
      story({
        dates: [{ day: "2026-11-21", start: "10:00" }],
        evidence: [{ url: EV, quote: "Nov 21 10am" }],
      }),
    );
    expect(loose.problems.join(" ")).toMatch(
      /must come from the event's own page/,
    );
  });
});

describe("the legacy split and the DB switch", () => {
  it("plans moves from each date's own page", () => {
    const e = storedFrom(
      story({
        series: true,
        dates: [
          { day: "2026-11-21", start: "10:30" },
          { day: "2026-11-30", start: "10:30" },
          { day: "2026-12-03", start: "10:30" },
        ],
      }),
      null,
      "",
    );
    const plan = planLegacySplit(e, {
      "2026-11-21": {
        title: "Family Storytime",
        venue: "Bend Downtown Library",
        town: "Bend",
      },
      "2026-11-30": {
        title: "Baby Story Time",
        venue: "Redmond Library",
        town: "Redmond",
      },
      "2026-12-03": null,
    });
    expect(plan.groups).toEqual([
      {
        title: "Baby Story Time",
        venue: "Redmond Library",
        town: "Redmond",
        occurrences: ["2026-11-30-1030"],
      },
    ]);
    expect(plan.unknown).toEqual(["2026-12-03-1030"]);
    expect(
      resolveFromJsonLd(
        `<script type="application/ld+json">{"@type":"Event","name":"Crafternoon","location":{"name":"Central Library","address":{"addressLocality":"Bend"}}}</script>`,
      ),
    ).toEqual({ title: "Crafternoon", venue: "Central Library", town: "Bend" });
  });

  it("runs the DB suites for every local URL spelling, and refuses a remote one", () => {
    expect(isLocalDb("postgres://localhost:5544/db")).toBe(true);
    expect(isLocalDb("postgresql://postgres@127.0.0.1:5544/db")).toBe(true);
    expect(isLocalDb("postgres://[::1]:5432/db")).toBe(true);
    expect(isLocalDb("postgres://u:p@db.railway.app:5432/db")).toBe(false);
    expect(testDbOn("")).toBe(false);
    expect(() => testDbOn("postgres://u@db.railway.app/x")).toThrow(/local/);
  });
});

describe("page addresses stay readable", () => {
  it("uses the title as written, plus a qualifier it doesn't say", async () => {
    const { slugStem } = await import("./model");
    expect(slugStem("Pop-Up Exhibits")).toBe("pop-up-exhibits");
    expect(slugStem("Story Time: Babies")).toBe("story-time-baby");
    expect(slugStem("Baby Storytime")).toBe("baby-storytime");
  });
});
