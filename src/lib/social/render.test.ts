import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadPhoto, sha256 } from "./render";

/** loadPhoto with real JPEG bytes (no render mock): the hash pins the photo. */
describe("loadPhoto", () => {
  it("draws the photo only when the bytes hash to what the vision check saw", async () => {
    const bytes = new Uint8Array(
      await sharp({
        create: { width: 40, height: 30, channels: 3, background: "#3aa35b" },
      })
        .jpeg()
        .toBuffer(),
    );
    const src = "https://www.bendparksandrec.org/x.jpg";
    const fetcher = async () => ({ bytes, type: "image/jpeg" });
    const ok = await loadPhoto(
      { src, sha256: sha256(bytes), credit: null },
      fetcher,
    );
    expect(ok).toMatch(/^data:image\/jpeg;base64,/);
    const swapped = await loadPhoto(
      { src, sha256: "0".repeat(64), credit: null },
      fetcher,
    );
    expect(swapped).toBeNull();
    const gone = await loadPhoto(
      { src, sha256: sha256(bytes), credit: null },
      async () => null,
    );
    expect(gone).toBeNull();
    const junk = new Uint8Array([1, 2, 3]);
    expect(
      await loadPhoto(
        { src, sha256: sha256(junk), credit: null },
        async () => ({ bytes: junk, type: "image/jpeg" }),
      ),
    ).toBeNull();
    expect(await loadPhoto(null)).toBeNull();
  });
});

/** A post queued before payoffs existed still renders (the preview route). */
describe("an old-shape at home slide (no payoff)", () => {
  it("draws without the payoff box, and its alt text says nothing about one", async () => {
    const { slidePng } = await import("./render");
    const { slideAlt } = await import("./compose");
    const old = {
      t: "idea" as const,
      n: 1,
      of: 3,
      icon: "home" as const,
      title: "Hand turkeys",
      ages: "Ages 2 to 6",
      need: "paper, crayons",
      steps: ["Trace a hand on paper.", "Color each finger as a feather."],
      safety: null,
    };
    const png = await slidePng([old], 0, null);
    expect(png.length).toBeGreaterThan(1000);
    expect(slideAlt(old)).not.toMatch(/undefined|best part/i);
  });
});

/** Every cover label code writes fits its row, and the worst case draws. */
describe("the cover's label and date chip", () => {
  it("fit beside the icon, on one line or two, for every label code writes", async () => {
    const { coverFit, coverLabelWidth } =
      await import("@/components/social/fit");
    const { breakName } = await import("./compose");
    const { CATALOG } = await import("@/lib/news/catalog");
    const { COPY } = await import("./model");
    const labels = [
      COPY.coverWeekendEvents,
      COPY.coverWeekend,
      COPY.coverWeek,
      COPY.coverNextWeek,
      COPY.coverWeekendAndBeyond,
      COPY.coverWeekAndBeyond,
      COPY.coverPlaces,
      COPY.atHomeKicker,
      ...CATALOG.breaks.map((b) => breakName(b)),
    ];
    const worstChip = "Oct 30 to Nov 1";
    for (const k of labels) {
      const f = coverFit(k, worstChip, coverLabelWidth(false));
      expect(f.fits, k).toBe(true);
      expect(f.label, k).toBeGreaterThanOrEqual(44);
    }
    for (const k of [
      COPY.mashupKicker,
      COPY.mashupWet,
      COPY.mashupSnow,
      COPY.mashupCold,
    ]) {
      const f = coverFit(k, worstChip, coverLabelWidth(true));
      expect(f.fits, k).toBe(true);
      expect(f.lines, k).toHaveLength(1);
    }
  });

  it("draws the worst case, feed and Story: two-line label, chip, 8 words, sub lines", async () => {
    const { slidePng } = await import("./render");
    const s = {
      t: "headline" as const,
      words: "Helicopter Santa, glowing parades, cocoa and twinkling stars",
      highlight: "glowing",
      kicker: "Jefferson County: November break",
      date: "Oct 30 to Nov 1",
      span: { from: "2026-10-30", to: "2026-11-01" },
      swipe: true,
      sub: ["Central Oregon"],
    };
    for (const frame of ["feed", "story"] as const) {
      const png = await slidePng([s, s], 0, null, frame);
      expect(png.length).toBeGreaterThan(1000);
    }
  });
});
