import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { db } from "@/db";
import { socialPhotoChecks, socialPosts } from "@/db/schema";
import {
  GRID_KINDS,
  type GridTile,
  gridTiles,
  type PhotoVerdicts,
  type PublicRow,
  publicMedia,
  type StoredMedia,
} from "./links";
import type { PostSpec } from "./model";

/**
 * The public reads of our posts (/social, /social/<id>): cached, and
 * expired whenever a post's status changes or a photo verdict comes in
 * (store.ts calls expireSocial). What may be shown is decided in one pure
 * place, links.ts publicMedia.
 */

export const SOCIAL_TAG = "social-posts";

/** The grid holds this many posts (about three months of five a week). */
export const GRID_LIMIT = 60;

/** Expire the public pages' post cache now (a no-op outside a Next request). */
export function expireSocial() {
  try {
    revalidateTag(SOCIAL_TAG, { expire: 0 });
  } catch {
    // Scripts and tests: there's no cache to expire.
  }
}

const COLUMNS = {
  id: socialPosts.id,
  kind: socialPosts.kind,
  slotDate: socialPosts.slotDate,
  status: socialPosts.status,
  spec: socialPosts.spec,
  media: socialPosts.media,
  report: socialPosts.report,
  publishedAt: socialPosts.publishedAt,
  body: socialPosts.body,
};

/** Every photo verdict, as the public filter reads them. */
export async function readVerdicts(): Promise<PhotoVerdicts> {
  const rows = await db
    .select({
      src: socialPhotoChecks.src,
      sha256: socialPhotoChecks.sha256,
      verdict: socialPhotoChecks.verdict,
    })
    .from(socialPhotoChecks);
  const v: PhotoVerdicts = { clear: new Set(), flagged: new Set() };
  for (const r of rows)
    if (r.verdict === "clear") v.clear.add(`${r.src} ${r.sha256}`);
    else v.flagged.add(r.src);
  return v;
}

/** Published feed posts, newest first (the filter runs after). */
export async function publishedRows(limit = GRID_LIMIT): Promise<PublicRow[]> {
  return db
    .select(COLUMNS)
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.status, "published"),
        inArray(socialPosts.kind, [...GRID_KINDS]),
      ),
    )
    .orderBy(desc(socialPosts.publishedAt), desc(socialPosts.slotDate))
    .limit(limit);
}

/** The link-in-bio grid's tiles (uncached: tests and the cached read). */
export async function loadGrid(): Promise<GridTile[]> {
  const [rows, verdicts] = await Promise.all([publishedRows(), readVerdicts()]);
  return gridTiles(rows, verdicts);
}

/** The grid, cached until a post changes. */
export async function socialGrid(): Promise<GridTile[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(SOCIAL_TAG);
  return loadGrid();
}

export type PublicPost = {
  id: number;
  kind: string;
  slotDate: string;
  publishedAt: string | null;
  spec: PostSpec;
  /** The draft as handed in (Unpack: the item refs, for older posts). */
  body: unknown;
  media: StoredMedia[];
};

/** One post the public may see, or null (uncached). */
export async function loadPost(id: number): Promise<PublicPost | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const [[row], verdicts] = await Promise.all([
    db.select(COLUMNS).from(socialPosts).where(eq(socialPosts.id, id)),
    readVerdicts(),
  ]);
  if (!row) return null;
  const media = publicMedia(row, verdicts);
  if (!media) return null;
  return {
    id: row.id,
    kind: row.kind,
    slotDate: row.slotDate,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    spec: row.spec as PostSpec,
    body: row.body,
    media,
  };
}

/** One post, cached until a post changes. */
export async function socialPost(id: number): Promise<PublicPost | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(SOCIAL_TAG);
  return loadPost(id);
}
