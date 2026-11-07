import { describe, expect, it } from "vitest";
import { averageTenths, formatStars, toTenths } from "./rating";
import { milesBetween } from "./geo";

describe("ratings", () => {
  it("rounds to the tenth and clamps", () => {
    expect(toTenths(4.34)).toBe(43);
    expect(toTenths(4.35)).toBe(44);
    expect(toTenths(7)).toBe(50);
    expect(toTenths(-1)).toBe(0);
    expect(formatStars(43)).toBe("4.3");
    expect(formatStars(50)).toBe("5.0");
  });
  it("averages in tenths", () => {
    expect(averageTenths([]))!.toBeNull();
    expect(averageTenths([43, 48])).toBe(46);
  });
});

describe("geo", () => {
  it("Bend to Redmond is about 15 miles", () => {
    const d = milesBetween(
      { lat: 44.0582, lng: -121.3153 },
      { lat: 44.2726, lng: -121.1739 },
    );
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(18);
  });
});
