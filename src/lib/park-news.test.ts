import { describe, expect, it } from "vitest";
import { cleanEmail, suggestEmail } from "./park-news";

describe("park news emails", () => {
  it("cleans and checks addresses", () => {
    expect(cleanEmail("  Jane@Example.com ")).toBe("jane@example.com");
    expect(cleanEmail("jane@example")).toBeNull();
    expect(cleanEmail("not an email")).toBeNull();
    expect(cleanEmail("a@..com")).toBeNull();
    expect(cleanEmail('"a"@b.com')).toBeNull();
    expect(cleanEmail("a..b@c.com")).toBeNull();
    expect(cleanEmail("jane.doe+parks@sub.example.org")).toBe(
      "jane.doe+parks@sub.example.org",
    );
  });
  it("suggests fixes for common typos, never for good addresses", () => {
    expect(suggestEmail("jane@gmial.com")).toBe("jane@gmail.com");
    expect(suggestEmail("jane@gmail.con")).toBe("jane@gmail.com");
    expect(suggestEmail("jane@yaho.com")).toBe("jane@yahoo.com");
    expect(suggestEmail("jane@gmail.com")).toBeNull();
    expect(suggestEmail("jane@truecraft.co")).toBeNull();
    expect(suggestEmail("jane@bendparks.org")).toBeNull();
    expect(suggestEmail("jane@mac.com")).toBeNull();
    expect(suggestEmail("jane@aim.com")).toBeNull();
    expect(suggestEmail("jane@email.com")).toBeNull();
  });
});
