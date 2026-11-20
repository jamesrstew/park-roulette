import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contactConsents,
  smsLastTexts,
  smsOptOuts,
  smsProgramSends,
} from "@/db/schema";
import { alertLater } from "./alerts";
import { SITE_URL } from "./site";
import { TEXTS, TEXTS_CONSENT_VERSION } from "./texts";
import { confirmWindowOpen } from "./weekend-pick";

/**
 * Weekend texts: consent, the STOP list, and texts out. Consent is keyed
 * by the phone number (E.164), not the account: a yes on /texts with no
 * account shows as On if that number later starts a family, and the
 * records outlive the account (4 years from the last text we send, the
 * TCPA's limitations period).
 *
 * Two switches, both off until carrier registration clears (and each
 * needs TWILIO_TEXTS_SERVICE_SID): TEXTS_CONFIRMATIONS_ENABLED=1 sends
 * the one confirmation text per yes; TEXTS_SENDING_ENABLED=1 sends
 * Weekend Picks (to admins only while /admin's dry run is on). Off, a
 * text goes to the server log instead. Replies to an inbound text come
 * back in the webhook's answer, so STOP works the moment a number exists.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Who said yes, where, and the proof (the details column). */
export type ConsentDetails = {
  path: string;
  ip: string | null;
  userAgent: string | null;
  /** When this number last passed a code (the 30-day rule). */
  codeAt: string | null;
  verifySid?: string | null;
  /** The account, if any (kept here, not as a foreign key: it outlives it). */
  explorerId?: number | null;
  /** The checkbox line as shown (with the number filled in). */
  shown?: string;
  twilioSid?: string | null;
  /** The browser's word that the box was checked, and the words it showed. */
  agreed?: boolean;
  disclosureShown?: string;
  checkboxShown?: string;
};

/** Weekend Picks go out (TEXTS_SENDING_ENABLED). */
export function sendingEnabled(): boolean {
  return (
    process.env.TEXTS_SENDING_ENABLED === "1" &&
    !!process.env.TWILIO_TEXTS_SERVICE_SID
  );
}

/** Confirmation texts go out (TEXTS_CONFIRMATIONS_ENABLED), on their own. */
export function confirmationsEnabled(): boolean {
  return (
    process.env.TEXTS_CONFIRMATIONS_ENABLED === "1" &&
    !!process.env.TWILIO_TEXTS_SERVICE_SID
  );
}

/** Twilio: the number texted STOP at Twilio, which won't deliver to it. */
export const TWILIO_STOPPED = 21610;
/** Delivery errors that mean the number can't get texts (off, not listed). */
export const UNREACHABLE = new Set([30003, 30005, 30006]);
/** Delivery errors James hears about (carrier filtering, unknown, and the
 * contact card failing to fetch or deliver as MMS). */
export const ALERT_CODES = new Set([30007, 30008, 11200, 12300, 30019]);

export type SendResult =
  | { ok: true; sid?: string; logged?: boolean }
  | {
      ok: false;
      why: string;
      /** Twilio's error code, when it gave one. */
      code?: number;
      /** 5xx, 429 or no answer: worth trying again later. */
      temporary: boolean;
    };

/** Is this number getting texts right now? */
export async function textsOn(phone: string): Promise<boolean> {
  const [stopped] = await db
    .select({ phone: smsOptOuts.phone })
    .from(smsOptOuts)
    .where(eq(smsOptOuts.phone, phone));
  if (stopped) return false;
  const [last] = await db
    .select({ action: contactConsents.action })
    .from(contactConsents)
    .where(
      and(
        eq(contactConsents.channel, "sms"),
        eq(contactConsents.address, phone),
        inArray(contactConsents.action, ["opt_in", "opt_out"]),
      ),
    )
    .orderBy(desc(contactConsents.id))
    .limit(1);
  return last?.action === "opt_in";
}

/** Did this number text STOP (or stop) before? Then START has to come from it. */
export async function textedStop(phone: string, tx?: Tx): Promise<boolean> {
  const [r] = await (tx ?? db)
    .select({ source: smsOptOuts.source })
    .from(smsOptOuts)
    .where(eq(smsOptOuts.phone, phone));
  return !!r;
}

/** Turned off by a number change in the last 30 days (settings says why). */
export async function offByNumberChange(explorerId: number): Promise<boolean> {
  const [r] = await db
    .select({ id: contactConsents.id })
    .from(contactConsents)
    .where(
      and(
        eq(contactConsents.channel, "sms"),
        eq(contactConsents.action, "opt_out"),
        eq(contactConsents.source, "number_changed"),
        sql`${contactConsents.details}->>'explorerId' = ${String(explorerId)}`,
        sql`${contactConsents.createdAt} > now() - interval '30 days'`,
      ),
    )
    .limit(1);
  return !!r;
}

export type OptInResult =
  | "on" // a yes, and the confirmation text went (or is logged)
  | "already" // already on: nothing new (one confirmation per number)
  | "needs_start" // texted STOP before: START has to come from the phone
  | "failed"; // the confirmation text failed: off

/**
 * Record a yes and send the one confirmation text. Idempotent per number
 * (a double tap or two devices send one text). The caller has checked the
 * 30-day code rule.
 */
export async function optIn(
  phone: string,
  source: string,
  details: ConsentDetails,
  now = new Date(),
): Promise<OptInResult> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`texts:${phone}`}))`,
    );
    await tx.insert(contactConsents).values({
      channel: "sms",
      action: "requested",
      address: phone,
      consentVersion: TEXTS_CONSENT_VERSION,
      source,
      details,
    });
    const [stopped] = await tx
      .select({ phone: smsOptOuts.phone })
      .from(smsOptOuts)
      .where(eq(smsOptOuts.phone, phone));
    // The in-app yes is logged; the phone has to say START.
    if (stopped) return "needs_start" as const;
    const [last] = await tx
      .select({ action: contactConsents.action })
      .from(contactConsents)
      .where(
        and(
          eq(contactConsents.channel, "sms"),
          eq(contactConsents.address, phone),
          inArray(contactConsents.action, ["opt_in", "opt_out"]),
        ),
      )
      .orderBy(desc(contactConsents.id))
      .limit(1);
    if (last?.action === "opt_in") return "already" as const;
    await tx.insert(contactConsents).values({
      channel: "sms",
      action: "opt_in",
      address: phone,
      consentVersion: TEXTS_CONSENT_VERSION,
      source,
      details,
    });
    return "on" as const;
  });
  if (result !== "on") return result;
  // Confirmations off (until the carrier campaign clears), or outside
  // 8 am to 5 pm Pacific (and the number's own 8 am to 8 pm): hold it.
  // sendPendingConfirmations sends it in the window; no Weekend Pick goes
  // to a number before its confirmation.
  if (!confirmationsEnabled() || !confirmWindowOpen(phone, now)) {
    await note(phone, "confirmation_pending", source, details);
    return "on";
  }
  const sent = await sendConfirmation(phone);
  if (sent.ok) {
    await note(phone, "confirmation_sent", source, {
      ...details,
      twilioSid: sent.sid ?? null,
    });
    return "on";
  }
  // Twilio has this number's STOP (sendText listed it): START from the phone.
  if (sent.code === TWILIO_STOPPED) return "needs_start";
  // Twilio down or slow: the yes stands, the confirmation is retried.
  if (sent.temporary) {
    await note(phone, "confirmation_pending", source, details);
    return "on";
  }
  // Never show On for a number we can't reach.
  await optOut(phone, "confirmation_failed", details.explorerId ?? null, {
    keepListed: false,
  });
  return "failed";
}

/** A step in a number's confirmation (no effect on on or off). */
async function note(
  phone: string,
  action: "confirmation_pending" | "confirmation_sent",
  source: string,
  details: ConsentDetails,
) {
  await db.insert(contactConsents).values({
    channel: "sms",
    action,
    address: phone,
    consentVersion: TEXTS_CONSENT_VERSION,
    source,
    details,
  });
}

/** The latest of a number's yes, stop and confirmation steps. */
const STEPS = [
  "opt_in",
  "opt_out",
  "confirmation_pending",
  "confirmation_sent",
] as const;

/**
 * May a weekend pick go to this number? Only if texts are on and its
 * confirmation text went out after its latest yes. Every program text
 * must pass this (sendProgramText does).
 */
export async function confirmedForTexts(phone: string): Promise<boolean> {
  if (!(await textsOn(phone))) return false;
  const rows = await db
    .select({ action: contactConsents.action })
    .from(contactConsents)
    .where(
      and(
        eq(contactConsents.channel, "sms"),
        eq(contactConsents.address, phone),
        inArray(contactConsents.action, [...STEPS]),
      ),
    )
    .orderBy(desc(contactConsents.id));
  for (const r of rows) {
    if (r.action === "confirmation_sent") return true;
    if (r.action === "opt_in" || r.action === "opt_out") return false;
  }
  return false;
}

/** A weekend pick: never to a number that hasn't had its confirmation. */
export async function sendProgramText(
  to: string,
  body: string,
): Promise<SendResult> {
  if (!(await confirmedForTexts(to)))
    return { ok: false, why: "not confirmed", temporary: false };
  return sendText(to, body, { enabled: sendingEnabled() });
}

export type ConfirmationsResult = {
  sent: number;
  /** Outside the number's window, or out of time: next run. */
  waiting: number;
  /** Twilio down or slow: next run. */
  retry: number;
  /** Refused for good (off), or Twilio has its STOP (listed). */
  failed: number;
};

/**
 * Held yeses (confirmations off, or outside the window, or Twilio was
 * down): each gets its confirmation text in its window. A number Twilio
 * refuses for good goes off; a temporary failure is retried next run.
 * Runs hourly in the daytime (/api/cron/text-confirmations).
 */
export async function sendPendingConfirmations(
  now = new Date(),
  { budgetMs = 240_000 }: { budgetMs?: number } = {},
): Promise<ConfirmationsResult> {
  const out: ConfirmationsResult = { sent: 0, waiting: 0, retry: 0, failed: 0 };
  if (!confirmationsEnabled()) return out;
  const started = Date.now();
  const waiting = await db.execute<{ address: string }>(sql`
    select address from (
      select distinct on (address) address, action
      from ${contactConsents}
      where channel = 'sms' and action in ('opt_in', 'opt_out', 'confirmation_pending', 'confirmation_sent')
      order by address, id desc
    ) last
    where action = 'confirmation_pending'
      and not exists (select 1 from ${smsOptOuts} o where o.phone = last.address)`);
  for (const { address } of waiting) {
    const at = new Date(now.getTime() + (Date.now() - started));
    if (Date.now() - started > budgetMs || !confirmWindowOpen(address, at)) {
      out.waiting++;
      continue;
    }
    const sent = await sendConfirmation(address);
    if (sent.ok) {
      await note(address, "confirmation_sent", "held_until_live", {
        path: "held",
        ip: null,
        userAgent: null,
        codeAt: null,
        twilioSid: sent.sid ?? null,
      });
      out.sent++;
    } else if (sent.temporary) out.retry++;
    else {
      out.failed++;
      // 21610 already put it on the STOP list (sendText).
      if (sent.code !== TWILIO_STOPPED)
        await optOut(address, "confirmation_failed", null, {
          keepListed: false,
        });
    }
  }
  return out;
}

/**
 * Stop texts to a number, now. `keepListed`: put it on the STOP list (a
 * STOP reply, or the person stopping): any new yes then needs START from
 * the phone. A failed confirmation doesn't list it.
 */
export async function optOut(
  phone: string,
  source: string,
  explorerId: number | null = null,
  { keepListed = true }: { keepListed?: boolean } = {},
  tx?: Tx,
): Promise<void> {
  const run = async (t: Tx) => {
    await t.insert(contactConsents).values({
      channel: "sms",
      action: "opt_out",
      address: phone,
      consentVersion: TEXTS_CONSENT_VERSION,
      source,
      details: { explorerId } as ConsentDetails,
    });
    if (keepListed)
      await t
        .insert(smsOptOuts)
        .values({ phone, source })
        .onConflictDoNothing();
  };
  return tx ? run(tx) : db.transaction(run);
}

/**
 * Stop texts to numbers that leave an account (a changed number, a deleted
 * account). The consent rows stay; the number isn't put on the STOP list
 * (it didn't say STOP), so its new owner can say yes with a code.
 */
export async function stopTextsFor(
  numbers: { phone: string | null; explorerId: number }[],
  source: "number_changed" | "account_deleted",
): Promise<void> {
  for (const n of numbers)
    if (n.phone && (await textsOn(n.phone)))
      await optOut(n.phone, source, n.explorerId, { keepListed: false });
}

/**
 * START from the phone: off the STOP list, and a yes. Its consent version
 * is "start_keyword": the person agreed by texting START, not by seeing
 * the app's words.
 */
export async function startFromPhone(phone: string, tx?: Tx): Promise<void> {
  const run = async (tx: Tx) => {
    await tx.delete(smsOptOuts).where(eq(smsOptOuts.phone, phone));
    await tx.insert(contactConsents).values({
      channel: "sms",
      action: "opt_in",
      address: phone,
      consentVersion: "start_keyword",
      source: "sms_start",
      details: {
        path: "sms",
        ip: null,
        userAgent: null,
        codeAt: null,
      } satisfies ConsentDetails,
    });
    // The START reply (ours or Twilio's) carries the program's terms: it
    // is this yes's confirmation.
    await tx.insert(contactConsents).values({
      channel: "sms",
      action: "confirmation_sent",
      address: phone,
      consentVersion: "start_keyword",
      source: "sms_start",
      details: { path: "sms", ip: null, userAgent: null, codeAt: null },
    });
  };
  return tx ? run(tx) : db.transaction(run);
}

/** Note that we texted a number (the 4-year retention clock). */
export async function noteTextSent(phone: string): Promise<void> {
  await db
    .insert(smsLastTexts)
    .values({ phone, sentAt: new Date() })
    .onConflictDoUpdate({
      target: smsLastTexts.phone,
      set: { sentAt: sql`now()` },
    });
}

/**
 * Send one text through the park texts Messaging Service (never the
 * sign-in number). `enabled` is the caller's switch: off, the text is
 * logged instead ({logged: true}). Twilio's 21610 (the number texted STOP
 * at Twilio) puts it on our STOP list too. Delivery status comes back on
 * /api/texts/status.
 */
/** Our contact card, the confirmation's MMS media. */
export const VCARD_URL = `${SITE_URL}/park-roulette.vcf`;

/**
 * The confirmation: an MMS with our contact card, so families can save the
 * number. If Twilio refuses the media (anything but 21610, a 5xx or a
 * timeout), the plain SMS confirmation goes instead.
 */
export async function sendConfirmation(phone: string): Promise<SendResult> {
  const mms = await sendText(phone, TEXTS.confirmation, {
    enabled: true,
    mediaUrl: VCARD_URL,
  });
  if (mms.ok || mms.temporary || mms.code === TWILIO_STOPPED) return mms;
  console.warn(`[texts] confirmation MMS refused (${mms.why}); sending SMS`);
  return sendText(phone, TEXTS.confirmationSms, { enabled: true });
}

export async function sendText(
  to: string,
  body: string,
  { enabled, mediaUrl }: { enabled: boolean; mediaUrl?: string },
): Promise<SendResult> {
  if (!enabled || !process.env.TWILIO_TEXTS_SERVICE_SID) {
    console.info(
      `[texts] sending off; would text …${to.slice(-4)}: ${body.slice(0, 40)}…`,
    );
    return { ok: true, logged: true };
  }
  const account = process.env.TWILIO_ACCOUNT_SID;
  const key = process.env.TWILIO_API_KEY_SID;
  const secret = process.env.TWILIO_API_KEY_SECRET;
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          MessagingServiceSid: process.env.TWILIO_TEXTS_SERVICE_SID!,
          Body: body,
          StatusCallback: `${SITE_URL}/api/texts/status`,
          ...(mediaUrl ? { MediaUrl: mediaUrl } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      sid?: string;
      code?: number;
    };
    if (!res.ok) {
      console.error(`[texts] Twilio said ${res.status} (${json.code ?? "?"})`);
      if (json.code === TWILIO_STOPPED) await twilioHasStop(to);
      return {
        ok: false,
        why: `Twilio ${res.status}${json.code ? ` (${json.code})` : ""}`,
        code: json.code,
        temporary: res.status >= 500 || res.status === 429,
      };
    }
    await noteTextSent(to);
    return { ok: true, sid: json.sid };
  } catch (e) {
    console.error("[texts] Twilio unreachable", (e as Error)?.name);
    return { ok: false, why: "Twilio unreachable", temporary: true };
  }
}

/** How far along a Twilio delivery status is (later states rank higher). */
const DELIVERY_RANK: Record<string, number> = {
  accepted: 0,
  scheduled: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  undelivered: 4,
  failed: 4,
  canceled: 4,
  read: 5,
};

export function deliveryRank(status: string): number {
  return DELIVERY_RANK[status] ?? 0;
}

function rankSql(col: ReturnType<typeof sql>) {
  // No status yet ranks below every status.
  return sql`case when ${col} is null then -1 else (case ${col} ${sql.join(
    Object.entries(DELIVERY_RANK).map(
      ([k, v]) => sql`when ${k} then ${v}::int`,
    ),
    sql` `,
  )} else 0 end) end`;
}

/**
 * Twilio has a STOP from this number we never heard (21610): off and on
 * our STOP list, so a yes in the app asks for START from the phone.
 */
async function twilioHasStop(phone: string): Promise<void> {
  if (await textedStop(phone)) return;
  await optOut(phone, "twilio_stop");
}

/**
 * Twilio's delivery report for one of our texts (signed StatusCallback).
 * Records it on the Weekend Pick row, if it is one; a number that can't
 * get texts (30003, 30005, 30006) goes off; 21610 lists it; carrier
 * filtering (30007) and unknown errors (30008) reach James.
 */
export async function recordDelivery(p: {
  sid: string;
  status: string;
  to: string;
  errorCode: number | null;
}): Promise<void> {
  // Reports can arrive out of order: a status only ever moves forward
  // (queued, sent, then delivered, undelivered or failed).
  const rank = deliveryRank(p.status);
  await db
    .update(smsProgramSends)
    .set({ deliveryStatus: p.status, errorCode: p.errorCode })
    .where(
      and(
        eq(smsProgramSends.twilioSid, p.sid),
        sql`${rankSql(sql`${smsProgramSends.deliveryStatus}`)} < ${rank}`,
      ),
    );
  const code = p.errorCode;
  if (!code) return;
  if (code === TWILIO_STOPPED) return twilioHasStop(p.to);
  if (UNREACHABLE.has(code)) {
    if (await textsOn(p.to))
      await optOut(p.to, "undeliverable", null, { keepListed: false });
    return;
  }
  if (ALERT_CODES.has(code))
    alertLater({
      key: `texts:delivery:${code}`,
      subject: `Park texts: Twilio error ${code}`,
      text: `A park text to …${p.to.slice(-4)} wasn't delivered (Twilio ${code}${code === 30007 ? ", carrier filtering" : ", unknown error"}). If more follow, check the campaign's status in the Twilio console before the next Friday.`,
      everyMinutes: 6 * 60,
    });
}

/**
 * Daily: text consent records for a number go 4 years after the last
 * text we sent it (or 4 years after the record, if we never texted it).
 * The STOP list stays as long as we text anyone. Weekend Pick send rows
 * lose their number and text after 13 months and go after 4 years.
 */
export async function pruneTextConsents(): Promise<number> {
  await db
    .delete(smsProgramSends)
    .where(lt(smsProgramSends.createdAt, sql`now() - interval '4 years'`));
  await db
    .update(smsProgramSends)
    .set({ phone: null, body: null })
    .where(
      and(
        lt(smsProgramSends.createdAt, sql`now() - interval '13 months'`),
        sql`(${smsProgramSends.phone} is not null or ${smsProgramSends.body} is not null)`,
      ),
    );
  const gone = await db
    .delete(contactConsents)
    .where(
      and(
        eq(contactConsents.channel, "sms"),
        lt(contactConsents.createdAt, sql`now() - interval '4 years'`),
        sql`not exists (select 1 from ${smsLastTexts} l where l.phone = ${contactConsents.address} and l.sent_at > now() - interval '4 years')`,
      ),
    )
    .returning({ id: contactConsents.id });
  return gone.length;
}
