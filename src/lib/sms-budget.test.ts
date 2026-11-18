import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { budgetLevel, wideNet } = await import("./sms");
const none = { siteFull: false, networkFull: false, backedUp: false };

describe("texting budget emails", () => {
  it("warns at half and 80% of the day's budget", () => {
    expect(budgetLevel("send", 398, 800, none)).toBeNull();
    expect(budgetLevel("send", 399, 800, none)).toBe(50);
    expect(budgetLevel("send", 639, 800, none)).toBe(80);
  });
  it("says the site budget is used up only when it really is", () => {
    const refused = { limit: "unknown/day", message: "x" };
    expect(budgetLevel(refused, 800, 800, { ...none, siteFull: true })).toBe(
      "hit",
    );
    expect(budgetLevel("silent", 800, 800, { ...none, siteFull: true })).toBe(
      "hit",
    );
  });
  it("treats one busy network as a network cap, not the site's", () => {
    expect(budgetLevel("silent", 30, 800, { ...none, networkFull: true })).toBe(
      "network",
    );
  });
});

describe("network grouping", () => {
  it("groups IPv6 by /48 and leaves IPv4 alone", () => {
    expect(wideNet("2001:db8:1:2::/64")).toBe("2001:db8:1");
    expect(wideNet("203.0.113.9")).toBe("203.0.113.9");
  });
});
