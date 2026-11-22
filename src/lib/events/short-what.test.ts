import { describe, expect, it } from "vitest";
import * as roundup from "@/lib/social/roundup";
import { DESC_MAX, firstSentence, shortWhat } from "./short-what";

describe("the shared descriptor trimmer", () => {
  it("is the one the social roundup uses (moved, not forked)", () => {
    expect(roundup.shortWhat).toBe(shortWhat);
    expect(roundup.firstSentence).toBe(firstSentence);
    expect(roundup.DESC_MAX).toBe(DESC_MAX);
  });

  it("keeps the slide's 70 by default and allows a longer card line", () => {
    const what =
      "Little ones paint, color, glue and snip their way through a simple craft while working on shapes.";
    // At 70 there's no cut that doesn't break the list: no line.
    expect(shortWhat(what)).toBeNull();
    expect(shortWhat(what, 84)).toBe(
      "Little ones paint, color, glue and snip their way through a simple craft",
    );
  });

  it("never stops halfway through a list", () => {
    expect(
      shortWhat(
        "Kids splash through an afternoon open swim with the slide, rope swing, diving boards and lazy river while school is out.",
        84,
      ),
    ).toBe("Kids splash through an afternoon open swim with the slide");
    expect(
      shortWhat(
        "Kids build whatever they dream up with LEGO bricks, Magna-Tiles and other building toys at the library.",
        84,
      ),
    ).toBe("Kids build whatever they dream up with LEGO bricks");
  });

  it("never returns a rule or a negation, at any length", () => {
    expect(
      shortWhat("No registration needed; families must bring candy.", 84),
    ).toBeNull();
  });
});
