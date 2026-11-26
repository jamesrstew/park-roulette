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
  const any = /^\/guides\/(?:pairings\/)?([^/]+)\/?$/.exec(pathname);
  if (!any) return false;
  const m = /^\/guides\/(?:(pairings)\/)?([a-z0-9-]+)\/?$/.exec(pathname);
  // A slug no page could have ("Nope", "Sledding-Hills-Bend"): gone.
  if (!m) return true;
  const [, pairings, slug] = m;
  if (pairings) {
    const [r] = await db
      .select({ key: pairingPages.shownKey, changed: pairingPages.changedAt })
      .from(pairingPages)
      .where(eq(pairingPages.slug, slug));
    if (!r) return true;
    // Born but not settled yet (its first check failed or hasn't run):
    // unknown, so the page decides, never a 404 for a page just born.
    if (!r.changed) return false;
    return r.key === "";
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
