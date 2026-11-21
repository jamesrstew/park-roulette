import { describe, expect, it, vi } from "vitest";

/** The issue page's link preview tags (iMessage, Facebook, Slack, X). */
const ISSUE = {
  issue_date: "2026-12-03",
  subject: "Juniper and the rain",
  preview: "Plus a covered skate this week.",
  hello: { text: "h".repeat(40) },
  weekend_ahead: {
    days: [
      {
        date: "2026-12-04",
        label: "Friday",
        condition: "Sunny",
        icon: "sun",
        high: 45,
        low: 25,
        precip: 0,
      },
      {
        date: "2026-12-05",
        label: "Saturday",
        condition: "Snow",
        icon: "snow",
        high: 29,
        low: 20,
        precip: 80,
      },
      {
        date: "2026-12-06",
        label: "Sunday",
        condition: "Sunny",
        icon: "sun",
        high: 36,
        low: 20,
        precip: 0,
      },
    ],
  },
  wheel_pick: {
    park: "wildflower-park-bend",
    why_now: "w",
    who_for: "w",
    bring: "b",
  },
  passport: { challenge_id: "x", text: "t" },
  signoff: { text: "s" },
};
vi.mock("@/lib/news/data", () => ({
  sentIssue: async (d: string) =>
    d === "2026-12-03" ? { issue: ISSUE, plan: null } : null,
  sentIssues: async () => [],
  loadParks: async () => [
    { slug: "wildflower-park-bend", name: "Wildflower Park", city: "Bend" },
  ],
}));
vi.mock("@/db", () => ({ db: {} }));

describe("the issue page's metadata", () => {
  it("names the subject, the preview line, the canonical URL and the 1200x630 picture", async () => {
    const { generateMetadata } = await import("./[date]/page");
    const m = await generateMetadata({
      params: Promise.resolve({ date: "2026-12-03" }),
    });
    const url = "https://parkroulette.quest/newsletter/2026-12-03";
    expect(m.metadataBase?.toString()).toBe("https://parkroulette.quest/");
    expect(m.alternates?.canonical).toBe("/newsletter/2026-12-03");
    expect(m.openGraph).toMatchObject({
      url,
      siteName: "Park Roulette",
      title: "Juniper and the rain",
      description: "Plus a covered skate this week.",
    });
    const image = {
      url: `${url}/preview.jpg`,
      width: 1200,
      height: 630,
      type: "image/jpeg",
    };
    expect((m.openGraph as { images: unknown[] }).images[0]).toMatchObject(
      image,
    );
    expect(m.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Juniper and the rain",
    });
    expect((m.twitter as { images: unknown[] }).images[0]).toMatchObject(image);
    const alt = (m.openGraph as { images: { alt: string }[] }).images[0].alt;
    expect(alt).toMatch(/^Wildflower Park\. Weekend forecast for Bend\./);
    // A date that didn't go out: no index, no preview.
    const lost = await generateMetadata({
      params: Promise.resolve({ date: "2026-12-10" }),
    });
    expect(lost.robots).toEqual({ index: false });
    expect(lost.openGraph).toBeUndefined();
  });
});
