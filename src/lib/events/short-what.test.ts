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
    ).toBe("Kids splash through an afternoon open swim");
    expect(
      shortWhat(
        "Kids build whatever they dream up with LEGO bricks, Magna-Tiles and other building toys at the library.",
        84,
      ),
    ).toBe("Kids build whatever they dream up");
  });

  it("never leaves a fragment (real summaries, November 2026)", () => {
    const cases: [string, string | null][] = [
      [
        "Kids bring a favorite book, curl up with snacks and read quietly together, sometimes chatting or crafting after.",
        "Kids bring a favorite book",
      ],
      [
        "Families sing along to lively holiday songs and stories in a big, festive stage show at the downtown theater.",
        "Families sing along to lively holiday songs and stories",
      ],
      [
        "Kids getting ready for school practice circle time: sitting together, listening to stories, singing and playing games.",
        "Kids getting ready for school practice circle time",
      ],
      [
        "Kids paint small train-themed pictures that go up in the library's big holiday model train display.",
        "Kids paint small train-themed pictures",
      ],
      [
        "A kid and a grown-up team up at the clay table to shape and decorate ornaments, which get fired in the kiln for gifting.",
        "A kid and a grown-up team up",
      ],
      [
        "Families try 3D printers, sewing machines, button makers and Cricut cutters in a Spanish-language makerspace session.",
        null,
      ],
    ];
    for (const [what, line] of cases) expect(shortWhat(what), what).toBe(line);
    // "...and work it" stops mid-action: no line rather than a fragment.
    expect(
      shortWhat(
        "Kids pick colorful wool and work it with soapy water into a soft felted bowl they carry home the same day.",
      ) ?? "",
    ).not.toMatch(/work it$/);
  });

  it("never returns a rule or a negation, at any length", () => {
    expect(
      shortWhat("No registration needed; families must bring candy.", 84),
    ).toBeNull();
  });
});
