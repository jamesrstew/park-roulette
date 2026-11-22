import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDbOn } from "@/lib/local-db";
import type { EventInput } from "@/lib/events/model";
import type { EventVerdict } from "@/lib/events/validate";

/**
 * The newsletter inbox against a real (local) Postgres: storing issues
 * once, reading them back for the harvest (never Gmail's confirmation
 * row), pruning after 120 days, and the nightly check of an event that
 * stands on a stored issue. Opt-in: set TEST_DATABASE_URL (see
 * news/sender.db.test.ts). It wipes newsletter_issues and kid_events.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = testDbOn(URL_);

describe.skipIf(!local)("newsletter_issues, against Postgres", () => {
  let store: typeof import("./store");
  let events: typeof import("@/lib/events/store");
  let model: typeof import("@/lib/events/model");
  let q: (s: string) => Promise<Record<string, unknown>[]>;

  const issue = (over: Partial<import("./store").NewIssue> = {}) => ({
    source: "weekly",
    messageId: `<${Math.random()}@mta>`,
    subject: "Weekend of Nov. 20-22",
    sentAt: new Date("2026-11-20T02:02:43Z"),
    html: "<p>Saturday 11/21 Holiday Swim 10:30am</p>",
    text: "Saturday 11/21 Holiday Swim 10:30am",
    links: [{ text: "More info", url: "https://example-pool.org/x" }],
    ...over,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    store = await import("./store");
    events = await import("@/lib/events/store");
    model = await import("@/lib/events/model");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    await q(
      "truncate newsletter_issues, kid_events, kid_event_edits restart identity",
    );
  });

  it("stores an issue once per source and Message-ID", async () => {
    const a = issue({ messageId: "<same@mta>" });
    expect(await store.saveIssue(a)).toEqual({ saved: true, id: 1 });
    expect(await store.saveIssue({ ...a, subject: "again" })).toEqual({
      saved: false,
      why: "duplicate",
    });
    expect(await store.saveIssue({ ...a, source: "daily" })).toMatchObject({
      saved: true,
    });
    expect(await store.issueCount()).toBe(2);
  });

  it("refuses a third issue from one source within 24 hours, even at once", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => store.saveIssue(issue(), { maxPerDay: 2 })),
    );
    expect(results.filter((r) => r.saved)).toHaveLength(2);
    expect(
      results.filter((r) => !r.saved && r.why === "over_limit"),
    ).toHaveLength(2);
    // Another source has its own allowance; a day later, so does this one.
    expect(
      await store.saveIssue(issue({ source: "daily" }), { maxPerDay: 2 }),
    ).toMatchObject({ saved: true });
    await q(
      "update newsletter_issues set received_at = now() - interval '25 hours'",
    );
    expect(await store.saveIssue(issue(), { maxPerDay: 2 })).toMatchObject({
      saved: true,
    });
  });

  it("never lists a click tracker", async () => {
    const r = await store.saveIssue(
      issue({
        links: [
          { text: "Go", url: "https://link.mail.beehiiv.com/v2/c/SYNTHETIC/x" },
          { text: "Ok", url: "https://example-parks.org/x" },
        ],
      }),
    );
    expect((await store.issueById(r.saved ? r.id : 0))?.links).toEqual([
      { text: "Ok", url: "https://example-parks.org/x" },
    ]);
  });

  it("lists recent issues for the harvest, newest first, never Gmail's row", async () => {
    const now = new Date("2026-11-22T12:00:00Z");
    await store.saveIssue(issue({ sentAt: new Date("2026-11-01T14:00:00Z") }));
    await store.saveIssue(issue());
    await store.saveIssue(
      issue({ source: "daily", sentAt: new Date("2026-11-21T14:00:00Z") }),
    );
    const gmail = await store.saveIssue(
      issue({ source: "gmail-forwarding", text: "Confirmation code: 1" }),
    );
    if (!gmail.saved) throw new Error("not saved");
    const list = await store.recentIssues(14, now);
    expect(list.map((i) => i.source)).toEqual(["daily", "weekly"]);
    expect(list[0]).toMatchObject({
      ref: `issue:${list[0].id}`,
      sent_day: "2026-11-21",
      links: [{ text: "More info", url: "https://example-pool.org/x" }],
    });
    expect(list[1].sent_day).toBe("2026-11-19");
    expect((await store.recentIssues(30, now)).length).toBe(3);
    expect(await store.issueById(gmail.id)).toBe(null);
    expect(await store.issueForEvidence(list[0].id)).toEqual({
      text: "Saturday 11/21 Holiday Swim 10:30am",
      day: "2026-11-21",
    });
  });

  it("counts temporary failures per email, and prunes old counters", async () => {
    await q("delete from alert_log where key like 'inbox:tempfail:%'");
    expect(await store.tempFailCount("e1")).toBe(1);
    expect(await store.tempFailCount("e1")).toBe(2);
    expect(await store.tempFailCount("e2")).toBe(1);
    await q(
      "update alert_log set sent_at = now() - interval '8 days' where key = 'inbox:tempfail:e1'",
    );
    await store.pruneIssues();
    expect(
      (
        await q("select key from alert_log where key like 'inbox:tempfail:%'")
      ).map((r) => r.key),
    ).toEqual(["inbox:tempfail:e2"]);
  });

  it("prunes issues over 120 days old (by when they arrived)", async () => {
    const idOf = (r: import("./store").SaveResult) => (r.saved ? r.id : 0);
    const old = idOf(await store.saveIssue(issue()));
    const fresh = idOf(await store.saveIssue(issue()));
    await q(
      `update newsletter_issues set received_at = now() - interval '121 days' where id = ${old}`,
    );
    await q(
      `update newsletter_issues set received_at = now() - interval '119 days' where id = ${fresh}`,
    );
    expect(await store.pruneIssues()).toBe(1);
    expect(await store.issueById(old)).toBe(null);
    expect(await store.issueById(fresh)).not.toBe(null);
  });

  it("an event on a stored issue is seen at night; once it's pruned, unknown", async () => {
    const r = await store.saveIssue(issue());
    const id = r.saved ? r.id : 0;
    const ORG = "https://www.example-pool.org/events/holiday-swim";
    const ref = `issue:${id}`;
    const quote = "Saturday 11/21 Holiday Swim 10:30am";
    const e: EventInput = {
      title: "Holiday Swim",
      dates: [{ day: "2026-11-21", start: "10:30" }],
      venue: { name: "Example Pool", town: "Bend" },
      what: "Kids splash in the indoor pool with music and holiday lights.",
      url: ORG,
      verified_via: "listing",
      evidence: [{ url: ref, quote }],
    };
    const v: EventVerdict = {
      index: 0,
      title: e.title,
      ok: true,
      problems: [],
      warnings: [],
      slug: model.eventSlug(e),
      key: model.seriesKey(e),
      kind: model.kindOf(e),
      event: {
        ...model.storedFrom(e, null, quote),
        targets: { "2026-11-21": { url: ref, quote } },
      },
    };
    await events.upsertEvents([v], { network: true });
    const asked: string[] = [];
    const walled = async (u: string) => {
      asked.push(u);
      return { status: 403, finalUrl: u, text: "", blocked: "a firewall" };
    };
    const now = new Date("2026-11-20T12:00:00Z");
    await events.recheckEvents(now, walled, { gapMs: 0 });
    expect(asked).toEqual([ORG]); // the issue is read from the store
    expect(
      (
        await q(
          "select confirm, misses, seen_streak, last_seen_at from kid_events",
        )
      )[0],
    ).toMatchObject({ confirm: "ok", misses: 0, seen_streak: 1 });
    // Pruned: unknown (no miss), and still listed.
    await q("delete from newsletter_issues");
    await q("update kid_events set last_seen_at = null, last_check_at = null");
    await events.recheckEvents(now, walled, { gapMs: 0 });
    expect(
      (await q("select confirm, misses, last_seen_at from kid_events"))[0],
    ).toMatchObject({ confirm: "ok", misses: 0, last_seen_at: null });
  });
});
