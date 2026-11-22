import { describe, expect, it } from "vitest";
import * as roundup from "@/lib/social/roundup";
import pins from "./__fixtures__/short-what-pins.json";
import whats from "./__fixtures__/prod-whats.json";
import { DESC_MAX, firstSentence, shortWhat } from "./short-what";

describe("the shared descriptor module", () => {
  it("is the one the social roundup uses (moved, not forked)", () => {
    expect(roundup.shortWhat).toBe(shortWhat);
    expect(roundup.firstSentence).toBe(firstSentence);
    expect(roundup.DESC_MAX).toBe(DESC_MAX);
  });

  it("the roundup's slide lines are unchanged (outputs as of 890ec22)", () => {
    for (const [what, line] of pins as [string, string | null][])
      expect(shortWhat(what), what).toBe(line);
  });
});

describe("a card's whole first sentence", () => {
  it("is the first sentence, period dropped, or null past 140", () => {
    expect(
      firstSentence(
        "Kids bring a favorite book, curl up with snacks and read quietly together. Snacks provided.",
        140,
      ),
    ).toBe(
      "Kids bring a favorite book, curl up with snacks and read quietly together",
    );
    expect(firstSentence("x".repeat(141) + ".", 140)).toBeNull();
    expect(firstSentence(undefined, 140)).toBeNull();
    expect(firstSentence("   ", 140)).toBeNull();
  });

  it("never splits after an abbreviation, and never ends on one", () => {
    expect(
      firstSentence(
        "Celebrate Dr. Seuss with stories at 10 a.m. Saturday on Mt. Bachelor Drive. More later.",
        140,
      ),
    ).toBe(
      "Celebrate Dr. Seuss with stories at 10 a.m. Saturday on Mt. Bachelor Drive",
    );
    expect(firstSentence("Meet Dr.", 140)).toBeNull();
  });

  it("real summaries: a complete sentence or nothing, never a cut", () => {
    for (const what of whats as string[]) {
      const s = firstSentence(what, 140);
      if (s === null) continue;
      // It's the start of the summary, up to a sentence end (or all of it).
      const rest = what.replace(/\s+/g, " ").trim().slice(s.length);
      expect(rest === "" || /^[.!?](\s|$)/.test(rest), what).toBe(true);
      expect(s.length).toBeLessThanOrEqual(140);
      expect(s).not.toMatch(/…|\.\.\./);
    }
    // Most real summaries fit.
    const fit = (whats as string[]).filter((w) => firstSentence(w, 140));
    expect(fit.length / whats.length).toBeGreaterThan(0.85);
  });
});
