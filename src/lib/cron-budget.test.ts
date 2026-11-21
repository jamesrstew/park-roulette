import { describe, expect, it } from "vitest";
import {
  EVENTS_UNTIL_MS,
  eventsBudget,
  MAX_DURATION_S,
  PROFILE_BUDGET_MS,
} from "./cron-budget";

describe("the events-check run's time", () => {
  it("gives the events what's left after the trait check, never below zero", () => {
    const t0 = 1_000_000;
    expect(eventsBudget(t0, t0)).toBe(EVENTS_UNTIL_MS);
    expect(eventsBudget(t0, t0 + PROFILE_BUDGET_MS)).toBe(
      EVENTS_UNTIL_MS - PROFILE_BUDGET_MS,
    );
    expect(eventsBudget(t0, t0 + 400_000)).toBe(0);
  });
  it("fits a full run, a last 15-second fetch and IndexNow inside maxDuration", () => {
    const lastFetch = 15_000;
    const indexNow = 15_000;
    expect(EVENTS_UNTIL_MS + lastFetch + indexNow).toBeLessThan(
      MAX_DURATION_S * 1000,
    );
    expect(PROFILE_BUDGET_MS + lastFetch).toBeLessThan(EVENTS_UNTIL_MS);
  });
});
