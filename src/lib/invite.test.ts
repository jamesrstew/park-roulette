import { describe, expect, it } from "vitest";
import { inviteCodeFrom } from "@/components/me/PasteInvite";

describe("inviteCodeFrom", () => {
  it("reads full links, bare codes, and trims", () => {
    expect(
      inviteCodeFrom(
        "https://park-roulette.vercel.app/join/wiggly-otter-k7pqm2vx9a",
      ),
    ).toBe("wiggly-otter-k7pqm2vx9a");
    expect(inviteCodeFrom("  Wiggly-Otter-K7PQ  ")).toBe("wiggly-otter-k7pq");
    expect(inviteCodeFrom("Come play! https://x.com/join/abc-def?x=1")).toBe(
      "abc-def",
    );
  });
  it("rejects junk", () => {
    expect(inviteCodeFrom("")).toBeNull();
    expect(inviteCodeFrom("hello there friend")).toBeNull();
    expect(inviteCodeFrom("https://evil.com/../etc")).toBeNull();
  });
});
