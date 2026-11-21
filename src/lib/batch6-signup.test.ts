import { describe, expect, it } from "vitest";
import {
  FAMILY_MAX,
  familyDefault,
  oneLine,
} from "@/components/me/NameTagField";
import {
  EMPTY_STATE,
  ignoredCount,
  openChannels,
  pickAsk,
  recordPicksIgnored,
} from "./asks";
import type { AskCtx } from "./asks";
import { footerSignup } from "./footer-signup";
import { formatOn, parseOn } from "./on-cookie";
import {
  CONSENT_VERSION,
  EMAIL_CONSENT_TEXT,
  emailConsentVersionFor,
  PARK_NEWS,
  proofCount,
} from "./park-news";

describe("pr_on, what this browser already gets", () => {
  it("reads e, t and et, and nothing else", () => {
    expect(parseOn("e")).toEqual({ email: true, texts: false });
    expect(parseOn("t")).toEqual({ email: false, texts: true });
    expect(parseOn("et")).toEqual({ email: true, texts: true });
    for (const bad of [undefined, null, "", "x", "eee", "e;t", "E"])
      expect(parseOn(bad)).toEqual({ email: false, texts: false });
  });
  it("writes the letters back in one order", () => {
    expect(formatOn({ email: true, texts: true })).toBe("et");
    expect(formatOn({ email: false, texts: true })).toBe("t");
    expect(formatOn({ email: false, texts: false })).toBe("");
  });
});

describe("the smart footer (batch 6 table)", () => {
  const f = (p: Partial<Parameters<typeof footerSignup>[0]>) =>
    footerSignup({
      kid: false,
      emailOn: false,
      textsOn: false,
      tapOK: false,
      phone: null,
      ...p,
    });
  it("shows each state's pieces", () => {
    const no = { manage: false };
    expect(f({ kid: true })).toEqual({ email: false, texts: null, ...no });
    expect(f({})).toEqual({ email: true, texts: "link", ...no });
    expect(f({ tapOK: true })).toEqual({
      email: true,
      texts: "card_rather",
      ...no,
    });
    expect(f({ emailOn: true, tapOK: true })).toEqual({
      email: false,
      texts: "card_too",
      ...no,
    });
    expect(f({ emailOn: true })).toEqual({
      email: false,
      texts: "link_too",
      ...no,
    });
    expect(f({ textsOn: true })).toEqual({ email: true, texts: null, ...no });
    expect(f({ emailOn: true, textsOn: true, tapOK: true })).toEqual({
      email: false,
      texts: null,
      ...no,
    });
  });
  it("remembers a no: a stopped email or a STOP-listed number isn't offered again", () => {
    expect(f({ emailNo: true, tapOK: true })).toMatchObject({
      email: false,
      texts: "card_rather",
    });
    expect(f({ textsNo: true, tapOK: true })).toMatchObject({
      email: true,
      texts: null,
    });
    expect(f({ emailNo: true, textsNo: true })).toMatchObject({
      email: false,
      texts: null,
    });
  });
  it("gives a signed-in subscriber a Manage link", () => {
    expect(f({ signedIn: true, emailOn: true, textsOn: true }).manage).toBe(
      true,
    );
    expect(f({ signedIn: true, textsOn: true }).manage).toBe(true);
    expect(f({ signedIn: true }).manage).toBe(false);
    expect(f({ emailOn: true }).manage).toBe(false); // signed out: the cookie
    expect(f({ kid: true, signedIn: true, emailOn: true }).manage).toBe(false);
  });
});

describe("the picks page's email words", () => {
  it("records the pre-checked version only from the welcome sheet", () => {
    expect(emailConsentVersionFor("welcome_sheet")).toBe(
      "email-2026-11-22-prechecked",
    );
    for (const s of ["footer", "newsletter", "settings", "next_pick"])
      expect(emailConsentVersionFor(s)).toBe(CONSENT_VERSION);
    const w = EMAIL_CONSENT_TEXT["email-2026-11-22-prechecked"];
    expect(w.prechecked).toBe(true);
    expect(w.body).toBe(PARK_NEWS.pitch);
    expect(EMAIL_CONSENT_TEXT[CONSENT_VERSION].prechecked).toBe(false);
  });
  it("shows the subscriber count only from 50, floored to the ten", () => {
    expect(proofCount(0)).toBeNull();
    expect(proofCount(49)).toBeNull();
    expect(proofCount(50)).toBe(50);
    expect(proofCount(237)).toBe(230);
  });
});

describe("asks and the batch 6 signups", () => {
  const ctx: AskCtx = {
    surface: "idle",
    signedIn: true,
    isKid: false,
    borrowed: false,
    overlayOpen: false,
    lastStamp: null,
    textsAvailable: true,
  };
  it("never offers what this browser's cookie says it gets", () => {
    expect(openChannels(ctx, EMPTY_STATE)).toEqual({ email: true, text: true });
    expect(
      openChannels(
        { ...ctx, device: { email: true, text: false } },
        EMPTY_STATE,
      ),
    ).toEqual({ email: false, text: true });
    expect(
      openChannels(
        { ...ctx, device: { email: false, text: true } },
        EMPTY_STATE,
      ),
    ).toEqual({ email: true, text: false });
  });
  it("counts an unchecked or empty email box as one ignored next_pick", () => {
    const now = new Date("2026-11-22T20:00:00Z");
    const s = recordPicksIgnored(EMPTY_STATE, now);
    expect(ignoredCount(s, "next_pick", "2026-11-22")).toBe(1);
    // Twice in a day is still one.
    expect(
      ignoredCount(recordPicksIgnored(s, now), "next_pick", "2026-11-22"),
    ).toBe(1);
    // And it takes no slot today.
    const later = new Date("2026-11-23T05:00:00Z");
    const stamp = {
      key: "v1",
      park: "Pine Nursery",
      at: "2026-11-21T18:00:00Z",
    };
    expect(
      pickAsk(
        { ...ctx, lastStamp: stamp },
        { ...s, firstSeen: "2026-11-01T00:00:00Z" },
        later,
      ),
    ).toBeNull();
  });
});

describe("the tap-to-write name tag", () => {
  it("saves the family line it showed when left empty", () => {
    expect(familyDefault("Sam")).toBe("Sam's Family");
    expect(familyDefault("  Grandma Jo ")).toBe("Grandma Jo's Family");
    expect(familyDefault("")).toBe("");
  });
  it("never makes a family name over the 40 the actions take", () => {
    const name = "Bartholomew Montgomery-Fitzgerald J"; // 35 characters
    expect(name).toHaveLength(35);
    const fam = familyDefault(name);
    expect(fam.length).toBeLessThanOrEqual(FAMILY_MAX);
    expect(fam.endsWith("'s Family")).toBe(true);
    expect(familyDefault("x".repeat(40)).length).toBe(FAMILY_MAX);
  });
  it("strips newlines", () => {
    expect(oneLine("Sam\nthe\r\nGreat")).toBe("Sam the Great");
  });
});
