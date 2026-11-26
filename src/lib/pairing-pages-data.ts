import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  pairingPages,
  pairingPlaces,
  parks,
  placesUsage,
  socialPosts,
} from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import { pingIndexNow } from "@/lib/indexnow";
import { CATALOG } from "@/lib/news/catalog";
import { pacific } from "@/lib/news/time";
import { currentProfiles } from "@/lib/park-profiles-check";
import { SITE_URL } from "@/lib/site";
import { INDOOR, INDOOR_LABEL } from "@/lib/social/indoor";
import { parkLine } from "@/lib/social/mashup";
import type { PostSpec } from "@/lib/social/model";
import { PlacesError, placeNameNow, placesKey } from "@/lib/social/places";
import { parkHas, pairingGuidePath } from "./pairing-guides";
import {
  type AnchorNow,
  guidesForPage,
  isPageTheme,
  NAME_DAYS,
  newestFirst,
  PAGE_MIN,
  type PagePairDef,
  pagePairsFromSlides,
  pageTextProblems,
  pairingPagePath,
  pairingPageSlug,
  pairingPageView,
  type PairingPageView,
  PAIRINGS_HUB,
  type PlaceNow,
  printableName,
  shownKey,
  supersededSlugs,
  angleLine,
} from "./pairing-pages";

/**
 * The pairing pages' data (lib/pairing-pages.ts): born from a park
 * pairings post the moment it's published (birthPairingPages, run by the
 * social cron right after it publishes, and by the daily guides cron as a
 * backstop and backfill), and kept true by the daily refresh
 * (refreshPairingPlaces): each business's name re-read by its place id
 * (Place Details, its own small daily cap) within 30 days, else purged.
 * Nothing here ever holds a post up: callers catch, and the next run
 * tries again.
 */

type PageRow = typeof pairingPages.$inferSelect;

/** Today's anchors: our parks (still open, on the map) and the indoor registry. */
async function anchorLookup(
  now: Date,
): Promise<(kind: "park" | "indoor", slug: string) => AnchorNow | null> {
  const [rows, profiles] = await Promise.all([
    db
      .select({
        slug: parks.slug,
        name: parks.name,
        city: parks.city,
        status: parks.status,
        play: parks.play,
        features: parks.features,
        approvedAt: parks.approvedAt,
      })
      .from(parks),
    currentProfiles(now).catch(() => new Map()),
  ]);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const closed = new Set(
    CATALOG.parks.filter((p) => p.closed).map((p) => p.slug),
  );
  const month = Number(pacific(now).date.slice(5, 7));
  return (kind, slug) => {
    if (kind === "indoor") {
      const x = INDOOR.find((i) => i.slug === slug);
      return x
        ? {
            name: x.name,
            city: x.town,
            label: INDOOR_LABEL[x.type],
            line: x.line,
            href: x.url,
          }
        : null;
    }
    const p = bySlug.get(slug);
    // Every pair says "a playground": a park that lost it, closed or left
    // the map hides its pair.
    if (
      !p ||
      !p.approvedAt ||
      p.status !== "active" ||
      p.play !== "playground" ||
      closed.has(slug)
    )
      return null;
    return {
      name: p.name,
      city: p.city,
      label: "At the park",
      line: parkLine(profiles.get(slug), month)?.text ?? null,
      href: `/parks/${slug}`,
      has: parkHas(p.features ?? []),
    };
  };
}

async function placeLookup(): Promise<(id: string) => PlaceNow | undefined> {
  const rows = await db.select().from(pairingPlaces);
  const m = new Map(rows.map((r) => [r.placeId, r]));
  return (id) => m.get(id);
}

/**
 * Every page row as a view (null: not showing), with today's lookups. A
 * showing page whose pairs mostly show on a newer one is marked
 * superseded (noindex,follow, off the sitemap).
 */
async function views(
  now: Date,
): Promise<{ row: PageRow; view: PairingPageView | null }[]> {
  const rows = await db.select().from(pairingPages);
  if (!rows.length) return [];
  const [place, anchor] = await Promise.all([placeLookup(), anchorLookup(now)]);
  const out = rows.map((row) => {
    const v = pairingPageView(row, place, anchor, now);
    // A page whose words break our rules doesn't show (never expected).
    return { row, view: v && !pageTextProblems(v).length ? v : null };
  });
  const old = supersededSlugs(out.flatMap((x) => (x.view ? [x.view] : [])));
  for (const x of out) if (x.view) x.view.superseded = old.has(x.view.slug);
  return out;
}

export async function loadPairingPage(
  slug: string,
  now: Date,
): Promise<PairingPageView | null> {
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) return null;
  // The whole set: whether it's superseded depends on the newer pages.
  return (await views(now)).find((x) => x.row.slug === slug)?.view ?? null;
}

/** Every page that shows now, newest first (superseded ones too). */
export async function allPairingPages(now: Date): Promise<PairingPageView[]> {
  return (await views(now))
    .flatMap((x) => (x.view ? [x.view] : []))
    .sort(newestFirst);
}

/** The page a post was born as, when it shows now (the post page links it). */
export async function pageForPost(
  postId: number,
  now: Date,
): Promise<PairingPageView | null> {
  const [r] = await db
    .select({ slug: pairingPages.slug })
    .from(pairingPages)
    .where(eq(pairingPages.postId, postId));
  return r ? loadPairingPage(r.slug, now) : null;
}

/** The pages a park anchors (its page's "Nearby" line), newest first. */
export async function pagesForPark(
  slug: string,
  now: Date,
): Promise<PairingPageView[]> {
  // Most parks are on no page: one indexed look before building any view.
  const [any] = await db
    .select({ slug: pairingPages.slug })
    .from(pairingPages)
    .where(
      sql`${pairingPages.pairs} @> ${JSON.stringify([{ anchorSlug: slug }])}::jsonb`,
    )
    .limit(1);
  if (!any) return [];
  return (await allPairingPages(now)).filter((v) =>
    v.pairs.some((p) => p.anchorKind === "park" && p.anchorSlug === slug),
  );
}

/** URLs to tell IndexNow when a page appears, changes or goes. */
function pingsFor(
  moved: readonly { row: PageRow; view: PairingPageView | null }[],
) {
  return [
    `${SITE_URL}${PAIRINGS_HUB}`,
    `${SITE_URL}/guides`,
    ...moved.flatMap(({ row, view }) => [
      `${SITE_URL}${pairingPagePath(row.slug)}`,
      // The theme guides and park pages that gained or lost a link to it
      // (every park it was born with: its Nearby line may have changed).
      ...(view
        ? guidesForPage(view).map(
            (g) => `${SITE_URL}${pairingGuidePath(g.slug)}`,
          )
        : []),
      ...((Array.isArray(row.pairs) ? row.pairs : []) as PagePairDef[])
        .filter((d) => d.anchorKind === "park")
        .map((d) => `${SITE_URL}/parks/${d.anchorSlug}`),
    ]),
  ];
}

/**
 * Record what each page shows now: a page that appeared, changed or went
 * gets a new lastmod and an IndexNow ping. Returns the slugs that moved.
 */
async function settle(now: Date): Promise<string[]> {
  const all = await views(now);
  const moved: { row: PageRow; view: PairingPageView | null }[] = [];
  for (const x of all) {
    const key = shownKey(x.view);
    if (key === x.row.shownKey) continue;
    await db
      .update(pairingPages)
      .set({ shownKey: key, changedAt: now })
      .where(eq(pairingPages.slug, x.row.slug));
    moved.push(x);
  }
  if (moved.length) await pingIndexNow(pingsFor(moved));
  return moved.map((m) => m.row.slug);
}

/**
 * Give every published park pairings post its page (the moment it's out,
 * and any that went out before this existed). The post's own slides hand
 * in its pairs: no Places request. Their names were read from Google when
 * the post was made, so they count from then (a post older than 30 days
 * starts with ids only, and shows once the refresh reads its names). One
 * page per post, ever; its slug is fixed at birth.
 */
export async function birthPairingPages(
  now: Date,
): Promise<{ born: string[] }> {
  const posts = await db
    .select({
      id: socialPosts.id,
      spec: socialPosts.spec,
      createdAt: socialPosts.createdAt,
      publishedAt: socialPosts.publishedAt,
    })
    .from(socialPosts)
    .leftJoin(pairingPages, eq(pairingPages.postId, socialPosts.id))
    .where(
      and(
        eq(socialPosts.kind, "mashup"),
        eq(socialPosts.status, "published"),
        isNull(pairingPages.slug),
      ),
    )
    .orderBy(socialPosts.publishedAt, socialPosts.id);
  if (!posts.length) return { born: [] };
  const existing = await db
    .select({
      slug: pairingPages.slug,
      theme: pairingPages.theme,
      pairs: pairingPages.pairs,
    })
    .from(pairingPages);
  const taken = new Set(existing.map((r) => r.slug));
  // A place on any page that isn't a brewery page never prints a drinks word.
  const strict = new Set(
    existing
      .filter((r) => r.theme !== "breweries")
      .flatMap((r) =>
        ((Array.isArray(r.pairs) ? r.pairs : []) as PagePairDef[]).map(
          (d) => d.placeId,
        ),
      ),
  );
  const born: string[] = [];
  for (const post of posts) {
    const spec = post.spec as Partial<PostSpec> | null;
    const theme = spec?.facts?.mashup?.theme;
    const slides = Array.isArray(spec?.slides) ? spec.slides : [];
    const pairs: PagePairDef[] = isPageTheme(theme)
      ? pagePairsFromSlides(slides)
      : [];
    const slug = isPageTheme(theme)
      ? pairingPageSlug(theme, pairs, taken)
      : `post-${post.id}`;
    // When Google's names were read: the make, just before the post.
    const namesAt = post.createdAt;
    const fresh = now.getTime() - namesAt.getTime() < NAME_DAYS * 86_400_000;
    const printed = new Map(
      slides.flatMap((s) =>
        s.t === "pair" && s.placeId ? [[s.placeId, s.place] as const] : [],
      ),
    );
    const inserted = await db.transaction(async (tx) => {
      const got = await tx
        .insert(pairingPages)
        .values({
          slug,
          postId: post.id,
          theme: String(theme ?? ""),
          pairs,
          bornAt: post.publishedAt ?? now,
          angle: angleLine(spec?.headline) ?? "",
        })
        .onConflictDoNothing()
        .returning({ slug: pairingPages.slug });
      if (!got.length) return false;
      for (const p of pairs) {
        const raw = printed.get(p.placeId) ?? "";
        const name =
          fresh && raw
            ? printableName(
                raw,
                theme === "breweries" && !strict.has(p.placeId),
              )
            : null;
        await tx
          .insert(pairingPlaces)
          .values({
            placeId: p.placeId,
            name,
            status: "ok",
            refreshedAt: name ? namesAt : null,
          })
          .onConflictDoUpdate({
            target: pairingPlaces.placeId,
            set: { name, status: "ok", refreshedAt: namesAt },
            // A newer read wins; an older one never overwrites.
            setWhere: name
              ? sql`${pairingPlaces.refreshedAt} is null or ${pairingPlaces.refreshedAt} < ${namesAt.toISOString()}::timestamptz`
              : sql`false`,
          });
      }
      return true;
    });
    taken.add(slug);
    if (inserted) born.push(slug);
    if (inserted && theme !== "breweries")
      for (const p of pairs) strict.add(p.placeId);
  }
  if (born.length) await settle(now);
  return { born };
}

/** A name is re-read once it's this old (well inside the 30 days). */
export const REFRESH_DAYS = 21;
/** Place Details requests a day, at most (Google's own cap is 100). */
export const DETAILS_PER_DAY = 20;

/** One Place Details request from today's cap, or a fatal PlacesError. */
async function spendDetail(now: Date) {
  const day = pacific(now).date;
  const got = await db
    .insert(placesUsage)
    .values({ day, details: 1 })
    .onConflictDoUpdate({
      target: placesUsage.day,
      set: { details: sql`${placesUsage.details} + 1` },
      setWhere: sql`${placesUsage.details} < ${DETAILS_PER_DAY}`,
    })
    .returning({ details: placesUsage.details });
  if (!got.length)
    throw new PlacesError(
      `Places: today's ${DETAILS_PER_DAY} details requests are used`,
      false,
      true,
    );
}

/**
 * The daily refresh: purge names older than 30 days, then re-read the
 * stalest due names by place id (Place Details, at most 20 a day, never
 * a Text Search). Only places on pages that can still show are read. A
 * business that closed for good, or that Google no longer knows, hides
 * its pair for good; one closed for now is read again later. Then each
 * page's lastmod and IndexNow follow what it shows.
 */
export async function refreshPairingPlaces(
  now: Date,
  {
    placesFetch,
    budgetMs = 100_000,
  }: { placesFetch?: typeof fetch; budgetMs?: number } = {},
): Promise<{ read: number; purged: number; moved: string[] }> {
  const cutoff = new Date(now.getTime() - NAME_DAYS * 86_400_000);
  const purged = await db
    .update(pairingPlaces)
    .set({ name: null })
    .where(
      sql`${pairingPlaces.name} is not null and (${pairingPlaces.refreshedAt} is null or ${pairingPlaces.refreshedAt} < ${cutoff.toISOString()}::timestamptz)`,
    )
    .returning({ id: pairingPlaces.placeId });
  const [pages, placeRows] = await Promise.all([
    db.select().from(pairingPages),
    db.select().from(pairingPlaces),
  ]);
  const place = new Map(placeRows.map((r) => [r.placeId, r]));
  // Which themes print each place (a brewery's name only on brewery pages).
  const themes = new Map<string, Set<string>>();
  const due = new Set<string>();
  const dueAt = now.getTime() - REFRESH_DAYS * 86_400_000;
  const triedAt = now.getTime() - 20 * 3_600_000;
  for (const pg of pages) {
    const defs = (Array.isArray(pg.pairs) ? pg.pairs : []) as PagePairDef[];
    for (const d of defs)
      themes.set(d.placeId, (themes.get(d.placeId) ?? new Set()).add(pg.theme));
    // A page that can never show again (under 3 places left) costs nothing.
    if (
      defs.filter((d) => place.get(d.placeId)?.status !== "gone").length <
      PAGE_MIN
    )
      continue;
    for (const d of defs) {
      const r = place.get(d.placeId);
      if (r?.status === "gone") continue;
      if ((r?.triedAt?.getTime() ?? 0) > triedAt) continue;
      if ((r?.refreshedAt?.getTime() ?? 0) <= dueAt) due.add(d.placeId);
    }
  }
  const order = [...due].sort(
    (a, b) =>
      (place.get(a)?.refreshedAt?.getTime() ?? 0) -
      (place.get(b)?.refreshedAt?.getTime() ?? 0),
  );
  let read = 0;
  if (order.length) {
    let key: string | null = null;
    try {
      key = placesKey();
    } catch {
      key = null;
    }
    const deadline = Date.now() + budgetMs;
    let failures = 0;
    for (const id of key ? order : []) {
      const stamp = (set: Partial<typeof pairingPlaces.$inferInsert>) =>
        db
          .insert(pairingPlaces)
          .values({ placeId: id, triedAt: now, ...set })
          .onConflictDoUpdate({
            target: pairingPlaces.placeId,
            set: { triedAt: now, ...set },
          });
      let r: Awaited<ReturnType<typeof placeNameNow>>;
      try {
        r = await placeNameNow(id, {
          key: key!,
          fetchImpl: placesFetch,
          deadline,
          spend: () => spendDetail(now),
        });
      } catch (e) {
        const msg = (e as Error).message;
        // Our cap, Google's daily quota or the run's time: the rest wait.
        if (/requests are used|out of time|daily quota/.test(msg)) break;
        await stamp({});
        alertLater({
          key: `pairing-pages:refresh:${pacific(now).date}`,
          subject: "Pairing pages: a name refresh failed",
          text: `Reading a place's name failed (${msg}). Its pair stays up to 30 days from its last good read.`,
          everyMinutes: 24 * 60,
        });
        // A refused key fails every read: stop after three in a row.
        if (++failures >= 3) break;
        continue;
      }
      failures = 0;
      read++;
      if (r.gone || r.businessStatus === "CLOSED_PERMANENTLY") {
        await stamp({ name: null, status: "gone", refreshedAt: now });
        continue;
      }
      if (r.businessStatus !== "OPERATIONAL") {
        await stamp({ name: null, status: "closed", refreshedAt: now });
        continue;
      }
      const ts = themes.get(id) ?? new Set();
      const breweryOnly =
        ts.size > 0 && [...ts].every((t) => t === "breweries");
      const name = r.name ? printableName(r.name, breweryOnly) : null;
      await stamp({
        name,
        status: name ? "ok" : "unfit",
        refreshedAt: now,
      });
    }
  }
  const moved = await settle(now);
  // A page whose oldest name is 25 days old is 5 from hiding a pair.
  const read25 = new Map(
    (await db.select().from(pairingPlaces)).map((r) => [
      r.placeId,
      r.refreshedAt?.getTime() ?? 0,
    ]),
  );
  const late = (await allPairingPages(now)).filter((v) =>
    v.pairs.some(
      (p) => now.getTime() - (read25.get(p.placeId) ?? 0) > 25 * 86_400_000,
    ),
  );
  if (late.length)
    alertLater({
      key: "pairing-pages:stale",
      subject: "Pairing pages: names going stale",
      text: `${late.map((v) => v.slug).join(", ")} have names 25 days old; at 30 their pairs hide. Check the cron, the Places key and the ${DETAILS_PER_DAY}-a-day cap.`,
      everyMinutes: 24 * 60,
    });
  return { read, purged: purged.length, moved };
}
