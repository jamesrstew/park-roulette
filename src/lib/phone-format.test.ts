import { describe, expect, it } from "vitest";
import {
  codeDigits,
  formatPhone,
  maskPhone,
  normalizeUSPhone,
  safeNext,
  typePhone,
} from "./phone-format";

describe("normalizeUSPhone", () => {
  it.each([
    ["(541) 555-0123", "+15415550123"],
    ["541.555.0123", "+15415550123"],
    ["541 555 0123", "+15415550123"],
    ["5415550123", "+15415550123"],
    ["15415550123", "+15415550123"],
    ["+1 (541) 555-0123", "+15415550123"],
    ["+15415550123", "+15415550123"],
    ["  541-555-1234 ", "+15415551234"],
  ])("%s → %s", (input, out) => {
    expect(normalizeUSPhone(input)).toBe(out);
  });

  it.each([
    "",
    "541555012", // 9 digits
    "54155501231", // 11 digits, not starting with 1
    "+44 20 7946 0958", // UK
    "+52 55 1234 5678", // Mexico
    "(041) 555-0123", // area code can't start with 0
    "(141) 555-0123", // or 1
    "(541) 055-0123", // exchange can't start with 0
    "(911) 555-0123",
    "(541) 411-0123",
    "(416) 555-0123", // Toronto: +1, but not the US
    "(876) 555-0123", // Jamaica
    "+1 809 555 0123", // Dominican Republic
    "call me",
    "1".repeat(50),
  ])("rejects %s", (input) => {
    expect(normalizeUSPhone(input)).toBeNull();
  });
});

describe("display", () => {
  it("formats and masks", () => {
    expect(formatPhone("+15415550123")).toBe("(541) 555-0123");
    expect(maskPhone("+15415550123")).toBe("(•••) •••-0123");
  });

  it("formats as you type, including iOS autofill", () => {
    expect(typePhone("")).toBe("");
    expect(typePhone("5")).toBe("(5");
    expect(typePhone("5415")).toBe("(541) 5");
    expect(typePhone("541555")).toBe("(541) 555");
    expect(typePhone("5415550")).toBe("(541) 555-0");
    expect(typePhone("5415550123999")).toBe("(541) 555-0123");
    expect(typePhone("+1 (541) 555-0123")).toBe("(541) 555-0123");
    // backspacing over ") " still leaves digits
    expect(typePhone("(541")).toBe("(541");
  });

  it("pulls a code out of what was typed or pasted", () => {
    expect(codeDigits("123 456.")).toBe("123456");
    expect(codeDigits("Your code is 1234567")).toBe("123456");
    expect(codeDigits("12")).toBe("12");
  });
});

describe("safeNext", () => {
  it.each([
    [undefined, "/"],
    ["", "/"],
    ["/parks/drake-park", "/parks/drake-park"],
    ["/passport", "/passport"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\\evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/\t/evil.com", "/"],
    ["/.//evil.com", "/"],
    ["/..//evil.com", "/"],
    ["/a/..//evil.com", "/"],
    ["/%2e//evil.com", "/"],
    ["/\n/evil.com", "/"],
    ["/%09/evil.com", "/%09/evil.com"], // stays a path on our site
    ["/me?next=1#signin", "/me?next=1#signin"],
  ])("%s → %s", (input, out) => {
    expect(safeNext(input as string | undefined)).toBe(out);
  });
});
