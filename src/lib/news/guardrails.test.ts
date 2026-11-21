import { describe, expect, it } from "vitest";
import { EventEvidence, EventInput } from "@/lib/events/model";
import {
  COPY_LIMIT,
  MAX_DAYS_AHEAD,
  MAX_ONE_OFF_QUOTES,
  MAX_SERIES_DATES,
  NOT_EVENT_DOMAINS,
} from "@/lib/events/validate";
import { CATALOG } from "./catalog";
import { Evidence, OutingEvidence } from "./issue";
import { POLITICS, PROFANITY } from "./safety";
import {
  BANNED_PHRASES,
  blockedLink,
  BLOCKED_DOMAINS,
  DOOM_WORDS,
  LIMITS,
  shortQuoteOk,
  styleProblems,
} from "./validate";

/**
 * Rules only tighten (self-improve spec section 6). These pins are the
 * floor for the writer's compliance rules: quote lengths, evidence counts,
 * the competitor lists, the safety wordlists and the event allowlist's
 * exclusions. A change that lowers or removes one fails here, on every
 * branch, in CI. Only James moves a pin, in a reviewed change. (The Sunday
 * maintainer is report-only and edits nothing; decisions, item 12.)
 */

const minOf = (s: { minLength?: number | null }) => s.minLength ?? 0;

describe("guardrails: quotes and evidence", () => {
  it("keeps quote minimums", () => {
    expect(minOf(Evidence.shape.quote)).toBeGreaterThanOrEqual(20);
    expect(minOf(EventEvidence.shape.quote)).toBeGreaterThanOrEqual(8);
    expect(minOf(OutingEvidence.shape.quote)).toBeGreaterThanOrEqual(8);
    // Short outing quotes pass only with a price or "free" and a date or time.
    expect(shortQuoteOk("Dec. 6, noon", "2026-12-06")).toBe(false);
    expect(shortQuoteOk("Free · Dec 6", "2026-12-06")).toBe(true);
    expect(shortQuoteOk("Free fun", "2026-12-06")).toBe(false);
  });

  it("keeps evidence counts", () => {
    const ev = EventInput.shape.evidence;
    const q = { url: "https://example.org/a", quote: "Saturday, Dec 5, 10 am" };
    // 1 to 30 (a series: one quote per date, events-spec batch 6); only the
    // count fails. A one-off stays at 8 (the validator's MAX_ONE_OFF_QUOTES).
    expect(ev.safeParse([q]).success).toBe(true);
    expect(ev.safeParse(Array(30).fill(q)).success).toBe(true);
    for (const n of [0, 31]) {
      const r = ev.safeParse(Array(n).fill(q));
      expect(r.success, String(n)).toBe(false);
      expect(
        r.error?.issues.map((i) => i.code),
        String(n),
      ).toEqual([n ? "too_big" : "too_small"]);
    }
    expect(MAX_ONE_OFF_QUOTES).toBeLessThanOrEqual(8);
    expect(MAX_SERIES_DATES).toBeLessThanOrEqual(30);
  });

  it("keeps the copy and date limits", () => {
    expect(COPY_LIMIT.primary).toBeLessThanOrEqual(0.5);
    expect(COPY_LIMIT.discovery).toBeLessThanOrEqual(0.4);
    expect(MAX_DAYS_AHEAD).toBeLessThanOrEqual(60);
    expect(LIMITS.issueSimilarity).toBeLessThanOrEqual(0.3);
    expect(LIMITS.sectionSimilarity).toBeLessThanOrEqual(0.5);
    expect(LIMITS.exclamations).toBeLessThanOrEqual(1);
  });
});

describe("guardrails: competitors", () => {
  const PINNED = [
    "bendbuzz.com",
    "thebendbuzz.com",
    "bendfamilyloop.com",
    "beehiiv.com",
    "substack.com",
    "campaign-archive.com",
    "list-manage.com",
    "mailchi.mp",
    "buttondown.email",
    "buttondown.com",
  ];
  it("keeps every competitor domain blocked, subdomains too", () => {
    for (const d of PINNED) {
      expect(BLOCKED_DOMAINS, d).toContain(d);
      expect(blockedLink(`https://news.${d}/p/1`), d).toBe(true);
    }
  });
  it("keeps competitor names out of the copy", () => {
    for (const t of [
      "Found via Bend Family Loop.",
      "As The Bend Buzz said.",
      "Seen on BendBuzz.",
      "From bend-family-loop.",
    ])
      expect(styleProblems(t), t).toContain(
        "Names another newsletter. Credit the primary source instead.",
      );
    expect(styleProblems("Found at the library.")).toEqual([]);
  });
  it("never puts a competitor or a listings site on the link allowlist", () => {
    for (const d of CATALOG.link_domains)
      expect(blockedLink(`https://${d}/`), d).toBe(false);
    for (const d of [
      "visitbend.com",
      "visitcentraloregon.com",
      "bendbuzz.com",
      "bendfamilyloop.com",
      "bendfamilyloop.beehiiv.com",
    ]) {
      expect(CATALOG.lead_domains, d).toContain(d);
      expect(CATALOG.link_domains, d).not.toContain(d);
    }
    for (const d of CATALOG.lead_domains)
      expect(CATALOG.link_domains, d).not.toContain(d);
  });
  it("keeps our own site, roads and weather off event pages", () => {
    for (const d of ["parkroulette.quest", "tripcheck.com", "weather.gov"])
      expect(NOT_EVENT_DOMAINS, d).toContain(d);
  });
});

describe("guardrails: safety wordlists", () => {
  it("never shortens the banned phrases or doom words", () => {
    expect(BANNED_PHRASES.length).toBeGreaterThanOrEqual(29);
    for (const p of ["hidden gem", "sponsored", "don't miss", "nestled"])
      expect(BANNED_PHRASES, p).toContain(p);
    expect(DOOM_WORDS.length).toBeGreaterThanOrEqual(13);
  });
  it("still catches politics and profanity", () => {
    for (const t of [
      "vote on Tuesday",
      "the election",
      "Trump",
      "abortion",
      "Supreme Court",
    ])
      expect(POLITICS.test(t), t).toBe(true);
    for (const t of ["wtf", "sh!t", "f*ck", "bullshit"])
      expect(PROFANITY.test(t), t).toBe(true);
  });
});
