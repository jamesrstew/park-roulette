import { describe, expect, it, vi } from "vitest";

/**
 * The fetcher's answer when a site never answers (writer-fixes item 4):
 * a reset, a timeout or a TLS failure is named, with a blocked kind the
 * retro reports, instead of a bare "answered nothing".
 */

// A plain stand-in, not vi.fn(): a spy reports the errors it throws.
type Init = { headers: Record<string, string> };
let answer: (url: string, init: Init) => Promise<Response> = async () =>
  new Response("");
vi.mock("undici", () => ({
  Agent: class {},
  fetch: (url: string, init: Init) => answer(url, init),
}));
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const DOMAINS = ["oldmilldistrict.com"];
const URL_ = "https://www.oldmilldistrict.com/events/santaland/";

/** undici's shape: TypeError("fetch failed") with the socket error as cause. */
const undiciError = (code: string, name = "Error") =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("other side closed"), { code, name }),
  });

describe("fetchPage when the site never answers", () => {
  it("a reset says so, with blocked_kind reset", async () => {
    answer = async () => {
      throw undiciError("ECONNRESET");
    };
    const { fetchPage } = await import("./fetcher");
    const r = await fetchPage(URL_, DOMAINS);
    expect(r).toMatchObject({
      status: 0,
      unreachable: "connection reset",
      blockedKind: "reset",
    });
  });

  it("a timeout and a TLS failure are named too", async () => {
    const { networkFailure } = await import("./fetcher");
    expect(networkFailure(undiciError("UND_ERR_CONNECT_TIMEOUT"))).toEqual({
      reason: "timed out",
      kind: "timeout",
    });
    expect(
      networkFailure(
        new DOMException("The operation timed out", "TimeoutError"),
      ),
    ).toEqual({ reason: "timed out", kind: "timeout" });
    expect(networkFailure(undiciError("ERR_TLS_CERT_ALTNAME_INVALID"))).toEqual(
      { reason: "TLS error", kind: "reset" },
    );
  });

  it("anything else is still thrown (a bug, not a site)", async () => {
    answer = async () => {
      throw new RangeError("boom");
    };
    const { fetchPage } = await import("./fetcher");
    await expect(fetchPage(URL_, DOMAINS)).rejects.toThrow("boom");
  });

  it("a bot check carries blocked_kind bot_check", async () => {
    answer = async () =>
      new Response("<html>sucuri_cloudproxy_js</html>", {
        status: 200,
        headers: { server: "Sucuri/Cloudproxy", "content-type": "text/html" },
      });
    const { fetchPage } = await import("./fetcher");
    const r = await fetchPage(URL_, DOMAINS);
    expect(r.blocked).toMatch(/Sucuri/);
    expect(r.blockedKind).toBe("bot_check");
  });
});

describe("who the checker says it is (Old Mill District resets, November 2026)", () => {
  it("names itself plainly, without a fake-browser Mozilla prefix", async () => {
    // Old Mill District's firewall reset every connection whose
    // User-Agent was "Mozilla/5.0 (compatible; ...)" and answered our own
    // bot name; the routine's reader got the page, the checker didn't.
    let sent = "";
    answer = async (_url, init) => {
      sent = init.headers["user-agent"];
      return new Response("<p>Santa Flies in by AirLink</p>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const { fetchPage, UA } = await import("./fetcher");
    const r = await fetchPage(URL_, DOMAINS);
    expect(r.text).toContain("Santa Flies in");
    expect(sent).toBe(UA);
    expect(UA).not.toMatch(/mozilla|compatible|chrome|safari|gecko/i);
    expect(UA).toMatch(/ParkRoulette.*parkroulette\.quest.*hello@/);
  });
});

describe("organizer data endpoints (High Desert Museum CMS, lesson 34)", () => {
  const HDM =
    "https://hdm.mux.earth/public/v2/find-path/?html_path=/whats-on/events/winter-nights-evergreen-dreams/&site=www.highdesertmuseum.org";
  const RECORD = JSON.stringify({
    title: "Winter Nights - Evergreen Dreams",
    start: "2026-12-03T16:00:00-08:00",
  });

  it("knows a data URL from a page", async () => {
    const { dataUrl } = await import("./fetcher");
    expect(dataUrl(HDM)).toBe(true);
    expect(
      dataUrl("https://www.oldmilldistrict.com/wp-json/tribe/events/v1/events"),
    ).toBe(true);
    expect(dataUrl("https://example.org/feed/events.ics")).toBe(true);
    expect(dataUrl("https://example.org/events?format=json")).toBe(true);
    expect(
      dataUrl(
        "https://api.live.onaws.letsway.com/v1/catalogs/01a11cd6/items?limit=100",
      ),
    ).toBe(true);
    expect(dataUrl(URL_)).toBe(false);
    expect(dataUrl("https://www.highdesertmuseum.org/whats-on/events/")).toBe(
      false,
    );
  });

  it("asks a data URL for JSON, not HTML", async () => {
    let accept = "";
    answer = async (_url, init) => {
      accept = init.headers.accept;
      return new Response(RECORD, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const { fetchPage } = await import("./fetcher");
    const r = await fetchPage(HDM, ["hdm.mux.earth"]);
    expect(accept).toMatch(/^application\/json/);
    expect(r.data).toContain(
      "Winter Nights - Evergreen Dreams | 2026-12-03T16:00",
    );
  });

  it("when a cache hands back the API's HTML page, asks once more with format=json", async () => {
    // Cloudflare in front of the CMS ignores Vary: Accept, so whoever
    // asked first decides what everyone gets for 4 hours: the browsable
    // API page (HTML, the record isn't its text) cut the museum's events.
    const urls: string[] = [];
    answer = async (url) => {
      urls.push(url);
      return new URL(url).searchParams.get("format") === "json"
        ? new Response(RECORD, {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(
            "<html><title>Find Path By Site - Django REST framework</title></html>",
            { status: 200, headers: { "content-type": "text/html" } },
          );
    };
    const { fetchPage } = await import("./fetcher");
    const r = await fetchPage(HDM, ["hdm.mux.earth"]);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1]).searchParams.get("site")).toBe(
      "www.highdesertmuseum.org",
    );
    expect(r.data).toContain(
      "Winter Nights - Evergreen Dreams | 2026-12-03T16:00",
    );
  });

  it("a page is fetched once, as a page", async () => {
    const urls: string[] = [];
    answer = async (url) => {
      urls.push(url);
      return new Response("<p>hi</p>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const { fetchPage } = await import("./fetcher");
    await fetchPage(URL_, DOMAINS);
    expect(urls).toEqual([URL_]);
  });
});
