/* eslint-disable @typescript-eslint/no-require-imports */
// Mobile screenshot helper for design review:
//   node scripts/shot.cjs <url> <out.png> [selector-to-click]
// LOGIN_ID=1 signs in as explorer 1 first (dev only). Uses CHROME_PATH or Playwright's bundled browser.
const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");

const fallback = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const executablePath =
  process.env.CHROME_PATH || (fs.existsSync(fallback) ? fallback : undefined);

(async () => {
  const [, , url, out, click] = process.argv;
  const b = await chromium.launch({ executablePath });
  const ctx = await b.newContext({ ...devices["iPhone 14"] });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  p.on(
    "console",
    (m) => m.type() === "error" && console.log("CONSOLE", m.text()),
  );
  if (process.env.LOGIN_ID) {
    const origin = new URL(url).origin;
    await p.goto(`${origin}/api/dev-login?id=${process.env.LOGIN_ID}`);
  }
  await p.goto(url, { waitUntil: "networkidle" });
  if (click) {
    await p.click(click);
    await p.waitForTimeout(6500);
  }
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
})();
