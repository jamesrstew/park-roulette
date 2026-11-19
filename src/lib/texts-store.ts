import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { contactConsents, smsLastTexts, smsOptOuts } from "@/db/schema";
import { TEXTS, TEXTS_CONSENT_VERSION } from "./texts";

/**
 * Weekend texts: consent, the STOP list, and texts out. Consent is keyed
 * by the phone number (E.164), not the account: a yes on /texts with no
 * account shows as On if that number later starts a family, and the
 * records outlive the account (4 years from the last text we send, the
 * TCPA's limitations period).
 *
 * Sending is OFF until carrier registration clears: TEXTS_SENDING_ENABLED
 * must be "1" and TWILIO_TEXTS_SERVICE_SID set; until then texts go to the
 * server log. Replies to an inbound text (STOP, HELP, START) come back in
 * the webhook's answer, so STOP works the moment a number exists.
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

export function sendingEnabled(): boolean {
  return (
    process.env.TEXTS_SENDING_ENABLED === "1" &&
    !!process.env.TWILIO_TEXTS_SERVICE_SID
  );
}

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
export async function textedStop(phone: string): Promise<boolean> {
  const [r] = await db
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
  // Texting is off until the carrier campaign clears: hold the
  // confirmation. It goes out first when sending is turned on
  // (sendPendingConfirmations), before any weekend pick.
  if (!sendingEnabled()) {
    await note(phone, "confirmation_pending", source, details);
    return "on";
  }
  const sent = await sendText(phone, TEXTS.confirmation);
  if (sent.ok)
    await note(phone, "confirmation_sent", source, {
      ...details,
      twilioSid: sent.sid ?? null,
    });
  if (!sent.ok) {
    // Never show On for a number we can't reach.
    await optOut(phone, "confirmation_failed", details.explorerId ?? null, {
      keepListed: false,
    });
    return "failed";
  }
  return "on";
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
): Promise<{ ok: boolean; sid?: string; logged?: boolean; why?: string }> {
  if (!(await confirmedForTexts(to)))
    return { ok: false, why: "not confirmed" };
  return sendText(to, body);
}

/**
 * Yeses taken while sending was off: once it's on, each gets its
 * confirmation text (a number that can't be reached goes off). Run daily
 * and before any weekend pick goes out.
 */
export async function sendPendingConfirmations(): Promise<number> {
  if (!sendingEnabled()) return 0;
  const waiting = await db.execute<{ address: string }>(sql`
    select address from (
      select distinct on (address) address, action
      from ${contactConsents}
      where channel = 'sms' and action in ('opt_in', 'opt_out', 'confirmation_pending', 'confirmation_sent')
      order by address, id desc
    ) last
    where action = 'confirmation_pending'
      and not exists (select 1 from ${smsOptOuts} o where o.phone = last.address)`);
  let n = 0;
  for (const { address } of waiting) {
    const sent = await sendText(address, TEXTS.confirmation);
    const details: ConsentDetails = {
      path: "held",
      ip: null,
      userAgent: null,
      codeAt: null,
      twilioSid: sent.sid ?? null,
    };
    if (sent.ok) {
      await note(address, "confirmation_sent", "held_until_live", details);
      n++;
    } else
      await optOut(address, "confirmation_failed", null, {
        keepListed: false,
      });
  }
  return n;
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

/** START from the phone: off the STOP list, and a yes. */
export async function startFromPhone(phone: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(smsOptOuts).where(eq(smsOptOuts.phone, phone));
    await tx.insert(contactConsents).values({
      channel: "sms",
      action: "opt_in",
      address: phone,
      consentVersion: TEXTS_CONSENT_VERSION,
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
      consentVersion: TEXTS_CONSENT_VERSION,
      source: "sms_start",
      details: { path: "sms", ip: null, userAgent: null, codeAt: null },
    });
  });
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
 * sign-in number). Off until registration: logged instead, and counted
 * as sent so the yes stands.
 */
export async function sendText(
  to: string,
  body: string,
): Promise<{ ok: boolean; sid?: string; logged?: boolean }> {
  if (!sendingEnabled()) {
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
      return { ok: false };
    }
    await noteTextSent(to);
    return { ok: true, sid: json.sid };
  } catch (e) {
    console.error("[texts] Twilio unreachable", (e as Error)?.name);
    return { ok: false };
  }
}

/**
 * Daily: text consent records for a number go 4 years after the last
 * text we sent it (or 4 years after the record, if we never texted it).
 * The STOP list stays as long as we text anyone.
 */
export async function pruneTextConsents(): Promise<number> {
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
