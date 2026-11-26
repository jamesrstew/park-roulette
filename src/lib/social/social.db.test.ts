import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Instagram publisher, drafts, the code posts and keyword DMs against a
 * real (local) Postgres. Opt-in: set TEST_DATABASE_URL. Meta is a stub that
 * records every call; rendering and Blob are stubbed (render.test.ts draws
 * real bytes). Nothing ever reaches the real Instagram API.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);

const alerts: { key: string; subject: string; text: string }[] = [];
vi.mock("@/lib/alerts", () => ({
  alertLater: (a: { key: string; subject: string; text: string }) =>
    alerts.push(a),
  sendAlert: async () => {},
}));
/** What the stub renderer was asked to draw (photos per slide). */
const drawn: (string | null)[][] = [];
let photoLoads = true;
/** Runs inside the stub storeMedia (null: nothing). */
let onStore: (() => Promise<void>) | null = null;
vi.mock("./render", () => ({
  loadPhoto: async (ref: unknown) =>
    ref && photoLoads ? "data:image/jpeg;base64,AA" : null,
  photosFor: async (spec: { slides: { photo?: unknown }[] }) =>
    spec.slides.map((s) =>
      s.photo && photoLoads ? "data:image/jpeg;base64,AA" : null,
    ),
  renderPost: async (
    spec: { slides: unknown[] },
    photos: (string | null)[] = [],
  ) => {
    drawn.push(spec.slides.map((_, i) => photos[i] ?? null));
    return spec.slides.map((_, i) => ({
      bytes: Buffer.from(String(i)),
      file: {
        sha: `${drawn.length % 10}${i}`.repeat(32),
        ext: "jpg",
        role: "slide",
        width: 1080,
        height: 1350,
        alt: `slide ${i + 1}`,
      },
    }));
  },
  storeMedia: async (files: { file: unknown }[]) => {
    // A test can act while the new media is "uploading" (a race).
    await onStore?.();
    return files.map((f) => f.file);
  },
}));
/**
 * The Story frames the stub drew: which slide, with its photo or not. A
 * frame's sha says both (slide number, then "a" with the photo, "c" the
 * crayon card).
 */
const echoes: { slide: number; photo: boolean }[] = [];
let echoBreaks = false;
const frameSha = (slide: number, photo: boolean) =>
  `${slide.toString(16).padStart(2, "0")}${photo ? "a" : "c"}`
    .repeat(22)
    .slice(0, 64);
vi.mock("./echo-render", () => ({
  renderFrame: async (_slides: unknown[], i: number, photo: string | null) => {
    if (echoBreaks) throw new Error("drawing broke");
    echoes.push({ slide: i, photo: !!photo });
    return {
      bytes: Buffer.from("frame"),
      file: {
        sha: frameSha(i, !!photo),
        ext: "jpg",
        width: 1080,
        height: 1920,
      },
    };
  },
  storeFrame: async (r: { file: unknown }) => r.file,
}));
vi.mock("@vercel/blob", () => ({
  get: async () => ({
    stream: new Blob(["jpeg"]).stream(),
    blob: { size: 4 },
  }),
  put: async () => ({}),
}));

/** Meta's stand-in. */
type Call = { method: string; path: string; body: URLSearchParams };
const calls: Call[] = [];
let containerState = "FINISHED";
/** The container's status once a publish was tried (null: containerState). */
let afterPublish: string | null = null;
let publishFails: "no" | "timeout" | "rate" | "bad" | "5xx" | "already" = "no";
/** Only the nth media_publish (1-based) fails, as publishFails says (null: all). */
let publishFailsOn: number | null = null;
/** A Story container create that times out (Meta may or may not have it). */
let storyCreateFails = false;
/** Story containers' status (null: containerState, as for feed posts). */
let storyState: string | null = null;
const storyContainers = new Set<string>();
/** Runs when a container's status is read (another worker, mid-run). */
let onStatus: ((id: string) => Promise<void>) | null = null;
let quota = 1;
/** Meta's publishing limit can't be read. */
let quotaFails = false;
let comments: { id: string; text: string; from: { id: string } }[] = [];
/** Business Discovery's answers by handle (missing: Meta's error). */
let discovered: Record<string, Record<string, unknown>> = {};
const meta = async (u: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(u));
  const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
  const body = new URLSearchParams(String(init?.body ?? ""));
  calls.push({ method: init?.method ?? "GET", path, body });
  const bd = /^business_discovery\.username\(([^)]+)\)/.exec(
    url.searchParams.get("fields") ?? "",
  );
  if (bd)
    return discovered[bd[1]]
      ? Response.json({ business_discovery: discovered[bd[1]] })
      : Response.json(
          {
            error: {
              message: "Invalid user id",
              code: 110,
              error_subcode: 2207013,
            },
          },
          { status: 400 },
        );
  if (path.endsWith("/content_publishing_limit") && quotaFails)
    return Response.json(
      { error: { message: "oops", code: 1 } },
      { status: 500 },
    );
  if (path.endsWith("/content_publishing_limit"))
    return Response.json({ data: [{ quota_usage: quota }] });
  if (path.endsWith("/media_publish")) {
    const nth = calls.filter((c) => c.path.endsWith("/media_publish")).length;
    if (publishFailsOn != null && nth !== publishFailsOn)
      return Response.json({ id: `IGMEDIA${nth}` });
    if (publishFails === "timeout") throw new Error("timeout");
    if (publishFails === "rate")
      return Response.json(
        { error: { message: "rate", code: 4 } },
        { status: 400 },
      );
    if (publishFails === "bad")
      return Response.json(
        { error: { message: "bad", code: 100 } },
        { status: 400 },
      );
    if (publishFails === "5xx")
      return Response.json(
        { error: { message: "oops", code: 1 } },
        { status: 502 },
      );
    if (publishFails === "already")
      return Response.json(
        {
          error: {
            message: "The media has already been published",
            code: 9,
            error_subcode: 2207051,
          },
        },
        { status: 400 },
      );
    return Response.json({ id: "IGMEDIA1" });
  }
  if (path.endsWith("/media")) {
    if (storyCreateFails && body.get("media_type") === "STORIES")
      throw new Error("timeout");
    if (body.get("media_type") === "STORIES")
      storyContainers.add(`C${calls.length}`);
    return Response.json({ id: `C${calls.length}` });
  }
  if (path.endsWith("/photos"))
    return Response.json({ id: `P${calls.length}` });
  if (path.endsWith("/feed")) return Response.json({ id: "FBPOST1" });
  if (path.endsWith("/comments")) return Response.json({ data: comments });
  if (path.endsWith("/conversations")) return Response.json({ data: [] });
  if (path.endsWith("/messages"))
    return Response.json({ recipient_id: "IGSID1", message_id: "aWdfMSG1" });
  if (path === "c1")
    return Response.json({
      id: "c1",
      text: "PARK",
      timestamp: "2026-11-23T20:00:00+0000",
      from: { id: "IGSID1", username: "someone" },
      media: { id: "IGMEDIA1" },
    });
  if (path === "aWdfMSG1")
    return Response.json({ id: "aWdfMSG1", message: "hi" });
  if (/^C\d+$/.test(path)) {
    await onStatus?.(path);
    return Response.json({
      status_code:
        afterPublish &&
        calls.some(
          (c) =>
            c.path.endsWith("/media_publish") &&
            c.body.get("creation_id") === path,
        )
          ? afterPublish
          : storyContainers.has(path)
            ? (storyState ?? containerState)
            : containerState,
    });
  }
  return new Response("no", { status: 404 });
};

const WEEK = "2026-11-23";
/** Sunday, November 22, 2026, 6 pm Pacific (the routine). */
const SUNDAY = new Date("2026-11-23T02:00:00Z");
/** Monday 11:50 am Pacific: 25 minutes before the park post. */
const MON_1150 = new Date("2026-11-23T19:50:00Z");
const MON_1215 = new Date("2026-11-23T20:15:00Z");
const LARKSPUR_PHOTO =
  "https://www.bendparksandrec.org/wp-content/uploads/2015/05/Larkspur-2-1024x685.jpg";

describe.skipIf(!local)("Instagram, against Postgres", () => {
  let store: typeof import("./store");
  let settings: typeof import("./settings");
  let dm: typeof import("./dm");
  let q: (s: string) => Promise<Record<string, unknown>[]>;
  const fetchImpl = meta as unknown as typeof fetch;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.IG_ACCESS_TOKEN = "test-token";
    process.env.IG_USER_ID = "17841400000000";
    process.env.CRON_SECRET = "test-cron-secret-123456789";
    store = await import("./store");
    // Waiting on Meta's containers: milliseconds here, not seconds.
    Object.assign((await import("./echo")).ECHO_POLL, {
      everyMs: 1,
      maxMs: 20,
    });
    settings = await import("./settings");
    dm = await import("./dm");
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    q = (s) =>
      db.execute(sql.raw(s)) as unknown as Promise<Record<string, unknown>[]>;
  });
  beforeEach(async () => {
    calls.length = 0;
    alerts.length = 0;
    drawn.length = 0;
    echoes.length = 0;
    echoBreaks = false;
    photoLoads = true;
    onStore = null;
    containerState = "FINISHED";
    afterPublish = null;
    publishFails = "no";
    publishFailsOn = null;
    storyCreateFails = false;
    storyState = null;
    storyContainers.clear();
    onStatus = null;
    quota = 1;
    quotaFails = false;
    comments = [];
    discovered = {};
    delete process.env.SOCIAL_PUBLISH;
    delete process.env.SOCIAL_KEYWORD_DMS;
    delete process.env.FB_PAGE_ID;
    process.env.VERCEL_ENV = "production";
    await q(
      "truncate social_dm_replies, social_posts, social_photo_checks, news_issues, news_settings, kid_events, parks, places_usage restart identity cascade",
    );
    await q(`insert into parks (slug, name, city, lat, lng, approved_at, features, address)
      values ('larkspur-park-bend', 'Larkspur Park', 'Bend', 44.03, -121.28, now(), '{accessible,shade,picnic,trail,sports_courts}', '1600 SE Reed Market Rd, Bend, OR 97701')`);
    await q(`insert into news_settings (id) values (1)`);
  });

  const postDraft = () => ({
    week_of: WEEK,
    posts: [
      {
        type: "park_post",
        park: "larkspur-park-bend",
        story:
          "This week we're featuring Larkspur Park, a Bend playground for all abilities. There are three play zones, plus picnic tables.",
        who: "Universal-design play for every ability.",
        bring: "Mittens and a snack.",
      },
    ],
  });

  async function draftPost() {
    const { WeekDraft } = await import("./model");
    const r = await store.handleDrafts(WeekDraft.parse(postDraft()), SUNDAY, {
      store: true,
    });
    expect(r[0].errors).toEqual([]);
    expect(r[0].error).toBeUndefined();
    expect(r[0].stored).toBe(true);
    return r[0].id!;
  }

  it("starts in dry run with DMs off: draws, checks, mails James, never calls Meta", async () => {
    expect(await settings.getSocialSettings()).toEqual({
      enabled: true,
      dryRun: true,
    });
    expect(settings.dmsOn()).toBe(false);
    const id = await draftPost();
    const [row] = await q(`select caption from social_posts where id = ${id}`);
    expect(String(row.caption)).toContain("Link in bio.");
    const r = await store.runSocial(MON_1150, { fetchImpl });
    expect(r.notes).toContain(`${id}: dry run`);
    expect(calls).toEqual([]);
    expect(
      alerts.some(
        (a) =>
          /dry run/.test(a.subject) &&
          a.text.includes(`/social/${id}/1.png?k=`),
      ),
    ).toBe(true);
  });

  it("the media route serves a live post's JPEG and nothing else", async () => {
    const id = await draftPost();
    const [row] = await q(
      `select media->0->>'sha' as sha from social_posts where id = ${id}`,
    );
    const { GET } = await import("@/app/social/m/[file]/route");
    const get = (file: string) =>
      GET(new Request(`http://x/social/m/${file}`), {
        params: Promise.resolve({ file }),
      });
    const ok = await get(`${row.sha}.jpg`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect((await get(`${"f".repeat(64)}.jpg`)).status).toBe(404);
    expect((await get(`${row.sha}.mp4`)).status).toBe(404);
    await q(`update social_posts set status = 'failed'`);
    expect((await get(`${row.sha}.jpg`)).status).toBe(404);
  });

  it("live: creates the container ahead, publishes at its minute, never twice", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    const create = calls.find(
      (c) => c.method === "POST" && c.path.endsWith("/media"),
    );
    expect(create?.body.get("image_url")).toMatch(
      /^https:\/\/parkroulette\.quest\/social\/m\/[0-9a-f]{64}\.jpg$/,
    );
    expect(create?.body.get("alt_text")).toBeTruthy();
    expect(create?.body.get("media_type")).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/media_publish"))).toBe(false);
    await store.runSocial(new Date("2026-11-23T20:00:00Z"), { fetchImpl });
    expect(calls.some((c) => c.path.endsWith("/media_publish"))).toBe(false);
    await store.runSocial(MON_1215, { fetchImpl });
    await store.runSocial(new Date("2026-11-23T20:30:00Z"), { fetchImpl });
    const [row] = await q(
      `select status, ig_media_id, container_id from social_posts where id = ${id}`,
    );
    // The feed post's own container (the Story echo publishes its own).
    expect(
      calls.filter(
        (c) =>
          c.path.endsWith("/media_publish") &&
          c.body.get("creation_id") === row.container_id,
      ),
    ).toHaveLength(1);
    expect(row).toMatchObject({ status: "published", ig_media_id: "IGMEDIA1" });
  });

  it("tags the park's operator only when the re-check holds, never on Facebook", async () => {
    await settings.setSocialSettings({ dryRun: false });
    process.env.SOCIAL_FACEBOOK = "on";
    process.env.FB_PAGE_ID = "1234567890";
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const { REGISTRY } = await import("./handles");
      const bprd = REGISTRY.entries["bendparksandrec.org"];
      const id = await draftPost();
      const [queued] = await q(
        `select caption from social_posts where id = ${id}`,
      );
      expect(String(queued.caption)).toContain(`\nPark by @${bprd.handle}\n`);
      // Meta still knows the account under the same id and name: kept.
      discovered[bprd.handle] = {
        id: bprd.igId,
        username: bprd.handle,
        website: "https://www.bendparksandrec.org/",
      };
      await store.runSocial(MON_1150, { fetchImpl });
      const create = calls.find(
        (c) => c.method === "POST" && c.path.endsWith("/media"),
      );
      expect(create?.body.get("caption")).toContain(`Park by @${bprd.handle}`);
      await store.runSocial(MON_1215, { fetchImpl });
      const fb = calls.find(
        (c) => c.path.endsWith("/photos") || c.path.endsWith("/feed"),
      );
      const fbText = [...calls]
        .filter((c) => c.path.startsWith("1234567890"))
        .map((c) => c.body.get("caption") ?? c.body.get("message") ?? "")
        .join("\n");
      expect(fb).toBeTruthy();
      expect(fbText).not.toMatch(/@|Park by/);

      // Another week: the account is gone (Meta says no such user; every
      // publish asks fresh), so the tag goes, and the post still goes out.
      await q("truncate social_posts restart identity cascade");
      calls.length = 0;
      discovered = {};
      const id2 = await draftPost();
      await store.runSocial(MON_1150, { fetchImpl });
      const create2 = calls.find(
        (c) => c.method === "POST" && c.path.endsWith("/media"),
      );
      expect(create2?.body.get("caption")).not.toMatch(/@|Park by/);
      const [row] = await q(
        `select status, caption from social_posts where id = ${id2}`,
      );
      expect(row.status).toBe("creating");
      expect(String(row.caption)).not.toMatch(/@/);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.SOCIAL_FACEBOOK;
    }
  });

  it("a queued park post stored in the old shape (hook and what) still publishes, Facebook too", async () => {
    await settings.setSocialSettings({ dryRun: false });
    process.env.SOCIAL_FACEBOOK = "on";
    process.env.FB_PAGE_ID = "1234567890";
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const id = await draftPost();
      // What a post queued before the voice change looks like.
      const oldCaption =
        "A Bend playground for all abilities: Larkspur Park\n\nThree play zones for all abilities, plus picnic tables.\nUniversal-design play for every ability.\nMittens and a snack.\n\n1600 SE Reed Market Rd, Bend, OR 97701\n\nLink in bio.\n\n#BendOregon #CentralOregon #BendKids";
      const oldFb = oldCaption.replace(
        "Link in bio.",
        "Free park picks every Thursday: https://parkroulette.quest/ig?from=fb",
      );
      const old = {
        type: "park_post",
        park: "larkspur-park-bend",
        hook: "A Bend playground for all abilities",
        who: "Universal-design play for every ability.",
        what: "Three play zones for all abilities, plus picnic tables.",
        bring: "Mittens and a snack.",
        hashtags: ["#BendOregon", "#CentralOregon", "#BendKids"],
      };
      const lit = (x: unknown) => `'${JSON.stringify(x).replace(/'/g, "''")}'`;
      await q(
        `update social_posts set body = ${lit(old)}::jsonb,
          spec = jsonb_set(jsonb_set(jsonb_set(spec, '{caption}', ${lit(oldCaption)}::jsonb), '{fbCaption}', ${lit(oldFb)}::jsonb), '{headline}', '"A Bend playground for all abilities"'::jsonb)
          where id = ${id}`,
      );
      await q(
        `update social_posts set caption = spec->>'caption' where id = ${id}`,
      );
      await store.runSocial(MON_1150, { fetchImpl });
      await store.runSocial(MON_1215, { fetchImpl });
      const create = calls.find(
        (c) => c.method === "POST" && c.path.endsWith("/media"),
      );
      expect(create?.body.get("caption")).toBe(oldCaption);
      // The feed post's own container (the Story echo publishes its own).
      const [{ container_id }] = await q(
        `select container_id from social_posts where id = ${id}`,
      );
      expect(
        calls.filter(
          (c) =>
            c.path.endsWith("/media_publish") &&
            c.body.get("creation_id") === container_id,
        ),
      ).toHaveLength(1);
      const feed = calls.find((c) => c.path.endsWith("/feed"));
      expect(feed?.body.get("message")).toBe(oldFb);
      const [row] = await q(
        `select status, fb_post_id from social_posts where id = ${id}`,
      );
      expect(row).toMatchObject({ status: "published", fb_post_id: "FBPOST1" });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.SOCIAL_FACEBOOK;
    }
  });

  it("two runs at once: one takes the lease, the other stands down", async () => {
    await settings.setSocialSettings({ dryRun: false });
    await draftPost();
    const [a, b] = await Promise.all([
      store.runSocial(MON_1150, { fetchImpl }),
      store.runSocial(MON_1150, { fetchImpl }),
    ]);
    expect([a.action, b.action].sort()).toEqual(["busy", "ran"]);
    expect(
      calls.filter((c) => c.method === "POST" && c.path.endsWith("/media")),
    ).toHaveLength(1);
  });

  it("skips when Meta's daily publishing limit is used up", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    quota = 50;
    await store.runSocial(MON_1150, { fetchImpl });
    const [row] = await q(
      `select status, reason from social_posts where id = ${id}`,
    );
    expect(row).toMatchObject({
      status: "skipped",
      reason: "Daily publishing limit reached.",
    });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("an unclear publish is settled from the container, never published blindly", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    publishFails = "timeout";
    afterPublish = "IN_PROGRESS";
    await store.runSocial(MON_1215, { fetchImpl });
    let [row] = await q(`select status from social_posts where id = ${id}`);
    expect(row.status).toBe("publishing");
    publishFails = "no";
    afterPublish = "PUBLISHED";
    await store.runSocial(new Date("2026-11-23T20:30:00Z"), { fetchImpl });
    [row] = await q(
      `select status, container_id from social_posts where id = ${id}`,
    );
    expect(row.status).toBe("published");
    // The feed post's own container (the Story echo publishes its own).
    expect(
      calls.filter(
        (c) =>
          c.path.endsWith("/media_publish") &&
          c.body.get("creation_id") === row.container_id,
      ),
    ).toHaveLength(1);
  });

  it("a rate-limited publish waits and goes out next run; a clear no fails", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    publishFails = "rate";
    await store.runSocial(MON_1215, { fetchImpl });
    let [row] = await q(`select status from social_posts where id = ${id}`);
    expect(row.status).toBe("creating");
    publishFails = "no";
    await store.runSocial(new Date("2026-11-23T20:30:00Z"), { fetchImpl });
    [row] = await q(`select status from social_posts where id = ${id}`);
    expect(row.status).toBe("published");
    await q(`update social_posts set status = 'creating', ig_media_id = null`);
    publishFails = "bad";
    await store.runSocial(new Date("2026-11-23T20:45:00Z"), { fetchImpl });
    [row] = await q(`select status from social_posts where id = ${id}`);
    expect(row.status).toBe("failed");
  });

  it("skips a post 2 hours late, and one whose park closed, and tells James", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await q(`update parks set status = 'closed'`);
    await store.runSocial(MON_1150, { fetchImpl });
    const [row] = await q(
      `select status, reason from social_posts where id = ${id}`,
    );
    expect(row.status).toBe("skipped");
    expect(String(row.reason)).toMatch(/isn't open/);
    expect(alerts.some((a) => /skipped/.test(a.subject))).toBe(true);
    await q(`update parks set status = 'active'`);
    await q(`update social_posts set status = 'queued', reason = null`);
    await store.runSocial(new Date("2026-11-23T22:30:00Z"), { fetchImpl });
    const [late] = await q(
      `select status, reason from social_posts where id = ${id}`,
    );
    expect(late).toMatchObject({
      status: "skipped",
      reason: "Over 2 hours late.",
    });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("the kill switch, SOCIAL_PUBLISH=off and non-production never call Meta", async () => {
    await settings.setSocialSettings({ dryRun: false });
    await draftPost();
    await settings.setSocialSettings({ enabled: false });
    expect((await store.runSocial(MON_1150, { fetchImpl })).action).toBe(
      "paused",
    );
    await settings.setSocialSettings({ enabled: true });
    process.env.SOCIAL_PUBLISH = "off";
    expect((await store.runSocial(MON_1150, { fetchImpl })).action).toBe(
      "paused",
    );
    delete process.env.SOCIAL_PUBLISH;
    process.env.VERCEL_ENV = "preview";
    const r = await store.runSocial(MON_1150, { fetchImpl });
    expect(r.notes.join(" ")).toMatch(/Not production/);
    expect(calls).toEqual([]);
  });

  it("preflight makes real containers and never publishes", async () => {
    const id = await draftPost();
    const r = await store.preflight(id, fetchImpl);
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.path.endsWith("/media"))).toBe(true);
    expect(calls.some((c) => c.path.endsWith("/media_publish"))).toBe(false);
    const [row] = await q(`select status from social_posts where id = ${id}`);
    expect(row.status).toBe("queued");
  });

  it("a re-draft replaces the queued post; a published slot refuses it", async () => {
    const first = await draftPost();
    const second = await draftPost();
    expect(second).not.toBe(first);
    const rows = await q(`select status from social_posts order by id`);
    expect(rows.map((r) => r.status)).toEqual(["replaced", "queued"]);
    await q(
      `update social_posts set status = 'published' where id = ${second}`,
    );
    const { WeekDraft } = await import("./model");
    const r = await store.handleDrafts(WeekDraft.parse(postDraft()), SUNDAY, {
      store: true,
    });
    expect(r[0].stored).toBe(false);
  });

  it("a verdict is never upgraded to clear, and only catalog photos are taken", async () => {
    const r = await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "a".repeat(64), verdict: "people" },
      {
        src: "https://example.com/x.jpg",
        sha256: "b".repeat(64),
        verdict: "clear",
      },
    ]);
    expect(r.saved).toBe(1);
    expect(r.refused.map((x) => x.src)).toEqual(["https://example.com/x.jpg"]);
    const again = await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "c".repeat(64), verdict: "clear" },
      { src: LARKSPUR_PHOTO, sha256: "a".repeat(64), verdict: "clear" },
    ]);
    expect(again.saved).toBe(0);
    expect(
      (await store.socialCtx(WEEK, SUNDAY)).photoFor("larkspur-park-bend"),
    ).toBeNull();
    const plan = await store.socialPlan(SUNDAY, WEEK);
    expect(plan.photos_to_check.map((p) => p.src)).not.toContain(
      LARKSPUR_PHOTO,
    );
    expect(plan.post_parks[0].photo?.check).toBe("people");
  });

  it("a clear photo is drawn with its credit; one that doesn't load falls back to the card", async () => {
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const ctx = await store.socialCtx(WEEK, SUNDAY);
    expect(ctx.photoFor("larkspur-park-bend")).toMatchObject({
      src: LARKSPUR_PHOTO,
      credit: "Photo: Bend Park & Recreation District",
    });
    let id = await draftPost();
    let [row] = await q(`select caption from social_posts where id = ${id}`);
    expect(String(row.caption)).toContain(
      "Photo: Bend Park & Recreation District",
    );
    expect(drawn.at(-1)).toEqual(["data:image/jpeg;base64,AA"]);
    photoLoads = false;
    id = await draftPost();
    [row] = await q(
      `select caption, spec->'slides'->0->'photo' as photo from social_posts where id = ${id}`,
    );
    expect(String(row.caption)).not.toContain("Photo:");
    expect(row.photo).toBeNull();
  });

  it("a person seen in the rendered slide flags the photo and redraws the crayon card", async () => {
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const id = await draftPost();
    const r = await store.downgradeToCrayon(id, "a person by the slide");
    expect(r.ok).toBe(true);
    const [row] = await q(
      `select caption, spec->'slides'->0->'photo' as photo from social_posts where id = ${id}`,
    );
    expect(row.photo).toBeNull();
    expect(String(row.caption)).not.toContain("Photo:");
    expect(drawn.at(-1)).toEqual([null]);
    expect(
      (await store.socialCtx(WEEK, SUNDAY)).photoFor("larkspur-park-bend"),
    ).toBeNull();
    await q(`update social_posts set status = 'published' where id = ${id}`);
    expect((await store.downgradeToCrayon(id, undefined)).ok).toBe(false);
  });

  it("a redraw keeps the downgrade mark (the post never shows on /social)", async () => {
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const id = await draftPost();
    expect((await store.downgradeToCrayon(id, "a person")).ok).toBe(true);
    // Far from its slot, so the redraw may apply.
    await q(
      `update social_posts set publish_at = now() + interval '3 days' where id = ${id}`,
    );
    const r = await store.redrawQueued(id, { apply: true, now: SUNDAY });
    expect(r.ok && r.applied).toBe(true);
    const [row] = await q(`select report from social_posts where id = ${id}`);
    expect(row.report).toMatchObject({ downgraded: "a person" });
    expect((row.report as { errors: unknown }).errors).toEqual([]);
    // Only the mark is merged: the new report's own nulls stay as they are.
    expect(Object.keys(row.report as object).sort()).toEqual([
      "cut",
      "downgraded",
      "errors",
      "warnings",
    ]);
  });

  it("stops serving a published post's slides once its photo is flagged", async () => {
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const id = await draftPost();
    await q(
      `update social_posts set status = 'published', published_at = now() where id = ${id}`,
    );
    const [row] = await q(
      `select media->0->>'sha' as sha, spec->'slides'->0->'photo'->>'src' as src from social_posts where id = ${id}`,
    );
    expect(row.src).toBe(LARKSPUR_PHOTO);
    expect(await store.mediaAllowed(String(row.sha), "jpg")).toBe(true);
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "people" },
    ]);
    expect(await store.mediaAllowed(String(row.sha), "jpg")).toBe(false);
  });

  it("keeps serving a photo-free Story echo after the photo is flagged", async () => {
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const id = await draftPost();
    const echo = (sha: string, photoFree: boolean) =>
      JSON.stringify({ sha, ext: "jpg", width: 1080, height: 1920, photoFree });
    await q(
      `update social_posts set status = 'published', published_at = now(), echo_status = 'published', echo_media = '${echo("e".repeat(64), true)}' where id = ${id}`,
    );
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "people" },
    ]);
    // The crayon echo shows no photo: still served.
    expect(await store.mediaAllowed("e".repeat(64), "jpg")).toBe(true);
    // An echo drawn from the photo cover: refused like the slides.
    await q(
      `update social_posts set echo_media = '${echo("f".repeat(64), false)}' where id = ${id}`,
    );
    expect(await store.mediaAllowed("f".repeat(64), "jpg")).toBe(false);
  });

  it("refuses slides whose photo was never cleared on those exact bytes", async () => {
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const id = await draftPost();
    await q(
      `update social_posts set status = 'published', published_at = now() where id = ${id}`,
    );
    const [row] = await q(
      `select media->0->>'sha' as sha from social_posts where id = ${id}`,
    );
    expect(await store.mediaAllowed(String(row.sha), "jpg")).toBe(true);
    // Its clear look is gone (another file's look remains): no longer served.
    await q(
      `update social_photo_checks set sha256 = '${"c".repeat(64)}' where src = '${LARKSPUR_PHOTO}'`,
    );
    expect(await store.mediaAllowed(String(row.sha), "jpg")).toBe(false);
  });

  it("checks holiday-hours evidence on the page itself, on the venue's host only", async () => {
    const seen: string[][] = [];
    const page =
      (status: number, text: string) =>
      async (u: string, d: readonly string[]) => {
        seen.push([...d]);
        return { status, finalUrl: u, text };
      };
    const url = "https://www.highdesertmuseum.org/visit/";
    const quote = "Open Thanksgiving Day, Nov. 26, from 10 am to 4 pm";
    expect(
      await store.evidenceSeen(url, quote, page(200, `hours ${quote} more`)),
    ).toBe(true);
    expect(seen[0]).toEqual(["highdesertmuseum.org"]);
    expect(
      await store.evidenceSeen(
        url,
        quote,
        page(200, "Open daily 10 am to 5 pm"),
      ),
    ).toBe(false);
    expect(await store.evidenceSeen(url, quote, page(404, quote))).toBe(false);
  });

  it("makes Thursday's teaser from the sent issue once, on the crayon card", async () => {
    const thu = new Date("2026-11-26T15:30:00Z");
    expect(await store.ensureCodePost("teaser", thu)).toBe(
      "waiting for the issue",
    );
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const issue = {
      issue_date: "2026-11-26",
      subject: "A cold, sunny weekend",
      preview: "Bundle up: Saturday is clear and crisp.",
      hello: {
        text: "Happy Thanksgiving! A short one this week, back to the pie.",
      },
      wheel_pick: {
        park: "larkspur-park-bend",
        why_now: "Sun hits the slides first.",
        who_for: "All",
        bring: "Mittens",
      },
      passport: { challenge_id: "c", text: "Stamp it." },
      signoff: { text: "Hit reply." },
    };
    await q(`insert into news_issues (issue_date, status, body, sent_body, sent_at, send_started_at)
      values ('2026-11-26', 'sent', '{}', '${JSON.stringify(issue).replace(/'/g, "''")}'::jsonb, now(), now())`);
    expect(await store.ensureCodePost("teaser", thu)).toBe("made");
    expect(await store.ensureCodePost("teaser", thu)).toBe("already made");
    const [row] = await q(
      `select caption, origin, status from social_posts where kind = 'teaser'`,
    );
    expect(row).toMatchObject({ origin: "code", status: "queued" });
    expect(String(row.caption)).toContain(
      "Bundle up: Saturday is clear and crisp.",
    );
    expect(String(row.caption)).toContain("Link in bio.");
    expect(drawn.at(-1)!.every((p) => p === null)).toBe(true);
    const fri = new Date("2026-11-28T00:40:00Z");
    expect(await store.ensureCodePost("story", fri)).toBe("made");
    expect(
      await store.ensureCodePost("teaser", new Date("2026-12-03T18:00:00Z")),
    ).toMatch(/No issue/);
    expect(alerts.some((a) => /teaser skipped/.test(a.subject))).toBe(true);
  });

  it("keyword DMs stay off without SOCIAL_KEYWORD_DMS=on and FB_PAGE_ID", async () => {
    expect((await dm.runKeywordDms(new Date(), { fetchImpl })).action).toBe(
      "off",
    );
    process.env.SOCIAL_KEYWORD_DMS = "on";
    expect((await dm.runKeywordDms(new Date(), { fetchImpl })).action).toBe(
      "off",
    );
    expect(calls).toEqual([]);
  });

  it("answers a PARK comment once, never twice, and nothing in dry run", async () => {
    process.env.SOCIAL_KEYWORD_DMS = "on";
    process.env.FB_PAGE_ID = "1234567890";
    const id = await draftPost();
    await q(
      `update social_posts set status = 'published', ig_media_id = 'IGMEDIA1', published_at = '${MON_1215.toISOString()}' where id = ${id}`,
    );
    comments = [
      { id: "c1", text: "PARK", from: { id: "u1" } },
      { id: "c2", text: "which park is this?", from: { id: "u2" } },
      { id: "c3", text: "park", from: { id: process.env.IG_USER_ID! } },
    ];
    const later = new Date("2026-11-23T21:00:00Z");
    let r = await dm.runKeywordDms(later, { fetchImpl });
    expect(r.replies).toBe(1);
    expect(
      calls.some((c) => c.path.endsWith("/messages") && c.method === "POST"),
    ).toBe(false);
    await q(`truncate social_dm_replies`);
    await settings.setSocialSettings({ dryRun: false });
    r = await dm.runKeywordDms(later, { fetchImpl });
    r = await dm.runKeywordDms(later, { fetchImpl });
    expect(r.action).toBe("ran");
    const sent = calls.filter(
      (c) => c.method === "POST" && c.path.endsWith("/messages"),
    );
    expect(sent).toHaveLength(1);
    // Meta's private-reply doc: the Instagram account's own id, not the Page.
    expect(sent[0].path).toBe(`${process.env.IG_USER_ID}/messages`);
    expect(JSON.parse(sent[0].body.get("recipient")!)).toEqual({
      comment_id: "c1",
    });
    // The DM links to the commented post's own destination (the park).
    expect(JSON.parse(sent[0].body.get("message")!).text).toBe(
      "Here are the links from that post. New park picks every Thursday, free.\nhttps://parkroulette.quest/parks/larkspur-park-bend?from=ig_dm",
    );
    expect(
      await q(
        `select ext_id, status, message_id, recipient_id from social_dm_replies`,
      ),
    ).toEqual([
      {
        ext_id: "c1",
        status: "sent",
        message_id: "aWdfMSG1",
        recipient_id: "IGSID1",
      },
    ]);

    // The diagnostic reads Meta for the answer and stores nothing new.
    calls.length = 0;
    const d = await dm.dmDebug(5, { fetchImpl });
    expect(d.items).toHaveLength(1);
    const item = d.items![0] as Record<string, unknown>;
    expect(item.comment).toMatchObject({ from: { username: "someone" } });
    expect(item.sentMessage).toMatchObject({ id: "aWdfMSG1" });
    expect(item.conversation).toEqual([]);
    const conv = calls.find((c) => c.path.endsWith("/conversations"))!;
    expect(conv.path).toBe("1234567890/conversations");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(
      JSON.stringify(await q(`select * from social_dm_replies`)),
    ).not.toContain("someone");
  });
  // --- Batch 7: Tuesday's events roundup and Saturday's "at home" ---------

  /** Tuesday, November 24, 2026 (PST): 6:45 am, 7:15 am and 7:30 am Pacific. */
  const TUE_0645 = new Date("2026-11-24T14:45:00Z");
  const TUE_0715 = new Date("2026-11-24T15:15:00Z");

  async function addEvent(
    slug: string,
    day: string,
    town: string,
    over: Record<string, unknown> = {},
  ) {
    const data = {
      title: `Storytime ${slug}`,
      dates: [{ day, start: "10:00", end: "11:00" }],
      venue: { name: `${town} Library`, town },
      cost: { text: "Free", prices: [], free: true },
      ages_text: "Ages 0 to 5",
      ages: { tags: ["Ages 0-3", "Ages 4-7"], kids: true, range: [0, 5] },
      what: "Stories, songs and rhymes for little kids at the library.",
      url: "https://www.deschuteslibrary.org/calendar/event",
      organizer: {
        name: "Deschutes Public Library",
        url: "https://www.deschuteslibrary.org",
      },
      evidence: [
        {
          url: "https://www.deschuteslibrary.org/calendar/event",
          quote: "Storytime at the library",
        },
      ],
      point: null,
      checkQuote: "Storytime",
      ...over,
    };
    await q(`insert into kid_events (slug, kind, series_key, data)
      values ('${slug}', 'series', 'k:${slug}', '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
  }

  async function fourEvents() {
    await addEvent("a", "2026-11-25", "Bend");
    await addEvent("b", "2026-11-26", "Redmond");
    await addEvent("c", "2026-11-28", "Sisters");
    await addEvent("d", "2026-11-30", "La Pine");
  }

  it("Tuesday: the roundup is made from kid_events an hour ahead, then goes out (dry run)", async () => {
    await fourEvents();
    await addEvent("no-ages", "2026-11-25", "Bend", {
      ages_text: undefined,
      ages: null,
    });
    // Too early: nothing yet.
    let r = await store.runSocial(new Date("2026-11-24T14:15:00Z"), {
      fetchImpl,
    });
    expect(r.notes).toContain("events_week: not yet");
    r = await store.runSocial(TUE_0645, { fetchImpl });
    expect(r.notes).toContain("events_week: made");
    const [row] = await q(
      `select kind, slot_date::text as day, status, publish_at, spec, caption from social_posts`,
    );
    expect(row).toMatchObject({
      kind: "events_week",
      day: "2026-11-24",
      status: "queued",
    });
    const spec = row.spec as {
      slides: { t: string }[];
      facts: { events: { slug: string }[] };
    };
    expect(spec.slides.map((s) => s.t)).toEqual([
      "headline",
      "event",
      "event",
      "event",
      "event",
      "cta",
    ]);
    expect(spec.facts.events.map((e) => e.slug)).toEqual(["a", "b", "c", "d"]);
    expect(String(row.caption)).toContain(
      "Hosted by Deschutes Public Library.",
    );
    expect(String(row.caption)).toContain("parkroulette.quest/events");
    // Made once per slot.
    r = await store.runSocial(new Date("2026-11-24T15:00:00Z"), { fetchImpl });
    expect(r.notes).toContain("events_week: already made");
    r = await store.runSocial(TUE_0715, { fetchImpl });
    expect(
      (
        await q(`select status from social_posts where kind = 'events_week'`)
      )[0],
    ).toEqual({ status: "dry_run" });
    expect(calls).toEqual([]);
  });

  it("Tuesday live: an @ in an event's words never holds the roundup, and a verified host is tagged", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const { REGISTRY } = await import("./handles");
    const bprd = REGISTRY.entries["bendparksandrec.org"];
    await fourEvents();
    await addEvent("at-title", "2026-11-27", "Bend", {
      title: "Teen Night @TheGrove",
    });
    await addEvent("parks", "2026-11-29", "Bend", {
      title: "Winter Wonderland",
      venue: { name: "Larkspur Community Center", town: "Bend" },
      what: "Kids make snowflakes, email info@bendparksandrec.org with questions.",
      organizer: {
        name: "Bend Park and Recreation District",
        url: "https://www.bendparksandrec.org/",
      },
    });
    discovered[bprd.handle] = {
      id: bprd.igId,
      username: bprd.handle,
      website: "https://www.bendparksandrec.org/",
    };
    let r = await store.runSocial(TUE_0645, { fetchImpl });
    expect(r.notes).toContain("events_week: made");
    const [made] = await q(`select caption from social_posts`);
    // The library (now verified, by name) hosts the week's other events.
    expect(String(made.caption)).toContain(
      `Hosts this week: @deschuteslibrary @${bprd.handle}`,
    );
    r = await store.runSocial(TUE_0715, { fetchImpl });
    const [row] = await q(`select status, caption from social_posts`);
    expect(row.status).toBe("creating");
    const create = calls.find(
      (c) => c.method === "POST" && c.body.get("media_type") === "CAROUSEL",
    );
    const caption = create?.body.get("caption") ?? "";
    expect(caption).toContain(`Hosts this week: @${bprd.handle}`);
    // The only @ is the verified tag line's.
    expect(caption.match(/@/g)).toHaveLength(1);
  });

  it('live: a registry handle in a post\'s words, with no tags, still goes out (as "at")', async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    // A queued caption with an @ in its words (stored before the rule).
    await q(`update social_posts
      set caption = 'Thanks @bendparks for the sled hill.' || chr(10) || 'Link in bio.',
          spec = (spec - 'tags') || jsonb_build_object('caption', 'Thanks @bendparks for the sled hill.' || chr(10) || 'Link in bio.')
      where id = ${id}`);
    await store.runSocial(MON_1150, { fetchImpl });
    const [row] = await q(
      `select status, caption from social_posts where id = ${id}`,
    );
    expect(row.status).toBe("creating");
    const create = calls.find(
      (c) => c.method === "POST" && c.path.endsWith("/media"),
    );
    expect(create?.body.get("caption")).toBe(
      "Thanks at bendparks for the sled hill.\nLink in bio.",
    );
  });

  it("Tuesday: fewer than 4 events skips the week and tells James", async () => {
    await addEvent("a", "2026-11-25", "Bend");
    await addEvent("b", "2026-11-26", "Redmond");
    await addEvent("c", "2026-11-28", "Sisters");
    const r = await store.runSocial(TUE_0645, { fetchImpl });
    expect(r.notes.join(" ")).toMatch(/events_week: Only 3/);
    expect(await q(`select kind, status from social_posts`)).toEqual([
      { kind: "events_week", status: "skipped" },
    ]);
    expect(alerts.some((a) => /roundup skipped/.test(a.subject))).toBe(true);
  });

  it("a canceled date before publishing redraws the roundup without it, or skips it below 4", async () => {
    await fourEvents();
    await addEvent("e", "2026-11-27", "Madras");
    await store.runSocial(TUE_0645, { fetchImpl });
    await q(
      `update kid_events set data = jsonb_set(data, '{statusByDay}', '{"2026-11-27": "canceled"}') where slug = 'e'`,
    );
    let r = await store.runSocial(TUE_0715, { fetchImpl });
    expect(r.notes.join(" ")).toMatch(/Roundup: remade/);
    let rows = await q(
      `select status, spec->'facts'->'events' as ev from social_posts where kind = 'events_week' order by id`,
    );
    expect(rows.map((x) => x.status)).toEqual(["replaced", "queued"]);
    expect((rows[1].ev as { slug: string }[]).map((e) => e.slug)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    // Another date goes: only 3 left, so the week is skipped.
    await q(
      `update kid_events set data = jsonb_set(data, '{statusByDay}', '{"2026-11-28": "canceled"}') where slug = 'c'`,
    );
    r = await store.runSocial(new Date("2026-11-24T15:20:00Z"), { fetchImpl });
    rows = await q(
      `select status from social_posts where kind = 'events_week' and status <> 'replaced'`,
    );
    expect(rows).toEqual([{ status: "skipped" }]);
    expect(calls).toEqual([]);
  });

  it("a start time that moved before publishing redraws the roundup with the new time", async () => {
    await fourEvents();
    await store.runSocial(TUE_0645, { fetchImpl });
    await q(
      `update kid_events set data = jsonb_set(jsonb_set(data, '{dates,0,start}', '"14:00"'), '{dates,0,end}', '"15:00"') where slug = 'b'`,
    );
    const r = await store.runSocial(TUE_0715, { fetchImpl });
    expect(r.notes.join(" ")).toMatch(
      /now starts at 14:00, not 10:00\. Roundup: remade/,
    );
    const [row] = await q(
      `select caption from social_posts where kind = 'events_week' and status = 'queued'`,
    );
    expect(String(row.caption)).toMatch(/Thursday, Nov 26\n.+, 2 to 3 pm/);
  });

  /** Each idea its own words (identical steps would be a repeat in the post). */
  const STEPS: Record<string, string[]> = {
    "Snow paint": [
      "Fill spray bottles with water and food coloring",
      "Spray stripes and letters on clean snow",
    ],
    "Hand turkeys": [
      "Trace a hand on paper with the fingers spread wide",
      "Color each finger as a feather",
    ],
    "Paper chain": [
      "Tear paper into long strips, one each",
      "Loop and tape the strips into a chain",
    ],
    "Painting the snow": [
      "Fill spray bottles with water and food coloring",
      "Spray pictures on fresh snow in the yard",
    ],
    "Hallway bowling": [
      "Line up empty bottles at the end of the hall",
      "Roll a soft ball to knock them down",
    ],
    "Sock puppets": [
      "Draw faces on old socks with markers",
      "Put on a puppet show from behind the couch",
    ],
  };
  const PAYOFF: Record<string, string> = {
    "Snow paint": "Watch the yard turn into a rainbow",
    "Hand turkeys": "Hang the flock on the fridge for the week",
    "Paper chain": "Drape it over the table for dinner tonight",
    "Painting the snow": "Watch the whole yard glow with color",
    "Hallway bowling": "Count who knocks down the most bottles",
    "Sock puppets": "Now the puppets put on a show for the family",
  };
  const atHomeDraft = (week: string, titles: string[]) => ({
    week_of: week,
    posts: [
      {
        type: "at_home",
        headline: "Cozy ideas for a snowy morning",
        highlight: "cozy",
        theme: week === WEEK ? "thanksgiving" : "first-snow",
        ideas: titles.map((title) => ({
          title,
          ages: { from: 3, to: 8 },
          need: ["paper", "crayons", "tape"],
          steps: STEPS[title],
          payoff: PAYOFF[title],
        })),
      },
    ],
  });

  it("Saturday: the routine's at home post is stored for 7:45 am, and its ideas cool down for 12 weeks", async () => {
    const { WeekDraft } = await import("./model");
    const r = await store.handleDrafts(
      WeekDraft.parse(
        atHomeDraft(WEEK, ["Snow paint", "Hand turkeys", "Paper chain"]),
      ),
      SUNDAY,
      { store: true },
    );
    expect(r[0].errors).toEqual([]);
    expect(r[0].stored).toBe(true);
    const [row] = await q(
      `select kind, slot_date::text as day, publish_at from social_posts where id = ${r[0].id}`,
    );
    expect(row.kind).toBe("at_home");
    expect(row.day).toBe("2026-11-28");
    expect(new Date(String(row.publish_at)).toISOString()).toBe(
      "2026-11-28T15:45:00.000Z",
    );
    // A re-draft of the same Saturday may reuse its own ideas.
    const again = await store.handleDrafts(
      WeekDraft.parse(
        atHomeDraft(WEEK, ["Snow paint", "Hand turkeys", "Paper chain"]),
      ),
      SUNDAY,
      { store: false },
    );
    expect(again[0].errors).toEqual([]);
    // Two weeks later, a reworded "Painting the snow" is refused.
    const plan = await store.socialPlan(
      new Date("2026-12-06T02:00:00Z"),
      "2026-12-07",
    );
    expect(plan.at_home.recent_ideas).toEqual([
      "Snow paint",
      "Hand turkeys",
      "Paper chain",
    ]);
    expect(plan.at_home.themes.map((t) => t.id)).toContain("first-snow");
    const later = await store.handleDrafts(
      WeekDraft.parse(
        atHomeDraft("2026-12-07", [
          "Painting the snow",
          "Hallway bowling",
          "Sock puppets",
        ]),
      ),
      new Date("2026-12-06T02:00:00Z"),
      { store: false },
    );
    expect(later[0].errors.join(" ")).toMatch(/too close to "Snow paint"/);
  });

  // --- The Story echo ------------------------------------------------------

  const MON_1230 = new Date("2026-11-23T20:30:00Z");
  const MON_1245 = new Date("2026-11-23T20:45:00Z");
  const storyCreates = () =>
    calls.filter(
      (c) =>
        c.path.endsWith("/media") && c.body.get("media_type") === "STORIES",
    );
  const echoRow = async (id: number) =>
    (
      await q(
        `select status, echo_status, echo_reason, echo_container_id, echo_media_id, echo_frames from social_posts where id = ${id}`,
      )
    )[0] as Record<string, unknown> & {
      echo_frames: {
        slide: number;
        sha: string;
        photo: unknown;
        status: string;
        containerId: string | null;
        mediaId: string | null;
      }[];
    };
  const frameUrl = (sha: string) =>
    `https://parkroulette.quest/social/m/${sha}.jpg`;
  const publishesOf = (container: string | null) =>
    calls.filter(
      (c) =>
        c.path.endsWith("/media_publish") &&
        c.body.get("creation_id") === container,
    );
  const echoAlerts = () => alerts.filter((a) => /echo/i.test(a.subject));

  /**
   * A carousel that is out: the park post's cover (its photo when one is
   * cleared) and n - 1 more slides with no photo.
   */
  async function publishedCarousel(n: number) {
    const id = await draftPost();
    const more = Array.from({ length: n - 1 }, (_, k) => ({
      t: "cta",
      line: `Slide ${k + 2}`,
      cta: "Link in bio.",
      sub: null,
    }));
    await q(
      `update social_posts set status = 'published', published_at = '${MON_1215.toISOString()}', spec = jsonb_set(spec, '{slides}', (spec->'slides') || '${JSON.stringify(more)}'::jsonb) where id = ${id}`,
    );
    return id;
  }

  it("echo: once the feed post is out, the post goes out as a Story, never twice", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    expect(storyCreates()).toHaveLength(0);
    await store.runSocial(MON_1215, { fetchImpl });
    let row = await echoRow(id);
    expect(row.status).toBe("published");
    expect(row.echo_status).toBe("published");
    expect(storyCreates()).toHaveLength(1);
    expect(storyCreates()[0].body.get("image_url")).toBe(
      frameUrl(frameSha(0, false)),
    );
    expect(storyCreates()[0].body.get("caption")).toBeNull();
    // The post's own slide at 9:16, no "New post" card.
    expect(echoes).toEqual([{ slide: 0, photo: false }]);
    expect(row.echo_frames).toHaveLength(1);
    expect(row.echo_frames[0]).toMatchObject({
      slide: 0,
      sha: frameSha(0, false),
      photo: null,
      status: "published",
    });
    expect(publishesOf(row.echo_frames[0].containerId)).toHaveLength(1);
    for (const t of ["20:30", "20:45", "21:00", "21:15"])
      await store.runSocial(new Date(`2026-11-23T${t}:00Z`), { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(storyCreates()).toHaveLength(1);
    expect(calls.filter((c) => c.path.endsWith("/media_publish"))).toHaveLength(
      2,
    );
    expect(echoes).toHaveLength(1);
    // Meta may fetch the frame's JPEG; the feed post's status is untouched.
    const { GET } = await import("@/app/social/m/[file]/route");
    const file = `${frameSha(0, false)}.jpg`;
    const res = await GET(new Request(`http://x/social/m/${file}`), {
      params: Promise.resolve({ file }),
    });
    expect(res.status).toBe(200);
    expect(echoAlerts()).toEqual([]);
  });

  it("echo: a carousel goes out as one Story per slide, in slide order", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(4);
    await store.runSocial(MON_1230, { fetchImpl });
    const row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(echoes.map((e) => e.slide)).toEqual([0, 1, 2, 3]);
    expect(storyCreates().map((c) => c.body.get("image_url"))).toEqual(
      [0, 1, 2, 3].map((i) => frameUrl(frameSha(i, false))),
    );
    expect(row.echo_frames.map((f) => [f.slide, f.status])).toEqual([
      [0, "published"],
      [1, "published"],
      [2, "published"],
      [3, "published"],
    ]);
    // Each frame's container published once, in order, before the next was made.
    const order = calls
      .filter(
        (c) =>
          (c.path.endsWith("/media") &&
            c.body.get("media_type") === "STORIES") ||
          c.path.endsWith("/media_publish"),
      )
      .map((c) => (c.path.endsWith("/media_publish") ? "publish" : "create"));
    expect(order).toEqual(Array(4).fill(["create", "publish"]).flat());
    for (const f of row.echo_frames)
      expect(publishesOf(f.containerId)).toHaveLength(1);
    expect(new Set(row.echo_frames.map((f) => f.containerId)).size).toBe(4);
    await store.runSocial(MON_1245, { fetchImpl });
    expect(storyCreates()).toHaveLength(4);
    expect(echoAlerts()).toEqual([]);
  });

  it("echo: a publish that fails midway resumes at that frame next run, never sending one twice", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(4);
    publishFails = "5xx";
    publishFailsOn = 3; // the third frame's publish doesn't answer
    await store.runSocial(MON_1230, { fetchImpl });
    let row = await echoRow(id);
    expect(row.echo_status).toBe("publishing");
    expect(row.echo_frames.map((f) => f.status)).toEqual([
      "published",
      "published",
      "pending",
      "pending",
    ]);
    expect(storyCreates()).toHaveLength(3);
    publishFails = "no";
    publishFailsOn = null;
    await store.runSocial(MON_1245, { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(row.echo_frames.map((f) => f.status)).toEqual(
      Array(4).fill("published"),
    );
    // No frame drawn or made twice; only the unanswered one asked again.
    expect(storyCreates()).toHaveLength(4);
    expect(echoes).toHaveLength(4);
    expect(
      row.echo_frames.map((f) => publishesOf(f.containerId).length),
    ).toEqual([1, 1, 2, 1]);
    expect(echoAlerts()).toEqual([]);
  });

  it("echo: a frame Meta already published (its publish unanswered) isn't sent again", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(3);
    publishFails = "timeout";
    publishFailsOn = 2;
    afterPublish = "PUBLISHED";
    await store.runSocial(MON_1230, { fetchImpl });
    const row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(
      row.echo_frames.map((f) => publishesOf(f.containerId).length),
    ).toEqual([1, 1, 1]);
  });

  it("echo: none when the feed post fails or is skipped", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    publishFails = "bad";
    await store.runSocial(MON_1215, { fetchImpl });
    publishFails = "no";
    await store.runSocial(MON_1230, { fetchImpl });
    const row = await echoRow(id);
    expect(row.status).toBe("failed");
    expect(row.echo_status).toBeNull();
    expect(storyCreates()).toHaveLength(0);
    expect(echoes).toHaveLength(0);
  });

  it("echo: the crayon card when the post drew it, or when its photo was flagged before the Story was made", async () => {
    await settings.setSocialSettings({ dryRun: false });
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    photoLoads = false; // the photo didn't load: the post is the crayon card
    let id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    await store.runSocial(MON_1215, { fetchImpl });
    let row = await echoRow(id);
    expect(drawn.at(-1)).toEqual([null]);
    expect(echoes.at(-1)).toEqual({ slide: 0, photo: false });
    expect(row.echo_frames[0].photo).toBeNull();

    // A photo post: its Story shows the photo while it's clear.
    await q("truncate social_posts restart identity cascade");
    photoLoads = true;
    id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    await store.runSocial(MON_1215, { fetchImpl });
    row = await echoRow(id);
    expect(echoes.at(-1)).toEqual({ slide: 0, photo: true });
    expect(row.echo_frames[0]).toMatchObject({
      sha: frameSha(0, true),
      photo: { src: LARKSPUR_PHOTO, sha256: "d".repeat(64) },
      status: "published",
    });

    // Published, then a person is seen in the photo: the crayon card.
    await q("truncate social_posts restart identity cascade");
    id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    await q(
      `update social_posts set status = 'published', published_at = '${MON_1215.toISOString()}' where id = ${id}`,
    );
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "f".repeat(64), verdict: "people" },
    ]);
    await store.runSocial(MON_1230, { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(echoes.at(-1)).toEqual({ slide: 0, photo: false });
    expect(row.echo_frames[0]).toMatchObject({
      sha: frameSha(0, false),
      photo: null,
    });
    expect(storyCreates().at(-1)?.body.get("image_url")).toBe(
      frameUrl(frameSha(0, false)),
    );
  });

  it("echo: dry run draws every frame once and never calls Meta", async () => {
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    await store.runSocial(MON_1215, { fetchImpl });
    const row = await echoRow(id);
    expect(row).toMatchObject({ status: "dry_run", echo_status: "dry_run" });
    expect(row.echo_frames.map((f) => f.sha)).toEqual([frameSha(0, false)]);
    expect(echoes).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("echo: the kill switch and SOCIAL_PUBLISH=off stop it too", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await q(
      `update social_posts set status = 'published', published_at = '${MON_1215.toISOString()}' where id = ${id}`,
    );
    await settings.setSocialSettings({ enabled: false });
    await store.runSocial(MON_1230, { fetchImpl });
    await settings.setSocialSettings({ enabled: true });
    process.env.SOCIAL_PUBLISH = "off";
    await store.runSocial(MON_1230, { fetchImpl });
    delete process.env.SOCIAL_PUBLISH;
    expect(calls).toEqual([]);
    expect((await echoRow(id)).echo_status).toBeNull();
  });

  it("echo: none for the Friday Story, and none for a post over 6 hours old", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await q(
      `update social_posts set kind = 'story', status = 'published', published_at = '${MON_1215.toISOString()}' where id = ${id}`,
    );
    await store.runSocial(MON_1230, { fetchImpl });
    expect((await echoRow(id)).echo_status).toBeNull();
    await q(`update social_posts set kind = 'park_post' where id = ${id}`);
    await store.runSocial(new Date("2026-11-24T03:00:00Z"), { fetchImpl });
    expect((await echoRow(id)).echo_status).toBe("skipped");
    expect(storyCreates()).toHaveLength(0);
    expect(echoAlerts()).toEqual([]);
  });

  it("echo: a broken drawing retries and never touches the feed post; Meta's no fails once and tells James", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    echoBreaks = true;
    const r = await store.runSocial(MON_1215, { fetchImpl });
    expect(r.notes.join(" ")).toMatch(/echo retry \(drawing broke\)/);
    let row = await echoRow(id);
    expect(row).toMatchObject({ status: "published", echo_status: null });
    echoBreaks = false;
    containerState = "ERROR";
    await store.runSocial(MON_1230, { fetchImpl });
    row = await echoRow(id);
    expect(row).toMatchObject({ status: "published", echo_status: "failed" });
    await store.runSocial(MON_1245, { fetchImpl });
    const told = alerts.filter((a) => /Story echo failed/.test(a.subject));
    expect(told).toHaveLength(1);
    expect(told[0].key).toBe(`social:echo failed:${id}`);
  });

  /** A live park post that is out, with its Story's container made (creating). */
  async function echoCreating() {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    storyState = "IN_PROGRESS"; // Meta hasn't finished the Story yet
    await store.runSocial(MON_1215, { fetchImpl });
    storyState = null;
    const row = await echoRow(id);
    expect(row).toMatchObject({ status: "published", echo_status: "creating" });
    const container = row.echo_frames[0].containerId;
    expect(container).toBeTruthy();
    return { id, container: String(container) };
  }

  it("echo: a photo flagged after the container is made never publishes it", async () => {
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const { id, container } = await echoCreating();
    expect(echoes.at(-1)).toEqual({ slide: 0, photo: true });
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "people" },
    ]);
    await store.runSocial(MON_1230, { fetchImpl });
    await store.runSocial(MON_1245, { fetchImpl });
    const row = await echoRow(id);
    expect(row).toMatchObject({ echo_status: "skipped" });
    expect(String(row.echo_reason)).toMatch(/photo flagged/i);
    expect(row.echo_frames[0].status).toBe("skipped");
    expect(publishesOf(container)).toHaveLength(0);
  });

  it("echo: in a carousel, a photo frame flagged after its container is made is skipped; the rest go out", async () => {
    await settings.setSocialSettings({ dryRun: false });
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const id = await publishedCarousel(3);
    storyState = "IN_PROGRESS";
    await store.runSocial(MON_1230, { fetchImpl });
    storyState = null;
    let row = await echoRow(id);
    expect(row.echo_status).toBe("creating");
    expect(row.echo_frames.map((f) => !!f.photo)).toEqual([true, false, false]);
    const first = row.echo_frames[0].containerId;
    expect(first).toBeTruthy();
    expect(storyCreates()).toHaveLength(1);
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "people" },
    ]);
    await store.runSocial(MON_1245, { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(row.echo_frames.map((f) => f.status)).toEqual([
      "skipped",
      "published",
      "published",
    ]);
    expect(String(row.echo_reason)).toMatch(/1 of 3 frames skipped/);
    expect(publishesOf(first)).toHaveLength(0);
    // Meta can't fetch the flagged frame; the photo-free ones still serve.
    expect(await store.mediaAllowed(row.echo_frames[0].sha, "jpg")).toBe(false);
    expect(await store.mediaAllowed(row.echo_frames[1].sha, "jpg")).toBe(true);
    expect(echoAlerts()).toEqual([]);
  });

  it("echo: a photo flagged after a timed-out create is redrawn as the crayon card", async () => {
    await settings.setSocialSettings({ dryRun: false });
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    storyCreateFails = true;
    await store.runSocial(MON_1215, { fetchImpl });
    let row = await echoRow(id);
    expect(row.echo_status).toBe("creating");
    expect(row.echo_frames[0]).toMatchObject({
      containerId: null,
      sha: frameSha(0, true),
    });
    expect(echoes.at(-1)).toEqual({ slide: 0, photo: true });
    storyCreateFails = false;
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "people" },
    ]);
    await store.runSocial(MON_1230, { fetchImpl });
    row = await echoRow(id);
    expect(echoes.at(-1)).toEqual({ slide: 0, photo: false });
    expect(row.echo_status).toBe("published");
    expect(row.echo_frames[0]).toMatchObject({
      sha: frameSha(0, false),
      photo: null,
      status: "published",
    });
    // Only the crayon frame was ever made.
    expect(storyCreates().at(-1)?.body.get("image_url")).toBe(
      frameUrl(frameSha(0, false)),
    );
  });

  it("echo: a create that times out is made again next run", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    storyCreateFails = true;
    await store.runSocial(MON_1215, { fetchImpl });
    let row = await echoRow(id);
    expect(row.echo_status).toBe("creating");
    expect(row.echo_frames[0].containerId).toBeNull();
    storyCreateFails = false;
    await store.runSocial(MON_1230, { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_frames[0].containerId).toBeTruthy();
    expect(row.echo_status).toBe("published");
    expect(echoes).toHaveLength(1);
    expect(echoAlerts()).toEqual([]);
  });

  it("echo: a publish that times out but went out is settled as published, never sent again", async () => {
    const { id, container } = await echoCreating();
    publishFails = "timeout";
    afterPublish = "PUBLISHED";
    await store.runSocial(MON_1230, { fetchImpl });
    expect((await echoRow(id)).echo_status).toBe("published");
    publishFails = "no";
    await store.runSocial(MON_1245, { fetchImpl });
    expect(publishesOf(container)).toHaveLength(1);
  });

  it("echo: a 5xx publish whose container is still FINISHED waits, then goes out next run", async () => {
    const { id, container } = await echoCreating();
    publishFails = "5xx";
    await store.runSocial(MON_1230, { fetchImpl });
    expect((await echoRow(id)).echo_status).toBe("publishing");
    publishFails = "no";
    await store.runSocial(MON_1245, { fetchImpl });
    const row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(row.echo_frames[0].mediaId).toMatch(/^IGMEDIA/);
    expect(row.echo_media_id).toBe(row.echo_frames[0].mediaId);
    expect(publishesOf(container)).toHaveLength(2);
    expect(echoAlerts()).toEqual([]);
  });

  it("echo: Meta's 'already published' counts as published", async () => {
    const { id } = await echoCreating();
    publishFails = "already";
    await store.runSocial(MON_1230, { fetchImpl });
    expect((await echoRow(id)).echo_status).toBe("published");
    expect(echoAlerts()).toEqual([]);
  });

  it("echo: only the run that claims it (creating to publishing) publishes", async () => {
    const { id, container } = await echoCreating();
    onStatus = async (c) => {
      if (c === container)
        await q(
          `update social_posts set echo_status = 'publishing' where id = ${id}`,
        );
    };
    await store.runSocial(MON_1230, { fetchImpl });
    expect(publishesOf(container)).toHaveLength(0);
  });

  it("echo: skipped when Meta's daily publishing limit is used up", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await q(
      `update social_posts set status = 'published', published_at = '${MON_1215.toISOString()}' where id = ${id}`,
    );
    quota = 50;
    await store.runSocial(MON_1230, { fetchImpl });
    const [row] = await q(
      `select echo_status, echo_reason from social_posts where id = ${id}`,
    );
    expect(row).toMatchObject({
      echo_status: "skipped",
      echo_reason: "Daily publishing limit reached.",
    });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("echo: a carousel starts only when all its Stories fit the quota", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(7);
    quota = 44; // 6 left: one short
    await store.runSocial(MON_1230, { fetchImpl });
    expect(await echoRow(id)).toMatchObject({
      echo_status: "skipped",
      echo_reason: "Daily publishing limit reached.",
    });
    expect(echoes).toHaveLength(0);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    await q(`update social_posts set echo_status = null where id = ${id}`);
    quota = 43; // exactly 7 left
    await store.runSocial(MON_1245, { fetchImpl });
    expect((await echoRow(id)).echo_status).toBe("published");
    expect(storyCreates()).toHaveLength(7);
  });

  it("echo: when the quota runs out midway it waits, then goes on where it stopped", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(3);
    storyState = "IN_PROGRESS";
    await store.runSocial(MON_1230, { fetchImpl });
    storyState = null;
    // Something else used the day's room meanwhile.
    quota = 49;
    await store.runSocial(MON_1245, { fetchImpl });
    let row = await echoRow(id);
    expect(row.echo_status).toBe("creating");
    expect(row.echo_frames.map((f) => f.status)).toEqual([
      "published",
      "pending",
      "pending",
    ]);
    expect(String(row.echo_reason)).toMatch(/publishing limit/i);
    expect(storyCreates()).toHaveLength(1);
    quota = 10;
    await store.runSocial(new Date("2026-11-23T21:00:00Z"), { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(storyCreates()).toHaveLength(3);
    for (const f of row.echo_frames)
      expect(publishesOf(f.containerId)).toHaveLength(1);
  });

  it("echo: frames still waiting 6 hours on are skipped, and James is told how many went out", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(3);
    publishFails = "rate"; // FINISHED and retryable: back to creating
    publishFailsOn = 2;
    await store.runSocial(MON_1230, { fetchImpl });
    expect((await echoRow(id)).echo_frames.map((f) => f.status)).toEqual([
      "published",
      "pending",
      "pending",
    ]);
    await store.runSocial(new Date("2026-11-24T03:00:00Z"), { fetchImpl });
    const row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(String(row.echo_reason)).toMatch(/Only 1 of 3 Stories went out/);
    expect(row.echo_frames.map((f) => f.status)).toEqual([
      "published",
      "skipped",
      "skipped",
    ]);
    expect(echoAlerts()).toHaveLength(1);
  });

  it("echo: frames Meta is still processing are waited on, so a carousel goes out in one run", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(3);
    // Each Story container reads IN_PROGRESS twice before it's FINISHED.
    const reads = new Map<string, number>();
    onStatus = async (c) => {
      const n = (reads.get(c) ?? 0) + 1;
      reads.set(c, n);
      storyState = n <= 2 ? "IN_PROGRESS" : null;
    };
    await store.runSocial(MON_1230, { fetchImpl });
    const row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(row.echo_frames.map((f) => f.status)).toEqual(
      Array(3).fill("published"),
    );
    expect(storyCreates()).toHaveLength(3);
    for (const f of row.echo_frames) {
      expect(reads.get(String(f.containerId))).toBeGreaterThanOrEqual(3);
      expect(publishesOf(f.containerId)).toHaveLength(1);
    }
  });

  it("echo: the kill switch or SOCIAL_PUBLISH=off flipped mid-run stops the next frame", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(3);
    // While Meta finishes the second frame, James turns the switch off.
    let containers = 0;
    onStatus = async (c) => {
      if (storyContainers.has(c) && ++containers === 2)
        await settings.setSocialSettings({ enabled: false });
    };
    await store.runSocial(MON_1230, { fetchImpl });
    let row = await echoRow(id);
    expect(row.echo_status).toBe("creating");
    expect(row.echo_frames.map((f) => f.status)).toEqual([
      "published",
      "pending",
      "pending",
    ]);
    expect(publishesOf(row.echo_frames[1].containerId)).toHaveLength(0);
    onStatus = null;
    // Back on, then SOCIAL_PUBLISH=off before the third frame is made.
    await settings.setSocialSettings({ enabled: true });
    onStatus = async (c) => {
      if (c === row.echo_frames[1].containerId)
        process.env.SOCIAL_PUBLISH = "off";
    };
    try {
      await store.runSocial(MON_1245, { fetchImpl });
    } finally {
      delete process.env.SOCIAL_PUBLISH;
    }
    row = await echoRow(id);
    expect(row.echo_frames.map((f) => f.status)).toEqual([
      "published",
      "pending",
      "pending",
    ]);
    expect(storyCreates()).toHaveLength(2);
    onStatus = null;
    await store.runSocial(new Date("2026-11-23T21:00:00Z"), { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(storyCreates()).toHaveLength(3);
    for (const f of row.echo_frames)
      expect(publishesOf(f.containerId)).toHaveLength(1);
  });

  it("echo: a container Meta errors on after its photo is flagged skips only that frame", async () => {
    await settings.setSocialSettings({ dryRun: false });
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const id = await publishedCarousel(3);
    storyState = "IN_PROGRESS";
    await store.runSocial(MON_1230, { fetchImpl });
    storyState = null;
    const first = (await echoRow(id)).echo_frames[0].containerId;
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "people" },
    ]);
    onStatus = async (c) => {
      storyState = c === first ? "ERROR" : null;
    };
    await store.runSocial(MON_1245, { fetchImpl });
    const row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(row.echo_frames.map((f) => f.status)).toEqual([
      "skipped",
      "published",
      "published",
    ]);
    expect(publishesOf(first)).toHaveLength(0);
    expect(alerts.filter((a) => /Story echo failed/.test(a.subject))).toEqual(
      [],
    );
  });

  it("echo: without Meta's quota it never starts or goes on; it waits for the next run", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await publishedCarousel(3);
    quotaFails = true;
    await store.runSocial(MON_1230, { fetchImpl });
    let row = await echoRow(id);
    expect(row.echo_status).toBeNull();
    expect(String(row.echo_reason)).toMatch(/limit couldn't be read/);
    expect(storyCreates()).toHaveLength(0);
    expect(echoes).toHaveLength(0);
    // Started, then the quota can't be read midway: it waits there.
    quotaFails = false;
    storyState = "IN_PROGRESS";
    await store.runSocial(MON_1245, { fetchImpl });
    storyState = null;
    quotaFails = true;
    await store.runSocial(new Date("2026-11-23T21:00:00Z"), { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_status).toBe("creating");
    expect(row.echo_frames.map((f) => f.status)).toEqual([
      "published",
      "pending",
      "pending",
    ]);
    expect(storyCreates()).toHaveLength(1);
    quotaFails = false;
    await store.runSocial(new Date("2026-11-23T21:15:00Z"), { fetchImpl });
    expect((await echoRow(id)).echo_status).toBe("published");
    expect(storyCreates()).toHaveLength(3);
  });

  it("echo: a Story waiting when the account flips to dry run waits, then goes out once back live", async () => {
    const { id, container } = await echoCreating();
    await settings.setSocialSettings({ dryRun: true });
    const before = calls.length;
    await store.runSocial(MON_1230, { fetchImpl });
    expect(calls.length).toBe(before);
    expect((await echoRow(id)).echo_status).toBe("creating");
    await settings.setSocialSettings({ dryRun: false });
    await store.runSocial(MON_1245, { fetchImpl });
    expect((await echoRow(id)).echo_status).toBe("published");
    expect(publishesOf(container)).toHaveLength(1);
  });

  it("echo: no echo work once the run is out of time", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await q(
      `update social_posts set status = 'published', published_at = '${MON_1215.toISOString()}' where id = ${id}`,
    );
    const { runEchoes } = await import("./echo");
    const notes: string[] = [];
    const live = settings.graphOpts(fetchImpl)!;
    await runEchoes(MON_1230, live, notes, Date.now() - 201_000);
    expect(notes.join(" ")).toMatch(/out of time/);
    expect(calls).toEqual([]);
    expect((await echoRow(id)).echo_status).toBeNull();
  });

  it("echo: a photo flagged while a publish is unanswered is never published again, and James is told", async () => {
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    const { id, container } = await echoCreating();
    expect(echoes.at(-1)).toEqual({ slide: 0, photo: true });
    publishFails = "5xx";
    await store.runSocial(MON_1230, { fetchImpl });
    expect((await echoRow(id)).echo_status).toBe("publishing");
    expect(publishesOf(container)).toHaveLength(1);
    publishFails = "no";
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "people" },
    ]);
    await store.runSocial(MON_1245, { fetchImpl });
    const row = await echoRow(id);
    expect(row.echo_status).toBe("skipped");
    expect(String(row.echo_reason)).toMatch(/photo flagged/i);
    expect(publishesOf(container)).toHaveLength(1);
    const told = alerts.filter((a) =>
      /Story echo photo flagged/.test(a.subject),
    );
    expect(told).toHaveLength(1);
    expect(told[0].key).toBe(`social:echo photo flagged:${id}`);
  });

  it("echo: an echo from before frames (one card) finishes as that one Story", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    const legacy = JSON.stringify({
      sha: "e".repeat(64),
      ext: "jpg",
      width: 1080,
      height: 1920,
      photoFree: true,
    });
    await q(
      `update social_posts set status = 'published', published_at = '${MON_1215.toISOString()}', echo_status = 'creating', echo_media = '${legacy}', echo_container_id = 'C77' where id = ${id}`,
    );
    await store.runSocial(MON_1230, { fetchImpl });
    const row = await echoRow(id);
    expect(row.echo_status).toBe("published");
    expect(publishesOf("C77")).toHaveLength(1);
    expect(storyCreates()).toHaveLength(0);
    expect(echoes).toHaveLength(0);
    expect(row.echo_frames).toMatchObject([
      { sha: "e".repeat(64), containerId: "C77", status: "published" },
    ]);
  });

  it("redrawQueued re-validates a queued writer post and replaces its media in place, never once claimed", async () => {
    const id = await draftPost();
    const [before] = await q(
      `select media, spec from social_posts where id = ${id}`,
    );
    // Dry run: drawn, nothing stored.
    const dry = await store.redrawQueued(id, { apply: false, now: SUNDAY });
    expect(dry.ok).toBe(true);
    if (dry.ok) expect(dry.applied).toBe(false);
    const [same] = await q(`select media from social_posts where id = ${id}`);
    expect(same.media).toEqual(before.media);
    // Apply: the same row, new media, still queued. (Its slot is pushed
    // well ahead of the real clock: the update needs 35+ minutes to go.)
    await q(
      `update social_posts set publish_at = now() + interval '2 days' where id = ${id}`,
    );
    const done = await store.redrawQueued(id, { apply: true, now: SUNDAY });
    expect(done.ok).toBe(true);
    const [after] = await q(
      `select id, status, reason from social_posts where id = ${id}`,
    );
    expect(after).toMatchObject({
      id,
      status: "queued",
      reason: "Redrawn with the current layout.",
    });
    // Claimed by the publisher: refused, untouched.
    await q(`update social_posts set status = 'creating' where id = ${id}`);
    const late = await store.redrawQueued(id, { apply: true, now: SUNDAY });
    expect(late).toMatchObject({
      ok: false,
      error: "It's creating, not queued.",
    });
    expect((await store.redrawQueued(99999, { apply: false })).ok).toBe(false);
  });

  it("redrawQueued refuses when the publisher claims the post mid-redraw, or it's about to go out", async () => {
    const id = await draftPost();
    await q(
      `update social_posts set publish_at = now() + interval '2 days' where id = ${id}`,
    );
    const [before] = await q(
      `select media, spec from social_posts where id = ${id}`,
    );
    // The publisher claims it while the new JPEGs upload.
    onStore = async () => {
      await q(
        `update social_posts set status = 'creating', container_id = 'C1' where id = ${id}`,
      );
    };
    const r = await store.redrawQueued(id, { apply: true, now: SUNDAY });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/left the queue/);
    const [after] = await q(
      `select media, spec from social_posts where id = ${id}`,
    );
    expect(after).toEqual(before);
    // Queued but within 35 minutes of its slot: refused too.
    onStore = null;
    await q(
      `update social_posts set status = 'queued', container_id = null, publish_at = now() + interval '20 minutes' where id = ${id}`,
    );
    const soon = await store.redrawQueued(id, { apply: true, now: SUNDAY });
    expect(soon.ok).toBe(false);
    // Queued, far off, but a container already made: refused.
    await q(
      `update social_posts set publish_at = now() + interval '2 days', child_ids = '{C9}' where id = ${id}`,
    );
    expect(
      (await store.redrawQueued(id, { apply: true, now: SUNDAY })).ok,
    ).toBe(false);
  });

  // --- Park pairings (every other Wednesday, code only) ---------------------

  /** Places' stand-in: three spots near three parks, per theme by query. */
  const placesCalls: string[] = [];
  let placesDown = false;
  const spot = (
    id: string,
    name: string,
    type: string,
    at: { lat: number; lng: number },
    town: string,
  ) => ({
    id,
    displayName: { text: name },
    location: { latitude: at.lat + 0.1 / 69, longitude: at.lng },
    addressComponents: [{ shortText: town, types: ["locality"] }],
    businessStatus: "OPERATIONAL",
    primaryType: type,
    goodForChildren: true,
    menuForChildren: true,
    outdoorSeating: true,
    dineIn: true,
    rating: 4.7,
    userRatingCount: 500,
    websiteUri: "https://example.org/",
    regularOpeningHours: {
      periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        open: { day, hour: 7, minute: 0 },
        close: { day, hour: 16, minute: 0 },
      })),
    },
  });
  const EMPIRE = { lat: 44.09267, lng: -121.29746 };
  const FAREWELL = { lat: 44.04112, lng: -121.32568 };
  const SAMJ = { lat: 44.27362, lng: -121.18474 };
  /** The NWS stand-in: a dry weekend, or a wet one. */
  let wetWeekend = false;
  const weather = (async (u: unknown) => {
    const url = String(u);
    if (url.includes("/points/"))
      return Response.json({
        properties: {
          forecast: "https://api.weather.gov/gridpoints/x/forecast",
        },
      });
    const periods = ["2026-12-04", "2026-12-05", "2026-12-06"].map((d) => ({
      startTime: `${d}T06:00:00-08:00`,
      isDaytime: true,
      temperature: 44,
      shortForecast: wetWeekend ? "Rain" : "Sunny",
      probabilityOfPrecipitation: { value: wetWeekend ? 80 : 5 },
    }));
    return Response.json({ properties: { periods } });
  }) as unknown as typeof fetch;
  const places = (async (u: unknown, init?: RequestInit) => {
    // Place Details: an indoor anchor's hours (open every day, 9 to 6).
    if (!init?.body)
      return Response.json({
        regularOpeningHours: {
          periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
            open: { day, hour: 9, minute: 0 },
            close: { day, hour: 18, minute: 0 },
          })),
        },
      });
    void u;
    const q: string = JSON.parse(String(init?.body)).textQuery;
    placesCalls.push(q);
    if (placesDown)
      return Response.json({ error: { status: "INTERNAL" } }, { status: 500 });
    const town = / in ([A-Za-z ]+), Oregon$/.exec(q)?.[1];
    const all = /^coffee/.test(q)
      ? [
          spot("cafe1", "WildRoots Coffeehouse", "coffee_shop", EMPIRE, "Bend"),
          spot(
            "cafe2",
            "Dilly Dally Coffee Co.",
            "coffee_shop",
            FAREWELL,
            "Bend",
          ),
          spot("cafe3", "Coffee Depot", "coffee_shop", SAMJ, "Redmond"),
          // Near the wet-weekend test's event (and a mile from any park).
          spot(
            "cafe4",
            "Lone Pine Coffee Roasters",
            "coffee_shop",
            { lat: EMPIRE.lat + 0.004, lng: EMPIRE.lng + 0.02 },
            "Bend",
          ),
        ]
      : /^food/.test(q)
        ? [
            spot("lot1", "The Lot", "food_court", EMPIRE, "Bend"),
            spot(
              "lot2",
              "The Podski Food Cart Lot",
              "food_court",
              FAREWELL,
              "Bend",
            ),
            spot("lot3", "Dry Canyon Club", "food_court", SAMJ, "Redmond"),
          ]
        : [];
    return Response.json({
      places: all.filter((p) => p.addressComponents[0].shortText === town),
    });
  }) as unknown as typeof fetch;
  /** Wednesday, Dec 2, 2026 (a mashup week), Pacific: 5:45, 6:00 and 7:15 pm. */
  const WED_1745 = new Date("2026-12-03T01:45:00Z");
  const WED_1800 = new Date("2026-12-03T02:00:00Z");
  const WED_1915 = new Date("2026-12-03T03:20:00Z");

  async function pairingParks() {
    await q(`insert into parks (slug, name, city, lat, lng, approved_at, features) values
      ('empire-crossing-park-bend', 'Empire Crossing Park', 'Bend', ${EMPIRE.lat}, ${EMPIRE.lng}, now(), '{}'),
      ('farewell-bend-park-bend', 'Farewell Bend Park', 'Bend', ${FAREWELL.lat}, ${FAREWELL.lng}, now(), '{}'),
      ('sam-johnson-park-redmond', 'Sam Johnson Park', 'Redmond', ${SAMJ.lat}, ${SAMJ.lng}, now(), '{}')`);
  }

  it("park pairings: made by code on a mashup Wednesday at 6 pm, once, then out (dry run)", async () => {
    process.env.GOOGLE_PLACES_KEY = "test-places-key";
    placesCalls.length = 0;
    placesDown = false;
    await pairingParks();
    let r = await store.runSocial(WED_1745, {
      fetchImpl,
      placesFetch: places,
      forecastFetch: weather,
      placesBackoffMs: 1,
    });
    expect(r.notes).toContain("mashup: not yet");
    expect(placesCalls).toEqual([]);
    r = await store.runSocial(WED_1800, {
      fetchImpl,
      placesFetch: places,
      forecastFetch: weather,
      placesBackoffMs: 1,
    });
    expect(r.notes, JSON.stringify(r.notes)).toContain("mashup: made (coffee)");
    const [row] = await q(
      `select kind, slot_date::text as day, status, origin, body, spec, caption from social_posts where kind = 'mashup'`,
    );
    expect(row).toMatchObject({
      kind: "mashup",
      day: "2026-12-02",
      status: "queued",
      origin: "code",
    });
    const spec = row.spec as {
      slides: { t: string }[];
      facts: { parks: string[]; mashup: { theme: string; cycle: number } };
    };
    expect(spec.slides.map((x) => x.t)).toEqual([
      "headline",
      "pair",
      "pair",
      "pair",
      "cta",
    ]);
    expect(spec.facts.mashup).toMatchObject({ theme: "coffee", cycle: 1 });
    expect(spec.facts.parks).toHaveLength(3);
    // Only place ids and our parks are kept of Google's (the body).
    expect(JSON.stringify(row.body)).not.toMatch(/Coffee|rating|4\.7/);
    expect(String(row.caption)).toContain(
      "cafes a short walk from a playground",
    );
    expect(String(row.caption)).not.toMatch(/4\.7|rating|stars/i);
    // The key never leaves in a request body or URL.
    expect(placesCalls.join(" ")).not.toContain("test-places-key");
    r = await store.runSocial(new Date("2026-12-03T02:15:00Z"), {
      fetchImpl,
      placesFetch: places,
      forecastFetch: weather,
      placesBackoffMs: 1,
    });
    expect(r.notes).toContain("mashup: already made");
    r = await store.runSocial(WED_1915, {
      fetchImpl,
      placesFetch: places,
      forecastFetch: weather,
      placesBackoffMs: 1,
    });
    expect(
      (await q(`select status from social_posts where kind = 'mashup'`))[0],
    ).toEqual({ status: "dry_run" });
    expect(calls).toEqual([]);
    // Two weeks on, the rotation's next theme.
    r = await store.runSocial(new Date("2026-12-17T02:00:00Z"), {
      fetchImpl,
      placesFetch: places,
      forecastFetch: weather,
      placesBackoffMs: 1,
    });
    expect(r.notes).toContain("mashup: made (food_trucks)");
  });

  it("park pairings: none on an Unpack week, and the week's holiday Unpack wins", async () => {
    process.env.GOOGLE_PLACES_KEY = "test-places-key";
    await pairingParks();
    expect(
      await store.ensureMashup(new Date("2026-12-10T02:00:00Z"), {
        placesFetch: places,
        forecastFetch: weather,
        placesBackoffMs: 1,
      }),
    ).toBe("an Unpack week");
    // Not Wednesday: nothing.
    expect(
      await store.ensureMashup(new Date("2026-12-02T02:00:00Z"), {
        placesFetch: places,
        forecastFetch: weather,
        placesBackoffMs: 1,
      }),
    ).toBe("not its day");
    await q(`insert into social_posts (kind, slot_date, publish_at, origin, status, body, spec)
      values ('unpack', '2026-11-29', '2026-11-30T03:45:00Z', 'writer', 'queued', '{}', '{"facts":{"parks":[]}}')`);
    expect(
      await store.ensureMashup(WED_1800, {
        placesFetch: places,
        forecastFetch: weather,
        placesBackoffMs: 1,
      }),
    ).toBe("the week's Unpack has the slot");
    expect(
      (
        await q(
          `select count(*)::int as n from social_posts where kind = 'mashup'`,
        )
      )[0],
    ).toEqual({ n: 0 });
  });

  it("park pairings: the routine's Wednesday Unpack is refused on a mashup week", async () => {
    const { WeekDraft } = await import("./model");
    const r = await store.handleDrafts(
      WeekDraft.parse({
        week_of: "2026-11-30",
        posts: [
          {
            type: "unpack",
            headline: "Three warm spots for a cold week",
            highlight: "warm",
            items: [
              {
                ref: "park:larkspur-park-bend",
                what: "Universal-design play for every ability.",
              },
              {
                ref: "park:larkspur-park-bend",
                what: "Universal-design play for every ability.",
              },
              {
                ref: "park:larkspur-park-bend",
                what: "Universal-design play for every ability.",
              },
            ],
          },
        ],
      }),
      new Date("2026-11-30T02:00:00Z"),
      { store: false },
    );
    expect(r[0].errors.join(" ")).toMatch(/park pairings week/);
  });

  it("park pairings: Places down retries next run; no key or no pairs skips and tells James", async () => {
    await pairingParks();
    process.env.GOOGLE_PLACES_KEY = "test-places-key";
    placesDown = true;
    const r = await store.runSocial(WED_1800, {
      fetchImpl,
      placesFetch: places,
      forecastFetch: weather,
      placesBackoffMs: 1,
    });
    expect(r.notes.join(" ")).toMatch(
      /mashup: failed \(Places search failed \(500/,
    );
    expect(alerts.map((a) => a.key)).toContain("social:make:mashup:2026-12-02");
    expect((await q(`select count(*)::int as n from social_posts`))[0]).toEqual(
      { n: 0 },
    );
    placesDown = false;
    // No key: skipped, and James hears.
    delete process.env.GOOGLE_PLACES_KEY;
    expect(
      await store.ensureMashup(WED_1800, {
        placesFetch: places,
        forecastFetch: weather,
        placesBackoffMs: 1,
      }),
    ).toMatch(/GOOGLE_PLACES_KEY/);
    expect(alerts.map((a) => a.key)).toContain("social:skip:mashup:2026-12-02");
    const [row] = await q(
      `select status from social_posts where kind = 'mashup'`,
    );
    expect(row).toEqual({ status: "skipped" });
  });

  it("park pairings: next week's holiday Unpack doesn't take this week; the day's Places cap skips", async () => {
    process.env.GOOGLE_PLACES_KEY = "test-places-key";
    await pairingParks();
    // Next week's Sunday carousel, stored early: not this week's.
    await q(`insert into social_posts (kind, slot_date, publish_at, origin, status, body, spec)
      values ('unpack', '2026-12-06', '2026-12-07T03:45:00Z', 'writer', 'queued', '{}', '{"facts":{"parks":[]}}')`);
    // Today's cap almost used: the make gets 1 request, then skips once.
    await q(
      `insert into places_usage (day, requests) values ('2026-12-02', 59)`,
    );
    const got = await store.ensureMashup(WED_1800, {
      placesFetch: places,
      forecastFetch: weather,
      placesBackoffMs: 1,
    });
    expect(got).toMatch(/today's 60 requests are used/);
    expect((await q(`select requests from places_usage`))[0]).toEqual({
      requests: 60,
    });
    expect(
      alerts.filter((a) => a.key === "social:skip:mashup:2026-12-02"),
    ).toHaveLength(1);
    // Skipped once: no more searches this week.
    expect(
      await store.ensureMashup(WED_1800, {
        placesFetch: places,
        forecastFetch: weather,
      }),
    ).toBe("already made");
  });

  it("park pairings: a wet weekend leads with an event; a canceled event drops only its slide", async () => {
    process.env.GOOGLE_PLACES_KEY = "test-places-key";
    wetWeekend = true;
    try {
      await pairingParks();
      // An indoor event Saturday near Empire Crossing (a cafe's walk away).
      await addEvent("train-show", "2026-12-05", "Bend", {
        title: "Train Show",
        setting: "indoor",
        point: { lat: EMPIRE.lat + 0.004, lng: EMPIRE.lng + 0.004 },
      });
      let r = await store.runSocial(WED_1800, {
        fetchImpl,
        placesFetch: places,
        forecastFetch: weather,
      });
      expect(r.notes, JSON.stringify(r.notes)).toContain(
        "mashup: made (coffee)",
      );
      const [row] = await q(
        `select id, spec from social_posts where kind = 'mashup'`,
      );
      const spec = row.spec as {
        headline: string;
        slides: { t: string; kind?: string; label?: string }[];
        facts: { mashup: { weather: string; pairs: { kind: string }[] } };
      };
      // The weather is the cover's kicker; an event makes it "something for the kids".
      expect(spec.headline).toMatch(/\+ something for the kids$/);
      expect(spec.slides[0]).toMatchObject({ kicker: "Rainy-day pairings" });
      expect(spec.facts.mashup.weather).toBe("wet");
      const pairs = spec.slides.filter((x) => x.t === "pair");
      expect(pairs[0]).toMatchObject({ kind: "event", label: "This weekend" });
      // Canceled before it goes out: that slide goes, the rest stay.
      await q(
        `update kid_events set status = 'canceled' where slug = 'train-show'`,
      );
      r = await store.runSocial(new Date("2026-12-03T03:20:00Z"), {
        fetchImpl,
        placesFetch: places,
        forecastFetch: weather,
      });
      expect(r.notes.join(" ")).toMatch(/redrawn without 1 changed event/);
      const [after] = await q(
        `select status, spec, caption from social_posts where id = ${row.id}`,
      );
      const next = after.spec as { slides: { t: string; kind?: string }[] };
      expect(next.slides.filter((x) => x.t === "pair")).toHaveLength(
        pairs.length - 1,
      );
      expect(next.slides.some((x) => x.kind === "event")).toBe(false);
      expect(String(after.caption)).not.toContain("Train Show");
      expect(after.status).toBe("queued");
    } finally {
      wetWeekend = false;
    }
  });

  it("park pairings: fewer than 3 pairs in every theme skips the week", async () => {
    process.env.GOOGLE_PLACES_KEY = "test-places-key";
    // No parks on the map: no towns to search, nothing to pair with.
    await q(`delete from parks`);
    const got = await store.ensureMashup(WED_1800, {
      placesFetch: places,
      forecastFetch: weather,
      placesBackoffMs: 1,
    });
    expect(got).toMatch(/No theme had 3 good pairs/);
    expect(alerts.map((a) => a.key)).toContain("social:skip:mashup:2026-12-02");
  });
});
