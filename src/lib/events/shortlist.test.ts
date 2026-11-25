import { describe, expect, it } from "vitest";
import type { EventRow, StoredEvent } from "./model";
import { keepTimes, occParts, shortlistFacts } from "./shortlist";

const NOW = new Date("2026-11-25T18:00:00Z"); // Wed, Nov 25, 10 am Pacific

function row(
  slug: string,
  over: Partial<StoredEvent> = {},
  rowOver: Partial<EventRow> = {},
): EventRow {
  return {
    id: slug.length,
    slug,
    kind: "one_off",
    status: "scheduled",
    confirm: "ok",
    lastSeenAt: null,
    factsChangedAt: NOW,
    stateChangedAt: null,
    ...rowOver,
    data: {
      title: slug,
      url: "https://www.deschuteslibrary.org/x",
      what: "Fun.",
      dates: [{ day: "2026-12-02", start: "17:30", end: "18:30" }],
      venue: { name: "Central Library", town: "Bend" },
      evidence: [],
      ages: null,
      point: { lat: 44.05, lng: -121.31 },
      checkQuote: "q",
      ...over,
    } as StoredEvent,
  };
}

describe("the shortlist's facts", () => {
  it("reads an occurrence id", () => {
    expect(occParts("2026-12-06-1400")).toEqual({
      day: "2026-12-06",
      start: "14:00",
    });
    expect(occParts("2026-12-06")).toEqual({ day: "2026-12-06" });
  });

  it("an upcoming date: on, with its calendar link and group", () => {
    const [f] = shortlistFacts(
      [row("night")],
      [{ slug: "night", occ: "2026-12-02-1730" }],
      NOW,
    );
    expect(f).toMatchObject({ state: "ok", past: false, regular: false });
    expect(f.show.group).toBe("later");
    expect(f.show.ics).toBe("/events/night/calendar.ics?d=2026-12-02&t=17:30");
    expect(f.show.changed).toBe(false);
    expect(f.show.when).toBe("Wed, Dec 2 · 5:30 pm to 6:30 pm");
  });

  it("a date canceled on its page is flagged, with no calendar link", () => {
    const r = row("night", { statusByDay: { "2026-12-02": "canceled" } });
    const [f] = shortlistFacts(
      [r],
      [{ slug: "night", occ: "2026-12-02-1730" }],
      NOW,
    );
    expect(f.state).toBe("canceled");
    expect(f.show.changed).toBe(true);
    expect(f.show.ics).toBeNull();
    expect(f.by).toBe("Central Library");
  });

  it("a rescheduled date says moved, with the new day", () => {
    const r = row("night", {
      dates: [{ day: "2026-12-09", start: "17:30" }],
      status: {
        kind: "rescheduled",
        quote: "Moved to Dec 9",
        previous_day: "2026-12-02",
      },
    });
    const [f] = shortlistFacts(
      [r],
      [{ slug: "night", occ: "2026-12-02-1730" }],
      NOW,
    );
    expect(f.state).toBe("moved");
    expect(f.show.newDay).toBe("Wed, Dec 9");
  });

  it("a page that came off our list", () => {
    const [f] = shortlistFacts(
      [],
      [{ slug: "gone-one", occ: "2026-12-02" }],
      NOW,
    );
    expect(f.state).toBe("gone");
    expect(f.show.changed).toBe(true);
  });

  it("a regular always shows its next date; a passed series date offers the next", () => {
    const r = row(
      "lego",
      {
        dates: [
          { day: "2026-11-18", start: "16:00" },
          { day: "2026-12-02", start: "16:00" },
          { day: "2026-12-09", start: "16:00" },
        ],
      },
      { kind: "series" },
    );
    const [reg, old] = shortlistFacts(
      [r],
      [
        { slug: "lego", occ: "" },
        { slug: "lego", occ: "2026-11-18-1600" },
      ],
      NOW,
    );
    expect(reg).toMatchObject({ state: "ok", regular: true });
    expect(reg.show.group).toBe("regular");
    expect(reg.date?.day).toBe("2026-12-02");
    expect(old.past).toBe(true);
    expect(old.show.group).toBe("past");
    expect(old.next?.occ).toBe("2026-12-02-1600");
    expect(old.show.changed).toBe(false);
  });

  it("a regular with nothing announced yet", () => {
    const r = row(
      "lego",
      { dates: [{ day: "2026-11-18" }] },
      { kind: "series" },
    );
    const [f] = shortlistFacts([r], [{ slug: "lego", occ: "" }], NOW);
    expect(f.state).toBe("no_next");
  });

  it("unconfirmed pages say check first", () => {
    const r = row("night", {}, { confirm: "unconfirmed" });
    const [f] = shortlistFacts(
      [r],
      [{ slug: "night", occ: "2026-12-02-1730" }],
      NOW,
    );
    expect(f.state).toBe("unconfirmed");
  });

  it("keeps times together", () => {
    expect(keepTimes("Sat · 10:30 am to 11 am")).toBe(
      "Sat · 10:30 am to 11 am",
    );
  });
});
