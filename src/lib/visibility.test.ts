import { describe, expect, it } from "vitest";
import { canSee, canSeeMedia, SHOW_AFTER_MS } from "./visibility";

const NOW = Date.parse("2026-11-13T20:00:00Z");
const old = new Date(NOW - SHOW_AFTER_MS - 1000);
const fresh = new Date(NOW - 60 * 1000);
const review = (visibility: string, extra: object = {}) => ({
  visibility,
  hidden: false,
  crewId: 1,
  createdAt: old,
  ...extra,
});
const us = { crewId: 1 };
const them = { crewId: 2 };

describe("who can see a review", () => {
  it("everyone sees public reviews, even signed out", () => {
    expect(canSee(null, review("public"), NOW)).toBe(true);
    expect(canSee(them, review("public"), NOW)).toBe(true);
  });
  it("members reviews need a signed-in family", () => {
    expect(canSee(null, review("members"), NOW)).toBe(false);
    expect(canSee(them, review("members"), NOW)).toBe(true);
  });
  it("family reviews stay in the family", () => {
    expect(canSee(them, review("family"), NOW)).toBe(false);
    expect(canSee(us, review("family"), NOW)).toBe(true);
  });
  it("another family's review waits an hour; ours shows right away", () => {
    expect(canSee(them, review("public", { createdAt: fresh }), NOW)).toBe(
      false,
    );
    expect(canSee(null, review("public", { createdAt: fresh }), NOW)).toBe(
      false,
    );
    expect(canSee(us, review("family", { createdAt: fresh }), NOW)).toBe(true);
  });
  it("hidden reviews only show to their own family", () => {
    expect(canSee(them, review("public", { hidden: true }), NOW)).toBe(false);
    expect(canSee(us, review("public", { hidden: true }), NOW)).toBe(true);
  });
});

describe("who can see photos and videos", () => {
  it("never shows photos to people who aren't signed in", () => {
    expect(canSeeMedia(null, review("public"), "image", NOW)).toBe(false);
  });
  it("shows photos to signed-in families the review allows", () => {
    expect(canSeeMedia(them, review("public"), "image", NOW)).toBe(true);
    expect(canSeeMedia(them, review("members"), "image", NOW)).toBe(true);
    expect(canSeeMedia(them, review("family"), "image", NOW)).toBe(false);
  });
  it("keeps videos in the family", () => {
    expect(canSeeMedia(them, review("public"), "video", NOW)).toBe(false);
    expect(canSeeMedia(us, review("public"), "video", NOW)).toBe(true);
  });
});
