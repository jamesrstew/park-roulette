import { describe, expect, it } from "vitest";
import {
  type Candidate,
  fingerprintOf,
  type LessonLike,
  lessonSimilarity,
  lessonTokens,
  matchLesson,
  MERGE_AT,
  patchProblem,
  personalDetails,
  prRef,
  RetroSchema,
  retroCandidates,
  ruleChangeCompliance,
  summaryProblem,
  touchesCompliance,
  withExamples,
} from "./lessons";

const NOW = new Date("2026-11-22T20:00:00Z");

const retro = (over: Record<string, unknown> = {}) =>
  RetroSchema.parse({
    run: { kind: "writer", issue_date: "2026-11-26" },
    ...over,
  });

const problem = (title: string, detail: string, category = "validator") => ({
  category,
  title,
  detail,
});

const lesson = (id: number, c: Candidate, status = "open"): LessonLike => ({
  id,
  category: c.category,
  title: c.title,
  detail: c.detail,
  host: c.host,
  fingerprint: c.fingerprint,
  status,
});

describe("normalizing", () => {
  it("replaces URLs by host and strips dates, times and digits", () => {
    const a = lessonTokens(
      "The quote on https://www.oldmilldistrict.com/events/123 failed on 2026-11-19 at 6:23 pm, Thursday Nov 19",
    );
    const b = lessonTokens(
      "the quotes on https://oldmilldistrict.com/x failed on 2026-12-03 at 10 am, Friday Dec 4",
    );
    expect(a).toEqual(b);
    expect(a).toContain("oldmilldistrict_com");
    expect(a.join(" ")).not.toMatch(/\d/);
  });

  it("gives the same fingerprint to the same problem on another day", () => {
    expect(
      fingerprintOf(
        "source",
        null,
        "Visit Bend shows a bot check on 2026-11-19",
      ),
    ).toBe(
      fingerprintOf(
        "source",
        null,
        "visit bend shows a bot check on 2026-12-03",
      ),
    );
    expect(fingerprintOf("source", "a.com", "x y")).not.toBe(
      fingerprintOf("data", "a.com", "x y"),
    );
  });
});

describe("matching", () => {
  const [base] = retroCandidates(
    retro({
      problems: [
        problem(
          "Draft accepted after the send window started",
          "The drafts endpoint stored a draft for today at 6:23 pm, after the 7:00 send window, and reported success.",
        ),
      ],
    }),
    NOW,
  );

  it("merges a reworded repeat at 0.55 or more", () => {
    const [again] = retroCandidates(
      retro({
        problems: [
          problem(
            "Draft accepted after send window started",
            "The drafts endpoint stored a draft for today at 7:40 pm, after the 7:00 send window, and reported success again.",
          ),
        ],
      }),
      NOW,
    );
    expect(lessonSimilarity(again, base)).toBeGreaterThanOrEqual(MERGE_AT);
    const m = matchLesson(again, [lesson(1, base)]);
    expect(m).toMatchObject({ kind: "merge", reopen: false });
  });

  it("keeps an unrelated problem apart, and never merges across categories without a host", () => {
    const [other] = retroCandidates(
      retro({
        problems: [
          problem(
            "Instagram list was empty",
            "The plan offered no Instagram candidates and there was no way to tell why the list was empty.",
          ),
        ],
      }),
      NOW,
    );
    expect(matchLesson(other, [lesson(1, base)]).kind).toBe("new");
    const sameWords = { ...base, category: "idea" as const, fingerprint: "x" };
    expect(matchLesson(sameWords, [lesson(1, base)]).kind).toBe("new");
  });

  it("keys blocked hosts on host and kind, and reopens a fixed lesson as regressed", () => {
    const r = (kind: string) =>
      retroCandidates(
        retro({
          blocked_hosts: [
            {
              host: "www.visitbend.com",
              kind,
              status: 307,
              url: "https://www.visitbend.com/e/1",
            },
          ],
        }),
        NOW,
      )[0];
    const a = r("bot_check");
    expect(a).toMatchObject({ category: "source", host: "visitbend.com" });
    expect(a.fingerprint).toBe("source:visitbend.com:blocked:bot_check");
    expect(r("reset").fingerprint).not.toBe(a.fingerprint);
    const m = matchLesson(r("bot_check"), [lesson(7, a, "fixed")]);
    expect(m).toMatchObject({ kind: "merge", reopen: true });
    // wontfix: counted, not reopened.
    expect(matchLesson(a, [lesson(7, a, "wontfix")])).toMatchObject({
      kind: "merge",
      reopen: false,
    });
  });

  it("a sighting by lesson id merges into that lesson", () => {
    const [c] = retroCandidates(
      retro({
        problems: [
          {
            ...problem(
              "Same trap as before",
              "The draft was refused again for the very same reason as last week.",
            ),
            lesson_id: 42,
          },
        ],
      }),
      NOW,
    );
    expect(matchLesson(c, [{ ...lesson(42, base) }])).toMatchObject({
      kind: "merge",
      lesson: { id: 42 },
    });
  });

  it("turns rule changes into rule_conflict lessons", () => {
    const [c] = retroCandidates(
      retro({
        rule_changes: [
          {
            target: "command",
            section: "Section 1, the date",
            current: "Draft for DATE.",
            proposed: "Draft only for next_issue_date.",
            why: "Run 1 drafted for a Thursday whose window had passed.",
          },
        ],
      }),
      NOW,
    );
    expect(c.category).toBe("rule_conflict");
    expect(c.title).toBe("command: Section 1, the date");
  });

  it("keeps the last 10 examples", () => {
    const ex = Array.from({ length: 12 }, (_, i) => ({
      message: `m${i}`,
      at: "t",
    }));
    expect(withExamples(ex.slice(0, 8), ex.slice(8))).toHaveLength(10);
    expect(withExamples(ex.slice(0, 8), ex.slice(8)).at(-1)?.message).toBe(
      "m11",
    );
  });
});

describe("the retro's shape", () => {
  it("refuses unknown keys, long titles and too many problems", () => {
    expect(
      RetroSchema.safeParse({ run: { kind: "writer" }, extra: 1 }).success,
    ).toBe(false);
    expect(
      RetroSchema.safeParse({
        run: { kind: "writer" },
        problems: [problem("x".repeat(121), "y".repeat(30))],
      }).success,
    ).toBe(false);
    expect(
      RetroSchema.safeParse({
        run: { kind: "writer" },
        problems: Array.from({ length: 21 }, () =>
          problem("A real title", "y".repeat(30)),
        ),
      }).success,
    ).toBe(false);
    expect(RetroSchema.safeParse({ run: { kind: "events" } }).success).toBe(
      true,
    );
  });
});

describe("compliance (set by code, never the writer)", () => {
  it("flags competitors, consent, evidence rules, safety lists and legal pages", () => {
    for (const t of [
      "Link the Bend Family Loop post instead",
      "bendbuzz.com has the full calendar",
      "Pre-check the texts opt-in box",
      "Lower the quote minimum to 6 characters",
      "Allow outings without evidence quotes",
      "Shorten the safety wordlist",
      "Update the Privacy policy wording",
      "Edit /terms copy",
    ])
      expect(touchesCompliance(t), t).toBe(true);
    for (const t of [
      "oldmilldistrict.com resets the connection",
      "The plan comment says 8 days, the code says 7",
      "Instagram list empty with no reason",
    ])
      expect(touchesCompliance(t), t).toBe(false);
  });

  it("catches the review's five misses (M2)", () => {
    // Competitor names without a TLD.
    expect(
      touchesCompliance("Pull the dates from bendfamilyloop each week"),
    ).toBe(true);
    expect(
      touchesCompliance("The beehiiv archive lists more story times"),
    ).toBe(true);
    // Getting past a bot check is never a fix.
    expect(
      touchesCompliance(
        "Send a browser user-agent so visitbend's challenge lets us in",
      ),
    ).toBe(true);
    expect(
      touchesCompliance("Add Accept headers to get past the Sucuri wall"),
    ).toBe(true);
    // A rule change at the validator or this file that names a limit or domains.
    expect(
      ruleChangeCompliance({
        target: "validator",
        section: "Outing title",
        current: "80 characters at most.",
        proposed: "120 characters at most.",
        why: "Long show names were cut.",
      }),
    ).toBe(true);
    expect(
      ruleChangeCompliance({
        target: "command",
        section: "3. events",
        current: "Link the organizer.",
        proposed: "Add oldmilldistrict.com back to the domains list.",
        why: "Its events were cut.",
      }),
    ).toBe(true);
    // A plan wording change with no limit is still the maintainer's.
    expect(
      ruleChangeCompliance({
        target: "plan",
        section: "next_issue_date comment",
        current: "over 8 days out",
        proposed: "over 7 days out",
        why: "The code uses 7.",
      }),
    ).toBe(false);
  });

  it("lets automation move a compliance lesson only to needs_james", () => {
    const c = { compliance: true };
    expect(patchProblem(c, { status: "fixed" })).toMatch(/compliance/);
    expect(
      patchProblem(c, { status: "wontfix", note: "Working as intended." }),
    ).toMatch(/compliance/);
    expect(patchProblem(c, { status: "open" })).toMatch(/compliance/);
    expect(
      patchProblem(c, { status: "needs_james", note: "James decides." }),
    ).toBeNull();
  });
});

describe("status changes (report-only maintainer)", () => {
  const pr = "https://github.com/jamesrstew/park-roulette/pull/12";
  const l = { compliance: false };
  it("needs a note for every triage, and a real fix plan for fix_proposed", () => {
    expect(patchProblem(l, { status: "needs_james" })).toMatch(/note/);
    expect(patchProblem(l, { status: "wontfix" })).toMatch(/note/);
    expect(
      patchProblem(l, { status: "fix_proposed", note: "Fix it." }),
    ).toMatch(/fix plan/);
    expect(
      patchProblem(l, {
        status: "fix_proposed",
        note: "Map ECONNRESET in fetcher.ts to a named reason; test in fetcher.test.ts.",
      }),
    ).toBeNull();
  });
  it("takes fixed only as an explicit call, and pr_url only on this repo", () => {
    expect(patchProblem(l, { status: "fixed" })).toBeNull();
    expect(patchProblem(l, { status: "fixed", pr_url: pr })).toBeNull();
    expect(
      patchProblem(l, {
        status: "fixed",
        pr_url: "https://github.com/someone/else/pull/1",
      }),
    ).toMatch(/this repository/);
    expect(patchProblem(l, { status: "fixed", pr_url: "not a url" })).toMatch(
      /this repository/,
    );
  });
  it("reads PR links strictly", () => {
    expect(prRef(pr)).toEqual({
      owner: "jamesrstew",
      repo: "park-roulette",
      number: 12,
    });
    expect(prRef(`${pr}/files`)).toBeNull();
    expect(
      prRef("http://github.com/jamesrstew/park-roulette/pull/1"),
    ).toBeNull();
  });
});

describe("the summary email and retros: no personal details", () => {
  it("refuses addresses and phone numbers, with or without separators", () => {
    expect(summaryProblem("A reader at mom@example.com wrote in.")).toMatch(
      /email/,
    );
    expect(summaryProblem("Call 541-555-0100 about it.")).toMatch(/phone/);
    expect(summaryProblem("Call (541) 555 0100.")).toMatch(/phone/);
    expect(summaryProblem("Text 5415550100 back.")).toMatch(/phone/);
    expect(summaryProblem("Or +15415550100.")).toMatch(/phone/);
    expect(personalDetails('{"url":"https://x.org/e/2026-11-21"}')).toBeNull();
    expect(
      summaryProblem(
        "Last 4 sends: 312 clicks, 3 unsubscribes, 0 bounces. Opens aren't tracked.",
      ),
    ).toBeNull();
  });
  it("allows links to this repository only", () => {
    expect(
      summaryProblem(
        "Plan: see https://github.com/jamesrstew/park-roulette/blob/main/x.ts.",
      ),
    ).toBeNull();
    expect(summaryProblem("See https://evil.example/x")).toMatch(/Only links/);
    expect(summaryProblem("See https://github.com/other/repo/pull/1")).toMatch(
      /Only links/,
    );
  });
});

describe("de-duplication details (M3, low)", () => {
  it("doesn't merge two short titles that share a word or two", () => {
    const a = {
      title: "Quote too short",
      detail: "The outing listing printed only a price and a date.",
    };
    const b = {
      title: "Quote not on page",
      detail:
        "The library changed its calendar page overnight so the quote vanished.",
    };
    expect(lessonSimilarity(a, b)).toBeLessThan(MERGE_AT);
    // Nearly the same short title merges.
    expect(
      lessonSimilarity(a, {
        title: "Quotes too short",
        detail: "Something else entirely here.",
      }),
    ).toBeGreaterThanOrEqual(0.75);
  });
  it("keeps the problem's own words as an example, and skips 404s as blocked hosts", () => {
    const c = retroCandidates(
      retro({
        problems: [
          problem(
            "Draft accepted late",
            "The draft for today went in after seven.",
          ),
        ],
        blocked_hosts: [
          {
            host: "example.org",
            kind: "http_status",
            status: 404,
            url: "https://example.org/gone",
          },
          {
            host: "example.net",
            kind: "http_status",
            status: 403,
            url: "https://example.net/x",
          },
        ],
      }),
      NOW,
    );
    expect(c[0].examples[0].message).toBe(
      "Draft accepted late: The draft for today went in after seven.",
    );
    expect(c.map((x) => x.host)).toEqual([null, "example.net"]);
  });
  it("refuses a retro with a date that doesn't exist", () => {
    expect(
      RetroSchema.safeParse({
        run: { kind: "writer", issue_date: "2026-02-30" },
      }).success,
    ).toBe(false);
  });
});
