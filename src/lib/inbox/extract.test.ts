import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { onPage } from "@/lib/events/structured";
import { pageText } from "@/lib/news/validate";
import {
  addressPattern,
  cleanIssue,
  isPixel,
  isPrivateLink,
  isTracker,
  keepLink,
  plainLinks,
  unwrapLink,
} from "./extract";

/**
 * Newsletter emails as we keep them: pixels out, subscriber links cut,
 * links unwrapped to their targets (or, for opaque click links, matched
 * in order to the plain part's), no tracker in the links, text exactly as
 * the events checker reads a page. The fixtures are synthetic: the markup
 * shape of real beehiiv issues, with made-up names, content and tokens.
 */
const fx = (f: string) =>
  readFileSync(path.join(__dirname, "__fixtures__", f), "utf8");

const weekly = () =>
  cleanIssue({
    html: fx("newsletter-weekly.html"),
    plain: fx("newsletter-weekly.txt"),
    scrub: ["owner@example.com"],
    names: ["Pat"],
  });
const daily = () =>
  cleanIssue({
    html: fx("newsletter-daily.html"),
    plain: fx("newsletter-daily.txt"),
  });

describe("unwrapLink", () => {
  it("unwraps a target carried in the link, and strips tracking", () => {
    expect(
      unwrapLink(
        "https://tracker.example.net/redirect?url=https%3A%2F%2Fwww.example-museum.org%2Fe%3Futm_source%3Dx&sig=1",
      ),
    ).toBe("https://www.example-museum.org/e");
    expect(
      unwrapLink(
        "https://www.google.com/url?q=https%3A%2F%2Fwww.example-library.org%2Fevents&sa=D",
      ),
    ).toBe("https://www.example-library.org/events");
    expect(
      unwrapLink(
        "https://clicks.example.org/c/https%3A%2F%2Fwww.example-arts.org%2Fk",
      ),
    ).toBe("https://www.example-arts.org/k");
  });
  it("unwraps nested redirects", () => {
    const inner = encodeURIComponent(
      "https://t.example.com/r?u=" +
        encodeURIComponent("https://example-parks.org/x"),
    );
    expect(unwrapLink(`https://www.google.com/url?q=${inner}`)).toBe(
      "https://example-parks.org/x",
    );
  });
  it("keeps an opaque tracker, and a link whose ?u= isn't a URL", () => {
    const opaque = "https://link.mail.beehiiv.com/v2/c/SYNTHETIC/x";
    expect(unwrapLink(opaque)).toBe(opaque);
    const mc = "https://x.us1.list-manage.com/track/click?u=1a2b&id=3c";
    expect(unwrapLink(mc)).toBe(mc);
  });
});

describe("trackers", () => {
  it("knows tracker hosts and branded tracking paths", () => {
    for (const u of [
      "https://link.mail.beehiiv.com/v2/c/SYNTHETIC/x",
      "https://url1234.the-daily.example/ls/click?upn=SYNTHETIC",
      "https://news.the-daily.example/ls/click?upn=SYNTHETIC",
      "https://em.the-daily.example/c/SYNTHETICTOKEN0123456789",
      "https://u123.ct.sendgrid.net/ls/click?upn=SYNTHETIC",
    ])
      expect(isTracker(u), u).toBe(true);
    for (const u of [
      "https://www.example-parks.org/c/kids",
      "https://www.example-museum.org/events/popup",
    ])
      expect(isTracker(u), u).toBe(false);
  });
});

describe("opaque /c/ links", () => {
  it("drops them on any host or subdomain, unless the anchor prints the page", () => {
    for (const u of [
      "https://go.the-daily.example/c/Ab12xY",
      "https://news.example-parks.org/c/k9",
      "https://www.example-parks.org/c/AbCdEf",
    ]) {
      expect(isTracker(u), u).toBe(true);
      expect(keepLink(u, "More info"), u).toBe(false);
    }
    expect(
      keepLink("https://www.example-parks.org/c/k9", "example-parks.org/c/k9"),
    ).toBe(true);
    expect(keepLink("https://www.example-parks.org/c/family", "Family")).toBe(
      true,
    );
    const r = cleanIssue({
      html: '<p>Fun <a href="https://go.the-daily.example/c/Ab12xY">More info</a> and <a href="https://www.example-parks.org/c/kids">Kids</a></p>',
    });
    expect(r.links).toEqual([
      { text: "Kids", url: "https://www.example-parks.org/c/kids" },
    ]);
  });
});

describe("greeting lines", () => {
  it("scrub any address in a greeting, and the subscriber's names", () => {
    const r = cleanIssue({
      html: "<p>Hi jane.q@example.net, welcome back!</p><p>Good morning, Pat!</p><p>Write to hello@the-daily.example any time.</p>",
      names: ["Pat"],
    });
    expect(r.text).toBe(
      "Hi there, welcome back! Good morning, there! Write to hello@the-daily.example any time.",
    );
  });
});

describe("cleanIssue (beehiiv weekly)", () => {
  it("drops the tracking pixel", () => {
    expect(weekly().html).not.toMatch(/v2\/o\//);
    expect(fx("newsletter-weekly.html")).toMatch(/v2\/o\//);
  });
  it("matches opaque click links to the plain part's targets, in order", () => {
    const r = weekly();
    expect(r.links).toContainEqual({
      text: "More info",
      url: "https://www.example-parks.org/events/winter-lights",
    });
    expect(r.links).toContainEqual({
      text: "Register",
      url: "https://register.example-parks.org/webtrac/iteminfo.html?Module=AR&FMID=1000001",
    });
    expect(r.html).toContain(
      'href="https://www.example-parks.org/events/winter-lights"',
    );
  });
  it("never lists a tracker it couldn't resolve", () => {
    expect(weekly().links.some((l) => isTracker(l.url))).toBe(false);
    expect(daily().links.some((l) => isTracker(l.url))).toBe(false);
  });
  it("cuts the unsubscribe link (by the words before it), and the subscriber", () => {
    const r = weekly();
    expect(r.links.some((l) => /PRIVATE|subscribe/.test(l.url))).toBe(false);
    expect(r.html).not.toContain("SYNTHETIC-TOKEN-PRIVATE");
    expect(r.html).not.toMatch(/owner(\+news)?@example\.com/);
    expect(r.text).toContain("[subscriber]");
    expect(r.text).toContain("Hi there, here's the weekend.");
    expect(r.text).not.toContain("Pat");
  });
  it("keeps the text exactly as the checker reads pages, so quotes verify", () => {
    const r = weekly();
    expect(r.text).toBe(pageText(r.html));
    for (const q of [
      "Saturday, November 21 • 12-7pm • Winter Lights • Family-friendly",
      "Saturday 11/21 🎨 Family Art Play 9:15am-10:15am • Ages 0-6",
      "Entry, the light walk, and the bonfire are free.",
      "Here's what you need to know",
    ])
      expect(onPage({ text: r.text }, q), q).toBe(true);
    expect(r.text).not.toMatch(/<|>/);
  });
});

describe("cleanIssue (beehiiv daily through SendGrid)", () => {
  it("unwraps redirect links, matches its twin, drops what it can't resolve", () => {
    const urls = daily().links.map((l) => l.url);
    expect(urls).toEqual([
      "https://www.example-sponsor.org/programs/",
      "https://www.example-museum.org/events/popup",
      "https://www.example-library.org/events/popup",
      "https://www.example-museum.org/events/popup",
      "https://www.example-arts.org/events/kids-art",
    ]);
  });
  it("drops the share and unsubscribe links, mailto and the pixel", () => {
    const r = daily();
    expect(r.links.some((l) => /Share|Unsubscribe/i.test(l.text))).toBe(false);
    expect(r.html).not.toMatch(/ss\/o\//);
    expect(r.html).not.toContain("SYNTHETIC-TOKEN-UNSUB");
  });
});

describe("cleanIssue, plain part only", () => {
  const plain = [
    "Hi Pat,",
    "**Winter Lights** [More info](https://www.example-parks.org/w?utm_source=n) or https://bare.example.org/x",
    "View image: (https://media.example.com/a.png)",
    "Follow image link: (https://img.example.org/)",
    "Tracked: [Go](https://link.mail.beehiiv.com/v2/c/SYNTHETIC/x)",
    "Update your email preferences or unsubscribe [here](https://example.org/u/SYNTHETIC)",
    "Sent to owner+x@gmail.com",
  ].join("\n");
  const r = cleanIssue({
    html: null,
    plain,
    scrub: ["owner@gmail.com"],
    names: ["Pat"],
  });
  it("applies the html link rules: unwrapped, no trackers, nothing private", () => {
    expect(r.links).toEqual([
      { text: "More info", url: "https://www.example-parks.org/w" },
    ]);
  });
  it("keeps no URL in the text, and scrubs the subscriber", () => {
    expect(r.text).not.toMatch(/https?:|www\.|\.png/);
    expect(r.text).toContain("Winter Lights More info or");
    expect(r.text).toContain("Hi there,");
    expect(r.text).toContain("Sent to [subscriber]");
  });
});

describe("pieces", () => {
  it("tells a pixel from a picture", () => {
    expect(
      isPixel('<img src="https://x.com/a.gif" width="1" height="1">'),
    ).toBe(true);
    expect(
      isPixel('<img src="https://x.com/a.gif" style="width:1px;height:1px">'),
    ).toBe(true);
    expect(isPixel('<img src="https://e.example.com/wf/open?upn=abc">')).toBe(
      true,
    );
    expect(
      isPixel('<img src="https://media.example.com/logo.png" width="600">'),
    ).toBe(false);
  });
  it("knows a subscriber's links: URL, anchor, or the words just before", () => {
    expect(isPrivateLink("https://x.beehiiv.com/unsubscribe/abc")).toBe(true);
    expect(isPrivateLink("https://t.example/c/x", "Unsubscribe")).toBe(true);
    expect(
      isPrivateLink(
        "https://t.example/c/x",
        "here",
        "Manage your subscription",
      ),
    ).toBe(true);
    expect(
      isPrivateLink("https://t.example/c/x", "here", "You can opt out"),
    ).toBe(true);
    expect(
      isPrivateLink("https://example-arts.org/events", "Tickets", "Kids paint"),
    ).toBe(false);
  });
  it("scrubs an address's dot and plus variants", () => {
    const re = addressPattern("jane.doe@gmail.com")!;
    for (const v of [
      "jane.doe@gmail.com",
      "janedoe@gmail.com",
      "j.a.n.e.d.o.e@googlemail.com",
      "JaneDoe+news@gmail.com",
      "janedoe%40gmail.com",
    ])
      expect(v.replace(re, "[s]"), v).toBe("[s]");
    expect("notjanedoe@gmail.com".replace(re, "[s]")).toBe(
      "notjanedoe@gmail.com",
    );
    const other = addressPattern("pat@example.com")!;
    expect("pat+x@example.com".replace(other, "[s]")).toBe("[s]");
    expect("p.at@example.com".replace(other, "[s]")).toBe("p.at@example.com");
  });
  it("reads the plain part's links in order", () => {
    expect(
      plainLinks(
        "a [One](https://a.org/1) b\nFollow image link: (https://b.org/2)\n[Two](https://c.org/3)",
      ),
    ).toEqual([
      { text: "One", url: "https://a.org/1" },
      { text: "", url: "https://b.org/2" },
      { text: "Two", url: "https://c.org/3" },
    ]);
  });
});
