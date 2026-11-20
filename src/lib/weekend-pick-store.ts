import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contactConsents,
  explorers,
  newsIssues,
  newsSettings,
  parks,
  smsOptOuts,
  smsProgramSends,
} from "@/db/schema";
import { alertLater } from "./alerts";
import { IssueSchema } from "./news/issue";
import { addDays, pacific } from "./news/time";
import { fetchForecast, labelPeriod } from "./news/weather";
import {
  confirmedForTexts,
  sendingEnabled,
  sendProgramText,
  sendText,
} from "./texts-store";
import {
  beforeWindow,
  dryRunText,
  guardrailTrips,
  hookFor,
  MONTHLY_CAP,
  SITE,
  stopRate,
  weekendText,
  windowMissed,
  windowOpen,
} from "./weekend-pick";

/**
 * The Friday Weekend Pick sender (Vercel cron every 15 minutes, gated in
 * code). One text per opted-in, confirmed number, from the week's SENT
 * issue's featured park. No sent issue, no text. Each (issue, number) is
 * claimed in sms_program_sends before the text goes (the idempotency
 * key), so a retry or an overlapping run never texts anyone twice.
 */

export type PickResult = {
  action: "idle" | "paused" | "skipped" | "sent" | "partial" | "dry_run";
  why: string;
  counts?: { sent: number; failed: number; skipped: number; waiting: number };
};

/** Stop starting new sends after this long (the route has 300 s). */
const BUDGET_MS = 240_000;

async function settings() {
  await db.insert(newsSettings).values({ id: 1 }).onConflictDoNothing();
  const [s] = await db
    .select({
      paused: newsSettings.textsPaused,
      dryRun: newsSettings.textsDryRun,
      clearedAt: newsSettings.textsGuardrailClearedAt,
    })
    .from(newsSettings)
    .where(eq(newsSettings.id, 1));
  return s;
}

async function takeLease(owner: string): Promise<boolean> {
  const got = await db
    .update(newsSettings)
    .set({
      textsLockUntil: sql`now() + interval '10 minutes'`,
      textsLockOwner: owner,
    })
    .where(
      and(
        eq(newsSettings.id, 1),
        sql`(${newsSettings.textsLockUntil} is null or ${newsSettings.textsLockUntil} < now())`,
      ),
    )
    .returning({ id: newsSettings.id });
  return got.length > 0;
}

async function releaseLease(owner: string) {
  await db
    .update(newsSettings)
    .set({ textsLockUntil: null, textsLockOwner: null })
    .where(and(eq(newsSettings.id, 1), eq(newsSettings.textsLockOwner, owner)));
}

/** The issue that went out this week (the Thursday before), or null. */
async function sentIssueFor(friday: string) {
  const thursday = addDays(friday, -1);
  const [r] = await db
    .select({ body: newsIssues.sentBody, status: newsIssues.status })
    .from(newsIssues)
    .where(eq(newsIssues.issueDate, thursday));
  if (!r || r.status !== "sent") return null;
  const body = IssueSchema.safeParse(r.body);
  return body.success ? { date: thursday, issue: body.data } : null;
}

/**
 * Dry run only, before any issue has gone out: the latest validated draft
 * for this week, else the latest validated draft of any date. Its text is
 * keyed to this week's Thursday, so a dry run never claims another week.
 */
async function draftIssueFor(friday: string) {
  const thursday = addDays(friday, -1);
  const rows = await db
    .select({ date: newsIssues.issueDate, body: newsIssues.body })
    .from(newsIssues)
    .where(
      and(
        eq(newsIssues.status, "draft"),
        sql`${newsIssues.report}->>'ok' = 'true'`,
      ),
    )
    .orderBy(
      sql`(${newsIssues.issueDate} = ${thursday}) desc`,
      desc(newsIssues.issueDate),
      desc(newsIssues.updatedAt),
    );
  for (const r of rows) {
    const body = IssueSchema.safeParse(r.body);
    if (body.success) return { date: thursday, issue: body.data };
  }
  return null;
}

/**
 * Saturday's fresh forecast for the park's town (Bend when NWS has none
 * for it), or null.
 */
async function freshSaturday(saturday: string, town: string) {
  const f = await fetchForecast().catch(() => ({}) as Record<string, never>);
  const all = f as Record<string, Parameters<typeof labelPeriod>[0][]>;
  const periods = all[town] ?? all.Bend;
  const p = periods?.find(
    (x) => x.isDaytime && x.startTime.slice(0, 10) === saturday,
  );
  if (!p) return null;
  return { short: p.shortForecast, labels: labelPeriod(p) };
}

/** Does the park page answer 200? Checked in production only. */
async function linkOk(url: string): Promise<boolean> {
  if (process.env.VERCEL_ENV !== "production") return true;
  try {
    const r = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

/** The week's text, or null with why (closed park, nothing fits...). */
export async function weekText(
  friday: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ issueDate: string; text: string } | { why: string }> {
  // A real run needs the sent issue; a dry run may test on a draft.
  const sent =
    (await sentIssueFor(friday)) ??
    (dryRun ? await draftIssueFor(friday) : null);
  if (!sent)
    return {
      why: dryRun
        ? "No issue went out this week and there's no validated draft, so no dry-run text."
        : "No issue went out this week, so no text.",
    };
  const slug = sent.issue.wheel_pick.park;
  const [park] = await db
    .select({
      id: parks.id,
      name: parks.name,
      city: parks.city,
      slug: parks.slug,
      features: parks.features,
      status: parks.status,
    })
    .from(parks)
    .where(and(eq(parks.slug, slug), isNotNull(parks.approvedAt)));
  if (!park) return { why: `The featured park ${slug} isn't on the map.` };
  const saturday = addDays(friday, 1);
  const issueSat =
    sent.issue.weekend_ahead?.days?.find((d) => d.date === saturday) ?? null;
  const hook = hookFor(issueSat, await freshSaturday(saturday, park.city));
  const text = weekendText(park, hook, Number(friday.slice(5, 7)));
  if (!text)
    return {
      why: `No text fits for ${park.name}, this week's featured park (closed, or no kid-fit words fit in 160 characters).`,
    };
  // The final page the short link lands on, not /w/ itself (a 302).
  const url = `${SITE}/parks/${park.slug}`;
  if (!(await linkOk(url)))
    return { why: `The park page ${url} didn't answer 200.` };
  return { issueDate: sent.date, text };
}

/** Numbers that are on and have had their confirmation text. */
async function audience(): Promise<string[]> {
  const rows = await db.execute<{ address: string }>(sql`
    select address from (
      select distinct on (address) address, action
      from ${contactConsents}
      where channel = 'sms' and action in ('opt_in', 'opt_out')
      order by address, id desc
    ) last
    where action = 'opt_in'
      and not exists (select 1 from ${smsOptOuts} o where o.phone = last.address)`);
  const out: string[] = [];
  for (const r of rows)
    if (await confirmedForTexts(r.address)) out.push(r.address);
  return out;
}

/** Admins' own numbers, minus any on the STOP list: the dry run's only recipients. */
async function adminNumbers(): Promise<string[]> {
  const rows = await db
    .select({ phone: explorers.phone })
    .from(explorers)
    .where(
      and(
        eq(explorers.isAdmin, true),
        isNotNull(explorers.phone),
        sql`not exists (select 1 from ${smsOptOuts} o where o.phone = ${explorers.phone})`,
      ),
    );
  return rows.map((r) => r.phone!);
}

/** Weekend Picks this number got this calendar month (Pacific). */
async function sentThisMonth(phone: string, friday: string): Promise<number> {
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(smsProgramSends)
    .where(
      and(
        eq(smsProgramSends.phone, phone),
        eq(smsProgramSends.status, "sent"),
        sql`to_char(${smsProgramSends.issueDate}, 'YYYY-MM') = ${friday.slice(0, 7)}`,
      ),
    );
  return c.n;
}

/** Opt-outs that aren't a person saying no (for the guardrail). */
const NOT_A_STOP = [
  "number_changed",
  "account_deleted",
  "confirmation_failed",
  "undeliverable",
];

/**
 * STOP rates of the last completed sends (newest first): any opt-out by
 * their numbers in the 3 days after each send (STOP, a stop in words,
 * "Stop texts" in settings, a STOP only Twilio heard), over the numbers
 * reached. Only sends after `since` (an admin turning texts back on).
 */
export async function recentStopRates(
  before: string,
  since: Date | null = null,
): Promise<number[]> {
  const after = since
    ? sql`and ${smsProgramSends.sentAt} > ${since.toISOString()}`
    : sql``;
  const weeks = await db.execute<{ d: string }>(sql`
    select distinct ${smsProgramSends.issueDate} as d
    from ${smsProgramSends}
    where ${smsProgramSends.status} = 'sent'
      and ${smsProgramSends.issueDate} < ${before} ${after}
    order by d desc
    limit 2`);
  const rates: number[] = [];
  for (const { d } of weeks) {
    const [r] = await db.execute<{ sent: number; stops: number }>(sql`
      select count(*)::int as sent,
        count(*) filter (where exists (
          select 1 from ${contactConsents} c
          where c.channel = 'sms' and c.action = 'opt_out'
            and c.address = s.phone
            and c.source not in (${sql.join(
              NOT_A_STOP.map((x) => sql`${x}`),
              sql`, `,
            )})
            and c.created_at >= s.sent_at
            and c.created_at < s.sent_at + interval '3 days'
        ))::int as stops
      from ${smsProgramSends} s
      where s.issue_date = ${d} and s.status = 'sent' ${since ? sql`and s.sent_at > ${since.toISOString()}` : sql``}`);
    rates.push(stopRate(r.sent, r.stops));
  }
  return rates;
}

/**
 * One run: Friday, 3:30 pm to 5 pm Pacific, at most 5 a month, never
 * twice a week. Before 3:30 it does nothing; from 5 pm it marks whoever
 * is left as skipped.
 */
export async function runWeekendPick(
  now = new Date(),
  opts: { budgetMs?: number } = {},
): Promise<PickResult> {
  const p = pacific(now);
  if (p.weekday !== 5)
    return { action: "idle", why: "Not Friday in Pacific time." };
  if (beforeWindow(now))
    return { action: "idle", why: "Before 3:30 pm Pacific." };
  const s = await settings();
  if (s.paused)
    return { action: "paused", why: "The Weekend Pick kill switch is on." };
  // Off means off: a real run never "logs" sends that count as sent.
  if (!s.dryRun && !sendingEnabled())
    return {
      action: "paused",
      why: "Sending is off (TEXTS_SENDING_ENABLED), and dry run is off.",
    };
  const owner = randomUUID();
  if (!(await takeLease(owner)))
    return { action: "idle", why: "Another run has the lease." };
  try {
    return await run(p.date, now, s, opts.budgetMs ?? BUDGET_MS);
  } finally {
    await releaseLease(owner);
  }
}

/** Re-read the kill switch every this many numbers. */
const RECHECK_EVERY = 25;

async function run(
  friday: string,
  now: Date,
  s: Awaited<ReturnType<typeof settings>>,
  budgetMs: number,
): Promise<PickResult> {
  const { dryRun } = s;
  const started = Date.now();
  /** The run's clock: `now`, moving with real time. */
  const clock = () => new Date(now.getTime() + (Date.now() - started));
  // The guardrail: two sends in a row above 1% STOP pause the texts.
  const rates = await recentStopRates(addDays(friday, -1), s.clearedAt);
  if (guardrailTrips(rates)) {
    await db
      .update(newsSettings)
      .set({
        textsPaused: true,
        textsPausedReason: `STOP rate ${rates.map((r) => `${(r * 100).toFixed(1)}%`).join(" and ")} on the last two sends.`,
      })
      .where(eq(newsSettings.id, 1));
    alertLater({
      key: `texts:guardrail:${friday}`,
      subject: "Weekend Pick paused: STOP rate over 1% twice",
      text: `The last two Weekend Picks had STOP rates of ${rates.map((r) => `${(r * 100).toFixed(1)}%`).join(" and ")}, so texts are paused (news_settings.texts_paused). Look at the texts before turning them back on in /admin.`,
      everyMinutes: 7 * 24 * 60,
    });
    return { action: "paused", why: "STOP-rate guardrail tripped." };
  }
  const week = await weekText(friday, { dryRun });
  if ("why" in week) {
    alertLater({
      key: `texts:skip:${friday}`,
      subject: "No Weekend Pick this week",
      text: week.why,
      everyMinutes: 7 * 24 * 60,
    });
    return { action: "skipped", why: week.why };
  }
  const numbers = dryRun ? await adminNumbers() : await audience();
  if (dryRun && !numbers.length) {
    console.info(`[texts] dry run, no admin number; the text: ${week.text}`);
  }
  const done = await db
    .select({ phone: smsProgramSends.phone })
    .from(smsProgramSends)
    .where(
      and(
        eq(smsProgramSends.issueDate, week.issueDate),
        inArray(smsProgramSends.phone, numbers.length ? numbers : [""]),
      ),
    );
  const seen = new Set(done.map((d) => d.phone));
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let waiting = 0;
  let stopped = false;
  let i = 0;
  for (const phone of numbers) {
    if (seen.has(phone)) continue;
    if (stopped || Date.now() - started > budgetMs) {
      waiting++;
      continue;
    }
    // The kill switch, mid-send.
    if (++i % RECHECK_EVERY === 0 && (await settings()).paused) {
      stopped = true;
      waiting++;
      continue;
    }
    const at = clock();
    const mark = (status: "skipped", reason: string) =>
      db
        .insert(smsProgramSends)
        .values({ issueDate: week.issueDate, phone, status, reason })
        .onConflictDoNothing();
    if (windowMissed(at)) {
      await mark("skipped", "missed the 5 pm Friday window");
      skipped++;
      continue;
    }
    if (!windowOpen(at)) {
      waiting++;
      continue;
    }
    if (!dryRun && (await sentThisMonth(phone, friday)) >= MONTHLY_CAP) {
      await mark("skipped", "five this month already");
      skipped++;
      continue;
    }
    // The idempotency key: claim (issue, number) before the text goes.
    const claimed = await db
      .insert(smsProgramSends)
      .values({
        issueDate: week.issueDate,
        phone,
        status: "sending",
        body: week.text,
      })
      .onConflictDoNothing()
      .returning({ id: smsProgramSends.id });
    if (!claimed.length) continue;
    const r = dryRun
      ? await sendText(phone, dryRunText(week.text), {
          enabled: sendingEnabled(),
        })
      : await sendProgramText(phone, week.text);
    const status = !r.ok
      ? "failed"
      : r.logged
        ? "logged"
        : dryRun
          ? "dry_run"
          : "sent";
    await db
      .update(smsProgramSends)
      .set({
        status,
        twilioSid: r.ok ? (r.sid ?? null) : null,
        reason: r.ok ? (r.logged ? "logged (sending off)" : null) : r.why,
        errorCode: r.ok ? null : (r.code ?? null),
        sentAt: r.ok && !r.logged ? sql`now()` : null,
      })
      .where(eq(smsProgramSends.id, claimed[0].id));
    if (r.ok) sent++;
    else failed++;
  }
  const counts = { sent, failed, skipped, waiting };
  if (failed)
    alertLater({
      key: `texts:failed:${week.issueDate}`,
      subject: `Weekend Pick: ${failed} text(s) failed`,
      text: `This week's Weekend Pick failed for ${failed} number(s). They won't be retried this week. Check Twilio's message logs.`,
      everyMinutes: 60,
    });
  if (stopped)
    return {
      action: "paused",
      why: `The kill switch went on mid-send: ${sent} sent, ${waiting} not sent.`,
      counts,
    };
  if (!waiting && (sent || skipped || failed)) {
    // Rows a killed run left in "sending" (never retried: at most once).
    const [stuck] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(smsProgramSends)
      .where(
        and(
          eq(smsProgramSends.issueDate, week.issueDate),
          eq(smsProgramSends.status, "sending"),
        ),
      );
    alertLater({
      key: `texts:done:${week.issueDate}`,
      subject: dryRun ? "Weekend Pick dry run done" : "Weekend Pick sent",
      text: `${dryRun ? "Dry run (admins only). " : ""}${sent} sent, ${failed} failed, ${skipped} skipped this run.${stuck.n ? ` ${stuck.n} stuck mid-send (status "sending"): they may or may not have gone; check Twilio's logs.` : ""}${dryRun && !sendingEnabled() ? " Sending is off (TEXTS_SENDING_ENABLED), so these were only logged." : ""}\n\n${week.text}`,
      everyMinutes: 24 * 60,
    });
  }
  return {
    action: dryRun ? "dry_run" : waiting ? "partial" : sent ? "sent" : "idle",
    why: `${sent} sent, ${failed} failed, ${skipped} skipped, ${waiting} waiting.`,
    counts,
  };
}
