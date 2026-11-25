import {
  type PhotoRef,
  type PostKind,
  type PostSpec,
  SITE,
  THEME_LABEL,
} from "./model";

/**
 * Where a post sends people (parkroulette.quest/social, the link in bio,
 * and the Facebook caption's link). Pure. James, 2026-11-23: "Why not take
 * them directly to where they need to go?" So a post with one place goes
 * straight there; only the posts with several (Unpack, at home) get our
 * own page (/social/<id>).
 *
 *   park_post    /parks/<slug>
 *   teaser       /newsletter/<issue date>
 *   events_week  /events?week=<the roundup's Tuesday>
 *   unpack       /social/<id>
 *   at_home      /social/<id>
 *   mashup       /social/<id>
 *
 * Stories aren't on the grid (they're gone in a day, and they echo a post).
 */

/** The posts on the grid (feed posts; never Stories). */
export const GRID_KINDS = [
  "park_post",
  "events_week",
  "unpack",
  "teaser",
  "at_home",
  "mashup",
] as const satisfies readonly PostKind[];
export type GridKind = (typeof GRID_KINDS)[number];
export const isGridKind = (k: string): k is GridKind =>
  (GRID_KINDS as readonly string[]).includes(k);

/** Kinds whose destination is our own post page (several places in one post). */
export const PAGE_KINDS = [
  "unpack",
  "at_home",
  "mashup",
] as const satisfies GridKind[];
export const hasPostPage = (k: string) =>
  (PAGE_KINDS as readonly string[]).includes(k);

/** What a tap leads to, as the Social tap's `to` label. */
/** "press": a news story about us, on the outlet's own site. */
export type DestinationType = "park" | "issue" | "events" | "post" | "press";

/** The small type label on a tile and atop a post page. */
export const KIND_LABEL: Record<GridKind, string> = {
  park_post: "Park pick",
  events_week: "Events",
  unpack: "Places to go",
  teaser: "Weekend email",
  at_home: "At home",
  mashup: "Park pairings",
};

const SLUG = /^[a-z0-9-]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const postPath = (id: number) => `/social/${id}`;
export const eventsWeekPath = (tuesday: string) => `/events?week=${tuesday}`;

/**
 * A post's destination from what it stored, or null when it has none (a
 * park post with no park, a teaser with no issue): such a post isn't shown.
 */
export function destinationOf(p: {
  id: number;
  kind: string;
  slotDate: string;
  spec: Pick<PostSpec, "facts">;
}): { href: string; to: DestinationType } | null {
  const facts = p.spec?.facts;
  switch (p.kind) {
    case "park_post": {
      const slug = facts?.parks?.[0];
      return slug && SLUG.test(slug)
        ? { href: `/parks/${slug}`, to: "park" }
        : null;
    }
    case "teaser": {
      const issue = facts?.issue;
      return issue && DAY.test(issue)
        ? { href: `/newsletter/${issue}`, to: "issue" }
        : null;
    }
    case "events_week":
      return DAY.test(p.slotDate)
        ? { href: eventsWeekPath(p.slotDate), to: "events" }
        : null;
    case "unpack":
    case "at_home":
    case "mashup":
      return { href: postPath(p.id), to: "post" };
    default:
      return null;
  }
}

// --- Facebook ------------------------------------------------------------------

/** A site path as Facebook's link ("https://parkroulette.quest/parks/x?from=fb"). */
export function fbLink(path: string): string {
  return `${SITE}${path}${path.includes("?") ? "&" : "?"}from=fb`;
}

/**
 * Unpack and at home link to their own post page, whose id only exists
 * once the post is stored. Until then the caption carries the grid's link
 * (a working link, never a broken one), and storing the post swaps in its
 * own page (withPostLink). Nothing reads the caption in between.
 */
export const PENDING_POST_LINK = fbLink("/social");

/** The legacy Facebook call to action (posts composed before Nov 23, 2026). */
const LEGACY_FB = /^Sign up free: https:\/\/parkroulette\.quest\/ig\?from=fb$/m;

/** The Facebook caption with this post's own link in (idempotent). */
export function fbCaptionFor(
  caption: string | null,
  post: { id: number; kind: string; slotDate: string; spec: PostSpec },
): string | null {
  if (caption == null) return null;
  const dest = destinationOf(post);
  const link = dest ? fbLink(dest.href) : PENDING_POST_LINK;
  return caption
    .split(PENDING_POST_LINK)
    .join(link)
    .replace(LEGACY_FB, `Details and links: ${link}`);
}

/** A spec with its Facebook caption pointing at its own page (by id). */
export function withPostLink(
  spec: PostSpec,
  id: number,
  slotDate: string,
): PostSpec {
  const fbCaption = fbCaptionFor(spec.fbCaption, {
    id,
    kind: spec.kind,
    slotDate,
    spec,
  });
  return fbCaption === spec.fbCaption ? spec : { ...spec, fbCaption };
}

/** A link with the visit's `from` carried on (only ig, ig_dm or fb). */
export function withFrom(href: string, from: string | null): string {
  if (!from) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`;
}

// --- The keyword DM --------------------------------------------------------------

/**
 * The keyword DM's link: the commented post's own destination (the same
 * rule as its grid tile), marked from=ig_dm; the grid when the post can't
 * be resolved (a Story reply, a post with nowhere to go).
 */
export function dmLink(
  post: { id: number; kind: string; slotDate: string; spec: unknown } | null,
): string {
  const dest =
    post && post.spec
      ? destinationOf({ ...post, spec: post.spec as PostSpec })
      : null;
  const path = dest?.href ?? "/social";
  return `${SITE}${path}${path.includes("?") ? "&" : "?"}from=ig_dm`;
}

// --- /ig -------------------------------------------------------------------------

/**
 * /ig (Instagram's bio link since batch 6, and the keyword DM's) moved to
 * /social. Every query param rides along; with no `from`, it's the bio.
 */
export function igRedirectPath(search: URLSearchParams): string {
  const q = new URLSearchParams(search);
  if (!q.has("from")) q.set("from", "ig");
  return `/social?${q.toString()}`;
}

// --- What's safe to show -------------------------------------------------------

/** Photo verdicts: "src sha256" pairs looked at and clear; srcs ever flagged. */
export type PhotoVerdicts = { clear: Set<string>; flagged: Set<string> };

/** A photo looked at and clear on these exact bytes, and never flagged since. */
export function photoClear(
  photo: Pick<PhotoRef, "src" | "sha256">,
  verdicts: PhotoVerdicts,
): boolean {
  return (
    !verdicts.flagged.has(photo.src) &&
    verdicts.clear.has(`${photo.src} ${photo.sha256}`)
  );
}

export type StoredMedia = {
  sha: string;
  ext: string;
  width: number;
  height: number;
  alt: string;
};

/** The fields a public read needs from a social_posts row. */
export type PublicRow = {
  id: number;
  kind: string;
  slotDate: string;
  status: string;
  spec: unknown;
  media: unknown;
  report: unknown;
  publishedAt: Date | string | null;
};

const SHA = /^[0-9a-f]{64}$/;

function mediaOf(raw: unknown): StoredMedia[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: StoredMedia[] = [];
  for (const m of raw) {
    if (
      !m ||
      typeof m !== "object" ||
      typeof m.sha !== "string" ||
      !SHA.test(m.sha) ||
      m.ext !== "jpg" ||
      typeof m.alt !== "string"
    )
      return null;
    out.push({
      sha: m.sha,
      ext: m.ext,
      width: Number(m.width) || 1080,
      height: Number(m.height) || 1350,
      alt: m.alt,
    });
  }
  return out;
}

/**
 * May the public see this post? Only a feed post that went out
 * (published: its photo verdicts were applied when it was made), was never
 * redrawn because a person was seen in it, and whose photos are all still
 * clear by the exact bytes in the slide (a later look that flagged one
 * takes the post down here too). Its media must be the stored slides,
 * whole: no slides, no post.
 */
export function publicMedia(
  row: PublicRow,
  verdicts: PhotoVerdicts,
): StoredMedia[] | null {
  if (row.status !== "published" || !isGridKind(row.kind)) return null;
  const spec = row.spec as PostSpec | null;
  if (!spec || spec.kind !== row.kind || !Array.isArray(spec.slides))
    return null;
  const report = row.report as { downgraded?: unknown } | null;
  if (report && typeof report === "object" && report.downgraded) return null;
  for (const s of spec.slides) {
    const photo = "photo" in s ? (s.photo as PhotoRef | null) : null;
    if (photo && !photoClear(photo, verdicts)) return null;
  }
  return mediaOf(row.media);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const md = (day: string) =>
  `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

/**
 * A tile's words: what the post is about, so two alike covers (two
 * Tuesday roundups) still read apart. The park's name, the week, or the
 * kind in a parent's words.
 */
export function tileLabel(kind: GridKind, spec: PostSpec) {
  if (kind === "park_post") {
    const card = spec.slides?.find((s) => s.t === "parkcard");
    if (card && card.t === "parkcard" && card.park) return card.park;
  }
  if (kind === "events_week") return "Family events";
  if (kind === "mashup") {
    const theme = spec.facts?.mashup?.theme;
    if (theme && theme in THEME_LABEL)
      return THEME_LABEL[theme as keyof typeof THEME_LABEL];
  }
  return KIND_LABEL[kind];
}

/** A tile's date line: the day it went out; a roundup's week ("Nov 24 to 30"). */
export function tileWhen(kind: GridKind, slotDate: string, day: string) {
  if (kind !== "events_week") return md(day);
  const [y, m, d] = slotDate.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10);
  return end.slice(5, 7) === slotDate.slice(5, 7)
    ? `${md(slotDate)} to ${Number(end.slice(8))}`
    : `${md(slotDate)} to ${md(end)}`;
}

export type GridTile = {
  /** A post's id; press tiles use negative ids (they have no row). */
  id: number;
  kind: GridKind | "press";
  label: string;
  /** The Pacific day it went out (YYYY-MM-DD). */
  day: string;
  /** The date line under the label ("Nov 23", a roundup's "Nov 24 to 30"). */
  when: string;
  href: string;
  to: DestinationType;
  cover: StoredMedia;
  /** A static picture's path (press tiles), used instead of the cover's sha. */
  src?: string;
  /** The tile leaves our site (press): a new tab, and no ?from= on it. */
  external?: boolean;
};

/** The day a post went out, in Pacific time (its slot day if unknown). */
export function outDay(row: Pick<PublicRow, "publishedAt" | "slotDate">) {
  if (!row.publishedAt) return row.slotDate;
  return new Date(row.publishedAt)
    .toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" })
    .slice(0, 10);
}

const outTime = (r: PublicRow) =>
  r.publishedAt ? new Date(r.publishedAt).getTime() : 0;

/** The grid: what's safe to show, with a destination, newest first. */
export function gridTiles(
  rows: readonly PublicRow[],
  verdicts: PhotoVerdicts,
): GridTile[] {
  return [...rows]
    .sort(
      (a, b) =>
        outTime(b) - outTime(a) ||
        b.slotDate.localeCompare(a.slotDate) ||
        b.id - a.id,
    )
    .flatMap((r): GridTile[] => {
      const media = publicMedia(r, verdicts);
      if (!media || !isGridKind(r.kind)) return [];
      const dest = destinationOf({
        id: r.id,
        kind: r.kind,
        slotDate: r.slotDate,
        spec: r.spec as PostSpec,
      });
      if (!dest) return [];
      return [
        {
          id: r.id,
          kind: r.kind,
          label: tileLabel(r.kind, r.spec as PostSpec),
          day: outDay(r),
          when: tileWhen(r.kind, r.slotDate, outDay(r)),
          href: dest.href,
          to: dest.to,
          cover: media[0],
        },
      ];
    });
}

/** A stored slide's public address (the route checks the post is live). */
export const mediaSrc = (m: Pick<StoredMedia, "sha" | "ext">) =>
  `/social/m/${m.sha}.${m.ext}`;
