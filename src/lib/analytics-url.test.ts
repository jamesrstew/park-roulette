import { describe, expect, it } from "vitest";
import { analyticsUrl } from "./analytics-url";

describe("what analytics sees", () => {
  it("never sees a family's invite code", () => {
    expect(analyticsUrl("https://parkroulette.quest/join/ab12cd34ef")).toBe(
      "https://parkroulette.quest/join/[code]",
    );
    expect(analyticsUrl("https://parkroulette.quest/join/ab12cd34ef?x=1")).toBe(
      "https://parkroulette.quest/join/[code]",
    );
  });
  it("catches codes in any letter case or position", () => {
    expect(analyticsUrl("https://parkroulette.quest/Join/Secret123")).toBe(
      "https://parkroulette.quest/join/[code]",
    );
    expect(analyticsUrl("https://parkroulette.quest/x/JOIN/abc/more")).toBe(
      "https://parkroulette.quest/x/join/[code]/more",
    );
  });
  it("drops query strings and fragments", () => {
    expect(
      analyticsUrl("https://parkroulette.quest/me?next=%2Fparks%2Fx#signin"),
    ).toBe("https://parkroulette.quest/me");
  });
  it("keeps ordinary pages as they are", () => {
    expect(
      analyticsUrl("https://parkroulette.quest/parks/drake-park-bend"),
    ).toBe("https://parkroulette.quest/parks/drake-park-bend");
  });
  it("never sees a newsletter token (confirm and unsubscribe links)", () => {
    const t = "4I9Irlu-KS_8HO97W87ktI7c4Yl0lFmASeWnY9avQ4I";
    for (const page of [
      "news/confirm",
      "news/unsubscribe",
      "api/news/unsubscribe",
    ])
      expect(analyticsUrl(`https://parkroulette.quest/${page}?t=${t}`)).toBe(
        `https://parkroulette.quest/${page}`,
      );
    expect(
      analyticsUrl(`https://parkroulette.quest/news/confirm?r=confirmed`),
    ).not.toContain("?");
  });
});
