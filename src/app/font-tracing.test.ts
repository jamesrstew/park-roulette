import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The card fonts must ship inside every function that can draw a card
 * (next.config.ts outputFileTracingIncludes): they're read with readFile,
 * which the bundler can't see. Reads the trace files a `next build` left;
 * skipped when there's no build.
 */
const SERVER = join(process.cwd(), ".next/server/app");
const ROUTES = [
  "api/news/drafts/route",
  "api/news/check/route",
  "api/news/plan/route",
  "api/cron/news-send/route",
  "newsletter/[date]/post.png/route",
  "newsletter/[date]/weather.png/route",
  "newsletter/[date]/page",
];
const FONTS = [
  "Inter-Regular.ttf",
  "Inter-Bold.ttf",
  "GochiHand-Regular.ttf",
  "Inter-OFL.txt",
  "GochiHand-OFL.txt",
];
const built = existsSync(join(SERVER, `${ROUTES[0]}.js.nft.json`));

describe.skipIf(!built)("card fonts in the function bundles", () => {
  for (const route of ROUTES)
    it(`${route} traces every font`, () => {
      const trace = JSON.parse(
        readFileSync(join(SERVER, `${route}.js.nft.json`), "utf8"),
      ) as { files: string[] };
      for (const f of FONTS)
        expect(
          trace.files.some((x) => x.endsWith(`public/fonts/${f}`)),
          `${route}: ${f}`,
        ).toBe(true);
    });
});
