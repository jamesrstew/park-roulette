import { describe, expect, it } from "vitest";
import {
  type AskCtx,
  type AskState,
  EMPTY_STATE,
  ignoredCount,
  isThisWeekendsPick,
  parseState,
  pickAsk,
  recordDeclined,
  recordHidden,
  recordOn,
  recordShown,
  recordTapped,
  wetFrom,
} from "./asks";
import { issueDay, successLine } from "./park-news";

// Pacific times (PST, UTC-8), the week of Monday, November 30, 2026.
const MON = new Date("2026-11-30T19:00:00Z"); // Monday 11 am
const TUE = new Date("2026-12-01T19:00:00Z");
const WED = new Date("2026-12-02T19:00:00Z");
const THU_AM = new Date("2026-12-03T18:00:00Z"); // Thursday 10 am
const THU_PM = new Date("2026-12-03T21:00:00Z"); // Thursday 1 pm
const FRI_2 = new Date("2026-12-04T22:00:00Z"); // Friday 2 pm
const FRI_4 = new Date("2026-12-05T00:00:00Z"); // Friday 4 pm
const SAT = new Date("2026-12-05T19:00:00Z");

const old: AskState = { ...EMPTY_STATE, firstSeen: "2026-11-01T00:00:00Z" };
const stamp = (at: string) => ({ key: `v1-${at}`, park: "Larkspur Park", at });

const idle = (over: Partial<AskCtx> = {}): AskCtx => ({
  surface: "idle",
  signedIn: true,
  isKid: false,
  borrowed: false,
  overlayOpen: false,
  lastStamp: stamp("2026-11-29T20:00:00Z"),
  textsAvailable: true,
  account: {
    emailOn: false,
    textsOn: false,
    emailNo: false,
    textNo: false,
    legacyIgnored: false,
  },
  ...over,
});
const wet = { day: "Saturday", kind: "Rain" } as const;
const result = (over: Partial<AskCtx> = {}): AskCtx =>
  idle({
    surface: "result",
    result: { playable: true, wet },
    ...over,
  });

describe("Moment 1: You stamped {Park}!", () => {
  it("shows above the wheel 8 hours after a stamp made on or after launch", () => {
    const a = pickAsk(idle(), old, MON);
    expect(a).toMatchObject({
      moment: "next_pick",
      channels: ["email", "text"],
      park: "Larkspur Park",
    });
    // 7 hours after: too soon.
    expect(
      pickAsk(idle({ lastStamp: stamp("2026-11-30T12:00:00Z") }), old, MON),
    ).toBeNull();
    // A stamp from before launch never triggers it.
    expect(
      pickAsk(idle({ lastStamp: stamp("2026-10-01T20:00:00Z") }), old, MON),
    ).toBeNull();
    // Signed out, or no stamp: no.
    expect(pickAsk(idle({ signedIn: false }), old, MON)).toBeNull();
    expect(pickAsk(idle({ lastStamp: null }), old, MON)).toBeNull();
  });
  it("never shows on a second day for the same stamp, but does for the next stamp", () => {
    const shown = recordShown(old, pickAsk(idle(), old, MON)!, MON);
    // Same day: keeps showing (one exposure).
    expect(pickAsk(idle(), shown, MON)).not.toBeNull();
    expect(pickAsk(idle(), shown, TUE)).toBeNull();
    const next = idle({ lastStamp: stamp("2026-12-01T01:00:00Z") });
    expect(pickAsk(next, shown, WED)?.moment).toBe("next_pick");
  });
  it("offers only the channels still open, and hides By text without texts", () => {
    expect(
      pickAsk(idle({ textsAvailable: false }), old, MON)?.channels,
    ).toEqual(["email"]);
    const acct = { ...idle().account!, emailOn: true };
    expect(pickAsk(idle({ account: acct }), old, MON)?.channels).toEqual([
      "text",
    ]);
    const both = { ...acct, textNo: true };
    expect(pickAsk(idle({ account: both }), old, MON)).toBeNull();
  });
  it("counts an old onboarding Not now as one ignored showing", () => {
    const acct = { ...idle().account!, legacyIgnored: true };
    const s = recordShown(
      old,
      pickAsk(idle({ account: acct }), old, MON)!,
      MON,
    );
    const later = idle({
      account: acct,
      lastStamp: stamp("2026-12-01T01:00:00Z"),
    });
    // One ignore plus the legacy one: retired.
    expect(pickAsk(later, s, WED)).toBeNull();
  });
});

describe("Moments 2 and 3: under a spin result", () => {
  it("asks for email Monday to Wednesday when the weekend is wet", () => {
    for (const t of [MON, TUE, WED])
      expect(pickAsk(result(), old, t)).toMatchObject({
        moment: "rainy_spin",
        wet,
      });
    expect(
      pickAsk(result({ result: { playable: true, wet: null } }), old, MON),
    ).toBeNull();
    // Thursday morning: the first email would be next week's.
    expect(pickAsk(result(), old, THU_AM)).toBeNull();
    // Works signed out.
    expect(
      pickAsk(result({ signedIn: false, account: undefined }), old, MON)
        ?.moment,
    ).toBe("rainy_spin");
  });
  it("asks for the text Thursday noon to Friday 3 pm, only when texts are on", () => {
    expect(pickAsk(result(), old, THU_PM)?.moment).toBe("weekend_spin");
    expect(pickAsk(result(), old, FRI_2)?.moment).toBe("weekend_spin");
    expect(pickAsk(result(), old, THU_AM)).toBeNull();
    expect(pickAsk(result(), old, FRI_4)).toBeNull();
    expect(pickAsk(result(), old, SAT)).toBeNull();
    // No fallback to email when texts aren't sending.
    expect(pickAsk(result({ textsAvailable: false }), old, THU_PM)).toBeNull();
  });
  it("never under a closed or unplayable result", () => {
    expect(
      pickAsk(result({ result: { playable: false, wet } }), old, MON),
    ).toBeNull();
  });
});

describe("the shared budget", () => {
  it("never for kids, borrowed links, a first session, an open overlay, or right after a stamp", () => {
    expect(pickAsk(result({ isKid: true }), old, MON)).toBeNull();
    expect(pickAsk(result({ borrowed: true }), old, MON)).toBeNull();
    expect(pickAsk(result({ overlayOpen: true }), old, MON)).toBeNull();
    expect(pickAsk(result(), EMPTY_STATE, MON)).toBeNull();
    expect(
      pickAsk(result(), { ...old, firstSeen: "2026-11-30T18:30:00Z" }, MON),
    ).toBeNull();
    expect(
      pickAsk(result({ lastStamp: stamp("2026-11-30T18:55:00Z") }), old, MON),
    ).toBeNull();
  });
  it("allows 1 a day, 2 a week and 6 ever", () => {
    // Monday's next_pick takes the day: no rainy_spin Monday.
    let s = recordShown(old, pickAsk(idle(), old, MON)!, MON);
    s = recordTapped(s, "next_pick", MON);
    expect(pickAsk(result(), s, MON)).toBeNull();
    // Tuesday: the second of the week.
    expect(pickAsk(result(), s, TUE)?.moment).toBe("rainy_spin");
    s = recordTapped(
      recordShown(s, pickAsk(result(), s, TUE)!, TUE),
      "rainy_spin",
      TUE,
    );
    // Wednesday: the week's 2 are used.
    expect(pickAsk(result(), s, WED)).toBeNull();
    // Six ever.
    const six: AskState = {
      ...old,
      exposures: Array.from({ length: 6 }, (_, i) => ({
        m: "rainy_spin" as const,
        d: `2026-0${i + 1}-01`,
        tapped: true,
      })),
    };
    expect(pickAsk(result(), six, MON)).toBeNull();
  });
  it("retires a moment ignored twice; × counts as ignored", () => {
    let s = recordShown(old, pickAsk(result(), old, MON)!, MON);
    s = recordHidden(s, "rainy_spin", MON);
    expect(pickAsk(result(), s, MON)).toBeNull(); // hidden for today
    expect(ignoredCount(s, "rainy_spin", "2026-11-30")).toBe(1);
    // Next week, shown and left alone.
    const nextMon = new Date("2026-12-07T19:00:00Z");
    s = recordShown(s, pickAsk(result(), s, nextMon)!, nextMon);
    const third = new Date("2026-12-14T19:00:00Z");
    expect(pickAsk(result(), s, third)).toBeNull();
  });
  it("No thanks retires that channel; a signup here does too", () => {
    expect(pickAsk(result(), recordDeclined(old, ["email"]), MON)).toBeNull();
    expect(pickAsk(result(), recordOn(old, "email"), MON)).toBeNull();
    expect(pickAsk(result(), recordOn(old, "email"), THU_PM)?.moment).toBe(
      "weekend_spin",
    );
    const acct = { ...idle().account!, textNo: true };
    expect(pickAsk(result({ account: acct }), old, THU_PM)).toBeNull();
  });
});

describe("helpers", () => {
  it("reads only sane state from storage", () => {
    expect(parseState("not json")).toEqual(EMPTY_STATE);
    expect(
      parseState(
        JSON.stringify({
          exposures: [
            { m: "x", d: "1" },
            { m: "rainy_spin", d: "2026-01-01" },
          ],
          no: { email: true },
        }),
      ),
    ).toMatchObject({ exposures: [{ m: "rainy_spin" }], no: { email: true } });
  });
  it("names the weekend's wet day, at a 40% chance or more (L2)", () => {
    expect(
      wetFrom([
        { day: "Saturday", w: { wet: false, line: "sunny" }, pop: 0 },
        {
          day: "Sunday",
          w: { wet: true, line: "Sunday in Bend: high 30°, snow likely" },
          pop: 70,
        },
      ]),
    ).toEqual({ day: "Sunday", kind: "Snow" });
    expect(
      wetFrom([
        { day: "Saturday", w: { wet: true, line: "rain showers" }, pop: 40 },
      ]),
    ).toEqual({ day: "Saturday", kind: "Rain" });
    // A slight chance isn't a rainy weekend.
    expect(
      wetFrom([
        {
          day: "Saturday",
          w: { wet: true, line: "slight chance rain showers" },
          pop: 20,
        },
      ]),
    ).toBeNull();
    expect(
      wetFrom([{ day: "Saturday", w: { wet: true, line: "rain" }, pop: null }]),
    ).toBeNull();
    expect(wetFrom([{ day: "Saturday", w: null }])).toBeNull();
  });
});

describe("Moment 4: This weekend's pick (a label)", () => {
  it("shows Thursday to Sunday of the issue's week only", () => {
    const d = "2026-12-03";
    expect(isThisWeekendsPick(d, new Date("2026-12-02T19:00:00Z"))).toBe(false);
    expect(isThisWeekendsPick(d, new Date("2026-12-03T16:00:00Z"))).toBe(true);
    expect(isThisWeekendsPick(d, new Date("2026-12-07T06:00:00Z"))).toBe(true); // Sun 10 pm
    expect(isThisWeekendsPick(d, new Date("2026-12-07T19:00:00Z"))).toBe(false); // Mon
    expect(isThisWeekendsPick(null, new Date("2026-12-03T16:00:00Z"))).toBe(
      false,
    );
  });
});

describe("the success line", () => {
  it("names the first issue's real date", () => {
    expect(issueDay("2026-12-03")).toBe("Thursday, December 3");
    expect(successLine("Thursday, December 3")).toBe(
      "You're in! Look for us Thursday, December 3.",
    );
    expect(successLine(null)).toBe("You're in! Look for us Thursday morning.");
  });
});
