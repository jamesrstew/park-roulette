import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { isLocalDb, withConnectRetries } from "@/lib/local-db";

function makeClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = isLocalDb(url);
  // Railway's proxy sometimes hangs a new connection (CONNECT_TIMEOUT,
  // Nov 23 and 25). Try up to 3 times, 8 s each, instead of one 30 s wait
  // that ends in an error page.
  return postgres(local ? url : withConnectRetries(url, 3), {
    max: 3,
    connect_timeout: 8,
    // Railway's public proxy uses a self-signed cert: encrypt, skip CA checks.
    ssl: local ? false : "require",
    prepare: false,
  });
}

const globalForDb = globalThis as unknown as {
  __pr_sql?: ReturnType<typeof postgres>;
};
const client = globalForDb.__pr_sql ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForDb.__pr_sql = client;

export const db = drizzle(client, { schema });
export { schema };
