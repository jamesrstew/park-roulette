import "server-only";
import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertLog, newsletterIssues } from "@/db/schema";
import { pacific } from "@/lib/news/time";
import { GMAIL_FORWARDING_SOURCE } from "./accept";
import { type IssueLink, keepLink } from "./extract";

/**
 * The stored newsletter issues (newsletter_issues): saved by the inbound
 * webhook, read by the events harvest and the events checker, pruned
 * after 120 days by the daily cleanup. Never shown or linked publicly.
 */

/** Days an issue is kept (from when it reached us). */
export const KEEP_DAYS = 120;

/** A newsletter's row (never Gmail's confirmation row). */
const isIssue = ne(newsletterIssues.source, GMAIL_FORWARDING_SOURCE);

/** Issues one source may store in 24 hours; more are dropped and alerted. */
export const MAX_PER_DAY = 2;

export type NewIssue = {
  source: string;
  messageId: string;
  subject: string;
  sentAt: Date;
  html: string;
  text: string;
  links: IssueLink[];
};

export type SaveResult =
  | { saved: true; id: number }
  | { saved: false; why: "duplicate" | "over_limit" };

/**
 * Store one email, once per source and Message-ID. With `maxPerDay`, a
 * source that already stored that many in the last 24 hours is refused
 * (one source at a time, under a lock, so two deliveries can't both slip
 * in).
 */
export async function saveIssue(
  i: NewIssue,
  opts: { maxPerDay?: number } = {},
): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`newsletter_issues:${i.source}`}))`,
    );
    const [dup] = await tx
      .select({ id: newsletterIssues.id })
      .from(newsletterIssues)
      .where(
        and(
          eq(newsletterIssues.source, i.source),
          eq(newsletterIssues.messageId, i.messageId),
        ),
      );
    if (dup) return { saved: false, why: "duplicate" } as const;
    if (opts.maxPerDay != null) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(newsletterIssues)
        .where(
          and(
            eq(newsletterIssues.source, i.source),
            sql`${newsletterIssues.receivedAt} > now() - interval '24 hours'`,
          ),
        );
      if (Number(r?.n ?? 0) >= opts.maxPerDay)
        return { saved: false, why: "over_limit" } as const;
    }
    const [row] = await tx
      .insert(newsletterIssues)
      .values({
        source: i.source,
        messageId: i.messageId,
        subject: i.subject.slice(0, 500),
        sentAt: i.sentAt,
        html: i.html,
        text: i.text,
        links: i.links,
      })
      .returning({ id: newsletterIssues.id });
    return { saved: true, id: row.id } as const;
  });
}

export type IssueSummary = {
  id: number;
  ref: string;
  source: string;
  subject: string;
  sent_at: string;
  /** The day it was sent, in Bend. */
  sent_day: string;
  text: string;
  links: IssueLink[];
};

type Row = typeof newsletterIssues.$inferSelect;
const summary = (r: Omit<Row, "html" | "messageId" | "receivedAt">) => ({
  id: r.id,
  ref: `issue:${r.id}`,
  source: r.source,
  subject: r.subject,
  sent_at: r.sentAt.toISOString(),
  sent_day: pacific(r.sentAt).date,
  text: r.text,
  // Never a click tracker (they'd count as the owner's clicks).
  links: r.links.filter((l) => keepLink(l.url, l.text)),
});

const cols = {
  id: newsletterIssues.id,
  source: newsletterIssues.source,
  subject: newsletterIssues.subject,
  sentAt: newsletterIssues.sentAt,
  text: newsletterIssues.text,
  links: newsletterIssues.links,
};

/** Issues sent in the last `days` days, newest first. */
export async function recentIssues(
  days: number,
  now = new Date(),
): Promise<IssueSummary[]> {
  const rows = await db
    .select(cols)
    .from(newsletterIssues)
    .where(
      and(
        isIssue,
        gte(
          newsletterIssues.sentAt,
          new Date(now.getTime() - days * 86_400_000),
        ),
      ),
    )
    .orderBy(desc(newsletterIssues.sentAt), desc(newsletterIssues.id));
  return rows.map(summary);
}

/** One stored issue (a newsletter's, never Gmail's confirmation). */
export async function issueById(id: number): Promise<IssueSummary | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const [r] = await db
    .select(cols)
    .from(newsletterIssues)
    .where(and(eq(newsletterIssues.id, id), isIssue));
  return r ? summary(r) : null;
}

/**
 * What the events checker needs of an issue: its text, its day, and its
 * html (which link sits next to which event).
 */
export async function issueForEvidence(
  id: number,
): Promise<{ text: string; day: string; html: string } | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const [r] = await db
    .select({ ...cols, html: newsletterIssues.html })
    .from(newsletterIssues)
    .where(and(eq(newsletterIssues.id, id), isIssue));
  return r ? { text: r.text, day: pacific(r.sentAt).date, html: r.html } : null;
}

/** Delete issues (and Gmail confirmation rows) over 120 days old. */
export async function pruneIssues(now = new Date()): Promise<number> {
  const gone = await db
    .delete(newsletterIssues)
    .where(
      lt(
        newsletterIssues.receivedAt,
        new Date(now.getTime() - KEEP_DAYS * 86_400_000),
      ),
    )
    .returning({ id: newsletterIssues.id });
  // Temp-fail counters (tempFailCount) a week old are done with.
  await db.execute(
    sql`delete from ${alertLog} where ${alertLog.key} like 'inbox:tempfail:%' and ${alertLog.sentAt} < now() - interval '7 days'`,
  );
  return gone.length;
}

/**
 * Count one more temporary failure (a DKIM key lookup) for this email,
 * across servers (a counter row in alert_log); returns the count.
 */
export async function tempFailCount(emailId: string): Promise<number> {
  const [r] = await db.execute<{ n: number }>(sql`
    insert into ${alertLog} (key, sent_at, suppressed)
    values (${`inbox:tempfail:${emailId}`}, now(), 1)
    on conflict (key) do update set suppressed = ${alertLog.suppressed} + 1
    returning suppressed as n`);
  return Number(r?.n ?? 0);
}

/** Rows stored (tests and logs). */
export async function issueCount(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(newsletterIssues);
  return Number(r?.n ?? 0);
}
