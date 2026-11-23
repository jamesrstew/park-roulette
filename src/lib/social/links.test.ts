import { describe, expect, it } from "vitest";
import { inSpan, weekView } from "@/lib/events/programs";
import {
  destinationOf,
  fbCaptionFor,
  gridTiles,
  igRedirectPath,
  PENDING_POST_LINK,
  type PhotoVerdicts,
  type PublicRow,
  publicMedia,
  withPostLink,
} from "./links";
import type { PostSpec } from "./model";
import { stateLine, unpackItems, type Lookups } from "./post-page";

const sha = (c: string) => c.repeat(64);
const media = (c: string, n = 1) =>
  Array.from({ length: n }, (_, i) => ({
    sha: sha(String.fromCharCode(c.charCodeAt(0) + i)),
    ext: "jpg",
    role: "slide",
    width: 1080,
    height: 1350,
    alt: `slide ${i + 1}`,
  }));

const PHOTO = {
  src: "https://www.bendparksandrec.org/a.jpg",
  sha256: sha("9"),
  credit: null,
};

function spec(kind: string, over: Partial<PostSpec> = {}): PostSpec {
  return {
    kind: kind as PostSpec["kind"],
    size: kind === "story" ? "story" : "feed",
    slides: [],
    alts: [],
    caption: "x",
    fbCaption: null,
    headline: "A headline",
    modelText: "",
    facts: {
      parks: kind === "park_post" ? ["larkspur-park-bend"] : [],
      events: [],
      venues: [],
      issue: kind === "teaser" ? "2026-11-26" : null,
    },
    ...over,
  };
}

let nextId = 1;
function row(kind: string, over: Partial<PublicRow> = {}): PublicRow {
  const id = nextId++;
  return {
    id,
    kind,
    slotDate: "2026-11-24",
    status: "published",
    spec: spec(kind),
    media: media("a"),
    report: null,
    publishedAt: new Date(`2026-11-${10 + id}T20:00:00Z`),
    ...over,
  };
}

const none: PhotoVerdicts = { clear: new Set(), flagged: new Set() };
const cleared: PhotoVerdicts = {
  clear: new Set([`${PHOTO.src} ${PHOTO.sha256}`]),
  flagged: new Set(),
};

describe("where a post leads", () => {
  it("goes straight to the one place, else the post's own page", () => {
    const d = (kind: string, s = spec(kind)) =>
      destinationOf({ id: 7, kind, slotDate: "2026-11-24", spec: s });
    expect(d("park_post")).toEqual({
      href: "/parks/larkspur-park-bend",
      to: "park",
    });
    expect(d("teaser")).toEqual({
      href: "/newsletter/2026-11-26",
      to: "issue",
    });
    expect(d("events_week")).toEqual({
      href: "/events?week=2026-11-24",
      to: "events",
    });
    expect(d("unpack")).toEqual({ href: "/social/7", to: "post" });
    expect(d("at_home")).toEqual({ href: "/social/7", to: "post" });
    expect(d("story")).toBeNull();
    // Nowhere to go: no tile (never a dead end).
    expect(
      d("park_post", spec("park_post", { facts: { ...spec("x").facts } })),
    ).toBeNull();
    expect(d("teaser", spec("x"))).toBeNull();
  });
});

describe("the grid", () => {
  it("shows published feed posts only, newest first, with the stored cover", () => {
    const rows = [
      row("park_post", { publishedAt: new Date("2026-11-16T20:15:00Z") }),
      row("events_week", { publishedAt: new Date("2026-11-24T15:30:00Z") }),
      row("story", { publishedAt: new Date("2026-11-25T00:30:00Z") }),
      row("unpack", { status: "dry_run" }),
      row("unpack", { status: "failed" }),
      row("at_home", { status: "queued" }),
      row("teaser", { status: "skipped" }),
      row("unpack", { status: "replaced" }),
      row("at_home", {
        publishedAt: new Date("2026-11-21T15:45:00Z"),
        media: media("c", 4),
      }),
    ];
    const tiles = gridTiles(rows, none);
    expect(tiles.map((t) => t.kind)).toEqual([
      "events_week",
      "at_home",
      "park_post",
    ]);
    const home = tiles[1];
    expect(home).toMatchObject({
      label: "At home",
      day: "2026-11-21",
      to: "post",
      href: `/social/${home.id}`,
    });
    // The cover is the first stored slide, exactly as published, its alt too.
    expect(home.cover).toMatchObject({ sha: sha("c"), alt: "slide 1" });
    // Pacific day: Monday 4:30 pm Pacific is still Monday, not Tuesday UTC.
    expect(
      gridTiles(
        [row("park_post", { publishedAt: new Date("2026-11-24T00:30:00Z") })],
        none,
      )[0].day,
    ).toBe("2026-11-23");
  });

  it("never shows a downgraded post, a flagged photo or one never cleared", () => {
    const withPhoto = (over: Partial<PublicRow> = {}) =>
      row("park_post", {
        spec: spec("park_post", {
          slides: [
            {
              t: "parkcard",
              park: "Larkspur Park",
              town: "Bend",
              photo: PHOTO,
            },
          ],
        }),
        ...over,
      });
    expect(publicMedia(withPhoto(), cleared)).not.toBeNull();
    // Never looked at (or a different file): out.
    expect(publicMedia(withPhoto(), none)).toBeNull();
    expect(
      publicMedia(withPhoto(), {
        clear: new Set([`${PHOTO.src} ${sha("8")}`]),
        flagged: new Set(),
      }),
    ).toBeNull();
    // A later look saw a person: out, even though it went out clear.
    expect(
      publicMedia(withPhoto(), { ...cleared, flagged: new Set([PHOTO.src]) }),
    ).toBeNull();
    // Redrawn as the crayon card because a person was seen: never shown.
    expect(
      publicMedia(
        row("park_post", { report: { downgraded: "a person" } }),
        none,
      ),
    ).toBeNull();
    // Media that isn't whole stored slides: out.
    expect(publicMedia(row("unpack", { media: [] }), none)).toBeNull();
    expect(
      publicMedia(
        row("unpack", { media: [{ sha: "nope", ext: "jpg", alt: "" }] }),
        none,
      ),
    ).toBeNull();
    expect(
      publicMedia(
        row("unpack", { media: [{ ...media("a")[0], alt: undefined }] }),
        none,
      ),
    ).toBeNull();
    // A spec that isn't the row's kind: out.
    expect(
      publicMedia(row("unpack", { spec: spec("at_home") }), none),
    ).toBeNull();
  });
});

describe("/ig", () => {
  it("redirects to /social keeping every param, from=ig by default", () => {
    expect(igRedirectPath(new URLSearchParams(""))).toBe("/social?from=ig");
    expect(igRedirectPath(new URLSearchParams("from=ig_dm"))).toBe(
      "/social?from=ig_dm",
    );
    expect(igRedirectPath(new URLSearchParams("from=fb&utm_source=x"))).toBe(
      "/social?from=fb&utm_source=x",
    );
    expect(igRedirectPath(new URLSearchParams("utm_source=ig"))).toBe(
      "/social?utm_source=ig&from=ig",
    );
  });
  it("/ig answers a permanent redirect to /social, query kept", async () => {
    const { GET } = await import("@/app/ig/route");
    const res = GET(
      new Request("https://parkroulette.quest/ig?from=ig_dm&x=1"),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/social?from=ig_dm&x=1");
    const bare = GET(new Request("https://parkroulette.quest/ig"));
    expect(bare.headers.get("location")).toBe("/social?from=ig");
  });
});

describe("the Facebook caption's link", () => {
  const post = (kind: string, fbCaption: string) => ({
    id: 42,
    kind,
    slotDate: "2026-11-25",
    spec: spec(kind, { fbCaption }),
  });
  it("fills in the post's own page once it has an id", () => {
    const cap = `Hi\nDetails and links: ${PENDING_POST_LINK}\n\n#BendKids`;
    expect(fbCaptionFor(cap, post("unpack", cap))).toBe(
      "Hi\nDetails and links: https://parkroulette.quest/social/42?from=fb\n\n#BendKids",
    );
    const s = withPostLink(
      spec("at_home", { fbCaption: cap }),
      42,
      "2026-11-28",
    );
    expect(s.fbCaption).toContain(
      "https://parkroulette.quest/social/42?from=fb",
    );
    // Idempotent: a second pass changes nothing.
    expect(withPostLink(s, 42, "2026-11-28")).toBe(s);
  });
  it("rewrites the old signup line to the post's destination", () => {
    const old =
      "Story.\nSign up free: https://parkroulette.quest/ig?from=fb\n\n#BendKids";
    expect(fbCaptionFor(old, post("park_post", old))).toBe(
      "Story.\nDetails and links: https://parkroulette.quest/parks/larkspur-park-bend?from=fb\n\n#BendKids",
    );
    expect(fbCaptionFor(old, post("events_week", old))).toContain(
      "https://parkroulette.quest/events?week=2026-11-25&from=fb",
    );
    expect(fbCaptionFor(null, post("unpack", ""))).toBeNull();
  });
});

describe("an Unpack post's page", () => {
  const item = (n: number, name: string, ref?: string) => ({
    t: "item" as const,
    n,
    of: 5,
    icon: "star" as const,
    name,
    what: "Kids do things",
    facts: ["Sat, Nov 28"],
    ...(ref ? { ref } : {}),
  });
  const L: Lookups = {
    venue: (id) =>
      id === "venue-museum"
        ? { name: "High Desert Museum", url: "https://highdesertmuseum.org/" }
        : null,
    event: (slug, day) =>
      slug === "story-time"
        ? { title: "Story Time", status: "ok" }
        : slug === "lights" && day === "2026-11-28"
          ? { title: "Tree Lighting", status: "canceled" }
          : null,
    park: (slug) =>
      slug === "larkspur-park-bend" ? { name: "Larkspur Park" } : null,
  };
  it("links each item to its event, park or venue page, and says what changed", () => {
    const items = unpackItems(
      [
        { t: "headline", words: "x", highlight: "x", kicker: "", swipe: true },
        item(1, "Story Time", "event:story-time@2026-11-27"),
        item(2, "Tree Lighting", "event:lights@2026-11-28"),
        item(3, "Gone Thing", "event:gone@2026-11-28"),
        item(4, "Larkspur Park", "park:larkspur-park-bend"),
        // An older slide with no ref: matched to the draft's ref by name.
        item(5, "High Desert Museum"),
      ],
      { items: [{ ref: "venue:venue-museum" }] },
      L,
    );
    expect(
      items.map((i) => [i.state, i.link?.href ?? null, i.link?.to ?? null]),
    ).toEqual([
      ["ok", "/events/story-time", "event"],
      ["canceled", "/events/lights", "event"],
      ["removed", null, null],
      ["ok", "/parks/larkspur-park-bend", "park"],
      ["ok", "https://highdesertmuseum.org/", "venue"],
    ]);
    expect(items[4].link?.external).toBe(true);
    expect(stateLine("canceled")).toBe("Canceled");
    expect(stateLine("removed")).toBe("No longer listed");
    expect(stateLine("ok")).toBeNull();
  });
});

describe("/events?week=", () => {
  it("is the seven days from that day, from today on; a past week says so", () => {
    expect(weekView("2026-11-24", "2026-11-23")).toEqual({
      start: "2026-11-24",
      from: "2026-11-24",
      to: "2026-11-30",
      over: false,
    });
    expect(weekView("2026-11-24", "2026-11-27")).toMatchObject({
      from: "2026-11-27",
      over: false,
    });
    expect(weekView("2026-11-10", "2026-11-27")?.over).toBe(true);
    expect(weekView("2026-02-31", "2026-02-01")).toBeNull();
    expect(weekView("nope", "2026-11-23")).toBeNull();
    expect(weekView("2027-06-01", "2026-11-23")).toBeNull();
    expect(inSpan([], "2026-11-24", "2026-11-30")).toEqual([]);
  });
});

describe("keyword DMs", () => {
  it("puts Comment PARK on the Unpack carousel only, and only with DMs on", async () => {
    const { ctaLine, COPY } = await import("./model");
    expect(ctaLine(true, "unpack")).toBe(
      "Comment PARK and we'll DM you every link. Follow us first so it reaches you.",
    );
    expect(ctaLine(true, "unpack", { slide: true })).toBe(COPY.commentSlide);
    expect(ctaLine(false, "unpack")).toBe("Link in bio.");
    for (const k of ["park_post", "events_week", "at_home", "teaser"] as const)
      expect(ctaLine(true, k)).toBe("Link in bio.");
  });

  it("links the DM to the commented post's destination, else the grid", async () => {
    const { dmLink } = await import("./links");
    const { dmText, COPY } = await import("./model");
    const p = (kind: string) => ({
      id: 9,
      kind,
      slotDate: "2026-11-24",
      spec: spec(kind),
    });
    expect(dmLink(p("unpack"))).toBe(
      "https://parkroulette.quest/social/9?from=ig_dm",
    );
    expect(dmLink(p("at_home"))).toBe(
      "https://parkroulette.quest/social/9?from=ig_dm",
    );
    expect(dmLink(p("park_post"))).toBe(
      "https://parkroulette.quest/parks/larkspur-park-bend?from=ig_dm",
    );
    expect(dmLink(p("teaser"))).toBe(
      "https://parkroulette.quest/newsletter/2026-11-26?from=ig_dm",
    );
    expect(dmLink(p("events_week"))).toBe(
      "https://parkroulette.quest/events?week=2026-11-24&from=ig_dm",
    );
    // Can't be resolved: the grid.
    const fallback = "https://parkroulette.quest/social?from=ig_dm";
    expect(dmLink(null)).toBe(fallback);
    expect(dmLink({ ...p("park_post"), spec: spec("x") })).toBe(fallback);
    expect(dmLink({ ...p("story") })).toBe(fallback);
    expect(dmText(fallback)).toBe(
      "Here are the links from that post. New park picks every Thursday, free.\nhttps://parkroulette.quest/social?from=ig_dm",
    );
    expect(COPY.dm).toBe(dmText(fallback));
  });
});

describe("tile words", () => {
  it("names the park, and gives a roundup its week", async () => {
    const { tileLabel, tileWhen } = await import("./links");
    expect(
      tileLabel(
        "park_post",
        spec("park_post", {
          slides: [
            { t: "parkcard", park: "Larkspur Park", town: "Bend", photo: null },
          ],
        }),
      ),
    ).toBe("Larkspur Park");
    expect(tileLabel("events_week", spec("events_week"))).toBe("Family events");
    expect(tileWhen("events_week", "2026-11-24", "2026-11-24")).toBe(
      "Nov 24 to 30",
    );
    expect(tileWhen("events_week", "2026-11-29", "2026-11-29")).toBe(
      "Nov 29 to Dec 5",
    );
    expect(tileWhen("at_home", "2026-11-28", "2026-11-28")).toBe("Nov 28");
  });
});

describe("signup attribution from our posts", () => {
  it("reads only ig, ig_dm and fb, and carries them on", async () => {
    const { igSourceOrNull, igSource, carryFrom } = await import("./sources");
    const { withFrom } = await import("./links");
    expect(igSourceOrNull("ig")).toBe("ig_bio");
    expect(igSourceOrNull("ig_dm")).toBe("ig_dm");
    expect(igSourceOrNull("fb")).toBe("fb");
    for (const bad of [undefined, null, "", "footer", "constructor", ["fb"]])
      expect(igSourceOrNull(bad as never)).toBeNull();
    // The bio link stays the default where a social source is certain.
    expect(igSource(undefined)).toBe("ig_bio");
    expect(carryFrom("fb")).toBe("fb");
    expect(carryFrom("x")).toBeNull();
    // A grid tile reached with ?from= keeps it, after any query it has.
    expect(withFrom("/parks/larkspur-park-bend", "ig")).toBe(
      "/parks/larkspur-park-bend?from=ig",
    );
    expect(withFrom("/events?week=2026-11-24", "ig_dm")).toBe(
      "/events?week=2026-11-24&from=ig_dm",
    );
    expect(withFrom("/social/9", null)).toBe("/social/9");
  });
});
