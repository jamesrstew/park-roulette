import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const host = new URL(url).host;
console.log(`Migrating ${host} ...`);
const client = postgres(url, { max: 1, ssl: local ? false : "require" });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
await client.end();
console.log("Done.");
