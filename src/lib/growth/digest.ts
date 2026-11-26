import "server-only";
import { ALERT_FROM, alertEmail, alertLater } from "@/lib/alerts";
import { digestRecipients } from "./recipients";
import { sendOne } from "@/lib/news/resend";
import { SITE_URL } from "@/lib/site";
import { buildView, type DigestView } from "./analyze";
import { collectWeek, type CollectOptions } from "./collect";
import type { Snapshot } from "./model";
import { renderHtml, renderSubject, renderText } from "./render";
import {
  bumpAttempt,
  claimSend,
  freezeEmail,
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
 * email James one page. Idempotent per week:
 *
 * 1. The week's numbers are gathered and stored (until the email is made).
 * 2. One run claims the send (a 15-minute lease, so a dead run frees it).
 * 3. That run renders the email ONCE and stores it with the snapshot it
 *    came from; from then on the snapshot is frozen and every retry sends
 *    exactly those bytes.
 * 4. The Resend Idempotency-Key is per week and attempt: the same key
 *    after a "later" (Resend may have taken it), a new one after a server,
 *    invalid or fatal answer (it clearly didn't), as lib/news/resend.ts
 *    lays out.
 */

/** Weeks of history the digest compares against (and backfills). */
export const HISTORY_WEEKS = 4;

/** The backfill's share of the cron's 120 seconds; the rest waits a week. */
export const BACKFILL_BUDGET_MS = 40_000;

export type Live = Pick<CollectOptions, "sitemap" | "eventsListed">;

export const webUrl = (week: string) => `${SITE_URL}/admin/growth?week=${week}`;

/**
 * Fill in missing earlier weeks from what can still be worked out, newest
 * first (last week matters most), within a time budget: a week that
 * doesn't finish in time is left for later, never half-stored.
 */
export async function backfill(
  week: Week,
  o: { fetchImpl?: typeof fetch; budgetMs?: number } = {},
): Promise<string[]> {
  const deadline = Date.now() + (o.budgetMs ?? BACKFILL_BUDGET_MS);
  const before = weeksBefore(week, HISTORY_WEEKS).reverse();
  const have = new Set(
    (await loadSnapshots(before.map((w) => w.start))).map((s) => s.weekStart),
  );
  const made: string[] = [];
  for (const w of before) {
    if (have.has(w.start)) continue;
    const left = deadline - Date.now();
    if (left <= 0) break;
    const snap = await Promise.race([
      collectWeek(w, { live: false, fetchImpl: o.fetchImpl }),
      new Promise<null>((r) => setTimeout(() => r(null), left)),
    ]);
    if (!snap) break;
    await insertBackfill(snap);
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

export const idempotencyKey = (week: string, attempt: number) =>
  `growth-digest-${week}-a${attempt}`;

export async function runDigest(
  now: Date,
  live: Live,
  o: { fetchImpl?: typeof fetch; ignoreGate?: boolean; budgetMs?: number } = {},
): Promise<DigestResult> {
  const gate = sendGate(now);
  if (!gate.open && !o.ignoreGate) return { action: "skipped", why: gate.why };
  const week = lastFullWeek(now);
  const existing = await snapshotRow(week.start);
  if (existing?.emailSentAt)
    return { action: "skipped", why: `already sent for ${week.start}` };

  // Gather only while the email hasn't been made (a made one is frozen).
  let snap: Snapshot | null = null;
  if (!existing?.renderedAt) {
    snap = await collectWeek(week, {
      live: true,
      fetchImpl: o.fetchImpl,
      ...live,
    });
    await saveSnapshot(snap);
  }
  if (!(await claimSend(week.start)))
    return { action: "skipped", why: "another run is sending this week" };

  let backfilled: string[] = [];
  let frozen: Awaited<ReturnType<typeof freezeEmail>>;
  try {
    if (snap) {
      backfilled = await backfill(week, o).catch((e) => {
        console.error("[growth] backfill failed", (e as Error)?.message);
        return [] as string[];
      });
      const { view } = await viewFor(snap);
      const url = webUrl(week.start);
      frozen = await freezeEmail(snap, {
        subject: renderSubject(view),
        html: renderHtml(view, { webUrl: url }),
        text: renderText(view, { webUrl: url }),
      });
    } else frozen = await freezeEmail(storedSnapshot(existing!), blank);
  } catch (e) {
    await releaseClaim(week.start);
    throw e;
  }

  const res = await sendOne(
    {
      from: ALERT_FROM,
      to: digestRecipients(process.env.GROWTH_DIGEST_TO ?? "", alertEmail()),
      subject: frozen.email.subject,
      html: frozen.email.html,
      text: frozen.email.text,
    },
    idempotencyKey(week.start, frozen.attempt),
  );
  // "accepted": Resend already took this key (an earlier run that died
  // before recording it). That's sent.
  if (res.ok || res.outcome === "accepted") {
    await markSent(week.start, res.ok ? (res.ids[0] ?? null) : null);
    return { action: "sent", week: week.start, backfilled };
  }
  if (res.outcome !== "later") await bumpAttempt(week.start);
  await releaseClaim(week.start);
  alertLater({
    key: "error:growth-digest",
    subject:
      res.outcome === "later"
        ? "The Monday growth digest may not have sent"
        : "The Monday growth digest didn't send",
    text:
      res.outcome === "later"
        ? `Resend didn't answer clearly (${res.status}, ${res.error}), so the digest may or may not have gone. The next run (every 30 minutes until 9:00 Pacific) retries with the same key, which Resend sends at most once.`
        : `Resend answered ${res.status} (${res.error}). The next run (every 30 minutes until 9:00 Pacific) tries again with a new key. Check the Vercel logs for [growth].`,
    everyMinutes: 6 * 60,
  });
  return { action: "failed", week: week.start, why: res.error };
}

/** An empty email: freezeEmail keeps the stored one when there is one. */
const blank = { subject: "", html: "", text: "" };

function storedSnapshot(
  r: NonNullable<Awaited<ReturnType<typeof snapshotRow>>>,
): Snapshot {
  return {
    weekStart: r.weekStart,
    metrics: r.metrics ?? {},
    details: (r.details ?? {}) as Snapshot["details"],
    backfilled: r.backfilled,
  };
}
