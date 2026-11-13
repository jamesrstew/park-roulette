import "server-only";
import {
  del,
  issueSignedToken,
  presignUrl,
  type IssuedSignedToken,
} from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { explorers, media, reviews } from "@/db/schema";
import { isPrivateBlobUrl } from "./blob";

/** How long a photo link we hand a browser keeps working. */
const LINK_MS = 60 * 60 * 1000;

/**
 * One read-only signing key for the whole store, kept in memory and renewed
 * well before it runs out. Signing a link with it is local math, so a page
 * of photos doesn't cost a round trip each. It never leaves the server.
 */
let key: IssuedSignedToken | null = null;
let keyP: Promise<IssuedSignedToken> | null = null;

async function signingKey(): Promise<IssuedSignedToken> {
  if (key && key.validUntil - Date.now() > LINK_MS + 5 * 60 * 1000) return key;
  keyP ??= issueSignedToken({
    pathname: "*",
    operations: ["get"],
    validUntil: Date.now() + 6 * LINK_MS,
  })
    .then((k) => (key = k))
    .finally(() => (keyP = null));
  return keyP;
}

/** A short-lived link a browser can load a private photo from. */
export async function photoLink(url: string): Promise<string> {
  if (!isPrivateBlobUrl(url)) return url; // from before photos went private
  const k = await signingKey();
  const { presignedUrl } = await presignUrl(k, {
    operation: "get",
    pathname: new URL(url).pathname.slice(1),
    access: "private",
    validUntil: Date.now() + LINK_MS,
  });
  return presignedUrl;
}

/** What /photos/<id> needs to decide who may look. */
export async function photoRecord(id: number) {
  const [row] = await db
    .select({
      url: media.url,
      kind: media.kind,
      visibility: reviews.visibility,
      hiddenAt: reviews.hiddenAt,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
      crewId: explorers.crewId,
    })
    .from(media)
    .innerJoin(reviews, eq(reviews.id, media.reviewId))
    .innerJoin(explorers, eq(explorers.id, reviews.explorerId))
    .where(eq(media.id, id));
  return row ?? null;
}

/**
 * Deletes photo files for good. Called after their rows are gone; a failure
 * is logged, not thrown (the photo is already unreachable without its row).
 */
export async function deleteFiles(urls: string[]): Promise<void> {
  // Our token only reaches the private store. Photos from before it are
  // moved (and the old store emptied) by scripts/move-photos-private.mts.
  const ours = urls.filter(isPrivateBlobUrl);
  if (ours.length < urls.length)
    console.error(
      `[photos] ${urls.length - ours.length} old public files left`,
    );
  if (!ours.length) return;
  try {
    await del(ours);
  } catch (e) {
    console.error("[photos] couldn't delete files", (e as Error)?.name);
  }
}
