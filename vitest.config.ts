import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // The database tests share one scratch database: run files one at a
    // time when it's set.
    fileParallelism: !process.env.TEST_DATABASE_URL,
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Tests run server modules directly; the marker package only
      // matters inside Next.
      "server-only": path.resolve(
        __dirname,
        "node_modules/server-only/empty.js",
      ),
    },
  },
});
