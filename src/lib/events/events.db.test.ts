import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDbOn } from "@/lib/local-db";
import type { EventInput } from "./model";
import type { EventVerdict } from "./validate";

/**
 * Kids' events against a real (local) Postgres: storing hand-ins and the
 * nightly re-check. Opt-in: set TEST_DATABASE_URL (see
 * news/sender.db.test.ts). It wipes kid_events.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = testDbOn(URL_);
const PAGE = "https://www.deschuteslibrary.org/storytime";

describe.skipIf(!local)("kid_events, against Postgres", () => {
  let store: typeof import("./store");
  let model: typeof import("./model");
  let q: (s: string) => Promise<Record<string, unknown>[]>;

  const verdict = (
    title: string,
    day: string,
    over: Partial<EventVerdict> = {},
    input: Partial<EventInput> = {},
  ): EventVerdict => {
    const e: EventInput = {
      title,
      dates: [{ day, start: "10:30" }],
      venue: { name: "Downtown Bend Library", town: "Bend" },
      what: "Songs and a picture book for the littlest listeners.",
      url: PAGE,
      evidence: [{ url: PAGE, quote: `Saturday, ${day}, 10:30 am.` }],
      ...input,
    };
    return {
      index: 0,
      title,
      ok: true,
      problems: [],
      warnings: [],
      slug: model.eventSlug(e),
      key: model.seriesKey(e),
      kind: model.kindOf(e),
      event: {
        ...model.storedFrom(e, null, e.evidence[0].quote),
        targets: { [day]: { url: PAGE, quote: e.evidence[0].quote } },
      },
      ...over,
    };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    store = await import("./store");
    model = await import("./model");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    await q("truncate kid_events, kid_event_edits restart identity");
  });

  it("merges weekly single-date hand-ins into one series page (H3)", async () => {
    await store.upsertEvents([verdict("Story Time: Dinosaurs", "2026-11-21")], {
      network: true,
    });
    await store.upsertEvents([verdict("Story Time: Snow", "2026-11-28")], {
      network: true,
    });
    const rows = await q("select slug, kind, data from kid_events");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("series");
    expect((rows[0].data as { dates: unknown[] }).dates).toHaveLength(2);
  });

  it("enriches a stored page with printed ages and cost, keeping its dates (events-ages)", async () => {
    // The harvest re-hands a known page with one upcoming date plus the
    // ages and cost its page prints: the same page, every date kept.
    await store.upsertEvents([verdict("Baby Story Time", "2026-11-21")], {
      network: true,
    });
    // The library prints ages but no cost; a price here stands for a
    // source that prints one (TEAL, Tower).
    const agesQuote = "A gentle story time for infant and caregiver. 0-18 mo.";
    const costQuote = "Saturday, 2026-11-28, 10:30 am. Price $5.00";
    const [r] = await store.upsertEvents(
      [
        verdict(
          "Baby Story Time",
          "2026-11-28",
          {},
          {
            ages_text: "0-18 mo.",
            cost: {
              text: "$5",
              prices: [{ label: "class", amount: 5 }],
              free: false,
            },
            evidence: [
              { url: PAGE, quote: costQuote },
              { url: PAGE, quote: agesQuote },
            ],
          },
        ),
      ],
      { network: true },
    );
    expect(r).toMatchObject({ created: false, changed: true });
    const rows = await q("select data from kid_events");
    expect(rows).toHaveLength(1);
    const data = rows[0].data as {
      dates: { day: string }[];
      ages: { tags: string[]; range: number[] };
      ages_text: string;
      cost: { free: boolean; text: string };
      targets: Record<string, unknown>;
    };
    expect(data.dates.map((d) => d.day)).toEqual(["2026-11-21", "2026-11-28"]);
    expect(Object.keys(data.targets).sort()).toEqual([
      "2026-11-21",
      "2026-11-28",
    ]);
    expect(data.ages_text).toBe("0-18 mo.");
    expect(data.ages).toMatchObject({ tags: ["Ages 0-3"], range: [0, 1] });
    expect(data.cost).toMatchObject({ text: "$5", free: false });
    // /api/events/known shows the stored facts, so the harvest can see a
    // page that lacks them and hand them in again with new dates.
    const [k] = await store.knownEvents(new Date("2026-11-19T20:00:00Z"));
    expect(k.facts).toMatchObject({
      venue: { name: "Downtown Bend Library", town: "Bend" },
      ages_text: "0-18 mo.",
      cost: { text: "$5", free: false },
    });
    // A hand-in replaces the page's facts: one without ages drops them
    // (the harvest prompt hands them in again every time).
    await store.upsertEvents([verdict("Baby Story Time", "2026-12-05")], {
      network: true,
    });
    const [after] = await store.knownEvents(new Date("2026-11-19T20:00:00Z"));
    expect(after.facts.ages_text).toBeUndefined();
    expect(after.dates).toHaveLength(3);
  });

  describe("a re-hand keeps what it leaves out (events-ages review)", () => {
    const pages = async () =>
      (await q(
        "select slug, kind, series_key, data from kid_events order by id",
      )) as {
        slug: string;
        kind: string;
        series_key: string;
        data: Record<string, unknown> & { dates: { day: string }[] };
      }[];

    it("A: series_id and organizer survive a re-hand without them", async () => {
      await store.upsertEvents(
        [
          verdict(
            "Family Skate",
            "2026-11-21",
            {},
            {
              series_id: "bprd-family-skate",
              organizer: { name: "Bend Park and Recreation", url: PAGE },
            },
          ),
        ],
        { network: true },
      );
      await store.upsertEvents(
        [verdict("Family Skate", "2026-11-28", {}, { ages_text: "All ages" })],
        { network: true },
      );
      const rows = await pages();
      expect(rows).toHaveLength(1);
      expect(rows[0].data).toMatchObject({
        series_id: "bprd-family-skate",
        organizer: { name: "Bend Park and Recreation" },
        ages_text: "All ages",
      });
      expect(rows[0].data.dates).toHaveLength(2);
      const [k] = await store.knownEvents(new Date("2026-11-19T20:00:00Z"));
      expect(k.facts).toMatchObject({
        series_id: "bprd-family-skate",
        organizer: { name: "Bend Park and Recreation" },
        what: expect.any(String),
      });
    });

    it("B: an annual page re-handed without annual stays one page", async () => {
      await store.upsertEvents(
        [verdict("Tree Lighting", "2026-12-05", {}, { annual: true })],
        { network: true },
      );
      await store.upsertEvents(
        [verdict("Tree Lighting", "2026-12-05", {}, { ages_text: "All ages" })],
        { network: true },
      );
      const rows = await pages();
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("annual");
      expect(rows[0].series_key).toMatch(/^annual:/);
      expect(rows[0].data).toMatchObject({
        annual: true,
        ages_text: "All ages",
      });
    });

    it("C: a one-off with two dates keeps both when one is re-handed", async () => {
      const two = verdict(
        "Santa Visit",
        "2026-12-05",
        {},
        {
          series: false,
          dates: [
            { day: "2026-12-05", start: "10:30" },
            { day: "2026-12-06", start: "10:30" },
          ],
        },
      );
      await store.upsertEvents([two], { network: true });
      await store.upsertEvents(
        [
          verdict(
            "Santa Visit",
            "2026-12-05",
            {},
            { series: false, ages_text: "All ages" },
          ),
        ],
        { network: true },
      );
      const rows = await pages();
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("one_off");
      expect(rows[0].data.dates.map((d) => d.day)).toEqual([
        "2026-12-05",
        "2026-12-06",
      ]);
    });

    it("C2: re-handing a one-off's second date (or no series flag) makes no duplicate page", async () => {
      const two = verdict(
        "Santa Visit",
        "2026-12-05",
        {},
        {
          series: false,
          dates: [
            { day: "2026-12-05", start: "10:30" },
            { day: "2026-12-06", start: "10:30" },
          ],
        },
      );
      await store.upsertEvents([two], { network: true });
      await store.upsertEvents(
        [verdict("Santa Visit", "2026-12-06", {}, { series: false })],
        { network: true },
      );
      await store.upsertEvents([verdict("Santa Visit", "2026-12-06")], {
        network: true,
      });
      const rows = await pages();
      expect(rows).toHaveLength(1);
      expect(rows[0].series_key).toMatch(/^one:.*2026-12-05$/);
      expect(rows[0].data.dates.map((d) => d.day)).toEqual([
        "2026-12-05",
        "2026-12-06",
      ]);
    });

    it("keeps the venue pin; the url only for the same page's other occurrence", async () => {
      await store.upsertEvents(
        [
          verdict(
            "Lego Club",
            "2026-11-21",
            {},
            {
              venue: {
                name: "Downtown Bend Library",
                town: "Bend",
                lat: 44.06,
                lng: -121.31,
              },
            },
          ),
        ],
        { network: true },
      );
      const again = verdict(
        "Lego Club",
        "2026-11-28",
        {},
        {
          url: "https://www.deschuteslibrary.org/other",
        },
      );
      await store.upsertEvents([again], { network: true });
      let [row] = await pages();
      // A new path on the same site is a new link: it's taken.
      expect(row.data).toMatchObject({
        url: "https://www.deschuteslibrary.org/other",
        venue: { lat: 44.06, lng: -121.31 },
      });
      // Another occurrence of the same page (same path, another query) keeps
      // the stored link.
      await store.upsertEvents(
        [
          verdict(
            "Lego Club",
            "2026-12-05",
            {},
            { url: "https://www.deschuteslibrary.org/other?occurrence=42" },
          ),
        ],
        { network: true },
      );
      [row] = await pages();
      expect(row.data).toMatchObject({
        url: "https://www.deschuteslibrary.org/other",
      });
    });
  });

  it("keeps two showtimes on one day as two dates", async () => {
    const a = verdict("Nutcracker for Kids", "2026-12-12");
    const b = verdict("Nutcracker for Kids", "2026-12-12");
    b.event!.dates = [{ day: "2026-12-12", start: "14:00" }];
    await store.upsertEvents([a], { network: true });
    await store.upsertEvents([b], { network: true });
    const [row] = await q("select data from kid_events");
    expect(
      (row.data as { dates: { start: string }[] }).dates.map((d) => d.start),
    ).toEqual(["10:30", "14:00"]);
  });

  it("gives a clashing slug a stable hash of its series key (H3)", async () => {
    const a = verdict("Story Time", "2026-11-21");
    const b = verdict("Story Time", "2026-11-21", { key: "series:other-key" });
    await store.upsertEvents([a], { network: true });
    const [r] = await store.upsertEvents([b], { network: true });
    expect(r.slug).toBe(`${a.slug}-${store.slugSuffix("series:other-key")}`);
  });

  it("keeps going after one event fails to store (H3)", async () => {
    const bad = verdict("Broken", "2026-11-21", { kind: "bogus" as never });
    const good = verdict("Lego Afternoon", "2026-11-21");
    const out = await store.upsertEvents([bad, good], { network: true });
    expect(out[0].error).toBeTruthy();
    expect(out[1].created).toBe(true);
    expect(await q("select slug from kid_events")).toHaveLength(1);
  });

  it("keeps a canceled date canceled until a status hand-in changes it (M3)", async () => {
    const quote = "Saturday, 2026-11-21, 10:30 am. This event is canceled.";
    const canceled = verdict(
      "Story Time",
      "2026-11-21",
      {},
      {
        status: { kind: "canceled", quote },
        evidence: [{ url: PAGE, quote }],
      },
    );
    canceled.event!.statusByDay = { "2026-11-21": "canceled" };
    await store.upsertEvents([canceled], { network: true });
    await store.upsertEvents([verdict("Story Time", "2026-11-21")], {
      network: true,
    });
    const [row] = await q("select status, data from kid_events");
    expect(row.status).toBe("canceled");
    expect((row.data as { statusByDay: object }).statusByDay).toEqual({
      "2026-11-21": "canceled",
    });
  });

  it("re-checks the next date's target: two misses unconfirm, and a row changed meanwhile isn't overwritten (H4, L11)", async () => {
    await store.upsertEvents([verdict("Story Time", "2026-11-21")], {
      network: true,
    });
    const now = new Date("2026-11-19T12:00:00Z");
    const gone = async () => ({
      status: 200,
      finalUrl: PAGE,
      text: "Nothing here now.",
    });
    await store.recheckEvents(now, gone);
    expect(
      (await q("select confirm, misses from kid_events"))[0],
    ).toMatchObject({ confirm: "ok", misses: 1 });
    const r = await store.recheckEvents(now, gone);
    expect(r.changed).toHaveLength(1);
    expect((await q("select confirm from kid_events"))[0].confirm).toBe(
      "unconfirmed",
    );
    // A hand-in lands while tonight's fetch is running: the check backs off.
    const racing = async () => {
      await q("update kid_events set updated_at = now() + interval '1 second'");
      return {
        status: 200,
        finalUrl: PAGE,
        text: "Saturday, 2026-11-21, 10:30 am.",
      };
    };
    await store.recheckEvents(now, racing);
    expect((await q("select seen_streak from kid_events"))[0].seen_streak).toBe(
      0,
    );
  });

  it("a listing event: a wall or a gone listing is unknown, a dead organizer link a miss (events-coverage)", async () => {
    const ISSUE = "https://bendfamilyloop.beehiiv.com/p/weekend-of-nov-20-22";
    const ORG = "https://www.sunriversharc.com/events/holiday-swim";
    const quote = "Saturday 11/21 Holiday Swim 10:30am";
    const v = verdict(
      "Holiday Swim",
      "2026-11-21",
      {},
      {
        url: ORG,
        verified_via: "listing",
        evidence: [{ url: ISSUE, quote }],
      },
    );
    v.event!.targets = { "2026-11-21": { url: ISSUE, quote } };
    await store.upsertEvents([v], { network: true });
    const now = new Date("2026-11-10T12:00:00Z");
    const seenUrls: string[][] = [];
    const night =
      (
        org: { status: number; text?: string; blocked?: string },
        listing: number,
      ) =>
      async (u: string, domains: readonly string[]) => {
        seenUrls.push([...domains]);
        return u === ORG
          ? { finalUrl: u, text: "", ...org }
          : {
              status: listing,
              finalUrl: u,
              text: listing === 200 ? quote : "",
            };
      };
    // The organizer's wall and a listing that's gone: unknown, for weeks.
    const later = new Date("2026-11-19T12:00:00Z");
    await store.recheckEvents(
      later,
      night({ status: 403, blocked: "a firewall" }, 404),
    );
    expect(
      (await q("select confirm, misses from kid_events"))[0],
    ).toMatchObject({ confirm: "ok", misses: 0 });
    // The listing is fetched on the newsletter's host.
    expect(seenUrls.some((d) => d.includes("bendfamilyloop.beehiiv.com"))).toBe(
      true,
    );
    // The wall and the listing still there: seen.
    await store.recheckEvents(now, night({ status: 403 }, 200));
    expect(
      (await q("select misses, seen_streak from kid_events"))[0],
    ).toMatchObject({ misses: 0, seen_streak: 1 });
    // A dead organizer link: a miss.
    await store.recheckEvents(now, night({ status: 404 }, 200));
    expect((await q("select misses from kid_events"))[0].misses).toBe(1);
  });

  it("stops starting checks when the time budget runs out (M8)", async () => {
    await store.upsertEvents(
      [verdict("A one", "2026-11-21"), verdict("B two", "2026-11-21")],
      { network: true },
    );
    const r = await store.recheckEvents(
      new Date("2026-11-19T12:00:00Z"),
      async () => ({ status: 200, finalUrl: PAGE, text: "" }),
      { budgetMs: -1 },
    );
    expect(r.checked).toBe(0);
    expect(r.left).toBe(2);
  });
  it("never merges one series_id across branches or programs (writer fix 1)", async () => {
    const sid = { series_id: "series-dpl-family-story-time" };
    const central = verdict("Family Story Time", "2026-11-21", {}, sid);
    const redmond = verdict(
      "Family Story Time",
      "2026-11-21",
      {},
      {
        ...sid,
        venue: { name: "Redmond Library", town: "Redmond" },
      },
    );
    const baby = verdict("Baby Storytime", "2026-11-24", {}, sid);
    await store.upsertEvents([central, redmond, baby], { network: true });
    const rows = await q("select slug from kid_events order by slug");
    expect(rows.map((r) => r.slug)).toEqual([
      "baby-storytime-downtown-bend-library",
      "family-story-time-downtown-bend-library",
      "family-story-time-redmond-library",
    ]);
  });

  const rowsSlug = (k: { slug: string }[]) =>
    k.map((x) => x.slug).find((x) => x.includes("downtown"))!;

  it("re-keys a row stored under the old key only for its own venue and program", async () => {
    const sid = { series_id: "series-dpl-family-story-time" };
    const old = verdict("Family Story Time", "2026-11-21", {}, sid);
    await store.upsertEvents(
      [{ ...old, key: "series:series-dpl-family-story-time" }],
      { network: true },
    );
    // Another branch: a page of its own; the old row is untouched.
    await store.upsertEvents(
      [
        verdict(
          "Family Story Time",
          "2026-11-28",
          {},
          {
            ...sid,
            venue: { name: "Sisters Library", town: "Sisters" },
          },
        ),
      ],
      { network: true },
    );
    expect(
      (await q("select series_key from kid_events order by id"))[0].series_key,
    ).toBe("series:series-dpl-family-story-time");
    // /api/events/known shows the key it will take, so de-duplication
    // never refuses the hand-in that re-keys it.
    const known = await store.knownEvents(new Date("2026-11-19T20:00:00Z"));
    expect(known.find((k) => k.slug === rowsSlug(known))?.key).toBe(
      "venue:dpl-downtown-bend:family-story-time",
    );
    // The same branch and program, now without a series_id: joins the old
    // row, which takes the new key (no second page, no duplicate refusal).
    await store.upsertEvents([verdict("Family Story Time", "2026-11-28")], {
      network: true,
    });
    const rows = await q(
      "select slug, series_key, data from kid_events order by id",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].series_key).toBe(
      "venue:dpl-downtown-bend:family-story-time",
    );
    expect((rows[0].data as { dates: unknown[] }).dates).toHaveLength(2);
  });

  it("trims only the chosen dates, and logs who did it", async () => {
    const v = verdict("Story Time", "2026-11-21");
    v.event!.dates = [
      { day: "2026-11-21", start: "10:30" },
      { day: "2026-11-28", start: "10:30" },
      { day: "2026-12-05", start: "10:30" },
    ];
    await store.upsertEvents([v], { network: true });
    const [{ id }] = await q("select id from kid_events");
    const r = await store.trimEventDates(id as number, ["2026-11-28-1030"], 7);
    expect(r).toMatchObject({ ok: true, removed: ["2026-11-28-1030"] });
    const [row] = await q("select data from kid_events");
    expect(
      (row.data as { dates: { day: string }[] }).dates.map((d) => d.day),
    ).toEqual(["2026-11-21", "2026-12-05"]);
    const [log] = await q(
      "select action, by_explorer_id, detail from kid_event_edits",
    );
    expect(log).toMatchObject({ action: "trim", by_explorer_id: 7 });
    expect(
      await store.trimEventDates(
        id as number,
        ["2026-11-21-1030", "2026-12-05-1030"],
        7,
      ),
    ).toMatchObject({ ok: false });
  });

  it("splits other branches' dates onto their own page, then removes a wrong row", async () => {
    const v = verdict("Family Story Time", "2026-11-21");
    v.event!.dates = [
      { day: "2026-11-21", start: "10:30" },
      { day: "2026-11-24", start: "10:30" },
    ];
    v.event!.targets = {
      "2026-11-21": { url: PAGE, quote: "Saturday, 2026-11-21, 10:30 am." },
      "2026-11-24": {
        url: `${PAGE}/redmond`,
        quote: "Tuesday, 2026-11-24, 10:30 am.",
      },
    };
    await store.upsertEvents([v], { network: true });
    const [{ id }] = await q("select id from kid_events");
    const r = await store.splitEvent(
      id as number,
      ["2026-11-24-1030"],
      {
        title: "Family Story Time",
        venueName: "Redmond Library",
        venueTown: "Redmond",
      },
      7,
    );
    expect(r).toMatchObject({
      ok: true,
      newSlug: "family-story-time-redmond-library-2026",
    });
    const rows = await q(
      "select slug, data, confirm, status from kid_events order by id",
    );
    expect(rows).toHaveLength(2);
    const moved = rows[1].data as {
      venue: { name: string; street?: string };
      checkQuote: string;
      series_id?: string;
      status?: unknown;
      statusByDay?: unknown;
    };
    expect(moved.venue.name).toBe("Redmond Library");
    // A catalog venue: its street comes from the catalog.
    expect(moved.venue.street).toBeTruthy();
    expect(moved.checkQuote).toBe("Tuesday, 2026-11-24, 10:30 am.");
    expect(moved.series_id).toBeUndefined();
    expect(moved.status).toBeUndefined();
    expect(moved.statusByDay).toBeUndefined();
    // The new page waits for the nightly check before it's listed.
    expect(rows[1]).toMatchObject({
      confirm: "unconfirmed",
      status: "scheduled",
    });
    expect((rows[0].data as { dates: unknown[] }).dates).toHaveLength(1);

    const gone = await store.removeEvent(id as number, "A test row", 7);
    expect(gone).toMatchObject({ ok: true });
    expect(await q("select id from kid_events")).toHaveLength(1);
    const logs = await q(
      "select action, detail from kid_event_edits order by id",
    );
    expect(logs.map((l) => l.action)).toEqual(["split", "remove"]);
    // The split log keeps the source row as it was.
    expect(
      (logs[0].detail as { source: { data: { dates: unknown[] } } }).source.data
        .dates,
    ).toHaveLength(2);
    expect((logs[1].detail as { row: { slug: string } }).row.slug).toBe(
      rows[0].slug,
    );
  });

  it("lists what's stored for the harvest, today to 60 days out", async () => {
    await store.upsertEvents(
      [verdict("Story Time", "2026-11-21"), verdict("Old Thing", "2026-10-01")],
      { network: true },
    );
    const k = await store.knownEvents(new Date("2026-11-19T20:00:00Z"), 60);
    expect(k.map((e) => e.slug)).toEqual([
      "story-time-downtown-bend-library-2026",
    ]);
    expect(k[0]).toMatchObject({
      dates: [{ day: "2026-11-21", start: "10:30" }],
      targetUrls: [PAGE],
    });
  });

  it("keeps admin repairs: trimmed dates and removed pages stay gone", async () => {
    const v = () => {
      const x = verdict("Story Time", "2026-11-21");
      x.event!.dates = [
        { day: "2026-11-21", start: "10:30" },
        { day: "2026-11-28", start: "10:30" },
      ];
      return x;
    };
    await store.upsertEvents([v()], { network: true });
    const [{ id }] = await q("select id from kid_events");
    await store.trimEventDates(id as number, ["2026-11-28-1030"], 7);
    // The harvest hands the trimmed date in again: it stays off.
    const back = v();
    const [out] = await store.upsertEvents([back], { network: true });
    expect(out.error).toBeUndefined();
    expect(back.warnings.join(" ")).toMatch(/an admin took off/);
    const [row] = await q("select data from kid_events");
    expect(
      (row.data as { dates: { day: string }[] }).dates.map((d) => d.day),
    ).toEqual(["2026-11-21"]);

    await store.removeEvent(id as number, "Wrong program", 7);
    const again = v();
    expect(await store.upsertEvents([again], { network: true })).toEqual([]);
    expect(again.problems.join(" ")).toMatch(/An admin removed/);
    expect(await q("select id from kid_events")).toHaveLength(0);
  });

  it("stops making new pages at the daily cap", async () => {
    expect(await store.createdToday()).toBe(0);
    const out = await store.upsertEvents(
      [verdict("A one", "2026-11-21"), verdict("B two", "2026-11-21")],
      { network: true, newLeft: 1 },
    );
    expect(out[0].created).toBe(true);
    expect(out[1].error).toMatch(/cap of 300/);
    expect(await store.createdToday()).toBe(1);
  });

  it("marks a date canceled when its page says so, and ages out a page that never answers", async () => {
    await store.upsertEvents([verdict("Story Time", "2026-11-21")], {
      network: true,
    });
    const now = new Date("2026-11-19T12:00:00Z");
    const r = await store.recheckEvents(now, async () => ({
      status: 200,
      finalUrl: PAGE,
      text: "News. Story Time is cancelled this Saturday. Back next week.",
    }));
    expect(r.changed).toHaveLength(1);
    const [row] = await q("select status, data from kid_events");
    expect(row.status).toBe("canceled");
    expect(
      (row.data as { statusByDay: Record<string, string> }).statusByDay,
    ).toEqual({ "2026-11-21": "canceled" });

    await q("truncate kid_events restart identity");
    await store.upsertEvents([verdict("Story Time", "2026-11-21")], {
      network: true,
    });
    await q("update kid_events set last_seen_at = now() - interval '8 days'");
    const walled = async () => ({
      status: 403,
      finalUrl: PAGE,
      text: "",
      blocked: "a Cloudflare bot check",
    });
    await store.recheckEvents(new Date(), walled);
    expect((await q("select confirm from kid_events"))[0].confirm).toBe(
      "unconfirmed",
    );
  });

  // --- The short line: PATCH /api/events/<slug>/short and adoption ---------

  describe("the short line", () => {
    const TOKEN = "test-ingest-token-0123456789abcdef";
    const patch = async (
      slug: string,
      body: unknown,
      token: string | null = TOKEN,
    ) => {
      process.env.NEWS_INGEST_TOKEN = TOKEN;
      const { PATCH } = await import("@/app/api/events/[slug]/short/route");
      return PATCH(
        new Request(`http://x/api/events/${slug}/short`, {
          method: "PATCH",
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ slug }) },
      );
    };
    const stored = async () =>
      (await q("select slug, data from kid_events"))[0] as {
        slug: string;
        data: Record<string, unknown>;
      };

    it("needs the ingest token, checks the line, and changes only `short`", async () => {
      await store.upsertEvents([verdict("Baby Songs", "2026-11-21")], {
        network: true,
      });
      const before = await stored();
      expect(
        (await patch(before.slug, { short: "Songs for babies" }, null)).status,
      ).toBe(401);
      expect(
        (
          await patch(
            before.slug,
            { short: "Songs for babies" },
            "wrong-token-0123456789abcdef",
          )
        ).status,
      ).toBe(401);
      expect((await patch(before.slug, { nope: 1 })).status).toBe(400);
      expect(
        (
          await patch("no-such-event", {
            short: "Songs for the littlest listeners",
          })
        ).status,
      ).toBe(404);
      const bad = await patch(before.slug, {
        short: "Songs and a picture book for",
      });
      expect(bad.status).toBe(422);
      expect(
        ((await bad.json()) as { problems: string[] }).problems.join(" "),
      ).toMatch(/mid-phrase/);
      expect((await stored()).data.short).toBeUndefined();
      const ok = await patch(before.slug, {
        short: "Songs and a picture book for the littlest listeners",
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({
        ok: true,
        short: "Songs and a picture book for the littlest listeners",
        previous: null,
      });
      const after = await stored();
      expect(after.data.short).toBe(
        "Songs and a picture book for the littlest listeners",
      );
      // Nothing else moved.
      const { short: _s, ...rest } = after.data;
      void _s;
      expect(rest).toEqual(before.data);
    });

    it("a re-hand without a short keeps the stored one while it's still grounded", async () => {
      await store.upsertEvents(
        [
          verdict(
            "Baby Songs",
            "2026-11-21",
            {},
            {
              short: "Songs and a picture book for the littlest listeners",
            },
          ),
        ],
        { network: true },
      );
      await store.upsertEvents([verdict("Baby Songs", "2026-11-28")], {
        network: true,
      });
      expect((await stored()).data.short).toBe(
        "Songs and a picture book for the littlest listeners",
      );
      // The summary changes: the old short no longer fits it, and goes.
      await store.upsertEvents(
        [
          verdict(
            "Baby Songs",
            "2026-12-05",
            {},
            {
              what: "Bouncy rhymes and lap games for babies and their grown-ups.",
            },
          ),
        ],
        { network: true },
      );
      expect((await stored()).data.short).toBeUndefined();
    });
  });
});
