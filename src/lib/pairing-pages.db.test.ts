import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pairing pages against a real (local) Postgres: born when a park pairings
 * post publishes (never from a draft, never twice, with no Places
 * request), names refreshed by place id or purged at 30 days, under 3
 * pairs no page. Opt-in: set TEST_DATABASE_URL. Places is a stub.
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

const PARKS = [
  ["pine-nursery-park-bend", "Pine Nursery Park"],
  ["larkspur-park-bend", "Larkspur Park"],
  ["hollinshead-park-bend", "Hollinshead Park"],
  ["juniper-park-bend", "Juniper Park"],
] as const;

const slide = (i: number, o: Record<string, unknown> = {}) => ({
  t: "pair",
  n: i + 1,
  of: 5,
  icon: "cup",
  place: `Cafe ${i}`,
  park: PARKS[i]?.[1] ?? "Storytime",
  town: "Bend",
  apart: "6-minute walk",
  walk: true,
  trait: "A big climbing net",
  placeId: `cafe-${i}`,
  parkSlug: PARKS[i]?.[0] ?? "storytime@2026-12-05",
  kind: "park",
  label: "At the park",
  site: null,
  ...o,
});

/** A park pairings post's spec: 4 park pairs and a weekend event. */
const spec = (theme = "coffee") => ({
  kind: "mashup",
  size: "feed",
  slides: [
    {
      t: "headline",
      words: "Coffee and a playground",
      highlight: "Coffee",
      kicker: "Park pairings",
    },
    slide(0),
    slide(1, { walk: false, apart: "Short drive" }),
    slide(2),
    slide(3),
    slide(4, {
      kind: "event",
      label: "This weekend",
      place: "Cafe 4",
      placeId: "cafe-4",
    }),
  ],
  alts: [],
  caption: "x",
  fbCaption: null,
  headline: "Coffee and a playground",
  modelText: "",
  facts: {
    parks: [],
    events: [],
    venues: [],
    issue: null,
    mashup: { theme, cycle: 0, pairs: [] },
  },
});

let calls: string[] = [];
let detail: (id: string) => Response = (id) =>
  Response.json({
    displayName: { text: `Cafe ${id.split("-")[1]} (new)` },
    businessStatus: "OPERATIONAL",
  });
const places = (async (u: unknown) => {
  calls.push(String(u));
  const id = decodeURIComponent(String(u).split("/places/")[1] ?? "");
  return detail(id);
}) as unknown as typeof fetch;

describe.skipIf(!local)("pairing pages, against Postgres", () => {
  let data: typeof import("./pairing-pages-data");
  let q: (s: string) => Promise<Record<string, unknown>[]>;
  let post: (o: {
    status: string;
    slot: string;
    createdAt: Date;
    publishedAt?: Date | null;
    theme?: string;
  }) => Promise<number>;
  const NOW = new Date("2026-12-03T04:00:00Z");
  const day = 86_400_000;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    data = await import("./pairing-pages-data");
    const { db } = await import("@/db");
    const { socialPosts } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
    post = async (o) => {
      const [r] = await db
        .insert(socialPosts)
        .values({
          kind: "mashup",
          slotDate: o.slot,
          publishAt: o.createdAt,
          origin: "code",
          status: o.status,
          body: { pairs: [] },
          spec: spec(o.theme),
          createdAt: o.createdAt,
          publishedAt: o.publishedAt ?? null,
        })
        .returning({ id: socialPosts.id });
      return r.id;
    };
  });

  beforeEach(async () => {
    alerts.length = 0;
    pings.length = 0;
    calls = [];
    detail = (id) =>
      Response.json({
        displayName: { text: `Cafe ${id.split("-")[1]} (new)` },
        businessStatus: "OPERATIONAL",
      });
    process.env.GOOGLE_PLACES_KEY = "test-places-key";
    await q(
      "truncate pairing_pages, pairing_places, places_usage, social_posts, parks restart identity cascade",
    );
    for (const [i, [slug, name]] of PARKS.entries())
      await q(`insert into parks (slug, name, city, lat, lng, approved_at, features)
        values ('${slug}', '${name}', 'Bend', ${44.05 + i / 100}, -121.3, now(), '{${i === 0 ? "toddler_area,fenced" : ""}}')`);
  });

  it("a published post is born as its page at once, with no Places request", async () => {
    const made = new Date(NOW.getTime() - 2 * 3_600_000);
    const queued = await post({
      status: "queued",
      slot: "2026-12-16",
      createdAt: made,
    });
    const dry = await post({
      status: "dry_run",
      slot: "2026-12-30",
      createdAt: made,
    });
    const id = await post({
      status: "published",
      slot: "2026-12-02",
      createdAt: made,
      publishedAt: new Date(NOW.getTime() - 15 * 60_000),
    });
    const r = await data.birthPairingPages(NOW);
    expect(r.born).toEqual(["coffee-near-pine-nursery-larkspur-hollinshead"]);
    expect(calls).toEqual([]);
    const v = await data.loadPairingPage(r.born[0], NOW);
    expect(v?.postId).toBe(id);
    // The weekend event never makes the page.
    expect(v?.pairs.map((p) => p.place)).toEqual([
      "Cafe 0",
      "Cafe 1",
      "Cafe 2",
      "Cafe 3",
    ]);
    expect(v?.title).toBe(
      "Coffee near Pine Nursery and Larkspur parks, Bend, OR",
    );
    // The post's own headline is the page's angle.
    expect(v?.angle).toBe("Coffee and a playground.");
    expect(v?.superseded).toBe(false);
    expect(v?.pairs[0].anchorHas).toEqual(["toddler area", "fenced"]);
    // Ids and our words only in the page; the names live apart, dated.
    const [row] = await q(`select pairs::text as p from pairing_pages`);
    expect(String(row.p)).not.toContain("Cafe");
    const names = await q(
      `select place_id, name, refreshed_at from pairing_places order by place_id`,
    );
    expect(names.map((n) => n.place_id)).toEqual([
      "cafe-0",
      "cafe-1",
      "cafe-2",
      "cafe-3",
    ]);
    expect(new Date(String(names[0].refreshed_at)).getTime()).toBe(
      made.getTime(),
    );
    // IndexNow hears of the page, the hub and the theme guide it links.
    expect(pings.flat()).toEqual(
      expect.arrayContaining([
        "https://parkroulette.quest/guides/pairings/coffee-near-pine-nursery-larkspur-hollinshead",
        "https://parkroulette.quest/guides/pairings",
        "https://parkroulette.quest/guides/coffee-shops-near-playgrounds-bend",
        // Park pages whose Nearby line now links it.
        "https://parkroulette.quest/parks/larkspur-park-bend",
      ]),
    );
    // What it shows is kept as a hash: no business name in the row.
    const [k] = await q(`select shown_key from pairing_pages`);
    expect(String(k.shown_key)).toMatch(/^[0-9a-f]{64}$/);
    expect(await data.pageForPost(id, NOW)).not.toBeNull();
    expect(await data.pageForPost(queued, NOW)).toBeNull();
    expect(await data.pageForPost(dry, NOW)).toBeNull();
    expect(
      (await data.pagesForPark("larkspur-park-bend", NOW)).map((p) => p.slug),
    ).toEqual(["coffee-near-pine-nursery-larkspur-hollinshead"]);
    // Once per post, ever.
    expect((await data.birthPairingPages(NOW)).born).toEqual([]);
    // A second post on the same parks gets its own slug.
    await post({
      status: "published",
      slot: "2027-01-13",
      createdAt: NOW,
      publishedAt: NOW,
    });
    await q(
      `update social_posts set status = 'published', published_at = now() where id = ${queued}`,
    );
    const again = await data.birthPairingPages(NOW);
    expect(again.born.sort()).toEqual([
      "coffee-near-pine-nursery-larkspur-hollinshead-2",
      "coffee-near-pine-nursery-larkspur-hollinshead-3",
    ]);
    // Newest first; the older ones repeat its places: noindex,follow.
    const all = await data.allPairingPages(NOW);
    expect(all[0].postId).not.toBe(id);
    expect(all.map((v) => v.superseded)).toEqual([false, true, true]);
    expect((await data.loadPairingPage(r.born[0], NOW))?.superseded).toBe(true);
  });

  it("the proxy's gone check: real 404s only for pages that don't show", async () => {
    const { guideGone } = await import("./guide-gone");
    await post({
      status: "published",
      slot: "2026-12-02",
      createdAt: NOW,
      publishedAt: NOW,
    });
    const [slug] = (await data.birthPairingPages(NOW)).born;
    expect(await guideGone(`/guides/pairings/${slug}`)).toBe(false);
    expect(await guideGone("/guides/pairings/no-such-page")).toBe(true);
    expect(await guideGone("/guides/pairings")).toBe(false);
    expect(await guideGone("/guides/sledding-hills-bend")).toBe(false);
    expect(await guideGone("/guides/no-such-guide")).toBe(true);
    // A theme guide with no fresh pairs is gone; the index never is.
    expect(await guideGone("/guides/breweries-near-playgrounds-bend")).toBe(
      true,
    );
    expect(await guideGone("/guides")).toBe(false);
    // Hidden at its last check: gone.
    await q(`update pairing_pages set shown_key = ''`);
    expect(await guideGone(`/guides/pairings/${slug}`)).toBe(true);
  });

  it("a post published long ago is born with ids only, and shows once its names are read", async () => {
    const old = new Date(NOW.getTime() - 60 * day);
    await post({
      status: "published",
      slot: "2026-10-01",
      createdAt: old,
      publishedAt: old,
    });
    const r = await data.birthPairingPages(NOW);
    expect(r.born).toHaveLength(1);
    expect(await data.loadPairingPage(r.born[0], NOW)).toBeNull();
    const names = await q(`select name from pairing_places`);
    expect(names.every((n) => n.name === null)).toBe(true);
    const f = await data.refreshPairingPlaces(NOW, { placesFetch: places });
    expect(f.read).toBe(4);
    // Place Details by id only, never a Text Search.
    expect(calls.every((u) => /\/v1\/places\/cafe-\d$/.test(u))).toBe(true);
    const v = await data.loadPairingPage(r.born[0], NOW);
    expect(v?.pairs.map((p) => p.place)).toEqual([
      "Cafe 0",
      "Cafe 1",
      "Cafe 2",
      "Cafe 3",
    ]);
    expect(f.moved).toEqual(r.born);
    const [u] = await q(`select details, requests from places_usage`);
    expect(u).toEqual({ details: 4, requests: 0 });
    // Read now: not due again for three weeks.
    calls = [];
    await data.refreshPairingPlaces(new Date(NOW.getTime() + 2 * day), {
      placesFetch: places,
    });
    expect(calls).toEqual([]);
  });

  it("names older than 30 days are purged; closed and gone places hide; under 3, no page", async () => {
    const made = new Date(NOW.getTime() - 3_600_000);
    await post({
      status: "published",
      slot: "2026-12-02",
      createdAt: made,
      publishedAt: NOW,
    });
    const [slug] = (await data.birthPairingPages(NOW)).born;
    // Google down for a month: the names go at 30 days, and the page.
    detail = () =>
      Response.json({ error: { status: "INTERNAL" } }, { status: 500 });
    const later = new Date(NOW.getTime() + 31 * day);
    const r = await data.refreshPairingPlaces(later, { placesFetch: places });
    expect(r.purged).toBe(4);
    expect(await data.loadPairingPage(slug, later)).toBeNull();
    expect(r.moved).toEqual([slug]);
    expect(alerts).toContain(`pairing-pages:refresh:2027-01-02`);
    // Back up the next day: one closed for good, one unknown, two fine.
    detail = (id) =>
      id === "cafe-0"
        ? Response.json({
            displayName: { text: "Cafe 0" },
            businessStatus: "CLOSED_PERMANENTLY",
          })
        : id === "cafe-1"
          ? Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 })
          : Response.json({
              displayName: { text: `Cafe ${id.split("-")[1]}` },
              businessStatus: "OPERATIONAL",
            });
    const next = new Date(later.getTime() + day);
    await data.refreshPairingPlaces(next, { placesFetch: places });
    expect(await data.loadPairingPage(slug, next)).toBeNull();
    const st = await q(
      `select place_id, status, name from pairing_places order by place_id`,
    );
    expect(st.map((s) => s.status)).toEqual(["gone", "gone", "ok", "ok"]);
    // A page that can never show again costs no more requests.
    calls = [];
    await q(
      `update pairing_places set refreshed_at = now() - interval '25 days', tried_at = null`,
    );
    await data.refreshPairingPlaces(new Date(), { placesFetch: places });
    expect(calls).toEqual([]);
  });

  it("stops at the day's 20 Place Details requests", async () => {
    const old = new Date(NOW.getTime() - 60 * day);
    for (let i = 0; i < 6; i++)
      await post({
        status: "published",
        slot: `2026-10-${String(i + 1).padStart(2, "0")}`,
        createdAt: old,
        publishedAt: old,
        theme: i % 2 ? "treats" : "coffee",
      });
    // Six posts on the same four places: four reads serve them all.
    await data.birthPairingPages(NOW);
    expect(
      (await data.refreshPairingPlaces(NOW, { placesFetch: places })).read,
    ).toBe(4);
    await q(`update places_usage set details = 19`);
    await q(
      `update pairing_places set refreshed_at = null, tried_at = null, name = null`,
    );
    const r = await data.refreshPairingPlaces(NOW, { placesFetch: places });
    expect(r.read).toBe(1);
  });

  it("a brewery page names a brewery; no other page prints a drinks word", async () => {
    detail = (id) =>
      Response.json({
        displayName: {
          text:
            id === "cafe-0" ? "Cafe and Taproom" : `Cafe ${id.split("-")[1]}`,
        },
        businessStatus: "OPERATIONAL",
      });
    const old = new Date(NOW.getTime() - 60 * day);
    await post({
      status: "published",
      slot: "2026-10-01",
      createdAt: old,
      publishedAt: old,
    });
    await data.birthPairingPages(NOW);
    await data.refreshPairingPlaces(NOW, { placesFetch: places });
    const [c0] = await q(
      `select status, name from pairing_places where place_id = 'cafe-0'`,
    );
    expect(c0).toEqual({ status: "unfit", name: null });
    const [v] = await data.allPairingPages(NOW);
    expect(v.pairs.map((p) => p.place)).toEqual(["Cafe 1", "Cafe 2", "Cafe 3"]);
  });
});
