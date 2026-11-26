import "server-only";
import { sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { alertLog } from "@/db/schema";
import { SITE_URL } from "./site";

/**
 * Tell James when something needs a person: a report, a new park, a park
 * fix, sign-up caps, Twilio trouble, a burst of errors. Emails go to
 * ALERT_EMAIL (hello@parkroulette.quest) through Resend; with no
 * RESEND_API_KEY they only go to the server log.
 *
 * Throttled per key: the first one emails right away, repeats within the
 * window are counted and mentioned in the next email. Never put phone
 * numbers, review text or other personal details in an alert: link to
 * /admin instead.
 */

export type Alert = {
  /** Throttle key, e.g. "report:123" or "error:saveReview". */
  key: string;
  subject: string;
  /** Plain text. Short. No personal details. */
  text: string;
  /** Minimum minutes between emails for this key. */
  everyMinutes?: number;
};

const FROM = "Park Roulette <alerts@parkroulette.quest>";

/** Where James's emails go (alerts and the Monday growth digest). */
export const alertEmail = () =>
  process.env.ALERT_EMAIL || "hello@parkroulette.quest";
export const ALERT_FROM = FROM;

/** Send an alert after the response, so it never slows anyone down. */
export function alertLater(a: Alert): void {
  try {
    after(() => sendAlert(a));
  } catch {
    // Outside a request (scripts, tests): send now, don't wait.
    void sendAlert(a);
  }
}

/** Most alert emails in an hour, all kinds together (then one roll-up). */
const MAX_PER_HOUR = 15;

/** Per-server memory, used only when the database can't be reached. */
const memory = new Map<string, number>();

/**
 * What happened to one alert: emailed (or logged with no RESEND_API_KEY),
 * suppressed by its key's window or the hourly budget, or failed.
 */
export type AlertOutcome = "sent" | "suppressed" | "failed";

export async function sendAlert(a: Alert): Promise<AlertOutcome> {
  const every = a.everyMinutes ?? 60;
  let repeats = 0;
  try {
    // Claim the slot atomically: insert, or take it over if the window has
    // passed; otherwise just count the repeat.
    const rows = await db.execute<{ claimed: boolean; repeats: number }>(sql`
      with prev as (
        select suppressed from ${alertLog} where key = ${a.key}
      ), up as (
        insert into ${alertLog} (key, sent_at, suppressed)
        values (${a.key}, now(), 0)
        on conflict (key) do update set
          sent_at = case when ${alertLog.sentAt} < now() - make_interval(mins => ${every})
                         then now() else ${alertLog.sentAt} end,
          suppressed = case when ${alertLog.sentAt} < now() - make_interval(mins => ${every})
                            then 0 else ${alertLog.suppressed} + 1 end
        returning sent_at
      )
      select (up.sent_at = now()) as claimed,
             coalesce((select suppressed from prev), 0)::int as repeats
      from up`);
    if (!rows[0]?.claimed) return "suppressed";
    repeats = Number(rows[0].repeats);
    // One budget for every kind, so a bad deploy can't flood the inbox.
    const [g] = await db.execute<{ n: number }>(sql`
      insert into ${alertLog} (key, sent_at, suppressed)
      values ('_hour', now(), 1)
      on conflict (key) do update set
        sent_at = case when ${alertLog.sentAt} < now() - interval '1 hour'
                       then now() else ${alertLog.sentAt} end,
        suppressed = case when ${alertLog.sentAt} < now() - interval '1 hour'
                          then 1 else ${alertLog.suppressed} + 1 end
      returning suppressed as n`);
    if (Number(g?.n) > MAX_PER_HOUR) {
      // Over the hour's budget: give this key its slot back (and keep its
      // count) so it emails once the hour is up.
      await db.execute(sql`
        update ${alertLog} set sent_at = now() - interval '10 years',
          suppressed = ${repeats + 1}
        where key = ${a.key}`);
      if (Number(g?.n) === MAX_PER_HOUR + 1)
        await deliver({
          key: "_hour",
          subject: "Lots of alerts this hour",
          text: `More than ${MAX_PER_HOUR} alerts in the last hour, so the rest wait until the hour is up. Something may be badly wrong: check /admin and the Vercel logs.`,
        }).catch(() => false);
      return "suppressed";
    }
  } catch (e) {
    // No database (the outage that matters most): still tell James, at
    // most once per key per hour from this server.
    console.error(
      "[alert] couldn't record; sending anyway",
      (e as Error)?.name,
    );
    const last = memory.get(a.key) ?? 0;
    if (Date.now() - last < every * 60_000) return "suppressed";
    memory.set(a.key, Date.now());
    return (await deliver(a).catch(() => false)) ? "sent" : "failed";
  }
  return deliverOrRelease(
    repeats > 0
      ? {
          ...a,
          text: `${a.text}\n\n(${repeats} more like this since the last email.)`,
        }
      : a,
  );
}

/** Deliver; if it didn't go out, free the slot so the next one can try. */
async function deliverOrRelease(a: Alert): Promise<AlertOutcome> {
  const ok = await deliver(a).catch(() => false);
  if (ok) return "sent";
  await db
    .execute(
      sql`update ${alertLog} set sent_at = now() - interval '10 years' where key = ${a.key}`,
    )
    .catch(() => {});
  return "failed";
}

/** True if Resend took it (or there's no key: log-only, nothing to retry). */
async function deliver(a: Alert): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = alertEmail();
  const text = `${a.text}\n\nAdmin: ${SITE_URL}/admin\n(Park Roulette alert: ${a.key})`;
  if (!key) {
    console.warn(`[alert] ${a.subject} (no RESEND_API_KEY, not emailed)`);
    return true;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], subject: a.subject, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error(`[alert] Resend said ${res.status}`);
    return false;
  }
  console.info(`[alert] emailed: ${a.subject}`);
  return true;
}
