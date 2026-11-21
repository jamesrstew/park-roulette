import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { db } from "@/db";
import { kidEventEdits, kidEventHandins, kidEvents } from "@/db/schema";
import { fetchPage } from "@/lib/news/fetcher";
import { CATALOG, onList } from "@/lib/news/catalog";
import type { EventVerdict } from "./validate";
import {
  type EditBlocks,
  type KnownEvent,
  REMOVED_BLOCK_DAYS,
  screenEdits,
} from "./dedupe";
import {
  type EventInput,
  type EventRow,
  type EventStatus,
  eventSlug,
  keyStem,
  kindOf,
  lastEnd,
  LEGACY_SERIES_KEY,
  pacificAt,
  occurrenceId,
  pacificToday,
  seriesKey,
  type StoredEvent,
  venueKey,
} from "./model";
import { addDays } from "@/lib/news/time";
import {
  afterCheck,
  cancellationOf,
  checkTarget,
  judge,
  judgeListing,
} from "./state";
import { eventDomains } from "./validate";

export {
  afterCheck,
  checkTarget,
  eventChanges,
  eventLastmod,
  nextStatus,
  townEventsChangedAt,
  indexable,
  judge,
  listed,
  listingChangedAt,
  MISSES_TO_UNCONFIRM,
  type CheckOutcome,
  type EventChange,
} from "./state";

/**
 * Kids' events in the database: storing what the writer handed in (keyed
 * on code's series key, so a series keeps one page), the reads pages use,
 * the nightly re-check, and the state changes IndexNow hears about.
 */

export const EVENTS_TAG = "kid-events";

/** Expire the pages' event cache now (a no-op outside a Next request). */
function expireEvents() {
  try {
    revalidateTag(EVENTS_TAG, { expire: 0 });
  } catch {
    // Scripts and tests: there's no cache to expire.
  }
}

/** A short, stable suffix for a slug that's taken: from the series key. */
export function slugSuffix(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 6);
}

type Raw = typeof kidEvents.$inferSelect;
export const toRow = (r: Raw): EventRow => ({
  id: r.id,
  slug: r.slug,
  kind: r.kind as EventRow["kind"],
  data: r.data as StoredEvent,
  status: r.status as EventStatus,
  confirm: r.confirm as EventRow["confirm"],
  lastSeenAt: r.lastSeenAt,
  factsChangedAt: r.factsChangedAt,
  stateChangedAt: r.stateChangedAt,
});

/** The key a stored row's own data makes today (old rows may carry an older one). */
export function rowKey(r: { data: unknown }): string {
  return seriesKey(r.data as EventInput);
}

/** Facts that change the page (not the nightly bookkeeping). */
function facts(e: StoredEvent) {
  const { checkQuote: _q, targets: _t, ...rest } = e;
  void _q;
  void _t;
  return JSON.stringify(rest);
}

/**
 * Store validated events. A series keeps its page and gains new dates
 * (old ones stay, for "Last held"); an annual page rolls to the new
 * edition. Facts that change bump lastmod; a status change also counts as
 * a state change (IndexNow). A fresh hand-in was just seen on its page.
 */
/** New event pages a day, at most (the harvest's cap, enforced here). */
export const DAILY_NEW_CAP = 300;

/** New event pages made today (Pacific). */
export async function createdToday(now = new Date()): Promise<number> {
  const start = pacificAt(pacificToday(now));
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(kidEvents)
    .where(sql`${kidEvents.createdAt} >= ${start.toISOString()}::timestamptz`);
  return r?.n ?? 0;
}

class CapReached extends Error {}

/**
 * A hand-in for a stored page keeps what it leaves out. The harvest
 * re-hands known pages (new dates, printed ages); a hand-in that omits
 * `annual`, `series`, `series_id`, `organizer` or the venue's pin would
 * otherwise drop them, and a dropped `annual` or `series: false` changes
 * the key and splits the page. So each verdict finds its stored page (its
 * key, or the same venue and title stem stored as an annual page, or as a
 * one-off sharing a day with it) and takes the page's key and those
 * fields. The page's `url` stays when the hand-in links the same site.
 * Printed ages and cost are not carried: a hand-in replaces them. Pure;
 * mutates the verdicts.
 */
export function adoptStored(
  verdicts: EventVerdict[],
  rows: readonly { seriesKey: string; kind: string; data: unknown }[],
): void {
  for (const v of verdicts) {
    if (!v.ok || !v.event || !v.key) continue;
    const e = v.event;
    const venue = venueKey(e.venue);
    const stem = keyStem(e.title);
    const days = new Set(e.dates.map((d) => d.day));
    const same = (r: (typeof rows)[number]) => {
      const d = r.data as StoredEvent;
      return venueKey(d.venue) === venue && keyStem(d.title) === stem;
    };
    const row =
      rows.find((r) => r.seriesKey === v.key || rowKey(r) === v.key) ??
      rows.find(
        (r) =>
          same(r) &&
          e.annual === undefined &&
          (r.kind === "annual"
            ? e.series === undefined
            : r.seriesKey.startsWith("one:") &&
              e.series !== true &&
              (r.data as StoredEvent).dates.some((d) => days.has(d.day))),
      );
    if (!row) continue;
    const prev = row.data as StoredEvent;
    const samePage = (a: string, b: string) => {
      try {
        const x = new URL(a);
        const y = new URL(b);
        return (
          x.hostname.replace(/^www\./, "") ===
            y.hostname.replace(/^www\./, "") &&
          x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "")
        );
      } catch {
        return false;
      }
    };
    const pinned = !!(e.venue.park || e.venue.lat != null);
    v.event = {
      ...e,
      ...(e.series_id === undefined && prev.series_id
        ? { series_id: prev.series_id }
        : {}),
      ...(e.organizer === undefined && prev.organizer
        ? { organizer: prev.organizer }
        : {}),
      ...(e.annual === undefined && prev.annual !== undefined
        ? { annual: prev.annual }
        : {}),
      ...(e.series === undefined && prev.series !== undefined
        ? { series: prev.series }
        : {}),
      // The stored link stays only for a per-occurrence page of the same
      // page (same host and path, another occurrence's query). An annual
      // page, or a new path, takes the new link (last year's is stale).
      ...(row.kind !== "annual" &&
      e.annual !== true &&
      samePage(e.url, prev.url)
        ? { url: prev.url }
        : {}),
      ...(!pinned && (prev.venue.park || prev.venue.lat != null)
        ? {
            venue: {
              ...e.venue,
              ...(prev.venue.park ? { park: prev.venue.park } : {}),
              ...(prev.venue.lat != null
                ? { lat: prev.venue.lat, lng: prev.venue.lng }
                : {}),
            },
            point: prev.point,
          }
        : {}),
    };
    if (v.key !== row.seriesKey && rowKey(row) !== v.key) {
      // Joined by venue and stem: this page's key (the one its data makes
      // today; upsert moves a row stored under an older key), kind and slug.
      v.key = rowKey(row);
      v.kind = row.kind as EventRow["kind"];
    }
  }
}

/** adoptStored against every stored row (the route runs it before de-duplication). */
export async function adoptStoredPages(verdicts: EventVerdict[]) {
  if (!verdicts.some((v) => v.ok && v.event)) return;
  const rows = await db
    .select({
      seriesKey: kidEvents.seriesKey,
      kind: kidEvents.kind,
      data: kidEvents.data,
    })
    .from(kidEvents);
  adoptStored(verdicts, rows);
}

export async function upsertEvents(
  verdicts: EventVerdict[],
  opts: { network: boolean; newLeft?: number },
): Promise<
  { slug: string; created: boolean; changed: boolean; error?: string }[]
> {
  const out: {
    slug: string;
    created: boolean;
    changed: boolean;
    error?: string;
  }[] = [];
  // Admin repairs stick, whoever calls this (the route screens first, so
  // the hand-in hears why; this is the backstop).
  screenEdits(verdicts, await editBlocks());
  await adoptStoredPages(verdicts);
  const budget = { left: opts.newLeft ?? Infinity };
  for (const v of verdicts) {
    if (!v.ok || !v.event || !v.key || !v.slug || !v.kind) continue;
    try {
      const r = await upsertOne(v, { ...opts, newLeft: budget.left });
      if (r.created) budget.left--;
      out.push(r);
    } catch (e) {
      if (e instanceof CapReached) {
        out.push({
          slug: v.slug,
          created: false,
          changed: false,
          error: `Today's cap of ${DAILY_NEW_CAP} new events is reached. Hand it in tomorrow.`,
        });
        continue;
      }
      // One bad event never stops the rest of the hand-in.
      console.error("[events] store failed", v.slug, (e as Error)?.message);
      out.push({
        slug: v.slug,
        created: false,
        changed: false,
        error: "Couldn't store this one. The rest went in.",
      });
    }
  }
  if (out.some((o) => !o.error)) expireEvents();
  return out;
}

async function upsertOne(
  v: EventVerdict,
  opts: { network: boolean; newLeft?: number },
): Promise<{ slug: string; created: boolean; changed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`event:${v.key}`}))`,
    );
    let [old] = await tx
      .select()
      .from(kidEvents)
      .where(eq(kidEvents.seriesKey, v.key!));
    // A row stored under an older key (series:<id> alone, which may hold
    // other venues' dates, or the key before venue and program names were
    // normalized) is this page when the key its own data makes now is
    // this one: it takes the key, with or without a series_id.
    if (!old) {
      const rows = await tx
        .select()
        .from(kidEvents)
        .where(sql`${kidEvents.seriesKey} <> ${v.key!}`)
        .orderBy(asc(kidEvents.id));
      const mine = rows.find((l) => rowKey(l) === v.key);
      if (mine) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`event:${mine.seriesKey}`}))`,
        );
        const [l] = await tx
          .update(kidEvents)
          .set({ seriesKey: v.key! })
          .where(
            and(
              eq(kidEvents.id, mine.id),
              eq(kidEvents.seriesKey, mine.seriesKey),
            ),
          )
          .returning();
        if (l) old = l;
      }
    }
    let data = v.event!;
    let kind = v.kind!;
    if (old) {
      const prev = old.data as StoredEvent;
      // Same key: one page, every date kept (a one-off's too).
      {
        // Keep earlier dates the new hand-in no longer lists.
        // An occurrence is its day and start time: two showtimes on one
        // day are two dates.
        const key = (d: { day: string; start?: string }) =>
          `${d.day} ${d.start ?? ""}`;
        const have = new Set(data.dates.map(key));
        data = {
          ...data,
          dates: [
            ...prev.dates.filter((d) => !have.has(key(d))),
            ...data.dates,
          ].sort((a, b) => key(a).localeCompare(key(b))),
          targets: { ...prev.targets, ...data.targets },
        };
        if (old.kind === "one_off" && v.key!.startsWith("one:"))
          kind = "one_off";
        else if (data.dates.length > 1 || kind === "series")
          kind =
            old.kind === "annual" || kind === "annual" ? "annual" : "series";
      }
      // Status is sticky per date: only a status hand-in changes it.
      data = {
        ...data,
        status: data.status ?? prev.status,
        statusByDay: { ...prev.statusByDay, ...data.statusByDay },
      };
    }
    const status: EventStatus =
      data.status?.kind ?? (old?.status as EventStatus) ?? "scheduled";
    if (!old) {
      if ((opts.newLeft ?? Infinity) <= 0) throw new CapReached();
      // A slug another event holds gets a short hash of this series key.
      const [clash] = await tx
        .select({ id: kidEvents.id })
        .from(kidEvents)
        .where(eq(kidEvents.slug, v.slug!));
      const slug = clash ? `${v.slug}-${slugSuffix(v.key!)}` : v.slug!;
      await tx.insert(kidEvents).values({
        slug,
        kind,
        seriesKey: v.key!,
        data,
        status,
        lastSeenAt: opts.network ? sql`now()` : null,
        lastCheckAt: opts.network ? sql`now()` : null,
        stateChangedAt: status === "scheduled" ? null : sql`now()`,
      });
      return { slug, created: true, changed: true };
    }
    const changed = facts(old.data as StoredEvent) !== facts(data);
    const stateChange = old.status !== status || old.confirm !== "ok";
    await tx
      .update(kidEvents)
      .set({
        data,
        kind,
        status,
        confirm: "ok",
        misses: 0,
        seenStreak: 0,
        ...(opts.network
          ? { lastSeenAt: sql`now()`, lastCheckAt: sql`now()` }
          : {}),
        ...(changed || stateChange ? { factsChangedAt: sql`now()` } : {}),
        ...(stateChange ? { stateChangedAt: sql`now()` } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(kidEvents.id, old.id));
    return { slug: old.slug, created: false, changed: changed || stateChange };
  });
}

/**
 * One POST /api/events hand-in, counted (stored, new pages, cut, and the
 * hosts that kept us out) for the maintainer's weekly stats.
 */
export async function recordHandin(
  verdicts: EventVerdict[],
  stored: { created: boolean; error?: string }[],
): Promise<void> {
  const blocked = verdicts
    .filter((v) => !v.ok && v.blocked)
    .map((v) => ({ host: v.blocked!.host, kind: v.blocked!.kind }));
  await db.insert(kidEventHandins).values({
    stored: stored.filter((s) => !s.error).length,
    created: stored.filter((s) => s.created).length,
    cut: verdicts.filter((v) => !v.ok).length,
    blocked,
  });
}

/** Every event row (a few hundred at most), cached until the next change. */
export async function allEvents(): Promise<EventRow[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(EVENTS_TAG);
  const rows = await db.select().from(kidEvents);
  // Passed one-offs over 90 days old leave the pages' list (the rows stay).
  const cutoff = Date.now() - 90 * 86_400_000;
  return rows
    .map(toRow)
    .filter((r) => r.kind !== "one_off" || lastEnd(r.data).getTime() > cutoff);
}

/** Every event slug, straight from the database (no cache: the validator). */
export async function eventSlugs(): Promise<Set<string>> {
  const rows = await db.select({ slug: kidEvents.slug }).from(kidEvents);
  return new Set(rows.map((r) => r.slug));
}

/**
 * Every stored event for the issue validator (no cache): an outing that
 * names one may use its verified quotes.
 */
export async function eventsForIssues(): Promise<
  Map<string, { data: StoredEvent; status: string; confirm: string }>
> {
  const rows = await db
    .select({
      slug: kidEvents.slug,
      data: kidEvents.data,
      status: kidEvents.status,
      confirm: kidEvents.confirm,
    })
    .from(kidEvents);
  return new Map(
    rows.map((r) => [
      r.slug,
      { data: r.data as StoredEvent, status: r.status, confirm: r.confirm },
    ]),
  );
}

/**
 * What's stored, for the daily harvest and de-duplication (no cache):
 * every event with a date between today and `days` out (or still going),
 * confirmed or not.
 */
export async function knownEvents(
  now = new Date(),
  days = 60,
): Promise<
  (KnownEvent & {
    kind: string;
    confirm: string;
    status: string;
    /**
     * The page's stored facts, for the harvest to hand them in again (a
     * hand-in replaces them) and to see which pages lack printed ages or
     * cost.
     */
    facts: Pick<
      StoredEvent,
      | "venue"
      | "setting"
      | "cost"
      | "ages_text"
      | "signup"
      | "parking"
      | "series_id"
      | "organizer"
      | "annual"
      | "series"
      | "what"
      | "verified_via"
    >;
  })[]
> {
  const today = pacificToday(now);
  const until = addDays(today, days);
  const rows = await db.select().from(kidEvents).orderBy(asc(kidEvents.id));
  return rows
    .map((r) => ({ r, e: r.data as StoredEvent }))
    .filter(({ e }) =>
      e.dates.some((d) => (d.end_day ?? d.day) >= today && d.day <= until),
    )
    .map(({ r, e }) => ({
      slug: r.slug,
      // The key its data makes today: a row under an older key takes it
      // on the next hand-in for its venue and program (upsertOne).
      key: rowKey(r),
      // Stored under series:<id> alone: it may hold other venues' dates,
      // so its dates never block a hand-in (lib/events/dedupe.ts).
      legacy: LEGACY_SERIES_KEY.test(r.seriesKey),
      kind: r.kind,
      confirm: r.confirm,
      status: r.status,
      title: e.title,
      url: e.url,
      venue: { name: e.venue.name, town: e.venue.town },
      point: e.point,
      dates: e.dates
        .filter((d) => (d.end_day ?? d.day) >= today && d.day <= until)
        .map((d) => ({
          day: d.day,
          ...(d.start ? { start: d.start } : {}),
          ...(d.end ? { end: d.end } : {}),
          ...(d.end_day ? { end_day: d.end_day } : {}),
        })),
      targetUrls: [
        ...new Set(Object.values(e.targets ?? {}).map((t) => t.url)),
      ],
      facts: {
        venue: e.venue,
        what: e.what,
        ...(e.series_id ? { series_id: e.series_id } : {}),
        ...(e.organizer ? { organizer: e.organizer } : {}),
        ...(e.annual !== undefined ? { annual: e.annual } : {}),
        ...(e.series !== undefined ? { series: e.series } : {}),
        ...(e.verified_via ? { verified_via: e.verified_via } : {}),
        ...(e.setting ? { setting: e.setting } : {}),
        ...(e.cost ? { cost: e.cost } : {}),
        ...(e.ages_text ? { ages_text: e.ages_text } : {}),
        ...(e.signup ? { signup: e.signup } : {}),
        ...(e.parking ? { parking: e.parking } : {}),
      },
    }));
}

export async function eventBySlug(slug: string): Promise<EventRow | null> {
  return (await allEvents()).find((e) => e.slug === slug) ?? null;
}

// --- The nightly re-check ------------------------------------------------------

/** At most this many official pages fetched at once at night. */
export const CHECK_CONCURRENCY = 6;
/** Stop starting new checks after this long (the function has 300 s). */
export const CHECK_BUDGET_MS = 240_000;

/**
 * Every event with a date still to come, oldest check first, 6 at a
 * time, stopping after about 240 seconds (the rest go first tomorrow).
 * Each looks at its next date's own page and quote, or its status quote.
 * A canceled or postponed event whose page is gone keeps its status until
 * its date. A row changed meanwhile (a new hand-in) isn't overwritten.
 */
export async function recheckEvents(
  now = new Date(),
  fetcher = fetchPage,
  opts: { budgetMs?: number; concurrency?: number } = {},
): Promise<{ checked: number; changed: string[]; left: number }> {
  const started = Date.now();
  const rows = await db
    .select()
    .from(kidEvents)
    .orderBy(sql`${kidEvents.lastCheckAt} asc nulls first`, asc(kidEvents.id));
  const due = rows
    .map((r) => ({ r, row: toRow(r) }))
    .map((x) => ({ ...x, target: checkTarget(x.row, now) }))
    .filter((x) => x.target);
  const changed: string[] = [];
  let checked = 0;
  let i = 0;
  const domains = eventDomains(CATALOG.link_domains);
  const worker = async () => {
    while (i < due.length) {
      if (Date.now() - started > (opts.budgetMs ?? CHECK_BUDGET_MS)) return;
      const { r, target } = due[i++];
      const title = (r.data as StoredEvent).title;
      // Verified on a newsletter's listing: the organizer's page and the
      // listing both, a wall or a gone listing never a miss (judgeListing).
      const listing = (r.data as StoredEvent).verified_via === "listing";
      const organizerUrl = (r.data as StoredEvent).url;
      // Both pages at once, so a listing check takes one fetch's time at
      // most, as the cron budget (lib/cron-budget.ts) assumes.
      const [page, organizer] = await Promise.all([
        fetcher(
          target!.url,
          listing ? [...domains, ...CATALOG.listing_domains] : domains,
        ).catch(() => null),
        listing && target!.url !== organizerUrl
          ? fetcher(organizerUrl, [
              ...domains,
              new URL(organizerUrl).hostname.replace(/^www\./, ""),
            ]).catch(() => null)
          : Promise.resolve(undefined),
      ]);
      let outcome = listing
        ? judgeListing(
            organizer === undefined ? page : organizer,
            page,
            target!.quote,
            title,
          )
        : judge(page, target!.quote, {
            walled: !!onList(target!.url, CATALOG.walled_hosts),
            title,
          });
      // A non-scheduled event whose page is gone stays as it is.
      if (target!.status !== "scheduled" && outcome === "miss")
        outcome = "unknown";
      const next = afterCheck(
        {
          confirm: r.confirm as "ok" | "unconfirmed",
          misses: r.misses,
          seenStreak: r.seenStreak,
        },
        outcome,
        // A listing event whose pages are walled or gone stays as it is
        // until its date: unknown never takes it off the listing.
        listing
          ? 0
          : (now.getTime() - (r.lastSeenAt ?? r.createdAt).getTime()) /
              86_400_000,
      );
      const flipped = next.confirm !== r.confirm;
      // The page says it's canceled: that date's status changes (the
      // same as a status hand-in), and the listing shows it.
      const cancel =
        outcome === "canceled" && page ? cancellationOf(page, title) : null;
      const data = r.data as StoredEvent;
      const canceled = cancel
        ? {
            data: {
              ...data,
              status: {
                kind: "canceled" as const,
                quote: cancel.slice(0, 300),
              },
              url: data.url,
              statusByDay: {
                ...data.statusByDay,
                [target!.next.day]: "canceled" as const,
              },
            },
            status: "canceled",
            stateChangedAt: sql`now()`,
            factsChangedAt: sql`now()`,
          }
        : {};
      const done = await db
        .update(kidEvents)
        .set({
          confirm: next.confirm,
          misses: next.misses,
          seenStreak: next.seenStreak,
          lastCheckAt: sql`now()`,
          ...(next.seen ? { lastSeenAt: sql`now()` } : {}),
          ...(flipped
            ? { stateChangedAt: sql`now()`, factsChangedAt: sql`now()` }
            : {}),
          ...canceled,
        })
        // Only if no hand-in changed the row meanwhile (timestamps compared
        // at the millisecond, as JavaScript reads them).
        .where(
          and(
            eq(kidEvents.id, r.id),
            sql`date_trunc('milliseconds', ${kidEvents.updatedAt}) = ${r.updatedAt.toISOString()}::timestamptz`,
          ),
        )
        .returning({ id: kidEvents.id });
      checked++;
      if ((flipped || cancel) && done.length) changed.push(r.slug);
    }
  };
  try {
    await Promise.all(
      Array.from({ length: opts.concurrency ?? CHECK_CONCURRENCY }, worker),
    );
  } finally {
    expireEvents();
  }
  return { checked, changed, left: due.length - checked };
}

// --- Admin repairs ---------------------------------------------------------------

/** One event for /admin: its id, slug, venue and every date with its id. */
export type AdminEvent = {
  id: number;
  slug: string;
  title: string;
  venue: string;
  town: string;
  kind: string;
  confirm: string;
  dates: { id: string; day: string; start?: string; url: string }[];
};

/** Events for the admin table (upcoming first, a few hundred at most). */
export async function adminEvents(now = new Date()): Promise<AdminEvent[]> {
  const today = pacificToday(now);
  const rows = await db.select().from(kidEvents).orderBy(asc(kidEvents.slug));
  return rows
    .map((r) => {
      const e = r.data as StoredEvent;
      return {
        id: r.id,
        slug: r.slug,
        title: e.title,
        venue: e.venue.name,
        town: e.venue.town,
        kind: r.kind,
        confirm: r.confirm,
        dates: [...e.dates]
          .sort((a, b) => occurrenceId(a).localeCompare(occurrenceId(b)))
          .map((d) => ({
            id: occurrenceId(d),
            day: d.day,
            ...(d.start ? { start: d.start } : {}),
            url: e.targets?.[d.day]?.url ?? e.url,
          })),
        upcoming: e.dates.some((d) => (d.end_day ?? d.day) >= today),
      };
    })
    .sort((a, b) => Number(b.upcoming) - Number(a.upcoming))
    .map(({ upcoming: _u, ...rest }) => {
      void _u;
      return rest;
    });
}

/** The data left after taking some occurrences out (targets and status kept in step). */
export function withoutDates(
  e: StoredEvent,
  remove: ReadonlySet<string>,
): StoredEvent {
  const dates = e.dates.filter((d) => !remove.has(occurrenceId(d)));
  const days = new Set(dates.map((d) => d.day));
  const keep = <T>(m?: Record<string, T>) =>
    m
      ? Object.fromEntries(Object.entries(m).filter(([k]) => days.has(k)))
      : undefined;
  const targets = keep(e.targets);
  const first = [...dates].sort((a, b) => a.day.localeCompare(b.day))[0];
  return {
    ...e,
    dates,
    targets,
    statusByDay: keep(e.statusByDay),
    checkQuote: (first && targets?.[first.day]?.quote) ?? e.checkQuote,
  };
}

/** The data of the occurrences split off to a new page (no series_id). */
export function splitData(
  e: StoredEvent,
  take: ReadonlySet<string>,
  to: { title: string; venueName: string; venueTown: string },
): StoredEvent {
  const dates = e.dates.filter((d) => take.has(occurrenceId(d)));
  const days = new Set(dates.map((d) => d.day));
  const pick = <T>(m?: Record<string, T>) =>
    m
      ? Object.fromEntries(Object.entries(m).filter(([k]) => days.has(k)))
      : undefined;
  const dest = { name: to.venueName, town: to.venueTown };
  // The same venue under another spelling keeps its street and pin; a
  // catalog venue gets its street from the catalog; any other venue's
  // street and pin were the source's, so they go.
  const sameVenue = venueKey(dest) === venueKey(e.venue);
  const known = CATALOG.venues.find((x) => x.id === venueKey(dest));
  const street = known?.address?.split(",")[0]?.trim();
  const {
    series_id: _s,
    status: _st,
    statusByDay: _sb,
    checkQuote: _cq,
    ...rest
  } = e;
  void _s;
  void _st;
  void _sb;
  void _cq;
  const targets = pick(e.targets);
  const first = [...dates].sort((a, b) => a.day.localeCompare(b.day))[0];
  return {
    ...rest,
    title: to.title,
    venue: sameVenue
      ? { ...e.venue, name: to.venueName }
      : { ...dest, ...(street ? { street } : {}) },
    point: sameVenue ? e.point : null,
    dates,
    targets,
    // Its own date's quote only: never the source page's check quote or
    // status. The new page starts unconfirmed until the nightly check
    // sees it.
    checkQuote: (first && targets?.[first.day]?.quote) ?? "",
  };
}

/** A stored event as the input its key and slug come from. */
const asInput = (e: StoredEvent): EventInput =>
  ({ ...e, series: e.dates.length > 1 ? true : undefined }) as EventInput;

type EditResult =
  | { ok: true; slug: string; newSlug?: string; removed: string[] }
  | { ok: false; error: string };

async function lockedRow(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: number,
) {
  const [row] = await tx
    .select()
    .from(kidEvents)
    .where(eq(kidEvents.id, id))
    .for("update");
  return row;
}

/**
 * Trim dates: take chosen occurrences off one event (a date that was
 * never this event's). Taking every date off is a remove. Logged.
 */
export async function trimEventDates(
  id: number,
  occurrences: readonly string[],
  by: number | null,
): Promise<EditResult> {
  const remove = new Set(occurrences);
  const res = await db.transaction(async (tx): Promise<EditResult> => {
    const row = await lockedRow(tx, id);
    if (!row) return { ok: false, error: "That event is gone." };
    const e = row.data as StoredEvent;
    const hit = e.dates.filter((d) => remove.has(occurrenceId(d)));
    if (!hit.length) return { ok: false, error: "Pick a date to take off." };
    const next = withoutDates(e, remove);
    if (!next.dates.length)
      return {
        ok: false,
        error: "That's every date. Use Remove for the whole event.",
      };
    await tx
      .update(kidEvents)
      .set({
        data: next,
        factsChangedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(kidEvents.id, id));
    await tx.insert(kidEventEdits).values({
      eventId: id,
      slug: row.slug,
      action: "trim",
      detail: {
        key: rowKey(row),
        occurrences: hit.map(occurrenceId),
        removed: hit,
        left: next.dates.length,
      },
      byExplorerId: by,
    });
    return { ok: true, slug: row.slug, removed: hit.map(occurrenceId) };
  });
  if (res.ok) expireEvents();
  return res;
}

/**
 * Split off: move chosen occurrences to their own page, under the title
 * and venue they really have (another branch's story time). They join
 * that page if it exists (same series key), else make it. The catalog
 * series id stays behind. Logged.
 */
export async function splitEvent(
  id: number,
  occurrences: readonly string[],
  to: { title: string; venueName: string; venueTown: string },
  by: number | null,
): Promise<EditResult> {
  const take = new Set(occurrences);
  const res = await db.transaction(async (tx): Promise<EditResult> => {
    const row = await lockedRow(tx, id);
    if (!row) return { ok: false, error: "That event is gone." };
    const e = row.data as StoredEvent;
    const moved = splitData(e, take, to);
    if (!moved.dates.length)
      return { ok: false, error: "Pick the dates to split off." };
    const input = asInput(moved);
    const key = seriesKey(input);
    if (key === row.seriesKey || key === rowKey(row))
      return {
        ok: false,
        error: "That's this same page. Change the title or venue.",
      };
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`event:${key}`}))`,
    );
    const [there] = await tx
      .select()
      .from(kidEvents)
      .where(eq(kidEvents.seriesKey, key));
    let newSlug: string;
    if (there) {
      const t = there.data as StoredEvent;
      const at = (d: { day: string; start?: string }) => occurrenceId(d);
      const have = new Set(t.dates.map(at));
      const dates = [
        ...t.dates,
        ...moved.dates.filter((d) => !have.has(at(d))),
      ].sort((a, b) => at(a).localeCompare(at(b)));
      await tx
        .update(kidEvents)
        .set({
          data: {
            ...t,
            dates,
            targets: { ...moved.targets, ...t.targets },
          },
          kind: there.kind === "annual" ? "annual" : "series",
          factsChangedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(kidEvents.id, there.id));
      newSlug = there.slug;
    } else {
      const base = eventSlug(input);
      const [clash] = await tx
        .select({ id: kidEvents.id })
        .from(kidEvents)
        .where(eq(kidEvents.slug, base));
      newSlug = clash ? `${base}-${slugSuffix(key)}` : base;
      await tx.insert(kidEvents).values({
        slug: newSlug,
        kind: kindOf(input),
        seriesKey: key,
        data: moved,
        status: "scheduled",
        confirm: "unconfirmed",
      });
    }
    const left = withoutDates(e, take);
    if (left.dates.length)
      await tx
        .update(kidEvents)
        .set({ data: left, factsChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(kidEvents.id, id));
    else await tx.delete(kidEvents).where(eq(kidEvents.id, id));
    await tx.insert(kidEventEdits).values({
      eventId: id,
      slug: row.slug,
      action: "split",
      detail: {
        key: rowKey(row),
        occurrences: moved.dates.map(occurrenceId),
        moved: moved.dates,
        to: { slug: newSlug, key, ...to },
        sourceRemoved: !left.dates.length,
        source: {
          slug: row.slug,
          kind: row.kind,
          seriesKey: row.seriesKey,
          data: row.data,
          status: row.status,
          confirm: row.confirm,
        },
      },
      byExplorerId: by,
    });
    return {
      ok: true,
      slug: row.slug,
      newSlug,
      removed: moved.dates.map(occurrenceId),
    };
  });
  if (res.ok) expireEvents();
  return res;
}

/**
 * Remove: delete a wrong event row (its page goes away). The row as it
 * was is kept in the log, so it can be put back by hand.
 */
export async function removeEvent(
  id: number,
  reason: string,
  by: number | null,
): Promise<EditResult> {
  const res = await db.transaction(async (tx): Promise<EditResult> => {
    const row = await lockedRow(tx, id);
    if (!row) return { ok: false, error: "That event is gone." };
    await tx.delete(kidEvents).where(eq(kidEvents.id, id));
    await tx.insert(kidEventEdits).values({
      eventId: id,
      slug: row.slug,
      action: "remove",
      detail: {
        reason,
        key: rowKey(row),
        row: {
          slug: row.slug,
          kind: row.kind,
          seriesKey: row.seriesKey,
          data: row.data,
          status: row.status,
          confirm: row.confirm,
        },
      },
      byExplorerId: by,
    });
    const e = row.data as StoredEvent;
    return { ok: true, slug: row.slug, removed: e.dates.map(occurrenceId) };
  });
  if (res.ok) expireEvents();
  return res;
}

/**
 * What admins took off or removed, for every hand-in: occurrences trimmed
 * or split off a key never come back to it, and a page removed in the
 * last 60 days isn't made again (by its key or its slug).
 */
export async function editBlocks(now = new Date()): Promise<EditBlocks> {
  const rows = await db.select().from(kidEventEdits);
  const trimmed = new Map<string, Set<string>>();
  const removed: { slug: string; key: string | null; at: string }[] = [];
  const since = now.getTime() - REMOVED_BLOCK_DAYS * 86_400_000;
  for (const r of rows) {
    const d = r.detail as { key?: string; occurrences?: string[] };
    if ((r.action === "trim" || r.action === "split") && d.key)
      for (const o of d.occurrences ?? [])
        trimmed.set(d.key, (trimmed.get(d.key) ?? new Set()).add(o));
    if (r.action === "remove" && r.createdAt.getTime() >= since)
      removed.push({
        slug: r.slug,
        key: d.key ?? null,
        at: r.createdAt.toISOString().slice(0, 10),
      });
  }
  return { trimmed, removed };
}

/** The last admin repairs (for /admin). */
export async function recentEventEdits(limit = 10) {
  return db
    .select()
    .from(kidEventEdits)
    .orderBy(sql`${kidEventEdits.createdAt} desc`)
    .limit(limit);
}
