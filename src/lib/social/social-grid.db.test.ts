import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The link-in-bio grid (/social) against a real (local) Postgres: what the
 * public reads may show, and the Facebook caption's own-page link filled in
 * when a post is stored. Opt-in: set TEST_DATABASE_URL.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);

vi.mock("@/lib/alerts", () => ({
  alertLater: () => {},
  sendAlert: async () => {},
}));
vi.mock("./render", () => ({
  photosFor: async () => [],
  renderPost: async (spec: { slides: unknown[] }) =>
    spec.slides.map((_, i) => ({
      bytes: Buffer.from(String(i)),
      file: {
        sha: `d${i}`.repeat(32),
        ext: "jpg",
        role: "slide",
        width: 1080,
        height: 1350,
        alt: `crayon ${i + 1}`,
      },
    })),
  storeMedia: async (files: { file: unknown }[]) => files.map((f) => f.file),
}));

const PHOTO = {
  src: "https://www.bendparksandrec.org/wp-content/uploads/2015/05/Larkspur-2-1024x685.jpg",
  sha256: "9".repeat(64),
  credit: "Photo: Bend Park & Recreation District",
};

describe.skipIf(!local)("the /social grid, against Postgres", () => {
  let store: typeof import("./store");
  let pub: typeof import("./public");
  let links: typeof import("./links");
  let q: (s: string) => Promise<Record<string, unknown>[]>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    store = await import("./store");
    pub = await import("./public");
    links = await import("./links");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    await q(
      "truncate social_dm_replies, social_posts, social_photo_checks restart identity cascade",
    );
  });

  const spec = (kind: string, extra: Record<string, unknown> = {}) => ({
    kind,
    size: kind === "story" ? "story" : "feed",
    slides: [],
    alts: [],
    caption: "Caption.\nLink in bio.",
    fbCaption: `Caption.\nDetails and links: ${links.PENDING_POST_LINK}`,
    headline: "Headline words here",
    modelText: "",
    facts: {
      parks: kind === "park_post" ? ["larkspur-park-bend"] : [],
      events: [],
      venues: [],
      issue: kind === "teaser" ? "2026-11-26" : null,
    },
    ...extra,
  });
  const lit = (x: unknown) => `'${JSON.stringify(x).replace(/'/g, "''")}'`;
  async function insert(
    kind: string,
    slot: string,
    status: string,
    o: { spec?: unknown; publishedAt?: string; ch?: string } = {},
  ): Promise<number> {
    const ch = o.ch ?? "a";
    const m = [
      {
        sha: ch.repeat(64),
        ext: "jpg",
        role: "slide",
        width: 1080,
        height: 1350,
        alt: `${kind} cover`,
      },
    ];
    const [r] = await q(`insert into social_posts
      (kind, slot_date, publish_at, origin, status, body, spec, media, published_at)
      values ('${kind}', '${slot}', '${slot}T20:00:00Z', 'writer', '${status}', '{}',
        ${lit(o.spec ?? spec(kind))}, ${lit(m)},
        ${status === "published" ? `'${o.publishedAt ?? `${slot}T20:05:00Z`}'` : "null"})
      returning id`);
    return Number(r.id);
  }

  it("lists published feed posts only, newest first, each with its destination", async () => {
    const park = await insert("park_post", "2026-11-16", "published", {
      ch: "1",
    });
    const events = await insert("events_week", "2026-11-17", "published", {
      ch: "2",
    });
    const home = await insert("at_home", "2026-11-21", "published", {
      ch: "3",
    });
    await insert("story", "2026-11-20", "published", { ch: "4" });
    await insert("unpack", "2026-11-18", "dry_run", { ch: "5" });
    await insert("teaser", "2026-11-19", "failed", { ch: "6" });
    await insert("park_post", "2026-11-23", "queued", { ch: "7" });
    await insert("unpack", "2026-11-25", "skipped", { ch: "8" });
    const tiles = await pub.loadPostTiles();
    expect(tiles.map((t) => [t.id, t.href, t.to])).toEqual([
      [home, `/social/${home}`, "post"],
      [events, "/events?week=2026-11-17", "events"],
      [park, "/parks/larkspur-park-bend", "park"],
    ]);
    // The grid itself adds the press tiles by day (The Bulletin, Nov 25).
    expect((await pub.loadGrid()).map((t) => t.id)).toEqual([
      -1,
      home,
      events,
      park,
    ]);
    expect(tiles[0].cover).toMatchObject({
      sha: "3".repeat(64),
      alt: "at_home cover",
    });
    expect(await pub.loadPost(home)).toMatchObject({
      id: home,
      kind: "at_home",
    });
    // Not published, a Story, or no such post: no page.
    for (const id of [park + 100, 4, 5, 7])
      expect(await pub.loadPost(id)).toBeNull();
  });

  it("takes a post down when a later look flags its photo, and never shows a downgraded one", async () => {
    const withPhoto = spec("park_post", {
      slides: [
        { t: "parkcard", park: "Larkspur Park", town: "Bend", photo: PHOTO },
      ],
    });
    const id = await insert("park_post", "2026-11-16", "published", {
      spec: withPhoto,
    });
    // No clear verdict on these bytes: never shown.
    expect(await pub.loadPostTiles()).toEqual([]);
    await q(
      `insert into social_photo_checks (src, sha256, verdict) values ('${PHOTO.src}', '${PHOTO.sha256}', 'clear')`,
    );
    expect((await pub.loadPostTiles()).map((t) => t.id)).toEqual([id]);
    await q(
      `insert into social_photo_checks (src, sha256, verdict) values ('${PHOTO.src}', '${"8".repeat(64)}', 'people')`,
    );
    expect(await pub.loadPostTiles()).toEqual([]);
    expect(await pub.loadPost(id)).toBeNull();

    // A queued post redrawn as the crayon card (a person was seen), then
    // published: its crayon card is fine on Instagram, but not shown here.
    await q("truncate social_photo_checks");
    const queued = await insert("park_post", "2026-11-23", "queued", {
      spec: withPhoto,
      ch: "b",
    });
    const r = await store.downgradeToCrayon(queued, "a child by the slide");
    expect(r.ok).toBe(true);
    await q(
      `update social_posts set status = 'published', published_at = now(), reason = null where id = ${queued}`,
    );
    const [row] = await q(
      `select report, spec from social_posts where id = ${queued}`,
    );
    expect(row.report).toMatchObject({ downgraded: "a child by the slide" });
    expect(await pub.loadPost(queued)).toBeNull();
  });

  it("stores an at-home post with its own page in the Facebook caption", async () => {
    const id = await store.upsertPost({
      kind: "at_home",
      slotDate: "2026-11-28",
      publishAt: new Date("2026-11-28T15:45:00Z"),
      origin: "writer",
      body: {},
      spec: spec("at_home") as never,
      media: [],
      report: null,
    });
    expect(id).not.toBeNull();
    const [row] = await q(`select id, spec from social_posts where id = ${id}`);
    expect(Number(row.id)).toBe(id);
    expect((row.spec as { fbCaption: string }).fbCaption).toBe(
      `Caption.\nDetails and links: https://parkroulette.quest/social/${id}?from=fb`,
    );
    // The sequence keeps going: the next post gets the next id, no clash.
    const next = await store.upsertPost({
      kind: "unpack",
      slotDate: "2026-11-25",
      publishAt: new Date("2026-11-26T03:45:00Z"),
      origin: "writer",
      body: {},
      spec: spec("unpack") as never,
      media: [],
      report: null,
    });
    expect(next).toBe(id! + 1);
  });
});
