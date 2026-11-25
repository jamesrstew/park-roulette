/**
 * Is this Postgres URL on this machine? By its parsed host, so every
 * spelling counts: "postgres://localhost:5544/db" (no user),
 * "postgresql://postgres@127.0.0.1/db", "postgres://[::1]/db". (A regex
 * that wanted "@localhost" skipped the database tests for a URL with no
 * user.) Pure: tests and the DB client share it.
 */
export function isLocalDb(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

/**
 * The database tests' switch: true when TEST_DATABASE_URL is a local
 * database, false when it's unset (the suite skips). A non-local URL is
 * an error, never a silent skip: the tests wipe tables.
 */
export function testDbOn(url = process.env.TEST_DATABASE_URL ?? ""): boolean {
  if (!url) return false;
  if (!isLocalDb(url))
    throw new Error(
      "TEST_DATABASE_URL must be a local database (localhost, 127.0.0.1 or ::1): the database tests wipe tables.",
    );
  return true;
}

/**
 * The same host listed `tries` times, so a connection that times out is
 * tried again on the spot instead of failing the request. Railway's public
 * proxy sometimes leaves a new TCP connection hanging, and the next try
 * goes straight through. postgres.js tries a multi-host URL's hosts in
 * order (as libpq does), each with its own connect_timeout. Pure.
 */
export function withConnectRetries(url: string, tries: number): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (tries < 2 || !u.host || url.includes(",")) return url;
  const at = url.indexOf("@" + u.host);
  const start = at >= 0 ? at + 1 : url.indexOf(u.host);
  if (start < 0) return url;
  const end = start + u.host.length;
  const hostPort = u.port ? u.host : `${u.host}:5432`;
  return url.slice(0, start) + Array(tries).fill(hostPort).join(",") + url.slice(end);
}
