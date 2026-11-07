import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function makeClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // Railway's public proxy uses a self-signed cert: encrypt, skip CA checks.
  return postgres(url, {
    max: 3,
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
