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
vi.mock("./render", () => ({
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
  storeMedia: async (files: { file: unknown }[]) => files.map((f) => f.file),
}));
/** What the Story echo was drawn from (the stub records the cover). */
const echoes: { kind: string; line: string; cover: string }[] = [];
let echoBreaks = false;
vi.mock("./echo-render", () => ({
  storedBytes: async (f: { sha: string }) => Buffer.from(`stored:${f.sha}`),
  crayonCover: async () => Buffer.from("crayon"),
  renderEcho: async (kind: string, line: string, cover: Uint8Array) => {
    if (echoBreaks) throw new Error("drawing broke");
    echoes.push({ kind, line, cover: Buffer.from(cover).toString() });
    return {
      bytes: Buffer.from("echo"),
      file: { sha: "e".repeat(64), ext: "jpg", width: 1080, height: 1920 },
    };
  },
  storeEcho: async (r: { file: unknown }) => r.file,
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
let publishFails: "no" | "timeout" | "rate" | "bad" = "no";
let quota = 1;
let comments: { id: string; text: string; from: { id: string } }[] = [];
const meta = async (u: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(u));
  const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
  const body = new URLSearchParams(String(init?.body ?? ""));
  calls.push({ method: init?.method ?? "GET", path, body });
  if (path.endsWith("/content_publishing_limit"))
    return Response.json({ data: [{ quota_usage: quota }] });
  if (path.endsWith("/media_publish")) {
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
    return Response.json({ id: "IGMEDIA1" });
  }
  if (path.endsWith("/media")) return Response.json({ id: `C${calls.length}` });
  if (path.endsWith("/photos"))
    return Response.json({ id: `P${calls.length}` });
  if (path.endsWith("/feed")) return Response.json({ id: "FBPOST1" });
  if (path.endsWith("/comments")) return Response.json({ data: comments });
  if (path.endsWith("/conversations")) return Response.json({ data: [] });
  if (path.endsWith("/messages")) return Response.json({ recipient_id: "x" });
  if (/^C\d+$/.test(path))
    return Response.json({
      status_code:
        afterPublish && calls.some((c) => c.path.endsWith("/media_publish"))
          ? afterPublish
          : containerState,
    });
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
    containerState = "FINISHED";
    afterPublish = null;
    publishFails = "no";
    quota = 1;
    comments = [];
    delete process.env.SOCIAL_PUBLISH;
    delete process.env.SOCIAL_KEYWORD_DMS;
    delete process.env.FB_PAGE_ID;
    process.env.VERCEL_ENV = "production";
    await q(
      "truncate social_dm_replies, social_posts, social_photo_checks, news_issues, news_settings, kid_events, parks restart identity cascade",
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
      expect(
        calls.filter((c) => c.path.endsWith("/media_publish")),
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
    [row] = await q(`select status from social_posts where id = ${id}`);
    expect(row.status).toBe("published");
    expect(calls.filter((c) => c.path.endsWith("/media_publish"))).toHaveLength(
      1,
    );
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
    expect(sent[0].path).toBe("1234567890/messages");
    expect(JSON.parse(sent[0].body.get("recipient")!)).toEqual({
      comment_id: "c1",
    });
    expect(JSON.parse(sent[0].body.get("message")!).text).toContain(
      "/ig?from=ig_dm",
    );
    expect(await q(`select ext_id, status from social_dm_replies`)).toEqual([
      { ext_id: "c1", status: "sent" },
    ]);
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
  const storyCreates = () =>
    calls.filter(
      (c) =>
        c.path.endsWith("/media") && c.body.get("media_type") === "STORIES",
    );
  const echoRow = async (id: number) =>
    (
      await q(
        `select status, echo_status, echo_container_id, echo_media_id, echo_media->>'sha' as echo_sha, media->0->>'sha' as cover_sha from social_posts where id = ${id}`,
      )
    )[0];

  it("echo: once the feed post is out, one Story from its cover goes out, never twice", async () => {
    await settings.setSocialSettings({ dryRun: false });
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    expect(storyCreates()).toHaveLength(0);
    await store.runSocial(MON_1215, { fetchImpl });
    let row = await echoRow(id);
    expect(row.status).toBe("published");
    expect(row.echo_status).toBe("creating");
    expect(storyCreates()).toHaveLength(1);
    expect(storyCreates()[0].body.get("image_url")).toBe(
      `https://parkroulette.quest/social/m/${"e".repeat(64)}.jpg`,
    );
    expect(storyCreates()[0].body.get("caption")).toBeNull();
    expect(echoes).toEqual([
      {
        kind: "park_post",
        line: "This week's park pick",
        cover: `stored:${row.cover_sha}`,
      },
    ]);
    await store.runSocial(MON_1230, { fetchImpl });
    row = await echoRow(id);
    expect(row).toMatchObject({
      echo_status: "published",
      echo_media_id: "IGMEDIA1",
    });
    expect(
      calls.filter(
        (c) =>
          c.path.endsWith("/media_publish") &&
          c.body.get("creation_id") === row.echo_container_id,
      ),
    ).toHaveLength(1);
    for (const t of ["20:45", "21:00", "21:15"])
      await store.runSocial(new Date(`2026-11-23T${t}:00Z`), { fetchImpl });
    expect(storyCreates()).toHaveLength(1);
    expect(calls.filter((c) => c.path.endsWith("/media_publish"))).toHaveLength(
      2,
    );
    expect(echoes).toHaveLength(1);
    // Meta may fetch the echo's JPEG; the feed post's status is untouched.
    const { GET } = await import("@/app/social/m/[file]/route");
    const file = `${"e".repeat(64)}.jpg`;
    const res = await GET(new Request(`http://x/social/m/${file}`), {
      params: Promise.resolve({ file }),
    });
    expect(res.status).toBe(200);
    expect(alerts.filter((a) => /echo/i.test(a.subject))).toEqual([]);
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

  it("echo: the crayon cover when the post drew it, or when its photo was flagged since", async () => {
    await settings.setSocialSettings({ dryRun: false });
    await store.savePhotoChecks([
      { src: LARKSPUR_PHOTO, sha256: "d".repeat(64), verdict: "clear" },
    ]);
    photoLoads = false; // the photo didn't load: the post is the crayon card
    let id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    await store.runSocial(MON_1215, { fetchImpl });
    let row = await echoRow(id);
    expect(echoes.at(-1)?.cover).toBe(`stored:${row.cover_sha}`);
    expect(drawn.at(-1)).toEqual([null]);

    // A photo post, published, then a person is seen in the photo.
    await q("truncate social_posts restart identity cascade");
    photoLoads = true;
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
    expect(row.echo_status).toBe("creating");
    expect(echoes.at(-1)?.cover).toBe("crayon");
  });

  it("echo: dry run draws it once and never calls Meta", async () => {
    const id = await draftPost();
    await store.runSocial(MON_1150, { fetchImpl });
    await store.runSocial(MON_1215, { fetchImpl });
    const row = await echoRow(id);
    expect(row).toMatchObject({ status: "dry_run", echo_status: "dry_run" });
    expect(row.echo_sha).toBe("e".repeat(64));
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
    expect(alerts.filter((a) => /echo/i.test(a.subject))).toEqual([]);
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
    await store.runSocial(MON_1230, { fetchImpl });
    row = await echoRow(id);
    expect(row.echo_status).toBe("creating");
    containerState = "ERROR";
    await store.runSocial(new Date("2026-11-23T20:45:00Z"), { fetchImpl });
    await store.runSocial(new Date("2026-11-23T21:00:00Z"), { fetchImpl });
    row = await echoRow(id);
    expect(row).toMatchObject({ status: "published", echo_status: "failed" });
    const told = alerts.filter((a) => /Story echo failed/.test(a.subject));
    expect(told).toHaveLength(1);
    expect(told[0].key).toBe(`social:echo failed:${id}`);
  });
});
