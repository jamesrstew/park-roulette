import { describe, expect, it } from "vitest";
import { isIconName } from "@/components/icons";
import { ATTRIBUTES, SMART_FILTERS } from "./features";
import { SMART_FILTER_ICONS } from "@/components/icons";

describe("crayon icons", () => {
  it("draws every attribute (keys double as icon names)", () => {
    expect(Object.keys(ATTRIBUTES).filter((k) => !isIconName(k))).toEqual([]);
  });
  it("draws every smart filter", () => {
    for (const f of SMART_FILTERS)
      expect(f.key in SMART_FILTER_ICONS).toBe(true);
  });
});
