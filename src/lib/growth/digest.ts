import "server-only";
import { ALERT_FROM, alertEmail, alertLater } from "@/lib/alerts";
import { sendOne } from "@/lib/news/resend";
import { SITE_URL } from "@/lib/site";
import { buildView, type DigestView } from "./analyze";
import { collectWeek, type CollectOptions } from "./collect";
import type { Snapshot } from "./model";
import { renderHtml, renderSubject, renderText } from "./render";
import {
  claimSend,
  insertBackfill,
  loadSnapshots,
  markSent,
  releaseClaim,
  saveSnapshot,
  snapshotRow,
} from "./store";
import { lastFullWeek, sendGate, weekOf, weeksBefore, type Week } from "./week";

/**
 * The Monday growth digest: gather last week's numbers, store them, and
 * email James one page. Idempotent per week: the snapshot is frozen once
 * the email has gone, the send is claimed before it goes, and Resend gets
 * an Idempotency-Key per week, so overlapping or repeated runs send once.
 */

/** Weeks of history the digest compares against (and backfills). */
export const HISTORY_WEEKS = 4;

export type Live = Pick<CollectOptions, "sitemap" | "eventsListed">;

export const webUrl = (week: string) => `${SITE_URL}/admin/growth?week=${week}`;

/** Fill in missing earlier weeks from what can still be worked out. */
export async function backfill(
  week: Week,
  o: { fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  const before = weeksBefore(week, HISTORY_WEEKS);
  const have = new Set(
    (await loadSnapshots(before.map((w) => w.start))).map((s) => s.weekStart),
  );
  const made: string[] = [];
  for (const w of before) {
    if (have.has(w.start)) continue;
    await insertBackfill(
      await collectWeek(w, { live: false, fetchImpl: o.fetchImpl }),
    );
    made.push(w.start);
  }
  return made;
}

/** The view for a stored or freshly gathered week, with its history. */
export async function viewFor(
  cur: Snapshot,
): Promise<{ view: DigestView; history: Snapshot[] }> {
  const history = await loadSnapshots(
    weeksBefore(weekOf(cur.weekStart), HISTORY_WEEKS).map((w) => w.start),
  );
  return { view: buildView(cur, history), history };
}

export type DigestResult =
  | { action: "skipped"; why: string }
  | { action: "sent"; week: string; backfilled: string[] }
  | { action: "failed"; week: string; why: string };

export async function runDigest(
  now: Date,
  live: Live,
  o: { fetchImpl?: typeof fetch; ignoreGate?: boolean } = {},
): Promise<DigestResult> {
  const gate = sendGate(now);
  if (!gate.open && !o.ignoreGate) return { action: "skipped", why: gate.why };
  const week = lastFullWeek(now);
  const existing = await snapshotRow(week.start);
  if (existing?.emailSentAt)
    return { action: "skipped", why: `already sent for ${week.start}` };

  const backfilled = await backfill(week, o).catch((e) => {
    console.error("[growth] backfill failed", (e as Error)?.message);
    return [] as string[];
  });
  const snap = await collectWeek(week, {
    live: true,
    fetchImpl: o.fetchImpl,
    ...live,
  });
  await saveSnapshot(snap);
  if (!(await claimSend(week.start)))
    return { action: "skipped", why: "another run is sending this week" };

  const { view } = await viewFor(snap);
  const url = webUrl(week.start);
  const res = await sendOne(
    {
      from: ALERT_FROM,
      to: [alertEmail()],
      subject: renderSubject(view),
      html: renderHtml(view, { webUrl: url }),
      text: renderText(view, { webUrl: url }),
    },
    `growth-digest-${week.start}`,
  );
  if (res.ok) {
    await markSent(week.start, res.ids[0] ?? null);
    return { action: "sent", week: week.start, backfilled };
  }
  // "accepted": Resend already took this week's key (an earlier run that
  // died before recording it). That's sent.
  if (res.outcome === "accepted") {
    await markSent(week.start, null);
    return { action: "sent", week: week.start, backfilled };
  }
  await releaseClaim(week.start);
  alertLater({
    key: "error:growth-digest",
    subject: "The Monday growth digest didn't send",
    text: `Resend answered ${res.status} (${res.error}). The cron tries again every 30 minutes until 9:00 Pacific. Check the Vercel logs for [growth].`,
    everyMinutes: 6 * 60,
  });
  return { action: "failed", week: week.start, why: res.error };
}
