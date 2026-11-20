import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { db } from "@/db";
import { kidEvents } from "@/db/schema";
import { fetchPage } from "@/lib/news/fetcher";
import { CATALOG } from "@/lib/news/catalog";
import type { EventVerdict } from "./validate";
import {
  type EventRow,
  type EventStatus,
  lastEnd,
  type StoredEvent,
} from "./model";
import { afterCheck, checkTarget, judge } from "./state";
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
const toRow = (r: Raw): EventRow => ({
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
export async function upsertEvents(
  verdicts: EventVerdict[],
  opts: { network: boolean },
): Promise<
  { slug: string; created: boolean; changed: boolean; error?: string }[]
> {
  const out: {
    slug: string;
    created: boolean;
    changed: boolean;
    error?: string;
  }[] = [];
  for (const v of verdicts) {
    if (!v.ok || !v.event || !v.key || !v.slug || !v.kind) continue;
    try {
      out.push(await upsertOne(v, opts));
    } catch (e) {
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
  opts: { network: boolean },
): Promise<{ slug: string; created: boolean; changed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`event:${v.key}`}))`,
    );
    const [old] = await tx
      .select()
      .from(kidEvents)
      .where(eq(kidEvents.seriesKey, v.key!));
    let data = v.event!;
    let kind = v.kind!;
    if (old) {
      const prev = old.data as StoredEvent;
      // Same key and not a declared one-off: one page, every date kept.
      if (!v.key!.startsWith("one:")) {
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
        if (data.dates.length > 1 || kind === "series")
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
      const page = await fetcher(target!.url, domains).catch(() => null);
      let outcome = judge(page, target!.quote);
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
      );
      const flipped = next.confirm !== r.confirm;
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
      if (flipped && done.length) changed.push(r.slug);
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
