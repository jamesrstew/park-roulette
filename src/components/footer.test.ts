import { describe, expect, it } from "vitest";
import { keyboardOpen } from "./BottomNav";
import { footerFor } from "./FooterGate";

describe("the site footer", () => {
  it("shows on reading pages only (an allowlist)", () => {
    for (const p of [
      "/list",
      "/news",
      "/towns",
      "/towns/bend",
      "/playgrounds/shaded",
      "/parks/juniper-park-bend",
      "/newsletter",
      "/newsletter/2026-12-03",
      "/texts",
      "/terms",
      "/privacy",
    ])
      expect(footerFor(p).show, p).toBe(true);
    for (const p of [
      "/",
      "/map",
      "/passport",
      "/me",
      "/start",
      "/join/abc",
      "/admin",
      "/parks/new",
      "/news/confirm",
      "/news/unsubscribe",
      "/somewhere-new",
    ])
      expect(footerFor(p).show, p).toBe(false);
  });
  it("drops its signup where the page has its own", () => {
    expect(footerFor("/newsletter").signup).toBe(false);
    expect(footerFor("/newsletter/2026-12-03").signup).toBe(false);
    expect(footerFor("/texts").signup).toBe(false);
    expect(footerFor("/towns/bend").signup).toBe(true);
  });
});

describe("the tab bar and the keyboard", () => {
  it("hides only when the visual viewport shrinks under 75%", () => {
    expect(keyboardOpen(400, 844)).toBe(true);
    expect(keyboardOpen(800, 844)).toBe(false);
    expect(keyboardOpen(640, 844)).toBe(false);
  });
});
