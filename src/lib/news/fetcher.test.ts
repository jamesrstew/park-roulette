import { describe, expect, it, vi } from "vitest";

/**
 * The fetcher's answer when a site never answers (writer-fixes item 4):
 * a reset, a timeout or a TLS failure is named, with a blocked kind the
 * retro reports, instead of a bare "answered nothing".
 */

// A plain stand-in, not vi.fn(): a spy reports the errors it throws.
let answer: () => Promise<Response> = async () => new Response("");
vi.mock("undici", () => ({
  Agent: class {},
  fetch: () => answer(),
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
