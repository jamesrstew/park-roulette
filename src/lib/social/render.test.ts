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
