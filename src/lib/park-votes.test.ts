import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));

const { validVote, winner } = await import("./park-votes");
const tally = (o: Record<string, number>) => new Map(Object.entries(o));

describe("park fixes need two families", () => {
  it("one family isn't enough", () => {
    expect(winner("status", "active", tally({ closed: 1 }))).toBeNull();
  });
  it("two families agreeing change it", () => {
    expect(winner("status", "active", tally({ closed: 2 }))).toBe("closed");
  });
  it("families who say it's still the same can hold it", () => {
    expect(
      winner("feature:swings", "yes", tally({ no: 2, yes: 2 })),
    ).toBeNull();
    expect(winner("feature:swings", "yes", tally({ no: 3, yes: 2 }))).toBe(
      "no",
    );
  });
  it("a family-added park needs one other family to confirm it", () => {
    expect(winner("exists", "pending", tally({ yes: 1 }))).toBe("yes");
    expect(winner("exists", "yes", tally({ yes: 3 }))).toBeNull();
  });
  it("only knows real topics and values", () => {
    expect(validVote("feature:swings", "yes")).toBe(true);
    expect(validVote("feature:rocket_ship", "yes")).toBe(false);
    expect(validVote("status", "no_playground")).toBe(false);
    expect(validVote("play", "nature")).toBe(true);
    expect(validVote("owner", "me")).toBe(false);
  });
});
