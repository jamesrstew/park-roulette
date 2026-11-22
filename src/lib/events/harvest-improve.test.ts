import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type FetchResult, pageText } from "@/lib/news/validate";
import { RetroSchema } from "@/lib/news/lessons";
import { dedupe, type KnownEvent, samePage, titlesDiffer } from "./dedupe";
import { type EventInput } from "./model";
import { judge, judgeListing } from "./state";
import { onPage } from "./structured";
import {
  type EventsContext,
  organizerVerdict,
  pageChunks,
  printedRuns,
  quotePrintsDate,
  quotePrintsTime,
  runCoversDate,
  validateEvents,
} from "./validate";

/**
 * The November 22 harvest run: date runs on an organizer's page (lessons
 * 56, 64), two programs at one venue and start (2, 26, 57), text run
 * together by inline tags (5), and the retro the routine sent (a
 * rule_changes target the schema refused).
 */

const NOW = new Date("2026-11-22T15:00:00Z");
const page = (url: string, over: Partial<FetchResult> = {}): FetchResult => ({
  status: 200,
  finalUrl: url,
  text: "",
  ...over,
});

// --- 1. Date runs -------------------------------------------------------

const SCROOGE = "Ebenezer Scrooge's Big Bend Christmas Show";
const CTC =
  "https://cascadestheatrical.org/production/ebenezer-scrooges-big-bend-christmas-show/";
const BUZZ = "https://bendbuzz.com/events/ebenezer-scrooges-big-bend-christmas";
/** The organizer's page as the checker read it (fetched 2026-11-22). */
const CTC_TEXT =
  "Ebenezer Scrooge's Big Bend Christmas Show! - Cascades Theatrical Company Skip to content Home TicketsExpand Buy Tickets Season Flex Pass. December 3-20, 2026 By Gordon Greenberg & Steve Rosen Ebenezer Scrooge's Big Bend Christmas Show! Running time Approximately 1.5 hours. Age guidance Appropriate for all ages.";
const LISTED = (day: string, when: string) =>
  `${SCROOGE} | ${day}T${when}:00-08:00 | Cascades Theatrical Company`;

describe("a date inside the organizer's printed run (lessons 56 and 64)", () => {
  it("reads 'Month D–D, YYYY' and 'Month D – Month D, YYYY' as runs", () => {
    expect(printedRuns("December 3–20, 2026", 2026)).toEqual([
      { from: "2026-12-03", to: "2026-12-20" },
    ]);
    expect(printedRuns("Nov 27 – Dec 6, 2026", 2026)).toEqual([
      { from: "2026-11-27", to: "2026-12-06" },
    ]);
    expect(printedRuns("December 28 – January 3, 2027", 2026)).toEqual([
      { from: "2026-12-28", to: "2027-01-03" },
    ]);
    // A date and a time range is not a run.
    expect(printedRuns("Dec 6 - 10:30am", 2026)).toEqual([]);
    expect(printedRuns("Dec 6 10-11 am", 2026)).toEqual([]);
  });

  it("passes a listing date inside the run when the run names the event (the real page)", () => {
    const r = page(CTC, { text: CTC_TEXT });
    expect(
      organizerVerdict(r, {
        title: SCROOGE,
        dates: [{ day: "2026-12-03" }, { day: "2026-12-12" }],
      }),
    ).toEqual({});
    // Outside the run: cut, as before.
    expect(
      organizerVerdict(r, { title: SCROOGE, dates: [{ day: "2026-12-21" }] })
        .cut,
    ).toMatch(/doesn't print 2026-12-21/);
  });

  it("passes it next to the event's name when the listing prints that exact date", () => {
    const text = `Now playing: ${SCROOGE}. December 3–20, 2026. Directed by Marilyn Magness.`;
    const chunks = pageChunks({ text });
    const listing = [LISTED("2026-12-12", "14:00")];
    expect(runCoversDate(chunks, "2026-12-12", SCROOGE, listing)).toBe(true);
    // Without the listing's exact date, a run in another sentence proves nothing.
    expect(runCoversDate(chunks, "2026-12-12", SCROOGE)).toBe(false);
    expect(
      runCoversDate(chunks, "2026-12-12", SCROOGE, [
        "Holiday shows | 2026-12-12T14:00:00-08:00",
      ]),
    ).toBe(false);
  });

  it("never lets another show's run prove the date", () => {
    const listing = [LISTED("2026-12-12", "14:00")];
    // The event's own run leaves the date out.
    const own = pageChunks({
      text: `${SCROOGE} runs December 3–6, 2026. Then The Nutcracker runs December 10–20, 2026.`,
    });
    expect(runCoversDate(own, "2026-12-12", SCROOGE, listing)).toBe(false);
    // A run far from the event's name.
    const far = pageChunks({
      text: `${SCROOGE}. Our cast. Our crew. Season tickets. Coming up: The Nutcracker, December 10–20, 2026.`,
    });
    expect(runCoversDate(far, "2026-12-12", SCROOGE, listing)).toBe(false);
  });

  it("stores every listing date in the run end to end (before: all but opening night cut)", async () => {
    const days = [
      "2026-12-03",
      "2026-12-04",
      "2026-12-05",
      "2026-12-06",
      "2026-12-10",
      "2026-12-11",
      "2026-12-12",
      "2026-12-13",
    ];
    const e: EventInput = {
      title: SCROOGE,
      dates: days.map((day) => ({ day, start: "19:00" })),
      venue: { name: "Cascades Theatrical Company", town: "Bend" },
      setting: "indoor",
      series: true,
      what: "A silly, song-filled spin on the Christmas Carol story, made for the whole family.",
      url: CTC,
      verified_via: "listing",
      evidence: days.map((day) => ({ url: BUZZ, quote: LISTED(day, "19:00") })),
    };
    const c: EventsContext = {
      catalog: {
        link_domains: ["cascadestheatrical.org"],
        lead_domains: ["bendbuzz.com"],
        listing_domains: ["bendbuzz.com"],
        event_series: [],
      },
      parks: new Map(),
      now: NOW,
      fetchGapMs: 0,
      fetcher: async (u) =>
        u === CTC
          ? page(CTC, { text: CTC_TEXT })
          : u === BUZZ
            ? page(BUZZ, {
                text: "Holiday shows in Bend.",
                data: days.map((d) => LISTED(d, "19:00")).join("\n"),
              })
            : page(u, { status: 404 }),
    };
    const v = (await validateEvents({ events: [e] }, c)).events[0];
    expect(v.problems).toEqual([]);
    expect(v.event?.dates).toHaveLength(days.length);
  });

  it("the nightly check sees a listing date inside the run", () => {
    expect(
      judgeListing(
        page(CTC, { text: CTC_TEXT }),
        page(BUZZ, { data: LISTED("2026-12-12", "19:00") }),
        LISTED("2026-12-12", "19:00"),
        SCROOGE,
        "2026-12-12",
      ),
    ).toBe("seen");
  });
});

// --- 2. Two programs at one venue and start -----------------------------

const CAL = "https://www.deschuteslibrary.org/calendar/";
const KIDS = "https://www.deschuteslibrary.org/kids/programs";
const CENTRAL = {
  name: "Central Library",
  town: "Bend",
  street: "61956 SE Santorini St",
};

const libCtx = (): EventsContext => ({
  catalog: {
    link_domains: ["deschuteslibrary.org", "dpl.libnet.info"],
    site_aliases: { "dpl.libnet.info": "deschuteslibrary.org" },
    lead_domains: [],
    event_series: [],
  },
  parks: new Map(),
  now: NOW,
  fetchGapMs: 0,
});

const known = (over: Partial<KnownEvent> = {}): KnownEvent => ({
  slug: "family-story-time-central-library",
  key: "venue:venue-central-library:family-story-time",
  title: "Family Story Time",
  url: CAL,
  venue: CENTRAL,
  point: null,
  dates: [{ day: "2026-11-30", start: "10:30", end: "11:00" }],
  targetUrls: [KIDS, "https://dpl.libnet.info/event/16862852"],
  ...over,
});

const preschool = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Preschool Story Time",
  dates: [{ day: "2026-11-30", start: "10:30", end: "11:00" }],
  venue: CENTRAL,
  what: "Stories, songs and rhymes that build early reading skills for kids about 3 to 5.",
  url: CAL,
  ages_text: "3-5 yrs",
  evidence: [
    {
      url: KIDS,
      quote:
        "Nov 30 Story Time Preschool Story Time 10:30 AM - 11:00 AM ● Central Library - Youth Programing (2nd Floor) Stories, songs and rhymes to develop early literacy skills. 3-5 yrs",
    },
  ],
  ...over,
});

describe("two programs at one venue, day and start (lessons 2, 26 and 57)", () => {
  it("tells programs for two audiences apart, not a title and its longer form", () => {
    expect(titlesDiffer("Preschool Story Time", "Family Story Time")).toBe(
      true,
    );
    expect(titlesDiffer("Toddler Story Time", "Baby Story Time")).toBe(true);
    expect(titlesDiffer("Story Time", "Preschool Story Time")).toBe(false);
    expect(titlesDiffer("Santa Flies In", "Santa Flies In by AirLink")).toBe(
      false,
    );
    expect(titlesDiffer("Family Story Time", "Family Storytime!")).toBe(false);
  });

  it("warns, not cuts, Preschool Story Time against Family Story Time at Central Library", async () => {
    const r = await validateEvents({ events: [preschool()] }, libCtx());
    expect(r.events[0].problems).toEqual([]);
    dedupe(r.events, [known()]);
    expect(r.events[0].problems).toEqual([]);
    expect(r.events[0].ok).toBe(true);
    expect(r.events[0].warnings.join(" ")).toMatch(
      /family-story-time-central-library is at the same venue, day and start/,
    );
  });

  it("a multi-program page (the kids' programs list, the calendar) never makes two events one", () => {
    const cal = [CAL, KIDS];
    expect(
      samePage(
        { url: CAL, targetUrls: [KIDS] },
        { url: CAL, targetUrls: [KIDS, "https://dpl.libnet.info/event/1"] },
        [],
        cal,
      ),
    ).toBe(false);
    expect(
      samePage(
        { url: CAL, targetUrls: [] },
        { url: CAL, targetUrls: [] },
        [],
        cal,
      ),
    ).toBe(false);
    // One occurrence page is one event.
    expect(
      samePage(
        { url: CAL, targetUrls: ["https://dpl.libnet.info/event/1"] },
        { url: CAL, targetUrls: ["https://dpl.libnet.info/event/1"] },
        [],
        cal,
      ),
    ).toBe(true);
  });

  it("still cuts true duplicates", async () => {
    // A title like the stored one, naming no other audience.
    const santa = await validateEvents(
      {
        events: [
          preschool({
            title: "Story Time",
            ages_text: undefined,
            evidence: [
              {
                url: "https://dpl.libnet.info/event/77",
                quote: "Monday, November 30 10:30am - 11:00am Story Time",
              },
            ],
          }),
        ],
      },
      libCtx(),
    );
    dedupe(santa.events, [known({ title: "Preschool Story Time" })]);
    expect(santa.events[0].ok).toBe(false);
    expect(santa.events[0].problems.join(" ")).toMatch(/Already on \/events/);
    // The same occurrence page, whatever the titles.
    const same = await validateEvents(
      {
        events: [
          preschool({
            ages_text: undefined,
            evidence: [
              {
                url: "https://dpl.libnet.info/event/16862852",
                quote: "Monday, November 30 10:30am - 11:00am",
              },
            ],
          }),
        ],
      },
      libCtx(),
    );
    dedupe(same.events, [known()]);
    expect(same.events[0].ok).toBe(false);
  });
});

// --- 3. Text run together ------------------------------------------------

const LEGO = readFileSync(
  path.join(__dirname, "fixtures/jcld-lego-hour.html"),
  "utf8",
);

describe("inline tags never run a date together (lesson 5)", () => {
  it("reads JCLD's LEGO Hour date tile as 'Dec 4 2026 3:30-4:30 PM'", () => {
    const text = pageText(LEGO);
    expect(text).not.toMatch(/Dec42026/);
    expect(text).toContain("Dec 4 2026 3:30-4:30 PM | Hockey Challenge");
    const quote = "Dec 4 2026 3:30-4:30 PM | Hockey Challenge";
    expect(onPage({ text }, quote)).toBe(true);
    expect(quotePrintsDate(quote, "2026-12-04")).toBe(true);
    expect(quotePrintsTime(quote, "15:30")).toBe(true);
    expect(quotePrintsTime(quote, "16:30", "end")).toBe(true);
  });

  it("spaces only where a digit meets a letter or a digit", () => {
    expect(pageText("<b>Win</b><i>ter</i> <span>Nights</span>")).toBe(
      "Winter Nights",
    );
    expect(pageText("<span>Nov</span><span>28</span><span>4pm</span>")).toBe(
      "Nov 28 4pm",
    );
    expect(pageText("<b>When</b><span>Saturday, Nov 28</span>")).toBe(
      "WhenSaturday, Nov 28",
    );
    // Inside one element, or a tag that only opens: unchanged.
    expect(pageText("Dec 4<sup>th</sup>")).toBe("Dec 4th");
    expect(pageText("$1<b>0</b>")).toBe("$10");
  });

  it("the routine is told to read it the same way", () => {
    const cmd = readFileSync(".claude/commands/events-harvest.md", "utf8");
    const m = /date tile `([^`]+)` reads "([^"]+)"/.exec(cmd);
    expect(m).not.toBeNull();
    expect(pageText(m![1])).toBe("Dec 4 2026");
    expect(m![2].startsWith(pageText(m![1]))).toBe(true);
    const n =
      /`(<b>When<\/b><span>Saturday<\/span>)` still reads "([^"]+)"/.exec(cmd);
    expect(n).not.toBeNull();
    expect(pageText(n![1])).toBe(n![2]);
  });
});

// --- 4. The retro the routine sent --------------------------------------

describe("the events retro's rule_changes (November 22 refusal)", () => {
  const retro = (target: string) => ({
    run: { kind: "events" },
    rule_changes: [
      {
        target,
        section: "3b",
        current: "A listing event's organizer page must print each date.",
        proposed: "Accept a date inside a printed run.",
        why: "Cascades Theatrical prints its run as December 3-20, 2026.",
      },
    ],
  });

  it("takes 'checker', the word the routine uses, as the validator", () => {
    const r = RetroSchema.safeParse(retro("checker"));
    expect(r.success).toBe(true);
    expect(r.data?.rule_changes[0].target).toBe("validator");
    expect(RetroSchema.safeParse(retro("harvest")).success).toBe(false);
  });

  it("the command lists exactly the targets the schema takes", () => {
    const cmd = readFileSync(".claude/commands/events-harvest.md", "utf8");
    const line = cmd.split("\n").find((l) => l.startsWith("- `rule_changes`"))!;
    for (const t of ["validator", "command", "catalog", "plan"]) {
      expect(line).toContain(`\`${t}\``);
      expect(RetroSchema.safeParse(retro(t)).success).toBe(true);
    }
    // Its example retro passes the schema as written.
    const json = /```json\n([\s\S]*?)\n```/.exec(
      cmd.slice(cmd.indexOf("## 6. Retro")),
    )![1];
    expect(RetroSchema.safeParse(JSON.parse(json)).success).toBe(true);
  });
});

// --- 5. Lines from a page of many programs (Family Story Time, id 3) ------

describe("a multi-program page's line proves only its own program and branch", () => {
  const family = (quote: string, day = "2026-11-30", start = "10:30") =>
    preschool({
      title: "Family Story Time",
      ages_text: undefined,
      dates: [{ day, start }],
      evidence: [{ url: KIDS, quote }],
    });
  const c = (): EventsContext => ({
    ...libCtx(),
    catalog: { ...libCtx().catalog, shared_calendar_pages: [CAL, KIDS] },
  });
  const PRESCHOOL_LINE =
    "Nov 30 Story Time Preschool Story Time 10:30 AM - 11:00 AM ● Central Library - Youth Programing (2nd Floor) Stories, songs and rhymes to develop early literacy skills.";
  const REDMOND_LINE =
    "Dec 1 Story Time Family Story Time 9:30 AM - 10:00 AM ● Redmond Library - Community 1 Interactive story time with books, songs and rhymes.";
  const CENTRAL_LINE =
    "Nov 30 Story Time Family Story Time 9:30 AM - 10:00 AM ● Central Library - Youth Programing (2nd Floor) Interactive story time with books, songs and rhymes.";

  it("Preschool Story Time's line never proves Family Story Time's date", async () => {
    const v = (await validateEvents({ events: [family(PRESCHOOL_LINE)] }, c()))
      .events[0];
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/page of many programs/);
    expect(v.problems.join(" ")).toMatch(/No evidence quote prints 2026-11-30/);
  });

  it("Redmond Library's line never proves Central Library's date", async () => {
    const v = (
      await validateEvents(
        { events: [family(REDMOND_LINE, "2026-12-01", "09:30")] },
        c(),
      )
    ).events[0];
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/page of many programs/);
    // The branch before it ("Find Central Library") doesn't count.
    const prefixed = (
      await validateEvents(
        {
          events: [
            family(
              `Find Central Library ${REDMOND_LINE}`,
              "2026-12-01",
              "09:30",
            ),
          ],
        },
        c(),
      )
    ).events[0];
    expect(prefixed.ok).toBe(false);
  });

  it("the program's own line at its own branch still proves it", async () => {
    const v = (
      await validateEvents(
        { events: [family(CENTRAL_LINE, "2026-11-30", "09:30")] },
        c(),
      )
    ).events[0];
    expect(v.problems).toEqual([]);
  });

  it("the nightly check never counts another program's line as seen", () => {
    const r = { status: 200, text: `${PRESCHOOL_LINE} ${CENTRAL_LINE}` };
    const at = { venue: "Central Library" };
    expect(
      judge(r, PRESCHOOL_LINE, {
        title: "Family Story Time",
        multiProgram: at,
      }),
    ).toBe("unknown");
    expect(
      judge(r, REDMOND_LINE, { title: "Family Story Time", multiProgram: at }),
    ).toBe("unknown");
    expect(
      judge(r, CENTRAL_LINE, { title: "Family Story Time", multiProgram: at }),
    ).toBe("seen");
    // Anywhere else, unchanged.
    expect(judge(r, PRESCHOOL_LINE, { title: "Family Story Time" })).toBe(
      "seen",
    );
  });
});
