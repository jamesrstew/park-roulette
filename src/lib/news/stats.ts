import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contactConsents,
  kidEventHandins,
  newsClicks,
  newsIssues,
  newsSends,
} from "@/db/schema";

/**
 * The maintainer's weekly numbers, per sent issue: recipients, clicks by
 * link (/n), email stops within 7 days by how (one_click, email_link,
 * bounce, complaint), the items the validator cut at send, and the
 * events stored and cut in the week before. Aggregates only: no address,
 * no person. Opens aren't tracked, and never estimated.
 */

const DAY = 86_400_000;

/** The cut items from a stored report, as {path, rule, message}. */
export function droppedOf(report: unknown): {
  path: string;
  rule: string;
  message: string;
}[] {
  const d = (report as { dropped?: unknown } | null)?.dropped;
  if (!Array.isArray(d)) return [];
  return d
    .filter(
      (x): x is { path: string; rule: string; message: string } =>
        !!x && typeof x === "object" && "message" in x,
    )
    .map((x) => ({
      path: String(x.path),
      rule: String(x.rule),
      message: String(x.message).slice(0, 200),
    }));
}

export async function newsStats(sends: number) {
  const issues = await db
    .select({
      id: newsIssues.id,
      issueDate: newsIssues.issueDate,
      sentAt: newsIssues.sentAt,
      sendStartedAt: newsIssues.sendStartedAt,
      report: newsIssues.report,
    })
    .from(newsIssues)
    .where(eq(newsIssues.status, "sent"))
    .orderBy(desc(newsIssues.issueDate))
    .limit(sends);
  const out = [];
  for (const i of issues) {
    const sentAt = i.sentAt ?? i.sendStartedAt ?? new Date(i.issueDate);
    const weekAfter = new Date(sentAt.getTime() + 7 * DAY);
    const weekBefore = new Date(sentAt.getTime() - 7 * DAY);
    const [[recipients], clicks, stops, [events]] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(newsSends)
        .where(and(eq(newsSends.issueId, i.id), eq(newsSends.status, "sent"))),
      db
        .select({ slug: newsClicks.slug, clicks: newsClicks.clicks })
        .from(newsClicks)
        .where(eq(newsClicks.issueDate, i.issueDate))
        .orderBy(desc(newsClicks.clicks)),
      db
        .select({
          source: contactConsents.source,
          n: sql<number>`count(*)::int`,
        })
        .from(contactConsents)
        .where(
          and(
            eq(contactConsents.channel, "email"),
            eq(contactConsents.action, "opt_out"),
            gte(contactConsents.createdAt, sentAt),
            lt(contactConsents.createdAt, weekAfter),
          ),
        )
        .groupBy(contactConsents.source),
      db
        .select({
          handins: sql<number>`count(*)::int`,
          stored: sql<number>`coalesce(sum(${kidEventHandins.stored}), 0)::int`,
          created: sql<number>`coalesce(sum(${kidEventHandins.created}), 0)::int`,
          cut: sql<number>`coalesce(sum(${kidEventHandins.cut}), 0)::int`,
        })
        .from(kidEventHandins)
        .where(
          and(
            gte(kidEventHandins.createdAt, weekBefore),
            lt(kidEventHandins.createdAt, sentAt),
          ),
        ),
    ]);
    const by = Object.fromEntries(stops.map((s) => [s.source, s.n]));
    const dropped = droppedOf(i.report);
    out.push({
      issue_date: i.issueDate,
      recipients: recipients?.n ?? 0,
      clicks_total: clicks.reduce((n, c) => n + c.clicks, 0),
      clicks_by_slug: Object.fromEntries(clicks.map((c) => [c.slug, c.clicks])),
      unsubscribes_7d: {
        one_click: by.one_click ?? 0,
        email_link: by.email_link ?? 0,
        other: Object.entries(by)
          .filter(
            ([k]) =>
              !["one_click", "email_link", "bounce", "complaint"].includes(k),
          )
          .reduce((n, [, v]) => n + v, 0),
      },
      bounces_7d: by.bounce ?? 0,
      complaints_7d: by.complaint ?? 0,
      validator_dropped: dropped.length,
      dropped,
      events_week: events ?? { handins: 0, stored: 0, created: 0, cut: 0 },
    });
  }
  return {
    sends: out,
    note: "Opens aren't tracked, and never estimated. Counts only, no people.",
  };
}
