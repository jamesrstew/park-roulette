import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pairingGuides, pairingPages } from "@/db/schema";
import { guideDef } from "@/lib/guides";
import { FRESH_DAYS, GUIDE_MIN, pairingGuideDef } from "@/lib/pairing-guides";

/**
 * Is a /guides page gone (a real 404)? Asked by the proxy before the page
 * renders: once a page streams, its status is already 200. One small
 * query: a pairing page shows when its last check saw it showing (its
 * shown_key, set at birth and by the daily refresh); a theme-and-town
 * guide when it has 3 or more pairs refreshed in the last 30 days. Any
 * doubt (a path it doesn't know, a database error at the caller): not
 * gone, and the page decides as before.
 */
export async function guideGone(pathname: string): Promise<boolean> {
  const m = /^\/guides\/(?:(pairings)\/)?([a-z0-9-]+)\/?$/.exec(pathname);
  if (!m) return false;
  const [, pairings, slug] = m;
  if (pairings) {
    const [r] = await db
      .select({ key: pairingPages.shownKey })
      .from(pairingPages)
      .where(eq(pairingPages.slug, slug));
    return !r || r.key === "";
  }
  if (slug === "pairings" || guideDef(slug)) return false;
  if (!pairingGuideDef(slug)) return true;
  const [r] = await db
    .select({
      ok: sql<boolean>`${pairingGuides.refreshedAt} > now() - make_interval(days => ${FRESH_DAYS}) and jsonb_array_length(${pairingGuides.pairs}) >= ${GUIDE_MIN}`,
    })
    .from(pairingGuides)
    .where(eq(pairingGuides.slug, slug));
  return !r?.ok;
}
