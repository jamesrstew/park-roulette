import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOST,
  KEY,
  KEY_LOCATION,
  parseArgs,
  parseSitemap,
  payload,
  urlsToSend,
} from "../indexnow-ping.mjs";

// The daily run: 6:10 am Pacific (14:10 UTC in standard time).
const NOW = new Date("2026-11-20T14:10:00Z");
const site = (path) => `https://parkroulette.quest${path}`;
const entry = (path, lastmod) =>
  `<url><loc>${site(path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
const XML = `<?xml version="1.0"?><urlset>
${entry("/parks/juniper-park-bend", "2026-11-19T21:03:11.000Z")}
${entry("/newsletter/2026-11-19", "2026-11-19T15:02:00.000Z")}
${entry("/events/fall-family-day-high-desert-museum", "2026-11-20T03:00:00.000Z")}
${entry("/parks/old-park", "2026-11-01T10:00:00.000Z")}
${entry("/privacy")}
${entry("/admin", "2026-11-20T03:00:00.000Z")}
<url><loc>https://example.com/elsewhere</loc><lastmod>2026-11-20T00:00:00.000Z</lastmod></url>
${entry("/parks/juniper-park-bend", "2026-11-19T21:03:11.000Z")}
</urlset>`;

describe("IndexNow: which URLs are sent", () => {
  it("sends pages whose real change time is in the last 48 hours, once each", () => {
    const sent = urlsToSend(parseSitemap(XML), NOW, 48);
    expect(sent).toEqual([
      site("/parks/juniper-park-bend"),
      site("/newsletter/2026-11-19"),
      site("/events/fall-family-day-high-desert-museum"),
    ]);
  });

  it("never sends old changes, undated pages, private pages or other hosts", () => {
    const sent = urlsToSend(parseSitemap(XML), NOW, 48);
    for (const path of ["/parks/old-park", "/privacy", "/admin"])
      expect(sent).not.toContain(site(path));
    expect(sent.some((url) => url.includes("example.com"))).toBe(false);
  });

  it("adds state changes the sitemap can't show (a passed or canceled event)", () => {
    const sent = urlsToSend(parseSitemap(XML), NOW, 48, {
      changes: [
        {
          url: site("/events/tree-lighting-sisters-2026"),
          changedAt: "2026-11-20T06:00:00Z",
        },
        { url: site("/events/long-ago"), changedAt: "2026-11-01T06:00:00Z" },
        { url: "https://example.com/x", changedAt: "2026-11-20T06:00:00Z" },
      ],
    });
    expect(sent).toContain(site("/events/tree-lighting-sisters-2026"));
    expect(sent).not.toContain(site("/events/long-ago"));
    expect(sent.some((url) => url.includes("example.com"))).toBe(false);
  });

  it("sends every public URL once with --all", () => {
    const sent = urlsToSend(parseSitemap(XML), NOW, 48, { all: true });
    expect(sent).toContain(site("/parks/old-park"));
    expect(sent).toContain(site("/privacy"));
    expect(sent).not.toContain(site("/admin"));
    expect(new Set(sent).size).toBe(sent.length);
  });
});

describe("IndexNow: arguments and payload", () => {
  it("defaults to 48 hours and refuses a bad window", () => {
    expect(parseArgs([])).toEqual({ hours: 48, all: false, dryRun: false });
    expect(parseArgs(["--hours", "72"]).hours).toBe(72);
    expect(() => parseArgs(["--hours", "0"])).toThrow();
    expect(parseArgs(["--all", "--dry-run"])).toMatchObject({
      all: true,
      dryRun: true,
    });
  });

  it("serves the key file the payload points at", () => {
    const file = readFileSync(
      join(process.cwd(), "public", `${KEY}.txt`),
      "utf8",
    );
    expect(file.trim()).toBe(KEY);
    expect(KEY).toMatch(/^[a-f0-9]{32}$/);
    expect(KEY_LOCATION).toBe(`https://${HOST}/${KEY}.txt`);
    expect(payload([site("/")])).toEqual({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList: [site("/")],
    });
  });
});
