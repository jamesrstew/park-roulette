import { describe, expect, it } from "vitest";
import {
  alertKind,
  alertWords,
  buildView,
  change,
  ideas,
  rate,
  verdict,
  withChange,
} from "./analyze";
import { arrivalSource } from "./arrival";
import { METRICS, type Snapshot } from "./model";
import { bars, renderHtml, renderSubject, renderText } from "./render";
import { applyTraffic, pathGroup, sourceOf, type Traffic } from "./vercel";
import {
  isMonday,
  lastFullWeek,
  mondayOn,
  sendGate,
  weekLabel,
  weekOf,
  weeksBefore,
} from "./week";

const snap = (
  weekStart: string,
  metrics: Snapshot["metrics"],
  details: Snapshot["details"] = {},
): Snapshot => ({ weekStart, metrics, details, backfilled: false });

describe("the week", () => {
  it("runs Monday to Monday, Pacific, in PST and PDT", () => {
    const w = weekOf("2026-11-23");
    expect(w.from.toISOString()).toBe("2026-11-23T08:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-11-30T08:00:00.000Z");
    expect(w.end).toBe("2026-11-29");
    const summer = weekOf("2026-07-06");
    expect(summer.from.toISOString()).toBe("2026-07-06T07:00:00.000Z");
    // The week DST ends in is 169 hours long.
    const fall = weekOf("2026-10-26");
    expect((fall.to.getTime() - fall.from.getTime()) / 3_600_000).toBe(169);
  });

  it("names the last full week from a Monday morning", () => {
    expect(lastFullWeek(new Date("2026-11-30T15:12:00Z")).start).toBe(
      "2026-11-23",
    );
    // Sunday night Pacific is still the week before.
    expect(mondayOn(new Date("2026-11-30T07:30:00Z"))).toBe("2026-11-23");
    expect(weeksBefore(weekOf("2026-11-30"), 2).map((w) => w.start)).toEqual([
      "2026-11-16",
      "2026-11-23",
    ]);
    expect(isMonday("2026-11-30")).toBe(true);
    expect(isMonday("2026-11-29")).toBe(false);
    expect(isMonday("2026-02-30")).toBe(false);
    expect(weekLabel(weekOf("2026-11-30"))).toBe("Nov 30 to Dec 6");
    expect(weekLabel(weekOf("2026-11-23"))).toBe("Nov 23 to 29");
  });

  it("opens the send at 7:12 Pacific on Mondays, whichever cron fires", () => {
    // Winter (PST): 14:12 UTC is 6:12 (closed), 15:12 is 7:12 (open).
    expect(sendGate(new Date("2026-11-30T14:12:00Z")).open).toBe(false);
    expect(sendGate(new Date("2026-11-30T15:12:00Z")).open).toBe(true);
    expect(sendGate(new Date("2026-11-30T16:42:00Z")).open).toBe(true);
    // Summer (PDT): 14:12 UTC is 7:12 (open); 16:12 is 9:12 (closed).
    expect(sendGate(new Date("2026-07-13T14:12:00Z")).open).toBe(true);
    expect(sendGate(new Date("2026-07-13T16:12:00Z")).open).toBe(false);
    // Not on a Tuesday.
    expect(sendGate(new Date("2026-12-01T15:12:00Z")).open).toBe(false);
  });
});

describe("Vercel's numbers", () => {
  it("sorts referrers into sources", () => {
    expect(sourceOf("")).toBe("direct");
    expect(sourceOf("bendbulletin.com")).toBe("bulletin");
    expect(sourceOf("www.bendbulletin.com")).toBe("bulletin");
    expect(sourceOf("l.instagram.com")).toBe("instagram");
    expect(sourceOf("m.facebook.com")).toBe("facebook");
    expect(sourceOf("google.com")).toBe("google");
    expect(sourceOf("www.google.co.uk")).toBe("google");
    expect(sourceOf("bing.com")).toBe("other_search");
    expect(sourceOf("Others")).toBe("other_site");
    expect(sourceOf("notbendbulletin.com")).toBe("other_site");
    expect(sourceOf("parkroulette.quest")).toBe("direct");
  });

  it("groups paths", () => {
    expect(pathGroup("/")).toBe("Home and wheel");
    expect(pathGroup("/events/lego-club")).toBe("Events");
    expect(pathGroup("/guides/pairings/x")).toBe("Guides");
    expect(pathGroup("/join/[code]")).toBe("Passport and sign-in");
  });

  it("adds up a week of traffic", () => {
    const t: Traffic = {
      visitors: 0,
      pageviews: 0,
      referrers: [
        { host: "", visitors: 50, pageviews: 90 },
        { host: "bendbulletin.com", visitors: 20, pageviews: 21 },
        { host: "facebook.com", visitors: 10, pageviews: 10 },
        { host: "m.facebook.com", visitors: 5, pageviews: 6 },
      ],
      paths: [
        { path: "/", visitors: 40, pageviews: 60 },
        { path: "/admin", visitors: 1, pageviews: 9 },
      ],
      events: { Spin: { count: 12, visitors: 5 } },
      askShownBy: {},
      arrivedBy: { ig: 3, fb: 1, email: 4 },
      daily: [],
    };
    const m: Record<string, number | null> = {};
    const d: Snapshot["details"] = {};
    applyTraffic({ ...t, visitors: 85, pageviews: 127 }, m, d);
    expect(m.src_facebook).toBe(15);
    expect(m.src_bulletin).toBe(20);
    expect(m.src_direct).toBe(50);
    expect(m.spins).toBe(12);
    expect(m.code_requested).toBe(0);
    expect(m.arrived_social).toBe(4);
    expect(d.topPaths?.map((p) => p.path)).toEqual(["/"]);
  });
});

describe("the reading", () => {
  it("shows small numbers as counts, percentages only on a real base", () => {
    expect(change(3, 1)).toBe("+2");
    expect(change(1, 3)).toBe("−2");
    expect(change(116, 57)).toBe("+59 (+104%)");
    expect(change(30, 10)).toBe("+20");
    expect(change(150, 100)).toBe("+50 (+50%)");
    expect(change(3, null)).toBe("no prior week");
    expect(change(null, 3)).toBe("not measured");
    expect(withChange(3, 1)).toBe("3 (+2)");
    expect(withChange(150, 100)).toBe("150 (+50, +50%)");
    expect(rate(4, 6)).toBe("4 of 6");
    expect(rate(6, 116)).toBe("6 of 116 (5%)");
  });

  it("leads with the big change and names the catch", () => {
    const prev = snap("2026-11-16", { visitors: 57, families_new: 2 });
    const cur = snap("2026-11-23", {
      visitors: 116,
      families_new: 3,
      first_stamps: 0,
      stamps: 0,
    });
    expect(verdict(cur, [prev])).toBe(
      "Visitors more than doubled to 116 and 3 families joined, but no one stamped a park yet.",
    );
    expect(
      verdict(snap("2026-11-23", { visitors: 40, email_new: 0 }), [
        snap("2026-11-16", { visitors: 38 }),
      ]),
    ).toBe("No one signed up this week.");
    expect(verdict(snap("2026-11-23", {}), [])).toBe(
      "Nothing was measured this week.",
    );
  });

  it("always offers three things to try, broken jobs first", () => {
    const cur = snap(
      "2026-11-23",
      { visitors: 5, cron_errors: 1, reviews: 0 },
      { alertKeys: ["error:cron-social"] },
    );
    const list = ideas(cur, []);
    expect(list).toHaveLength(3);
    expect(list[0].title).toBe("Fix the failed job: social");
  });

  it("puts one source tip at most, against last week", () => {
    const prev = snap("2026-11-16", { src_facebook: 5, src_bulletin: 0 });
    const cur = snap("2026-11-23", {
      visitors: 100,
      src_facebook: 18,
      src_bulletin: 20,
      families_new: 0,
    });
    const tips = ideas(cur, [prev]).filter((i) => i.title.startsWith("Lean"));
    expect(tips).toHaveLength(1);
    expect(tips[0].why).toContain("new this week");
  });

  it("says alerts in plain words and strips ids", () => {
    expect(alertKind("report:123")).toBe("report");
    expect(alertKind("texts:skip:2026-11-20")).toBe("texts:skip");
    expect(alertWords("error:cron-weekend-pick")).toBe(
      "the weekend pick job failed",
    );
  });

  it("reads which of our links a landing came from", () => {
    expect(arrivalSource("ig", null, null)).toBe("ig");
    expect(arrivalSource(null, "email", null)).toBe("email");
    expect(arrivalSource(null, null, "text")).toBe("text");
    expect(arrivalSource("<script>", null, null)).toBeNull();
  });
});

describe("the email", () => {
  const full = (w: string, x: number) =>
    snap(w, Object.fromEntries(METRICS.map((m, i) => [m.key, (i + 1) * x])), {
      sources: { bulletin: 20 * x, direct: 50 },
      emailBySource: { footer: 2 },
      issue: {
        date: "2026-11-26",
        sent: 3,
        links: [{ slug: "pick<b>", clicks: 2 }],
      },
      posts: [
        {
          id: 1,
          kind: "unpack",
          day: "2026-11-25",
          reach: 28,
          views: 50,
          saved: 1,
          shares: 0,
          likes: 1,
          comments: 0,
        },
      ],
      alertKeys: ["error:render:/guides/<x>"],
      events: { "Email signup": 1 },
      askShownBy: { email: 3 },
    });
  const view = buildView(full("2026-11-23", 3), [
    full("2026-10-26", 1),
    full("2026-11-02", 1),
    full("2026-11-09", 2),
    full("2026-11-16", 2),
  ]);
  const html = renderHtml(view, {
    webUrl: "https://parkroulette.quest/admin/growth?week=2026-11-23",
  });

  it("stays well under Gmail's clipping size", () => {
    expect(Buffer.byteLength(html)).toBeLessThan(80_000);
  });

  it("escapes everything it prints", () => {
    expect(html).not.toContain("<x>");
    expect(html).toContain("&lt;x&gt;");
    expect(html).not.toMatch(/NaN|undefined|\[object/);
    const text = renderText(view, { webUrl: "https://x.test" });
    expect(text).toContain("WHAT MOVED AND WHY");
    expect(text).not.toMatch(/NaN|undefined/);
  });

  it("has a subject with the three headlines", () => {
    expect(renderSubject(view)).toMatch(
      /^Growth, Nov 23 to 29: \d+ new families \(\+\d+\), \d+ visitors/,
    );
  });

  it("draws bars for zero and unmeasured weeks", () => {
    const b = bars([null, 0, 2, 4]);
    expect(b).toContain("dotted");
    expect(b.match(/<td/g)).toHaveLength(4);
  });
});

describe("reading Vercel", () => {
  const cfg = (data: Record<string, unknown>[] | ((u: URL) => unknown)) => ({
    token: "t",
    teamId: "team",
    projectId: "p",
    fetchImpl: (async (u: string) =>
      Response.json({
        data: typeof data === "function" ? data(new URL(u)) : data,
      })) as unknown as typeof fetch,
  });

  it("takes the total from one row, not a sum over referrers", async () => {
    const { readTraffic } = await import("./vercel");
    const t = await readTraffic(
      cfg((u) => {
        const by = u.searchParams.get("by");
        if (by === "environment")
          return [{ environment: "production", visitors: 105, pageviews: 328 }];
        if (by === "referrerHostname")
          return [
            { referrerHostname: "", visitors: 80, pageviews: 300 },
            { referrerHostname: "Others", visitors: 36, pageviews: 28 },
          ];
        if (by === "day") return [];
        if (by === "requestPath") return [];
        if (by === "eventName")
          return [{ eventName: "Spin", count: 3, visitors: 2 }];
        return [
          {
            [by!]: by === "eventData/from" ? "ig" : "email",
            count: 2,
            visitors: 2,
          },
        ];
      }),
      new Date("2026-11-23T08:00:00Z"),
      new Date("2026-11-30T08:00:00Z"),
    );
    expect(t.visitors).toBe(105);
    expect(t.events.Spin.count).toBe(3);
    expect(t.arrivedBy.ig).toBe(2);
  });

  it("fails the source on a malformed answer instead of reading zeros", async () => {
    const { readTraffic } = await import("./vercel");
    await expect(
      readTraffic(
        cfg([{ referrerHostname: "x" }]),
        new Date("2026-11-23T08:00:00Z"),
        new Date("2026-11-30T08:00:00Z"),
      ),
    ).rejects.toThrow(/no /);
  });
});

describe("without Vercel connected", () => {
  it("drops unmeasured funnel steps and leaves visitors out of the subject", async () => {
    const { funnels } = await import("./analyze");
    const cur = snap("2026-11-23", {
      families_new: 2,
      first_stamps: 1,
      email_new: 1,
    });
    const f = funnels(cur);
    expect(f.map((x) => x.name)).toEqual(["Families"]);
    expect(f[0].steps.map((s) => s.label)).toEqual([
      "Started a family",
      "Stamped a first park",
    ]);
    const view = buildView(cur, [snap("2026-11-16", { families_new: 1 })]);
    expect(renderSubject(view)).toBe(
      "Growth, Nov 23 to 29: 2 new families (+1)",
    );
    expect(
      renderHtml(view, { webUrl: "https://x.test/admin/growth" }),
    ).toContain("not connected yet");
  });
});

describe("digestRecipients", () => {
  it("sends to the alerts address plus GROWTH_DIGEST_TO, deduped, bad entries dropped", async () => {
    const { digestRecipients } = await import("./recipients");
    expect(
      digestRecipients(
        " a@example.com, HELLO@x.test ,not-an-email,, b@example.org ",
        "hello@x.test",
      ),
    ).toEqual(["hello@x.test", "a@example.com", "b@example.org"]);
    expect(digestRecipients("", "hello@x.test")).toEqual(["hello@x.test"]);
  });
});
