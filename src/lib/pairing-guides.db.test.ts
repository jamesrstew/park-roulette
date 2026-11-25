import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The park pairings guides' refresh against a real (local) Postgres: the
 * rotation, the Places budget, the 30-day purge, and what a page shows.
 * Opt-in: set TEST_DATABASE_URL. Places is a stub; nothing leaves.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);

const alerts: string[] = [];
vi.mock("@/lib/alerts", () => ({
  alertLater: (a: { key: string }) => alerts.push(a.key),
  sendAlert: async () => {},
}));
const pings: string[][] = [];
vi.mock("@/lib/indexnow", () => ({
  pingIndexNow: async (urls: string[]) => {
    pings.push(urls);
  },
}));

/** Three cafes, each a short walk from one of three Bend parks. */
const PARKS = [
  ["empire-crossing-park-bend", "Empire Crossing Park", 44.09267, -121.29746],
  ["farewell-bend-park-bend", "Farewell Bend Park", 44.04112, -121.32568],
  ["compass-park-bend", "Compass Park", 44.0526, -121.3473],
] as const;
let down = false;
let calls = 0;
const places = (async (_u: unknown, init?: RequestInit) => {
  calls++;
  if (down)
    return Response.json({ error: { status: "INTERNAL" } }, { status: 500 });
  const q = String(JSON.parse(String(init?.body)).textQuery);
  if (!/^coffee/.test(q) || !/Bend/.test(q))
    return Response.json({ places: [] });
  return Response.json({
    places: PARKS.map(([slug, , lat, lng], i) => ({
      id: `cafe-${i}`,
      displayName: { text: `Cafe ${slug.split("-")[0]}` },
      location: { latitude: lat + 0.1 / 69, longitude: lng },
      addressComponents: [{ shortText: "Bend", types: ["locality"] }],
      businessStatus: "OPERATIONAL",
      primaryType: "coffee_shop",
      goodForChildren: true,
      menuForChildren: false,
      outdoorSeating: true,
      dineIn: true,
      rating: 4.7,
      userRatingCount: 400,
    })),
  });
}) as unknown as typeof fetch;

describe.skipIf(!local)("pairing guides, against Postgres", () => {
  let data: typeof import("./pairing-guides-data");
  let q: (s: string) => Promise<Record<string, unknown>[]>;
  const NOW = new Date("2026-11-26T10:50:00Z");

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    data = await import("./pairing-guides-data");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    alerts.length = 0;
    pings.length = 0;
    calls = 0;
    down = false;
    process.env.GOOGLE_PLACES_KEY = "test-places-key";
    await q(
      "truncate pairing_guides, places_usage, parks restart identity cascade",
    );
    for (const [slug, name, lat, lng] of PARKS)
      await q(`insert into parks (slug, name, city, lat, lng, approved_at, features)
        values ('${slug}', '${name}', 'Bend', ${lat}, ${lng}, now(), '{}')`);
  });

  it("refreshes the stalest pages within budget; a page shows with 3 pairs", async () => {
    const r = await data.refreshPairingGuides(NOW, {
      placesFetch: places,
      max: 3,
    });
    expect(r.refreshed).toHaveLength(3);
    expect(calls).toBeLessThanOrEqual(12);
    const v = await data.loadPairingGuide(
      "coffee-shops-near-playgrounds-bend",
      NOW,
    );
    expect(v?.pairs).toHaveLength(3);
    expect(v?.pairs.every((p) => p.anchorKind === "park")).toBe(true);
    // Only names and our words: no rating or attribute is stored.
    const [row] = await q(
      `select pairs::text as p, place_ids from pairing_guides where slug = 'coffee-shops-near-playgrounds-bend'`,
    );
    expect(String(row.p)).not.toMatch(/rating|goodForChildren|outdoor|4\.7/);
    expect(row.place_ids).toEqual(
      expect.arrayContaining(["cafe-0", "cafe-1", "cafe-2"]),
    );
    expect(pings.flat()).toContain(
      "https://parkroulette.quest/guides/coffee-shops-near-playgrounds-bend",
    );
    // A page under 3 pairs doesn't exist.
    expect(
      await data.loadPairingGuide("breweries-near-playgrounds-bend", NOW),
    ).toBeNull();
    expect((await data.allPairingGuides(NOW)).map((g) => g.def.slug)).toEqual([
      "coffee-shops-near-playgrounds-bend",
    ]);
    // The next run takes the next pages, not the same ones.
    const next = await data.refreshPairingGuides(NOW, {
      placesFetch: places,
      max: 3,
    });
    expect(next.refreshed.some((s) => r.refreshed.includes(s))).toBe(false);
  });

  it("Places down keeps the last good pairs; after 30 days they're purged to ids", async () => {
    await data.refreshPairingGuides(NOW, { placesFetch: places, max: 1 });
    down = true;
    const later = new Date(NOW.getTime() + 7 * 86_400_000);
    const r = await data.refreshPairingGuides(later, {
      placesFetch: places,
      backoffMs: 1,
      max: 1,
    });
    expect(r.refreshed).toEqual([]);
    expect(
      await data.loadPairingGuide("coffee-shops-near-playgrounds-bend", later),
    ).not.toBeNull();
    // 31 days on: the page is gone, and the names with it.
    await q(
      `update pairing_guides set refreshed_at = now() - interval '31 days', tried_at = now()`,
    );
    await data.refreshPairingGuides(new Date(), {
      placesFetch: places,
      max: 0,
    });
    const [row] = await q(
      `select pairs::text as p, place_ids from pairing_guides where slug = 'coffee-shops-near-playgrounds-bend'`,
    );
    expect(row.p).toBe("[]");
    expect((row.place_ids as string[]).length).toBe(3);
    expect(
      await data.loadPairingGuide(
        "coffee-shops-near-playgrounds-bend",
        new Date(),
      ),
    ).toBeNull();
  });

  it("lastmod moves only when what a page shows changed; the make's 15 are kept", async () => {
    await data.refreshPairingGuides(NOW, { placesFetch: places, max: 1 });
    const first = await q(
      `select changed_at from pairing_guides where slug = 'coffee-shops-near-playgrounds-bend'`,
    );
    const later = new Date(NOW.getTime() + 7 * 86_400_000);
    await q(`update pairing_guides set tried_at = null`);
    await data.refreshPairingGuides(later, { placesFetch: places, max: 1 });
    const again = await q(
      `select changed_at, refreshed_at from pairing_guides where slug = 'coffee-shops-near-playgrounds-bend'`,
    );
    expect(again[0].changed_at).toEqual(first[0].changed_at);
    expect(new Date(String(again[0].refreshed_at)).getTime()).toBe(
      later.getTime(),
    );
    // 45 used today: the guides leave the rest for the Wednesday make.
    calls = 0;
    await q(
      `insert into places_usage (day, requests) values ('2026-12-03', 45) on conflict (day) do update set requests = 45`,
    );
    const r = await data.refreshPairingGuides(
      new Date("2026-12-03T18:00:00Z"),
      { placesFetch: places, max: 4 },
    );
    expect(r.refreshed).toEqual([]);
    expect(calls).toBe(0);
  });

  it("a page that fails its text check is stamped, so the rotation moves on", async () => {
    // Every Bend search fails hard (a 400): each page is stamped, none stalls.
    const bad = (async () =>
      Response.json(
        { error: { status: "INVALID_ARGUMENT" } },
        { status: 400 },
      )) as unknown as typeof fetch;
    const r = await data.refreshPairingGuides(NOW, {
      placesFetch: bad,
      max: 2,
    });
    expect(r.skipped).toHaveLength(2);
    const tried = await q(
      `select slug from pairing_guides where tried_at is not null`,
    );
    expect(tried).toHaveLength(2);
    const next = await data.refreshPairingGuides(NOW, {
      placesFetch: places,
      max: 2,
    });
    expect(next.refreshed.some((s) => r.skipped.includes(s))).toBe(false);
  });

  it("the day's Places cap stops a run without an alert", async () => {
    await q(
      `insert into places_usage (day, requests) values ('2026-11-26', 60)`,
    );
    const r = await data.refreshPairingGuides(NOW, {
      placesFetch: places,
      max: 2,
    });
    expect(r.refreshed).toEqual([]);
    expect(calls).toBe(0);
    expect(alerts).toEqual([]);
  });
});
