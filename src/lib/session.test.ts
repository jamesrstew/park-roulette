import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

const SECRET = "test-secret-at-least-16-chars";
let S: typeof import("./session");

beforeAll(async () => {
  process.env.SESSION_SECRET = SECRET;
  S = await import("./session");
});

describe("session cookie", () => {
  it("round-trips id, epoch and how you signed in", () => {
    expect(S.verify(S.sign(7, 3, "c"))).toEqual({ id: 7, epoch: 3, by: "c" });
    expect(S.verify(S.sign(7, 0, "l"))).toEqual({ id: 7, epoch: 0, by: "l" });
    expect(S.verify(S.sign(7, 0, "j"))?.by).toBe("j");
  });

  it("accepts cookies from before phone sign-in as trusted, epoch 0", () => {
    const legacy = `7.${createHmac("sha256", SECRET).update("explorer:7").digest("base64url")}`;
    expect(S.verify(legacy)).toEqual({ id: 7, epoch: 0, by: "legacy" });
    expect(S.trusted("legacy")).toBe(true);
    expect(S.trusted("l")).toBe(false);
  });

  it("rejects tampering", () => {
    const t = S.sign(7, 3, "l");
    const [, , , m] = t.split(".");
    expect(S.verify(`8.3.l.${m}`)).toBeNull(); // someone else's id
    expect(S.verify(`7.4.l.${m}`)).toBeNull(); // a newer epoch
    expect(S.verify(`7.3.c.${m}`)).toBeNull(); // upgrade a link sign-in to "code"
    expect(S.verify(`7.03.l.${m}`)).toBeNull(); // non-canonical epoch
    expect(S.verify(`7.-1.l.${m}`)).toBeNull();
    expect(S.verify(`7.3.x.${m}`)).toBeNull();
    expect(S.verify(`7.${m}`)).toBeNull(); // new mac as a legacy cookie
    expect(S.verify("")).toBeNull();
    expect(S.verify(undefined)).toBeNull();
    expect(S.verify("x".repeat(500))).toBeNull();
  });
});

describe("verified phone cookie", () => {
  it("round-trips until it expires", () => {
    const now = 1_000_000;
    const t = S.signPhone("+15415550123", now + 1000);
    expect(S.verifyPhone(t, now)).toBe("+15415550123");
    expect(S.verifyPhone(t, now + 1001)).toBeNull();
  });

  it("rejects a swapped number or expiry", () => {
    const now = 1_000_000;
    const [, exp, m] = S.signPhone("+15415550123", now + 1000).split(".");
    expect(S.verifyPhone(`+15415551234.${exp}.${m}`, now)).toBeNull();
    expect(
      S.verifyPhone(`+15415550123.${Number(exp) + 9999}.${m}`, now),
    ).toBeNull();
  });

  it("can't be confused with a session cookie", () => {
    expect(S.verify(S.signPhone("+15415550123", 9e12))).toBeNull();
  });
});

describe("grown-up on this phone cookie", () => {
  const exp = Date.now() + 60_000;
  it("round-trips a trusted grown-up", () => {
    const t = S.signGrownUp({ id: 7, epoch: 2, by: "c" }, exp);
    expect(S.verifyGrownUp(t)).toEqual({ id: 7, epoch: 2, by: "c" });
  });
  it("rejects tampering, expiry and untrusted sign-ins", () => {
    const t = S.signGrownUp({ id: 7, epoch: 2, by: "j" }, exp);
    expect(S.verifyGrownUp(t.replace(/^7\./, "8."))).toBeNull();
    expect(S.verifyGrownUp(t, exp + 1)).toBeNull();
    const forged = `7.2.l.${exp}.${t.split(".")[4]}`;
    expect(S.verifyGrownUp(forged)).toBeNull();
    expect(S.verifyGrownUp(undefined)).toBeNull();
  });
});
