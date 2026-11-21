import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The real components, with the server actions stubbed out (never called
// while rendering).
vi.mock("@/lib/client-actions", () => ({
  savePicks: vi.fn(),
  turnOnTexts: vi.fn(),
  sendTextsCode: vi.fn(),
  confirmTextsCode: vi.fn(),
  stopTexts: vi.fn(),
}));

const { SignupPicks } = await import("./SignupPicks");
const { FooterTexts } = await import("./FooterTexts");

/** Each checkbox in the markup: its label text and whether it's checked. */
function boxes(html: string): { text: string; checked: boolean }[] {
  const out: { text: string; checked: boolean }[] = [];
  const re = /<label[^>]*>([\s\S]*?)<\/label>/g;
  for (const m of html.matchAll(re)) {
    const input = /<input[^>]*type="checkbox"[^>]*>/.exec(m[1]);
    if (!input) continue;
    out.push({
      text: m[1].replace(/<[^>]+>/g, ""),
      checked: /\schecked(=""|\s|>|\/)/.test(input[0]),
    });
  }
  return out;
}

const facts = {
  show: true,
  emailOn: false,
  emailOnHere: false,
  textsOn: false,
  textsOffer: true,
  confirmationsOn: true,
  phone: "+15415550123",
  nextIssue: "2026-12-03",
  proof: null,
};

describe("the texts box starts unchecked (TCPA, CTIA; the filed CQXRMSG flow)", () => {
  it("on the welcome sheet's picks page, next to the pre-checked email", () => {
    const html = renderToStaticMarkup(
      createElement(SignupPicks, {
        facts,
        headingId: "h",
        onFinish: () => {},
      }),
    );
    const b = boxes(html);
    const texts = b.find((x) => /text me the Weekend Pick/.test(x.text));
    const email = b.find((x) => /Email me Thursdays/.test(x.text));
    expect(texts?.checked).toBe(false);
    expect(email?.checked).toBe(true);
    // The whole disclosure sits right there, with Terms and Privacy.
    expect(html).toContain("Message and data rates may apply.");
    expect(html).toMatch(
      /<a[^>]*target="_blank"[^>]*href="\/terms#park-texts"/,
    );
  });
  it("in the site footer's card", () => {
    const html = renderToStaticMarkup(
      createElement(FooterTexts, {
        number: "+15415550123",
        state: "rather",
        confirmationsOn: true,
      }),
    );
    const b = boxes(html);
    expect(b).toHaveLength(1);
    expect(b[0].text).toContain("Yes, text me the Weekend Pick at");
    expect(b[0].checked).toBe(false);
    expect(html).toContain("Text me Fridays");
  });
});
