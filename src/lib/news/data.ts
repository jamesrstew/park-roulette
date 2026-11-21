import "server-only";
import { cacheLife } from "next/cache";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  newsIssues,
  newsPlans,
  newsSends,
  newsSettings,
  parkChanges,
  parks,
} from "@/db/schema";
import { fixLine } from "@/lib/fix-words";
import { CATALOG } from "./catalog";
import type { PickPark, SentIssue } from "./cooldowns";
import { IssueSchema } from "./issue";
import type { Plan } from "./plan-types";
import { SITE_URL } from "@/lib/site";
import type { ParkInfo, ValidateContext } from "./validate";
import { fetchPage } from "./fetcher";
import { addDays, issueDateFor, pacific } from "./time";
import { snapshotTakenDown } from "./takedowns";
import { eventsForIssues } from "@/lib/events/store";
import { type CardMode, memeSnapshot } from "./parents";
import type { MemeSnapshot } from "./issue";
import { postUrl } from "./xapi";
import { audienceCount } from "./audience";

/** Every park, for the Wheel Pick and the validator. */
export async function loadParks(): Promise<PickPark[]> {
  const rows = await db
    .select({
      slug: parks.slug,
      name: parks.name,
      city: parks.city,
      status: parks.status,
      play: parks.play,
      approvedAt: parks.approvedAt,
      features: parks.features,
    })
    .from(parks);
  return rows.map(({ approvedAt, ...p }) => ({
    ...p,
    approved: approvedAt != null,
  }));
}

export function parkMap(list: PickPark[]): Map<string, ParkInfo> {
  return new Map(list.map((p) => [p.slug, p]));
}

/**
 * An issue "went out" when at least one email was delivered: it's sent, or
 * a send under way has delivered some. Only these count as history (for
 * cooldowns and repeats), get a number, or show on the web.
 */
const WENT_OUT = (i: string) =>
  sql.raw(`(${i}.status = 'sent' or (${i}.status = 'draft' and ${i}.send_started_at is not null
    and exists (select 1 from news_sends s where s.issue_id = ${i}.id and s.status = 'sent')))`);
const wentOut = WENT_OUT("news_issues");

/** How many issues went out before this date (the next issue's number - 1). */
export async function wentOutCount(before: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(newsIssues)
    .where(and(wentOut, lt(newsIssues.issueDate, before)));
  return r?.n ?? 0;
}

/** Sent issues before this date (what readers actually got), newest first. */
export async function loadHistory(before: string): Promise<SentIssue[]> {
  const rows = await db
    .select({ issueDate: newsIssues.issueDate, body: newsIssues.sentBody })
    .from(newsIssues)
    .where(and(wentOut, lt(newsIssues.issueDate, before)))
    .orderBy(desc(newsIssues.issueDate))
    .limit(60);
  return rows.flatMap((r) => {
    const body = IssueSchema.safeParse(r.body);
    return body.success ? [{ issueDate: r.issueDate, body: body.data }] : [];
  });
}

/** When the last issue went out (deltas start there). */
export async function lastSentAt(before: string): Promise<Date | null> {
  const [r] = await db
    .select({
      at: sql<Date | null>`coalesce(${newsIssues.sentAt}, ${newsIssues.sendStartedAt})`.mapWith(
        (v) => (v ? new Date(v) : null),
      ),
    })
    .from(newsIssues)
    .where(and(wentOut, lt(newsIssues.issueDate, before)))
    .orderBy(desc(newsIssues.issueDate))
    .limit(1);
  return r?.at ?? null;
}

/**
 * Park changes families made since a moment, only the ones that change a
 * visit: closed or reopened, play added or gone, a feature added or
 * removed (a splash pad on or off, a cleared path). A park joining the map
 * (a data cleanup, or another family confirming it) is never news, so
 * "exists" changes and new parks are left out (James's rule).
 */
export async function loadDeltas(since: Date): Promise<Plan["deltas"]> {
  const changes = await db
    .select({
      id: parkChanges.id,
      topic: parkChanges.topic,
      value: parkChanges.value,
      at: parkChanges.createdAt,
      park: parks.slug,
      parkName: parks.name,
      city: parks.city,
    })
    .from(parkChanges)
    .innerJoin(parks, eq(parks.id, parkChanges.parkId))
    .where(
      and(
        gt(parkChanges.createdAt, since),
        sql`${parks.approvedAt} is not null`,
        sql`${parkChanges.topic} <> 'exists'`,
      ),
    )
    .orderBy(desc(parkChanges.createdAt))
    .limit(30);
  return {
    since: since.toISOString(),
    changes: changes.map((c) => ({
      id: c.id,
      park: c.park,
      park_name: c.parkName,
      city: c.city,
      topic: c.topic,
      value: c.value,
      line: fixLine(c.topic, c.value),
      at: c.at.toISOString(),
    })),
  };
}

export async function getStoredPlan(issueDate: string): Promise<Plan | null> {
  const [r] = await db
    .select({ plan: newsPlans.plan })
    .from(newsPlans)
    .where(eq(newsPlans.issueDate, issueDate));
  return (r?.plan as Plan | undefined) ?? null;
}

export async function storePlan(plan: Plan): Promise<void> {
  await db
    .insert(newsPlans)
    .values({ issueDate: plan.issue_date, plan })
    .onConflictDoUpdate({
      target: newsPlans.issueDate,
      set: { plan, createdAt: sql`now()` },
    });
}

/** Everything the validator needs for one issue date. */
export async function validateContext(
  issueDate: string,
  opts: {
    network: boolean;
    now?: Date;
    /** Parents' corner card: render only (default), store, or reuse. */
    cards?: CardMode;
    /** An Instagram pick's X stand-in: draw the plan's best (store), or reuse. */
    fallback?: { mode: "store" } | { mode: "reuse"; snapshot: MemeSnapshot };
  },
): Promise<ValidateContext> {
  const [list, history, plan, events] = await Promise.all([
    loadParks(),
    loadHistory(issueDate),
    getStoredPlan(issueDate),
    eventsForIssues(),
  ]);
  return {
    catalog: CATALOG,
    parks: parkMap(list),
    events: new Set(events.keys()),
    eventData: events,
    history,
    plan,
    fetcher: opts.network ? fetchPage : undefined,
    memeSource: opts.network
      ? (meme) => memeSnapshot(meme, opts.cards ?? { mode: "memory" })
      : undefined,
    memeFallback:
      opts.network && opts.fallback
        ? async () => {
            const f = opts.fallback!;
            if (f.mode === "reuse") {
              const s = f.snapshot;
              if (s.kind !== "x") return null;
              return memeSnapshot(
                { platform: "x", postId: s.id, url: postUrl(s) },
                { mode: "reuse", snapshot: s },
              );
            }
            const best = plan?.parents_corner?.candidates?.[0];
            return best
              ? memeSnapshot(
                  { platform: "x", postId: best.id, url: postUrl(best) },
                  { mode: "store" },
                )
              : null;
          }
        : undefined,
    site: SITE_URL,
    now: opts.now ?? new Date(),
  };
}

// --- Settings ------------------------------------------------------------

export type NewsSettings = {
  paused: boolean;
  dryRun: boolean;
  textsPaused: boolean;
  textsDryRun: boolean;
  textsPausedReason: string | null;
  heartbeatAt: Date | null;
  updatedAt: Date;
};

/** The one settings row, made on first read (dry run on, not paused). */
export async function getNewsSettings(): Promise<NewsSettings> {
  await db.insert(newsSettings).values({ id: 1 }).onConflictDoNothing();
  const [s] = await db
    .select({
      paused: newsSettings.paused,
      dryRun: newsSettings.dryRun,
      textsPaused: newsSettings.textsPaused,
      textsDryRun: newsSettings.textsDryRun,
      textsPausedReason: newsSettings.textsPausedReason,
      heartbeatAt: newsSettings.heartbeatAt,
      updatedAt: newsSettings.updatedAt,
    })
    .from(newsSettings)
    .where(eq(newsSettings.id, 1));
  return s;
}

export async function setNewsSettings(
  patch: Partial<{
    paused: boolean;
    dryRun: boolean;
    textsPaused: boolean;
    textsDryRun: boolean;
  }>,
): Promise<void> {
  await getNewsSettings();
  await db
    .update(newsSettings)
    .set({
      ...patch,
      // Turning texts back on clears the guardrail's reason
      // and restarts its count: only sends after now are looked at.
      ...(patch.textsPaused === false
        ? { textsPausedReason: null, textsGuardrailClearedAt: sql`now()` }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(newsSettings.id, 1));
}

export async function beat(): Promise<void> {
  await getNewsSettings();
  await db
    .update(newsSettings)
    .set({ heartbeatAt: sql`now()` })
    .where(eq(newsSettings.id, 1));
}

// --- Admin and archive ---------------------------------------------------

/** Recent issues with their send counts, for /admin. */
export async function newsIssueList(limit = 12) {
  const rows = await db
    .select({
      id: newsIssues.id,
      issueDate: newsIssues.issueDate,
      status: newsIssues.status,
      subject: sql<string | null>`${newsIssues.body}->>'subject'`,
      skipReason: newsIssues.skipReason,
      dryRunAt: newsIssues.dryRunAt,
      sendStartedAt: newsIssues.sendStartedAt,
      sentAt: newsIssues.sentAt,
      ok: sql<boolean | null>`(${newsIssues.report}->>'ok')::boolean`,
      sent: sql<number>`(select count(*) from ${newsSends} s where s.issue_id = ${newsIssues.id} and s.status = 'sent')::int`,
      queued: sql<number>`(select count(*) from ${newsSends} s where s.issue_id = ${newsIssues.id} and s.status in ('queued', 'sending'))::int`,
      failed: sql<number>`(select count(*) from ${newsSends} s where s.issue_id = ${newsIssues.id} and s.status = 'failed')::int`,
      skipped: sql<number>`(select count(*) from ${newsSends} s where s.issue_id = ${newsIssues.id} and s.status = 'skipped')::int`,
    })
    .from(newsIssues)
    .orderBy(desc(newsIssues.issueDate))
    .limit(limit);
  return rows;
}

/** Everything /admin shows for the newsletter. */
export async function newsAdmin() {
  const [settings, issues, audience] = await Promise.all([
    getNewsSettings(),
    newsIssueList(),
    audienceCount(),
  ]);
  return {
    paused: settings.paused,
    dryRun: settings.dryRun,
    textsPaused: settings.textsPaused,
    textsDryRun: settings.textsDryRun,
    textsPausedReason: settings.textsPausedReason,
    heartbeat: settings.heartbeatAt
      ? settings.heartbeatAt.toLocaleString("en-US", {
          timeZone: "America/Los_Angeles",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "never",
    audience,
    issues: issues.map((i) => ({
      id: i.id,
      issueDate: i.issueDate,
      status: i.status,
      subject: i.subject,
      skipReason: i.skipReason,
      dryRun: i.dryRunAt != null,
      started: i.sendStartedAt != null,
      ok: i.ok,
      sent: i.sent,
      queued: i.queued,
      failed: i.failed,
      skipped: i.skipped,
    })),
  };
}

/** Issues that went out, newest first (The scoop, /newsletter, RSS). */
export async function sentIssues(limit = 200) {
  const rows = await db
    .select({
      issueDate: newsIssues.issueDate,
      subject: sql<string>`${newsIssues.sentBody}->>'subject'`,
      preview: sql<string>`${newsIssues.sentBody}->>'preview'`,
      sentAt:
        sql<Date>`coalesce(${newsIssues.sentAt}, ${newsIssues.sendStartedAt})`.mapWith(
          (v) => new Date(v),
        ),
    })
    .from(newsIssues)
    .where(wentOut)
    .orderBy(desc(newsIssues.issueDate))
    .limit(limit);
  return rows;
}

/**
 * The latest issue that went out, with its wheel pick's park when that
 * park is on the map (The scoop's "This weekend's pick"). The same for
 * everyone, so cached a few minutes.
 */
export async function latestIssue(): Promise<{
  issueDate: string;
  subject: string;
  pick: { slug: string; name: string } | null;
} | null> {
  "use cache";
  cacheLife("minutes");
  const [r] = await db
    .select({
      issueDate: newsIssues.issueDate,
      subject: sql<string>`${newsIssues.sentBody}->>'subject'`,
      pick: sql<string | null>`${newsIssues.sentBody}->'wheel_pick'->>'park'`,
    })
    .from(newsIssues)
    .where(wentOut)
    .orderBy(desc(newsIssues.issueDate))
    .limit(1);
  if (!r) return null;
  const [park] = r.pick
    ? await db
        .select({ slug: parks.slug, name: parks.name })
        .from(parks)
        .where(
          and(eq(parks.slug, r.pick), sql`${parks.approvedAt} is not null`),
        )
    : [];
  return { issueDate: r.issueDate, subject: r.subject, pick: park ?? null };
}

/**
 * One issue that went out (never a draft, a skipped or a failed week),
 * with its number, when it went, and its neighbors. The web archive.
 */
export async function sentIssue(issueDate: string) {
  const [r] = await db
    .select({
      body: newsIssues.sentBody,
      rendered: newsIssues.rendered,
      plan: newsIssues.plan,
      sentAt:
        sql<Date>`coalesce(${newsIssues.sentAt}, ${newsIssues.sendStartedAt})`.mapWith(
          (v) => new Date(v),
        ),
      number: sql<number>`(select count(*) from news_issues i where i.issue_date <= ${newsIssues.issueDate} and ${WENT_OUT("i")})::int`,
      prev: sql<
        string | null
      >`(select max(i.issue_date)::text from news_issues i where i.issue_date < ${newsIssues.issueDate} and ${WENT_OUT("i")})`,
      next: sql<
        string | null
      >`(select min(i.issue_date)::text from news_issues i where i.issue_date > ${newsIssues.issueDate} and ${WENT_OUT("i")})`,
    })
    .from(newsIssues)
    .where(and(eq(newsIssues.issueDate, issueDate), wentOut));
  if (!r) return null;
  const body = IssueSchema.safeParse(r.body);
  const snap = body.success ? body.data.meme?.snapshot : undefined;
  // A post taken down (data/takedowns.json) stops showing the same day.
  const removed = !!snap && snapshotTakenDown(snap);
  return body.success
    ? {
        issue: removed ? { ...body.data, meme: undefined } : body.data,
        number: r.number,
        sentAt: r.sentAt,
        /** Which images the email showed (older sends: both). */
        images: (
          r.rendered as {
            images?: { weatherImage: boolean; memeImage: boolean };
          } | null
        )?.images ?? { weatherImage: true, memeImage: true },
        prev: r.prev,
        next: r.next,
        /** The stored plan (tiers; a Friday update line, if any). */
        plan: r.plan as Plan | null,
      }
    : null;
}

/** The latest sent issue that listed this event in This weekend. */
export async function featuredEvent(slug: string): Promise<string | null> {
  "use cache";
  cacheLife("days");
  const [r] = await db
    .select({ issueDate: newsIssues.issueDate })
    .from(newsIssues)
    .where(
      and(
        wentOut,
        sql`${newsIssues.sentBody}->'weekend' @> ${JSON.stringify([{ event: slug }])}::jsonb`,
      ),
    )
    .orderBy(desc(newsIssues.issueDate))
    .limit(1);
  return r?.issueDate ?? null;
}

/** The latest issue that featured this park (for "Featured in" on its page). */
export async function featuredIn(slug: string) {
  const [r] = await db
    .select({ issueDate: newsIssues.issueDate })
    .from(newsIssues)
    .where(
      and(
        wentOut,
        sql`${newsIssues.sentBody}->'wheel_pick'->>'park' = ${slug}`,
      ),
    )
    .orderBy(desc(newsIssues.issueDate))
    .limit(1);
  return r?.issueDate ?? null;
}

/**
 * The next issue a new subscriber gets: this Thursday unless this week's
 * is done (or it's past the 9:00 start), skipping the calendar's skip
 * dates (Thanksgiving, Christmas Eve, New Year's Eve).
 */
export async function nextIssueDate(
  now = new Date(),
  /** Past this Pacific time on a Thursday, that Thursday is taken. */
  cutoffMinutes = 9 * 60,
): Promise<string> {
  const p = pacific(now);
  let date = issueDateFor(now);
  if (date === p.date) {
    const [today] = await db
      .select({ status: newsIssues.status, started: newsIssues.sendStartedAt })
      .from(newsIssues)
      .where(eq(newsIssues.issueDate, date));
    if (
      p.minutes >= cutoffMinutes ||
      today?.started ||
      (today && today.status !== "draft")
    )
      date = addDays(date, 7);
  }
  const skips = new Set(CATALOG.skip_dates.map((d) => d.date));
  while (skips.has(date)) date = addDays(date, 7);
  return date;
}

/**
 * The Thursday the writer drafts for: the next one whose send window
 * (7:00 Pacific) hasn't started, that isn't decided yet and isn't a skip
 * date.
 */
export function nextDraftDate(now = new Date()): Promise<string> {
  return nextIssueDate(now, 7 * 60);
}

/**
 * The issue a /n/<issue>/<slug> link belongs to: any issue whose send has
 * started, so links work from the first email on.
 */
export async function startedIssue(issueDate: string) {
  const [r] = await db
    .select({ body: newsIssues.sentBody })
    .from(newsIssues)
    .where(
      and(
        eq(newsIssues.issueDate, issueDate),
        sql`${newsIssues.sendStartedAt} is not null`,
      ),
    );
  const body = IssueSchema.safeParse(r?.body);
  return body.success ? body.data : null;
}

/**
 * The issue the weather card is drawn from: what was frozen when the send
 * started, or (before that) the latest validated draft, which is what a
 * dry run sends. Skipped weeks get nothing.
 */
export async function weatherIssue(issueDate: string) {
  const [r] = await db
    .select({
      status: newsIssues.status,
      started: sql<boolean>`${newsIssues.sendStartedAt} is not null`,
      sentBody: newsIssues.sentBody,
      report: newsIssues.report,
      plan: newsIssues.plan,
    })
    .from(newsIssues)
    .where(eq(newsIssues.issueDate, issueDate));
  if (!r) return null;
  const raw = r.started
    ? r.sentBody
    : r.status === "draft"
      ? (r.report as { issue?: unknown } | null)?.issue
      : null;
  const body = IssueSchema.safeParse(raw);
  return body.success
    ? { issue: body.data, frozen: r.started, plan: r.plan as Plan | null }
    : null;
}

// --- The sender's lease ----------------------------------------------------

/** Take the 10-minute lease if it's free (or expired). */
export async function takeLease(owner: string): Promise<boolean> {
  await getNewsSettings();
  const got = await db
    .update(newsSettings)
    .set({ lockUntil: sql`now() + interval '10 minutes'`, lockOwner: owner })
    .where(
      and(
        eq(newsSettings.id, 1),
        sql`(${newsSettings.lockUntil} is null or ${newsSettings.lockUntil} < now())`,
      ),
    )
    .returning({ id: newsSettings.id });
  return got.length > 0;
}

/** Extend our lease; false if it was lost (expired and taken). */
export async function renewLease(owner: string): Promise<boolean> {
  const got = await db
    .update(newsSettings)
    .set({ lockUntil: sql`now() + interval '10 minutes'` })
    .where(and(eq(newsSettings.id, 1), eq(newsSettings.lockOwner, owner)))
    .returning({ id: newsSettings.id });
  return got.length > 0;
}

export async function releaseLease(owner: string): Promise<void> {
  await db
    .update(newsSettings)
    .set({ lockUntil: null, lockOwner: null })
    .where(and(eq(newsSettings.id, 1), eq(newsSettings.lockOwner, owner)));
}

/** The URL of the site this deploy serves (for absolute links in emails). */
export const SITE = SITE_URL;
