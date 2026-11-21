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
