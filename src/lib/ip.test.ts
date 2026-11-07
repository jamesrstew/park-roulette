import { describe, expect, it } from "vitest";
import { ipKey } from "./ip";

describe("ipKey", () => {
  it("keeps IPv4 as is", () => {
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
  });

  it("groups IPv6 by /64, however it's written", () => {
    const k = "2001:db8:0:0::/64";
    expect(ipKey("2001:db8::1")).toBe(k);
    expect(ipKey("2001:db8::2")).toBe(k);
    expect(ipKey("2001:0db8:0000:0000:abcd::9")).toBe(k);
    expect(ipKey("2001:db8:0:0:1:2:3:4")).toBe(k);
    expect(ipKey("2001:db8:0:1::1")).not.toBe(k);
    expect(ipKey("[2001:db8::1]")).toBe(k);
  });

  it("puts junk in one shared bucket", () => {
    expect(ipKey("")).toBe("unknown");
    expect(ipKey("not an ip")).toBe("unknown");
    expect(ipKey("1:2:3::4::5")).toBe("unknown");
  });
});
