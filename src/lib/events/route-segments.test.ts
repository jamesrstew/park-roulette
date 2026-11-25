import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_ROUTE_SEGMENTS, type EventInput, eventSlug } from "./model";

/**
 * /events/<slug> is an event page, but fixed routes under /events
 * (/events/saved) win over it: an event must never get one of their
 * names as its slug, or its page would be unreachable.
 */

const input = (title: string, venue: string, days: string[]): EventInput =>
  ({
    title,
    venue: { name: venue, town: "Bend" },
    dates: days.map((day) => ({ day })),
  }) as unknown as EventInput;

describe("event slugs never take a fixed /events route", () => {
  it("every fixed folder under src/app/events is reserved", () => {
    const dir = path.resolve(__dirname, "../../app/events");
    const fixed = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !/^[[(@_]/.test(d.name))
      .map((d) => d.name);
    expect(fixed).toContain("saved");
    for (const seg of fixed) expect(EVENT_ROUTE_SEGMENTS.has(seg)).toBe(true);
  });

  it("a series that would slug to 'saved' gets another slug", () => {
    // "Saved" at a venue whose name slugs to nothing, two dates (a series).
    const e = input("Saved", "!!", ["2026-12-01", "2026-12-08"]);
    const slug = eventSlug(e);
    expect(slug).not.toBe("saved");
    expect(EVENT_ROUTE_SEGMENTS.has(slug)).toBe(false);
    expect(slug).toBe("saved-event");
  });

  it("ordinary slugs are unchanged", () => {
    expect(
      eventSlug(
        input("Lego Club", "Redmond Library", ["2026-12-01", "2026-12-08"]),
      ),
    ).toBe("lego-club-redmond-library");
    expect(
      eventSlug(
        input("Saved by the Bell Show", "Tower Theatre", ["2026-12-01"]),
      ),
    ).toBe("saved-by-the-bell-show-tower-theatre-2026");
  });
});
