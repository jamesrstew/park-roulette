import { beforeAll, describe, expect, it } from "vitest";
import { draftImageKey, draftImageKeyOk } from "./image-key";
import { postImageUrl, weatherImageUrl } from "./template";
import type { Issue } from "./issue";

describe("draft images need the dry-run key (L3)", () => {
  beforeAll(() => {
    process.env.CRON_SECRET = "a-cron-secret-for-tests";
  });
  it("accepts only that date's key", () => {
    const k = draftImageKey("2026-12-03");
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(draftImageKeyOk("2026-12-03", k)).toBe(true);
    expect(draftImageKeyOk("2026-12-10", k)).toBe(false);
    expect(draftImageKeyOk("2026-12-03", null)).toBe(false);
    expect(draftImageKeyOk("2026-12-03", "x")).toBe(false);
  });
  it("puts the key on the dry run's image links only when given", () => {
    const issue = {
      issue_date: "2026-12-03",
      weekend_ahead: {
        days: ["Friday", "Saturday", "Sunday"].map((label, i) => ({
          date: `2026-12-0${4 + i}`,
          label,
          condition: "Sunny",
          icon: "sun",
          high: 50,
          low: 30,
          precip: 0,
        })),
      },
      meme: {
        snapshot: { card: { path: "p", width: 1, height: 1, alt: "a" } },
      },
    } as unknown as Issue;
    const site = "https://parkroulette.quest";
    expect(weatherImageUrl(site, issue)).toBe(
      `${site}/newsletter/2026-12-03/weather.png`,
    );
    expect(weatherImageUrl(site, issue, "abc")).toBe(
      `${site}/newsletter/2026-12-03/weather.png?k=abc`,
    );
    expect(postImageUrl(site, issue, "abc")).toBe(
      `${site}/newsletter/2026-12-03/post.png?k=abc`,
    );
  });
});
