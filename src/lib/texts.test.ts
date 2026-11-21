import { describe, expect, it } from "vitest";
import {
  agreementOk,
  checkboxLine,
  classifyReply,
  consentVersionFor,
  TEXT_SOURCES,
  isGsm7,
  prettyPhone,
  TEXTS,
  TEXTS_CONSENT_TEXT,
  TEXTS_CONSENT_VERSION,
} from "./texts";
import { twilioSignature, verifyTwilio } from "./twilio-signature";
import { fold, parkRouletteVcard } from "./vcard";
import { VCARD_PHOTO_JPEG } from "./vcard-photo";

describe("Weekend texts words", () => {
  it("every text is GSM-7 and one segment (the MMS confirmation aside)", () => {
    for (const [name, t] of Object.entries(TEXTS)) {
      expect(isGsm7(t), name).toBe(true);
      if (name !== "confirmation")
        expect(t.length, name).toBeLessThanOrEqual(160);
      expect(t.startsWith("Park Roulette:"), name).toBe(true);
      if (name !== "stop") expect(t, name).toContain("STOP");
    }
    // The MMS confirmation (with our contact card), word for word.
    expect(TEXTS.confirmation).toBe(
      "Park Roulette: You're in! One playground pick every Friday afternoon (up to 5/mo). Save this contact to see weekend previews. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
    );
    expect(TEXTS.confirmationSms).toContain("Reply HELP for help");
    expect(isGsm7("Curly ’quote’")).toBe(false);
    expect(isGsm7("dash — here")).toBe(false);
  });
  it("freezes the consent words per version, with the number filled in", () => {
    const w = TEXTS_CONSENT_TEXT[TEXTS_CONSENT_VERSION];
    expect(w.button).toBe("Text me Fridays");
    expect(w.disclosure).toContain("STOP to opt out");
    expect(w.disclosure).toContain(
      "You don't have to agree to texts to use Park Roulette.",
    );
    expect(checkboxLine(TEXTS_CONSENT_VERSION, "+15415550123")).toBe(
      "Yes, text me the Weekend Pick at (541) 555-0123.",
    );
    expect(checkboxLine(TEXTS_CONSENT_VERSION, null)).toBe(
      "Yes, text me the Weekend Pick at this number.",
    );
    // Older versions stay frozen, word for word.
    expect(checkboxLine("sms-2026-11-20", null)).toBe(
      "Yes, text me a weekend park pick from Park Roulette at this number.",
    );
    expect(TEXTS.help).toBe(
      "Park Roulette: Weekend Pick, about 1 text a week on Fridays. Help: hello@parkroulette.quest. Msg & data rates may apply. Reply STOP to opt out.",
    );
    expect(TEXTS.help.length).toBeLessThanOrEqual(160);
    expect(prettyPhone("+15415550199")).toBe("(541) 555-0199");
  });
});

describe("text replies", () => {
  it("knows the stop words, case-insensitive", () => {
    for (const w of [
      "STOP",
      "stop",
      "Stop.",
      "STOPALL",
      "stop all",
      "unsubscribe",
      "Cancel",
      "END",
      "quit",
      "REVOKE",
      "opt out",
      "OPTOUT",
    ])
      expect(classifyReply(w), w).toBe("stop");
    expect(classifyReply("START")).toBe("start");
    expect(classifyReply("help")).toBe("help");
  });
  it("honors any reasonable way of saying no", () => {
    for (const w of [
      "please stop texting me",
      "No more",
      "wrong number",
      "Remove me",
      "don't text me",
    ])
      expect(classifyReply(w), w).toBe("stop_like");
    expect(classifyReply("Thanks, we loved Juniper Park")).toBe("other");
  });
  it("catches curly apostrophes, END, and more ways of saying no (M6)", () => {
    for (const w of [
      "Don’t text me",
      "END these texts",
      "take me off this list",
      "unsub",
      "Not interested",
      "no more texts",
      "BASTA",
      "parar por favor",
    ])
      expect(classifyReply(w), w).toBe("stop_like");
    expect(classifyReply("Have a good weekend")).toBe("other");
    // END alone, or about the texts; never "the end of the trail".
    expect(classifyReply("  End. ")).toBe("stop");
    expect(classifyReply("...END!!")).toBe("stop");
    for (const w of ["end texts", "End messages", "please end these texts"])
      expect(classifyReply(w), w).toBe("stop_like");
    for (const w of [
      "see you at the end of the trail",
      "By the end of the day we were all tired",
      "Weekend plans: done",
    ])
      expect(classifyReply(w), w).toBe("other");
    expect(classifyReply("para mi hija")).toBe("other");
  });
});

describe("Twilio webhook signatures", () => {
  const url = "https://parkroulette.quest/api/texts/inbound";
  const params = {
    From: "+15415550123",
    Body: "STOP",
    MessageSid: "SM1",
    To: "+15415550199",
    AccountSid: "AC1",
  };
  it("matches an independent HMAC-SHA1 of the URL and sorted params", () => {
    // Computed with Python's hmac module from the same inputs.
    expect(twilioSignature("test_auth_token", url, params)).toBe(
      "6zGEYMqMycvi70bZhCXKH1AlngI=",
    );
  });
  it("accepts the right signature and rejects any change", () => {
    const sig = twilioSignature("tok", url, params);
    expect(verifyTwilio("tok", url, params, sig)).toBe(true);
    expect(verifyTwilio("tok", url, { ...params, Body: "START" }, sig)).toBe(
      false,
    );
    expect(verifyTwilio("tok", `${url}?x=1`, params, sig)).toBe(false);
    expect(verifyTwilio("other", url, params, sig)).toBe(false);
    expect(verifyTwilio(undefined, url, params, sig)).toBe(false);
    expect(verifyTwilio("tok", url, params, null)).toBe(false);
  });
});

describe("the yes the browser sends (L7)", () => {
  const w = TEXTS_CONSENT_TEXT[TEXTS_CONSENT_VERSION];
  const good = {
    agreed: true,
    version: TEXTS_CONSENT_VERSION,
    checkbox: checkboxLine(TEXTS_CONSENT_VERSION, "+15415550123"),
    disclosure: w.disclosure,
  };
  it("names the program once, at the top of the disclosure", () => {
    expect(w.disclosure.startsWith("Park Roulette Weekend Pick: about 1")).toBe(
      true,
    );
    // The old version stays frozen, word for word.
    expect(TEXTS_CONSENT_TEXT["sms-2026-11-19"].disclosure).toMatch(/^About 1/);
  });
  it("needs the box checked and today's exact words", () => {
    const ok = (a: unknown) => agreementOk(a, "+15415550123", "texts_page");
    expect(ok(good)).toBe(true);
    expect(
      ok({ ...good, checkbox: checkboxLine(TEXTS_CONSENT_VERSION, null) }),
    ).toBe(true);
    expect(ok({ ...good, agreed: false })).toBe(false);
    expect(ok({ ...good, version: "sms-2026-11-19" })).toBe(false);
    expect(ok({ ...good, disclosure: "anything" })).toBe(false);
    expect(ok(null)).toBe(false);
  });
  it("accepts each surface's wording only from that surface (batch 6)", () => {
    const yes = (version: string) => ({
      agreed: true,
      version,
      checkbox: checkboxLine(version, "+15415550123"),
      disclosure: TEXTS_CONSENT_TEXT[version].disclosure,
    });
    expect(consentVersionFor("welcome_sheet")).toBe("sms-2026-11-22-sheet");
    expect(consentVersionFor("site_footer")).toBe("sms-2026-11-22-footer");
    expect(TEXTS_CONSENT_TEXT["sms-2026-11-22-sheet"].button).toBe(
      "Let's spin!",
    );
    expect(TEXTS_CONSENT_TEXT["sms-2026-11-22-footer"].button).toBe(
      "Text me Fridays",
    );
    const all = [
      TEXTS_CONSENT_VERSION,
      "sms-2026-11-22-sheet",
      "sms-2026-11-22-footer",
    ];
    for (const source of TEXT_SOURCES)
      for (const v of all)
        expect(
          agreementOk(yes(v), "+15415550123", source),
          `${v} from ${source}`,
        ).toBe(v === consentVersionFor(source));
    // An unknown source gets the default wording only.
    expect(agreementOk(yes("sms-2026-11-22-sheet"), null, "nowhere")).toBe(
      false,
    );
  });
  it("freezes the batch 6 words: the 11-21 box and disclosure, never pre-checked", () => {
    const base = TEXTS_CONSENT_TEXT["sms-2026-11-21"];
    for (const v of ["sms-2026-11-22-sheet", "sms-2026-11-22-footer"]) {
      expect(TEXTS_CONSENT_TEXT[v].checkbox).toBe(base.checkbox);
      expect(TEXTS_CONSENT_TEXT[v].disclosure).toBe(base.disclosure);
    }
  });
  it("never treats YES as START", () => {
    expect(classifyReply("YES")).toBe("other");
    expect(classifyReply("start")).toBe("start");
  });
});

describe("END as a stop", () => {
  it.each([
    ["end texting", "stop_like"],
    ["end my subscription", "stop_like"],
    ["Please end", "stop_like"],
    ["End please", "stop_like"],
    ["End it", "stop_like"],
    ["End this", "stop_like"],
    ["end weekend texts", "stop_like"],
    ["END", "stop"],
    ["see you at the end of the trail", "other"],
    ["by the end of the day", "other"],
    ["the end", "other"],
  ])("%s → %s", (msg, want) => {
    expect(classifyReply(msg)).toBe(want);
  });
});

describe("the contact card", () => {
  it("is a vCard 3.0 with our name, number, site, note and a small photo", () => {
    const card = parkRouletteVcard({
      number: "+15417198628",
      site: "https://parkroulette.quest",
    });
    expect(card.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(card.endsWith("END:VCARD\r\n")).toBe(true);
    for (const line of [
      "FN:Park Roulette",
      "ORG:Park Roulette",
      "TEL;TYPE=CELL,VOICE:+15417198628",
      "URL:https://parkroulette.quest",
      "NOTE:Weekend Pick: one playground every Friday",
    ])
      expect(card).toContain(`\r\n${line}\r\n`);
    // Every physical line fits in 75 octets.
    for (const l of card.split("\r\n"))
      expect(l.length).toBeLessThanOrEqual(75);
    // The photo: a JPEG under 30 KB.
    const photo = Buffer.from(VCARD_PHOTO_JPEG, "base64");
    expect(photo.length).toBeLessThan(30_000);
    expect([...photo.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    // Unfolded, the photo comes back whole.
    expect(card.replace(/\r\n /g, "")).toContain(
      `PHOTO;ENCODING=b;TYPE=JPEG:${VCARD_PHOTO_JPEG}\r\n`,
    );
    expect(
      parkRouletteVcard({ number: null, site: "https://parkroulette.quest" }),
    ).not.toContain("TEL");
  });
  it("folds long lines", () => {
    const f = fold("x".repeat(200));
    expect(f.split("\r\n").map((l) => l.length)).toEqual([75, 75, 52]);
    expect(f.replace(/\r\n /g, "")).toBe("x".repeat(200));
  });
});
