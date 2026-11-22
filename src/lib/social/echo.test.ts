import { describe, expect, it } from "vitest";
import { echoLine, type SlideSpec } from "./model";

const items = (t: "item" | "idea" | "event", k: number) =>
  Array.from({ length: k }, () => ({ t }) as unknown as SlideSpec);

describe("the Story echo's line", () => {
  it("is written by code per post type, with the slide count, and promises no tap", () => {
    expect(echoLine({ kind: "park_post", slides: [] })).toBe(
      "This week's park pick",
    );
    expect(echoLine({ kind: "events_week", slides: items("event", 8) })).toBe(
      "8 events for kids this week",
    );
    expect(echoLine({ kind: "unpack", slides: items("item", 5) })).toBe(
      "5 things for kids this week",
    );
    expect(echoLine({ kind: "at_home", slides: items("idea", 4) })).toBe(
      "4 ideas for inside",
    );
    expect(echoLine({ kind: "at_home", slides: items("idea", 1) })).toBe(
      "1 idea for inside",
    );
    expect(echoLine({ kind: "teaser", slides: [] })).toBe("Our Weekend Pick");
    for (const kind of [
      "park_post",
      "events_week",
      "unpack",
      "at_home",
      "teaser",
    ] as const)
      expect(echoLine({ kind, slides: items("item", 3) })).not.toMatch(
        /tap|link|swipe|click/i,
      );
  });
});
