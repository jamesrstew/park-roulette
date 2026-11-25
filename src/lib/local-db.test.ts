import { describe, expect, it } from "vitest";
import { isLocalDb, withConnectRetries } from "./local-db";

describe("withConnectRetries", () => {
  const url =
    "postgresql://postgres:p%40ss@altaria.proxy.rlwy.net:44873/railway?sslmode=require";

  it("lists the same host and port three times, keeping user, db and params", () => {
    expect(withConnectRetries(url, 3)).toBe(
      "postgresql://postgres:p%40ss@altaria.proxy.rlwy.net:44873,altaria.proxy.rlwy.net:44873,altaria.proxy.rlwy.net:44873/railway?sslmode=require",
    );
  });

  it("adds the default port when the URL has none", () => {
    expect(withConnectRetries("postgres://u:p@db.example.com/x", 2)).toBe(
      "postgres://u:p@db.example.com:5432,db.example.com:5432/x",
    );
  });

  it("works without a user", () => {
    expect(withConnectRetries("postgres://db.example.com:6000/x", 2)).toBe(
      "postgres://db.example.com:6000,db.example.com:6000/x",
    );
  });

  it("leaves already multi-host, unparsable or single-try URLs alone", () => {
    const multi = "postgres://u:p@a:1,b:2/x";
    expect(withConnectRetries(multi, 3)).toBe(multi);
    expect(withConnectRetries("not a url", 3)).toBe("not a url");
    expect(withConnectRetries(url, 1)).toBe(url);
  });

  it("does not touch a password that happens to contain the host", () => {
    const tricky = "postgres://u:db.example.com@db.example.com:5432/x";
    expect(withConnectRetries(tricky, 2)).toBe(
      "postgres://u:db.example.com@db.example.com:5432,db.example.com:5432/x",
    );
  });

  it("keeps retrying when only the query string has a comma", () => {
    expect(withConnectRetries("postgres://u:p@h:1/x?options=a,b", 2)).toBe(
      "postgres://u:p@h:1,h:1/x?options=a,b",
    );
  });

  it("isLocalDb still sees local URLs", () => {
    expect(isLocalDb("postgres://localhost:5544/db")).toBe(true);
  });
});
