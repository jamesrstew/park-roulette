import "server-only";
import { pingIndexNow } from "@/lib/indexnow";
import { draftImageKey } from "./image-key";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  emailConfirmations,
  newsIssues,
  newsChunkState,
  newsSends,
  webhookEvents,
} from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import { SITE_URL } from "@/lib/site";
import { audienceCount, chunkRecipients, snapshotAudience } from "./audience";
import { CATALOG } from "./catalog";
import { type ChunkStore, MAX_ATTEMPTS, processChunks } from "./chunks";
import { purgePending, purgeStopped } from "./subscribers";
import { pruneTextConsents, sendPendingConfirmations } from "@/lib/texts-store";
import {
  beat,
  getNewsSettings,
  loadParks,
  renewLease,
  releaseLease,
  takeLease,
  validateContext,
  wentOutCount,
} from "./data";
import { type Issue, IssueSchema } from "./issue";
import {
  NEWS_FROM,
  NEWS_REPLY_TO,
  type OutEmail,
  sendBatch,
  sendOne,
} from "./resend";
import {
  NEWS_NAME,
  postImageUrl,
  renderHtml,
  renderText,
  weatherImageUrl,
} from "./template";
import { addDays, pacific, pacificInstant, sendGate } from "./time";
import { type ValidationReport, validateIssue } from "./validate";

/**
 * The Thursday sender (/api/cron/news-send, every 15 minutes, 14:00 to
 * 19:45 UTC). One gate, at send time: it re-validates the draft (links and
 * evidence fetched again), renders it once, snapshots the audience and
 * sends in resumable chunks. New sends only start 7:00 to 9:00 Pacific;
 * the later runs only finish a send already under way. A bad issue is
 * skipped, never sent.
 */

const UNSUB = "__UNSUB_TOKEN__";

export type SenderResult = {
  action: "idle" | "skipped" | "dry_run" | "sent" | "partial" | "failed";
  why: string;
  counts?: { sent: number; skipped: number; failed: number; pending: number };
};

const idle = (why: string): SenderResult => ({ action: "idle", why });

/**
 * What the email looks like, frozen at snapshot time, with which images
 * answered (the archive shows the same ones).
 */
export type Rendered = {
  subject: string;
  html: string;
  text: string;
  images?: { weatherImage: boolean; memeImage: boolean };
};

export async function runNewsSend(now = new Date()): Promise<SenderResult> {
  await beat();
  const gate = sendGate(now);
  if (!gate.thursday) return idle("Not Thursday in Pacific time.");
  // A 10-minute lease in news_settings, renewed between chunks: one run at
  // a time, and a run that dies frees it on its own.
  const owner = randomUUID();
  if (!(await takeLease(owner))) {
    if (gate.lastChance)
      alertLater({
        key: `news:lock:${gate.date}`,
        subject: `${NEWS_NAME} sender is stuck`,
        text: `At ${gate.canStart ? "8:45" : "9:00 or later"} Pacific another run still holds the sender's lease. If nothing has started, this week may be skipped. Check /admin and the Vercel logs for [news].`,
        everyMinutes: 12 * 60,
      });
    return idle("Another run holds the lease.");
  }
  try {
    return await step(now, gate, owner);
  } finally {
    await releaseLease(owner);
  }
}

type Row = typeof newsIssues.$inferSelect;

async function issueRow(date: string): Promise<Row | undefined> {
  const [r] = await db
    .select()
    .from(newsIssues)
    .where(eq(newsIssues.issueDate, date));
  return r;
}

async function step(
  now: Date,
  gate: ReturnType<typeof sendGate>,
  owner: string,
): Promise<SenderResult> {
  await closeStaleSends(gate.date);
  const issue = await issueRow(gate.date);
  if (issue && issue.status !== "draft")
    return idle(`This week's issue is already ${issue.status}.`);
  // Started: always finish, whatever the time (9:00 only limits starting).
  if (issue?.sendStartedAt) return resume(issue, owner);

  const holiday = CATALOG.skip_dates.find((d) => d.date === gate.date);
  if (holiday)
    return skip(gate.date, `No issue this week (${holiday.reason}).`);
  if (gate.tooEarly) return idle("Before 7:00 Pacific.");
  const settings = await getNewsSettings();
  if (settings.dryRun && issue?.dryRunAt)
    return idle("The dry run already went out.");
  // Past the last start with nothing started or skipped: record the skip
  // (and the alert says why).
  if (!gate.canStart)
    return skip(gate.date, "Nothing was ready to send by 9:00 Pacific.");
  const last = gate.lastChance;
  if (settings.paused)
    return last
      ? skip(gate.date, "The kill switch is on (/admin).")
      : idle("Paused by the kill switch.");
  if (!issue?.body)
    return last
      ? skip(gate.date, "No draft arrived from the writer.")
      : idle("No draft yet.");

  let report: ValidationReport;
  try {
    // Reuse the card the draft stored: what was checked is what goes out.
    const drafted = (issue.report as ValidationReport | null)?.issue?.meme
      ?.snapshot;
    report = await validateIssue(
      issue.body,
      await validateContext(gate.date, {
        network: true,
        now,
        cards: drafted?.card
          ? {
              mode: "reuse",
              card: drafted.card,
              kind: drafted.kind,
              id: drafted.id,
            }
          : { mode: "store" },
      }),
    );
  } catch (e) {
    console.error("[news] validation threw", (e as Error)?.message);
    return last
      ? skip(
          gate.date,
          `The checks crashed: ${(e as Error)?.name ?? "error"}. Nothing was sent.`,
        )
      : idle("The checks crashed; trying again in 15 minutes.");
  }
  await db
    .update(newsIssues)
    .set({ report, updatedAt: sql`now()` })
    .where(eq(newsIssues.id, issue.id));
  if (!report.ok || !report.issue)
    return last
      ? skip(gate.date, `The draft didn't pass the checks:\n${reasons(report)}`)
      : idle("The draft didn't pass; trying again in 15 minutes.");

  const body = report.issue;
  const number = (await wentOutCount(gate.date)) + 1;
  // The weather card is served from the report we just saved; check it
  // answers before an email points at it (without it, the words still show).
  const [weatherImage, memeImage] = await Promise.all([
    imageAnswers(weatherImageUrl(SITE_URL, body, draftImageKey(gate.date))),
    // Parents' corner is image only: no image, no section.
    imageAnswers(postImageUrl(SITE_URL, body, draftImageKey(gate.date))),
  ]);
  const images = { weatherImage, memeImage };

  if (settings.dryRun) return dryRun(issue, render(body, number, true, images));

  if (!process.env.RESEND_API_KEY || !process.env.NEWS_POSTAL_ADDRESS) {
    const why =
      "RESEND_API_KEY or NEWS_POSTAL_ADDRESS isn't set, so a live send can't go out.";
    return last ? skip(gate.date, why) : idle(why);
  }
  if ((await audienceCount()) === 0)
    return skip(
      gate.date,
      "Nobody has confirmed their email yet, so there was no one to send to.",
      `${NEWS_NAME} had no one to send to`,
    );
  const started = await snapshot(
    issue.id,
    body,
    render(body, number, false, images),
  );
  if (!started) return idle("Another run started this send.");
  return resume((await issueRow(gate.date))!, owner);
}

function reasons(r: ValidationReport): string {
  return r.errors.map((e) => `- ${e.path}: ${e.message}`).join("\n");
}

async function imageAnswers(url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    await res.body?.cancel();
    return (
      res.status === 200 &&
      (res.headers.get("content-type") ?? "").startsWith("image/")
    );
  } catch {
    return false;
  }
}

/** Mark the week skipped (making the row if the writer never posted). */
async function skip(
  date: string,
  why: string,
  subject = `${NEWS_NAME} skipped this week`,
): Promise<SenderResult> {
  await db
    .insert(newsIssues)
    .values({ issueDate: date, status: "skipped", skipReason: why })
    .onConflictDoUpdate({
      target: newsIssues.issueDate,
      set: { status: "skipped", skipReason: why, updatedAt: sql`now()` },
      setWhere: sql`${newsIssues.status} = 'draft' and ${newsIssues.sendStartedAt} is null`,
    });
  console.info(`[news] ${date} skipped: ${why.split("\n")[0]}`);
  alertLater({
    key: `news:skip:${date}`,
    subject,
    text: `The ${date} issue was skipped. Nothing went to readers.\n\n${why}`,
    everyMinutes: 24 * 60,
  });
  return { action: "skipped", why };
}

/** Render once: subject, HTML and text, with a placeholder for each reader's token. */
function render(
  body: Issue,
  number: number,
  dryRun: boolean,
  images: { weatherImage: boolean; memeImage: boolean },
  parks?: Map<string, { name: string; city: string }>,
): Promise<Rendered> {
  return (async () => {
    const names =
      parks ??
      new Map(
        (await loadParks()).map((p) => [
          p.slug,
          { name: p.name, city: p.city },
        ]),
      );
    const o = {
      catalog: CATALOG,
      site: SITE_URL,
      number,
      park: (slug: string) => names.get(slug),
      links: dryRun ? ("direct" as const) : ("track" as const),
      unsubscribeUrl: `${SITE_URL}/news/unsubscribe?t=${UNSUB}`,
      postalAddress:
        process.env.NEWS_POSTAL_ADDRESS ||
        (dryRun ? "[postal address goes here]" : null),
      dryRun,
      ...images,
      // The dry run goes out before the images are public: it carries the key.
      imageKey: dryRun ? draftImageKey(body.issue_date) : undefined,
    };
    return {
      subject: dryRun ? `[Dry run] ${body.subject}` : body.subject,
      html: renderHtml(body, o),
      text: renderText(body, o),
      images,
    };
  })();
}

/** The labeled shadow copy: only to ALERT_EMAIL, and the issue stays a draft. */
async function dryRun(
  issue: Row,
  rendered: Promise<Rendered>,
): Promise<SenderResult> {
  const to = process.env.ALERT_EMAIL || "hello@parkroulette.quest";
  const r = await sendOne(
    personalize(
      {
        ...(await rendered),
        from: NEWS_FROM(),
        to: [to],
        reply_to: NEWS_REPLY_TO(),
      },
      "dry-run",
    ),
    `news-${issue.id}-dry-${issue.updatedAt.getTime()}`,
  );
  if (!r.ok) {
    alertLater({
      key: `news:dry-run-failed:${issue.issueDate}`,
      subject: `${NEWS_NAME} dry run didn't send`,
      text: `Resend said ${r.status} ${r.error}. The sender tries again in 15 minutes.`,
    });
    return idle(`Dry run failed (${r.error}).`);
  }
  await db
    .update(newsIssues)
    .set({ dryRunAt: sql`now()` })
    .where(eq(newsIssues.id, issue.id));
  return {
    action: "dry_run",
    why: `Dry run sent to ALERT_EMAIL${r.ok && r.logged ? " (logged only: no RESEND_API_KEY)" : ""}.`,
  };
}

/** One reader's copy: their own unsubscribe link and one-click headers. */
function personalize(e: OutEmail, token: string): OutEmail {
  return {
    ...e,
    html: e.html.replaceAll(UNSUB, token),
    text: e.text.replaceAll(UNSUB, token),
    headers: {
      "List-Unsubscribe": `<${SITE_URL}/api/news/unsubscribe?t=${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/**
 * Claim the send, freeze what it says and how it looks, and snapshot the
 * audience. Returns false if another run got here first.
 */
async function snapshot(
  issueId: number,
  body: Issue,
  rendered: Promise<Rendered>,
): Promise<boolean> {
  const frozen = await rendered;
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(newsIssues)
      .set({
        sendStartedAt: sql`now()`,
        sentBody: body,
        rendered: frozen,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(newsIssues.id, issueId),
          sql`${newsIssues.sendStartedAt} is null`,
        ),
      )
      .returning({ id: newsIssues.id });
    if (!claimed.length) return false;
    await snapshotAudience(tx, issueId);
    return true;
  });
}

function dbStore(issueId: number, owner: string): ChunkStore {
  const inChunk = (chunk: number) =>
    and(eq(newsSends.issueId, issueId), eq(newsSends.chunk, chunk));
  const live = inArray(newsSends.status, ["queued", "sending"]);
  return {
    async pendingChunks() {
      const rows = await db
        .selectDistinct({ chunk: newsSends.chunk })
        .from(newsSends)
        .where(and(eq(newsSends.issueId, issueId), live))
        .orderBy(newsSends.chunk);
      return rows.map((r) => r.chunk);
    },
    recipients: (chunk) => chunkRecipients(issueId, chunk),
    async markSending(chunk) {
      await db
        .update(newsSends)
        .set({ status: "sending", attempts: sql`${newsSends.attempts} + 1` })
        .where(and(inChunk(chunk), live));
    },
    async markSkipped(ids) {
      await db
        .update(newsSends)
        .set({ status: "skipped" })
        .where(inArray(newsSends.id, ids));
    },
    async markSent(sent) {
      if (!sent.length) return;
      const values = sql.join(
        sent.map((x) => sql`(${x.sendId}::int, ${x.resendId}::text)`),
        sql`, `,
      );
      await db.execute(sql`
        update ${newsSends} s set status = 'sent', resend_id = v.rid, sent_at = now()
        from (values ${values}) as v(id, rid)
        where s.id = v.id`);
    },
    async markFailed(ids) {
      if (!ids.length) return;
      await db
        .update(newsSends)
        .set({ status: "failed" })
        .where(inArray(newsSends.id, ids));
    },
    async recordAttempt(chunk, keyAttempt, sendIds) {
      // First write wins: the readers a key went to never change.
      await db
        .insert(newsChunkState)
        .values({ issueId, chunk, attempts: { [keyAttempt]: sendIds } })
        .onConflictDoUpdate({
          target: [newsChunkState.issueId, newsChunkState.chunk],
          set: {
            attempts: sql`case when ${newsChunkState.attempts} ? ${String(keyAttempt)} then ${newsChunkState.attempts} else ${newsChunkState.attempts} || ${JSON.stringify({ [keyAttempt]: sendIds })}::jsonb end`,
          },
        });
    },
    async markOneByOne(chunk) {
      await db
        .insert(newsChunkState)
        .values({ issueId, chunk, oneByOne: true })
        .onConflictDoUpdate({
          target: [newsChunkState.issueId, newsChunkState.chunk],
          set: { oneByOne: true },
        });
    },
    async retrySends(ids) {
      if (!ids.length) return;
      await db
        .update(newsSends)
        .set({
          status: sql`case when ${newsSends.attempts} >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end`,
        })
        .where(
          and(inArray(newsSends.id, ids), eq(newsSends.status, "sending")),
        );
    },
    async retryChunk(chunk, newKey) {
      await db
        .update(newsSends)
        .set({
          status: sql`case when ${newsSends.attempts} >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end`,
          ...(newKey ? { keyAttempt: sql`${newsSends.keyAttempt} + 1` } : {}),
        })
        .where(and(inChunk(chunk), eq(newsSends.status, "sending")));
    },
    async keepGoing() {
      if ((await getNewsSettings()).paused) return false;
      return renewLease(owner);
    },
  };
}

async function counts(issueId: number) {
  const [c] = await db
    .select({
      sent: sql<number>`count(*) filter (where status = 'sent')::int`,
      skipped: sql<number>`count(*) filter (where status = 'skipped')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      pending: sql<number>`count(*) filter (where status in ('queued', 'sending'))::int`,
    })
    .from(newsSends)
    .where(eq(newsSends.issueId, issueId));
  return c;
}

/** Send whatever is still queued for a started issue, then close it out. */
async function resume(issue: Row, owner: string): Promise<SenderResult> {
  const body = IssueSchema.parse(issue.sentBody);
  // The exact email frozen at snapshot time: every retry sends the same
  // bytes, so Resend's idempotency check sees the same request.
  const frozen =
    (issue.rendered as Rendered | null) ??
    (await render(body, (await wentOutCount(issue.issueDate)) + 1, false, {
      weatherImage: false,
      memeImage: false,
    }));
  const base: OutEmail = {
    ...frozen,
    from: NEWS_FROM(),
    to: [],
    reply_to: NEWS_REPLY_TO(),
  };
  const run = await processChunks({
    issueId: issue.id,
    store: dbStore(issue.id, owner),
    sendBatch: (emails, key) => sendBatch(emails, key),
    sendOne: (email, key) => sendOne(email, key),
    build: (r) => personalize({ ...base, to: [r.email] }, r.token),
    pause: () => new Promise((r) => setTimeout(r, 600)),
  });
  const c = await counts(issue.id);
  const tally = `${c.sent} sent, ${c.skipped} skipped (stopped before their turn), ${c.failed} failed, ${c.pending} still queued.`;
  const notes = run.outcomes
    .filter((x) => x.outcome !== "sent" && x.outcome !== "empty")
    .map(
      (x) =>
        `- chunk ${x.chunk}: ${x.outcome}${x.detail ? ` (${x.detail})` : ""}`,
    )
    .join("\n");
  const details = `${tally}${notes ? `\n\n${notes}` : ""}`;
  if (c.pending > 0) {
    alertLater({
      key: `news:partial:${issue.issueDate}`,
      subject: `${NEWS_NAME} is partway sent`,
      text: `The ${issue.issueDate} issue is partway out. The next run (every 15 minutes) picks up the rest.${run.stoppedEarly ? " It stopped early (the kill switch, or Resend asked us to slow down)." : ""}\n\n${details}`,
      everyMinutes: 60,
    });
    return { action: "partial", why: tally, counts: c };
  }
  return finish(issue, body.subject, c, details);
}

/**
 * Close a send. It counts as sent only if at least one email went out;
 * otherwise it's failed (or skipped, when there was nobody to send to).
 */
async function finish(
  issue: Pick<Row, "id" | "issueDate">,
  subject: string,
  c: Awaited<ReturnType<typeof counts>>,
  details: string,
): Promise<SenderResult> {
  const total = c.sent + c.skipped + c.failed;
  const status = c.sent > 0 ? "sent" : total === 0 ? "skipped" : "failed";
  await db
    .update(newsIssues)
    .set({
      status,
      sentAt: status === "sent" ? sql`now()` : null,
      skipReason:
        status === "skipped"
          ? "Nobody was left to send to when the send started."
          : status === "failed"
            ? "Not one email went out."
            : null,
      updatedAt: sql`now()`,
    })
    .where(eq(newsIssues.id, issue.id));
  alertLater({
    key: `news:done:${issue.issueDate}`,
    subject:
      status === "sent"
        ? c.failed
          ? `${NEWS_NAME} sent, with failures`
          : `${NEWS_NAME} sent`
        : status === "skipped"
          ? `${NEWS_NAME} had no one to send to`
          : `${NEWS_NAME} FAILED: not one email went out`,
    text: `The ${issue.issueDate} issue ("${subject}"). ${details}`,
    everyMinutes: 24 * 60,
  });
  // The archive page is public now: tell IndexNow engines today.
  if (status === "sent")
    await pingIndexNow([
      `${SITE_URL}/newsletter/${issue.issueDate}`,
      `${SITE_URL}/newsletter`,
    ]);
  return {
    action:
      status === "sent"
        ? c.failed
          ? "partial"
          : "sent"
        : status === "skipped"
          ? "skipped"
          : "failed",
    why: details.split("\n")[0],
    counts: c,
  };
}

/**
 * An earlier week's send that never finished (Resend down all morning):
 * stale weekend dates can't go out now, so close it and say so.
 */
async function closeStaleSends(today: string) {
  const stale = await db
    .select({
      id: newsIssues.id,
      issueDate: newsIssues.issueDate,
      subject: sql<string>`${newsIssues.sentBody}->>'subject'`,
    })
    .from(newsIssues)
    .where(
      and(
        eq(newsIssues.status, "draft"),
        sql`${newsIssues.sendStartedAt} is not null`,
        lt(newsIssues.issueDate, today),
      ),
    );
  for (const s of stale) {
    await db
      .update(newsSends)
      .set({ status: "failed" })
      .where(
        and(
          eq(newsSends.issueId, s.id),
          inArray(newsSends.status, ["queued", "sending"]),
        ),
      );
    const c = await counts(s.id);
    await finish(
      s,
      s.subject,
      c,
      `It never finished sending, so it was closed so it can't go out late. ${c.sent} got it; ${c.failed} never did.`,
    );
  }
}

// --- Daily cleanup's part ------------------------------------------------

/**
 * Called by the daily cleanup cron: alert if the last Thursday's sender
 * never ran (Vercel cron off, a deploy broke the route), and delete old
 * send logs, webhook ids and confirmation records (as Privacy promises).
 */
export async function newsDailyChecks(now = new Date()) {
  const p = pacific(now);
  let thursday = addDays(p.date, -((p.weekday - 4 + 7) % 7));
  // The sender runs until 12:45 Pacific (summer); judge after that.
  if (now < pacificInstant(thursday, 13)) thursday = addDays(thursday, -7);
  const s = await getNewsSettings();
  const since = pacificInstant(thursday, 6);
  if (s.updatedAt < since && (!s.heartbeatAt || s.heartbeatAt < since))
    alertLater({
      key: `news:heartbeat:${thursday}`,
      subject: `${NEWS_NAME} sender didn't run Thursday`,
      text: `The Thursday sender (/api/cron/news-send) never ran on ${thursday}. Check Vercel's cron list and logs for [news].`,
      everyMinutes: 7 * 24 * 60,
    });
  await db
    .delete(newsSends)
    .where(lt(newsSends.createdAt, sql`now() - interval '12 months'`));
  await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, sql`now() - interval '30 days'`));
  await db
    .delete(emailConfirmations)
    .where(lt(emailConfirmations.createdAt, sql`now() - interval '30 days'`));
  await pruneTextConsents();
  const purged = await purgePending();
  if (purged) console.info(`[news] deleted ${purged} unconfirmed sign-ups`);
  const stopped = await purgeStopped();
  if (stopped) console.info(`[news] deleted ${stopped} stops over 4 years old`);
  // Yeses taken while texting was off get their confirmation first.
  const confirmed = await sendPendingConfirmations();
  if (confirmed) console.info(`[texts] sent ${confirmed} held confirmations`);
}
