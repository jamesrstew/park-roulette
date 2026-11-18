import "server-only";
import { alertLater } from "./alerts";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { smsEvents } from "@/db/schema";
import { ipKey } from "./ip";

/**
 * Sign-in codes by text, through Twilio Verify. Twilio makes the code, sends
 * it from its own registered numbers, expires it after 10 minutes, and allows
 * 5 tries per code. On top of that the app keeps its own limits (sms_events),
 * so nobody can run up the bill or text-bomb a family member. The "from
 * anywhere" caps never apply to a phone+network that has signed in with
 * this number before, so a stranger can't lock you out on your own phone.
 *
 * Local dev without Twilio: set SMS_FAKE=1 in .env.local and every code is
 * 000000. That only works under `next dev` with a local database, never on
 * Vercel.
 */

/** App-side limits. Twilio also limits sends per number on its own. */
export const LIMITS = {
  /** Texts to one number. Per number+IP, so a stranger can't use them up. */
  perPhoneIpHour: 5,
  perPhoneIpDay: 10,
  /** Texts to one number from anywhere (a backstop against text-bombing). */
  perPhoneDay: 20,
  /**
   * Attempts from one network, whether or not a text went out. Phone
   * carriers share addresses between many customers, so not too tight.
   */
  perIpHour: 20,
  /**
   * Site-wide daily budgets: sized for a newspaper-story day (a few hundred
   * new families), not for an attack. Each text costs a few cents; James
   * gets an email at half and 80% of either budget, and when one is hit.
   */
  knownPerDay: 2000,
  /** Texts to numbers nobody has yet: new people, typos, or a script. */
  unknownPerDay: 800,
  /** Texts to unknown numbers from one household network (an IPv6 /64 or one IPv4). */
  unknownPerIpDay: 25,
  /**
   * The same for a wider IPv6 block (/48), so one actor can't hop addresses;
   * higher, because a phone carrier can put many families in one /48.
   */
  unknownPerWideNetDay: 120,
  /** Wrong codes for one number from one network, and from anywhere. */
  badCodesPerPhoneIpDay: 10,
  badCodesPerPhoneDay: 40,
  /** Code checks from one network. */
  checksPerIpHour: 30,
};

/** One key for the whole sms_events check-and-insert; volume is tiny. */
const LOCK_KEY = 72_726_001;
const TWILIO_TIMEOUT_MS = 8000;

export class SmsError extends Error {}

export type Caps = {
  /** This kind of text (sign-in or new number) hit the site-wide budget. */
  siteFull: boolean;
  /** This network hit its new-number budget. */
  networkFull: boolean;
  /** Some daily budget is full: show everyone "texts are backed up". */
  backedUp: boolean;
};

/** Shown to everyone while texts are backed up (never tells who plays). */
export const BACKED_UP =
  "Texts are backed up right now. If a code arrives, type it in. If not, try again in a bit.";

/** For the IPv6 /48 a /64 key belongs to (IPv4 stays as is). */
export function wideNet(key: string): string {
  const m = key.match(/^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+):[0-9a-f]+::\/64$/);
  return m ? m[1] : key;
}

const wideNetSql = (col: typeof smsEvents.ip) =>
  sql`(case when ${col} like '%::/64' then split_part(${col}, ':', 1) || ':' || split_part(${col}, ':', 2) || ':' || split_part(${col}, ':', 3) else ${col} end)`;

/** Which budget email (if any) this send should trigger. Pure, for tests. */
export function budgetLevel(
  verdict: Verdict,
  used: number,
  budget: number,
  caps: Caps,
): "hit" | "network" | 80 | 50 | null {
  const refused =
    verdict === "silent" ||
    (typeof verdict === "object" && verdict.limit.endsWith("/day"));
  if (refused)
    return caps.siteFull ? "hit" : caps.networkFull ? "network" : null;
  if (verdict !== "send") return null;
  if (used + 1 >= (budget * 80) / 100) return 80;
  if (used + 1 >= (budget * 50) / 100) return 50;
  return null;
}

/** Email James as a daily texting budget fills up, and when it's hit. */
function budgetAlerts(
  known: boolean,
  verdict: Verdict,
  used: number,
  budget: number,
  caps: Caps,
) {
  const which = known ? "sign-ins" : "new numbers";
  const kind = known ? "known" : "unknown";
  const level = budgetLevel(verdict, used, budget, caps);
  if (level === "hit")
    alertLater({
      key: `sms:budget-hit:${kind}`,
      subject: `Sign-up texts paused: daily budget for ${which} used up`,
      text: `The daily budget of ${budget} texts to ${which} is used up, so ${known ? "people signing in" : "new families"} aren't getting codes until it rolls over (a rolling 24 hours). Everyone sees "texts are backed up". If this is real interest (a news story), raise LIMITS in src/lib/sms.ts and redeploy. If it looks like abuse, leave it.`,
    });
  else if (level === "network")
    alertLater({
      key: "sms:network-cap",
      subject: "One network hit its new-number texting limit",
      text: `One network (a school, office, phone carrier, or one person) used its new-number texts for the day (${LIMITS.unknownPerIpDay} per household network, ${LIMITS.unknownPerWideNetDay} per wider IPv6 block). People there see "texts are backed up". Usually fine; if it's a big shared network on a busy day, consider raising unknownPerIpDay.`,
      everyMinutes: 12 * 60,
    });
  else if (level)
    alertLater({
      key: `sms:budget-${level}:${kind}`,
      subject: `Sign-up texts at ${level}% of today's budget`,
      text: `${used + 1} of ${budget} texts to ${which} in the last 24 hours. Busy day! Nothing is broken; this is a heads-up before the budget runs out.`,
      everyMinutes: 12 * 60,
    });
}

const last4 = (phone: string) => `…${phone.slice(-4)}`;

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/;

export function fakeSms(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    !process.env.VERCEL &&
    process.env.SMS_FAKE === "1" &&
    // `next dev` listens on the whole Wi-Fi: never fake codes for a real DB.
    LOCAL_DB.test(process.env.DATABASE_URL ?? "")
  );
}

function twilio() {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const key = process.env.TWILIO_API_KEY_SID;
  const secret = process.env.TWILIO_API_KEY_SECRET;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!account || !key || !secret || !service)
    throw new Error("Twilio Verify env vars are missing");
  return {
    base: `https://verify.twilio.com/v2/Services/${service}`,
    auth: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
  };
}

type TwilioReply = { status: number; body: Record<string, unknown> };

async function callTwilio(
  path: string,
  form: Record<string, string>,
): Promise<TwilioReply> {
  const { base, auth } = twilio();
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return ipKey(
    h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "",
  );
}

/** Keep phones and IPs for two days, no longer. */
/** Deletes rate-limit rows (phone + IP) after two days. Also run daily by cron. */
export async function sweep() {
  await db
    .delete(smsEvents)
    .where(lt(smsEvents.createdAt, sql`now() - interval '2 days'`));
}

export type Verdict = "send" | "silent" | { limit: string; message: string };

/**
 * Check the limits and record the attempt BEFORE calling Twilio (and outside
 * the lock), so a slow Twilio can't hold the lock. Every attempt counts
 * toward the network's limit, sent or not.
 */
async function reserveSend(
  phone: string,
  ip: string,
  known: boolean,
  quietWhenOverBudget: boolean,
): Promise<{
  verdict: Verdict;
  rowId: number;
  used: number;
  budget: number;
  caps: Caps;
}> {
  const result = await db.transaction(async (tx) => {
    // Don't let a flood stack up connections behind the lock.
    await tx.execute(sql`set local lock_timeout = '3s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    const [c] = await tx
      .select({
        // Per-number caps count quiet (over-budget, unsent) requests like
        // real sends, so known and unknown numbers hit them the same way.
        // Refused requests never count, so nobody can lock a number out.
        phoneIpHour: sql<number>`count(*) filter (where ${smsEvents.kind} in ('send', 'quiet') and ${smsEvents.phone} = ${phone} and ${smsEvents.ip} = ${ip} and ${smsEvents.createdAt} > now() - interval '1 hour')::int`,
        phoneIpDay: sql<number>`count(*) filter (where ${smsEvents.kind} in ('send', 'quiet') and ${smsEvents.phone} = ${phone} and ${smsEvents.ip} = ${ip})::int`,
        phoneDay: sql<number>`count(*) filter (where ${smsEvents.kind} in ('send', 'quiet') and ${smsEvents.phone} = ${phone})::int`,
        ipHour: sql<number>`count(*) filter (where ${smsEvents.ip} = ${ip} and ${smsEvents.createdAt} > now() - interval '1 hour')::int`,
        knownDay: sql<number>`count(*) filter (where ${smsEvents.kind} = 'send' and ${smsEvents.known})::int`,
        // Wider than one household for IPv6 (a /48), so one network can't
        // hop addresses to get around it.
        unknownIpDay: sql<number>`count(*) filter (where ${smsEvents.kind} = 'send' and not ${smsEvents.known} and ${smsEvents.ip} = ${ip})::int`,
        unknownWideDay: sql<number>`count(*) filter (where ${smsEvents.kind} = 'send' and not ${smsEvents.known} and ${wideNetSql(smsEvents.ip)} = ${wideNet(ip)})::int`,
        unknownDay: sql<number>`count(*) filter (where ${smsEvents.kind} = 'send' and not ${smsEvents.known})::int`,
      })
      .from(smsEvents)
      .where(
        and(
          inArray(smsEvents.kind, ["send", "attempt", "quiet", "refused"]),
          gt(smsEvents.createdAt, sql`now() - interval '1 day'`),
        ),
      );
    // Signed in with this number from this network before: the "anywhere"
    // caps (which a stranger could fill up) don't apply here.
    const [{ trustedHere }] = await tx
      .select({ trustedHere: sql<number>`count(*)::int` })
      .from(smsEvents)
      .where(
        and(
          eq(smsEvents.kind, "ok"),
          eq(smsEvents.phone, phone),
          eq(smsEvents.ip, ip),
        ),
      );
    const busy = {
      limit: "phone",
      message: "Lots of codes for this number today. Try again in a few hours.",
    };
    const resting = {
      limit: known ? "known/day" : "unknown/day",
      message: "Our texting crayon needs a rest. Try again in a little while.",
    };
    let verdict: Verdict = "send";
    const used = known ? c.knownDay : c.unknownDay;
    const budget = known ? LIMITS.knownPerDay : LIMITS.unknownPerDay;
    const siteFull = used >= budget;
    const netFull =
      c.unknownIpDay >= LIMITS.unknownPerIpDay ||
      c.unknownWideDay >= LIMITS.unknownPerWideNetDay;
    const networkFull = !known && netFull;
    // The same for every number from here, so it never tells who plays.
    const backedUp =
      c.unknownDay >= LIMITS.unknownPerDay ||
      c.knownDay >= LIMITS.knownPerDay ||
      netFull;
    if (c.ipHour >= LIMITS.perIpHour)
      verdict = {
        limit: "ip/hour",
        message: "Whoa, lots of codes from here! Try again in an hour.",
      };
    else if (
      c.phoneIpHour >= LIMITS.perPhoneIpHour ||
      c.phoneIpDay >= LIMITS.perPhoneIpDay ||
      (!trustedHere && c.phoneDay >= LIMITS.perPhoneDay)
    )
      verdict = busy;
    else if (
      (known && c.knownDay >= LIMITS.knownPerDay) ||
      (!known && (c.unknownDay >= LIMITS.unknownPerDay || netFull))
    )
      // Signing in: answer exactly as if we'd texted, known number or not,
      // so the reply never tells a stranger which numbers play.
      verdict = quietWhenOverBudget ? "silent" : resting;
    const [row] = await tx
      .insert(smsEvents)
      .values({
        kind:
          verdict === "send"
            ? "send"
            : verdict === "silent"
              ? "quiet"
              : "refused",
        phone,
        ip,
        known,
      })
      .returning({ id: smsEvents.id });
    return {
      verdict,
      rowId: row.id,
      used,
      budget,
      caps: { siteFull, networkFull, backedUp },
    };
  });
  await sweep();
  return result;
}

/**
 * Text a sign-in code to a US number (E.164). Throws SmsError with words to
 * show. `quiet`: for sign-in, never reveal (by an error) that a number is
 * unknown.
 */
export async function sendCode(
  phone: string,
  known: boolean,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<{ sent: boolean; backedUp: boolean }> {
  const ip = await clientIp();
  const { verdict, rowId, used, budget, caps } = await reserveSend(
    phone,
    ip,
    known,
    quiet,
  );
  budgetAlerts(known, verdict, used, budget, caps);
  const backedUp = caps.backedUp;
  if (verdict === "silent") {
    console.error(`[sms] daily budget reached; quietly not texting`);
    // Take about as long as a real send, so timing doesn't tell either.
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 600));
    return { sent: false, backedUp };
  }
  if (verdict !== "send") {
    console.warn(`[sms] cap ${verdict.limit} hit for ${last4(phone)}`);
    throw new SmsError(verdict.message);
  }
  if (fakeSms()) {
    console.log(`[sms:fake] code 000000 for ${last4(phone)}`);
    return { sent: true, backedUp };
  }
  // Twilio down or erroring on its side: don't charge the attempt to them.
  const refund = () =>
    db
      .update(smsEvents)
      .set({ kind: "attempt" })
      .where(eq(smsEvents.id, rowId))
      .catch(() => {});
  let reply: TwilioReply;
  try {
    reply = await callTwilio("Verifications", { To: phone, Channel: "sms" });
  } catch (e) {
    await refund();
    console.error(
      `[sms] send to ${last4(phone)} failed to reach Twilio: ${(e as Error)?.name}`,
    );
    alertLater({
      key: "sms:twilio-unreachable",
      subject: "Sign-in texts: Twilio unreachable",
      text: "A sign-in code couldn't be sent because Twilio didn't answer. If this repeats, people can't sign in or start a family.",
    });
    throw new SmsError("Couldn't send a text just now. Try again in a sec?");
  }
  if (reply.status < 300) return { sent: true, backedUp };
  const code = Number(reply.body.code);
  if (reply.status >= 500 || reply.status === 429) await refund();
  console.error(
    `[sms] send to ${last4(phone)} failed: HTTP ${reply.status}, Twilio ${code}`,
  );
  // A typo'd or landline number is normal; anything else is worth a look.
  if (![60200, 21211, 21614, 60205, 60203, 60212, 20429].includes(code))
    alertLater({
      key: `sms:twilio-${reply.status}-${code || "x"}`,
      subject: `Sign-in texts failing (Twilio ${code || reply.status})`,
      text: `Twilio refused a sign-in code: HTTP ${reply.status}, error ${code || "none"}. Check the Twilio console (balance, geo permissions, Verify service). Error codes: https://www.twilio.com/docs/api/errors/${code || ""}`,
    });
  if ([60200, 21211, 21614].includes(code))
    throw new SmsError("Hmm, that doesn't look like a real phone number.");
  if (code === 60205)
    throw new SmsError(
      "That looks like a landline. We need a phone that gets texts.",
    );
  if ([60203, 60212, 20429].includes(code))
    throw new SmsError("Whoa, lots of codes! Try again in 10 minutes.");
  if ([60410, 60605, 60220].includes(code))
    throw new SmsError(
      "We can only text US cell phones for now. Use your family link instead.",
    );
  throw new SmsError("Couldn't send a text just now. Try again in a sec?");
}

/**
 * approved, wrong, expired (no live code: expired, used, never sent),
 * too_many (5 tries on this code), locked (too many wrong codes today).
 */
export type CheckResult =
  "approved" | "wrong" | "expired" | "too_many" | "locked";

/** Check a typed code. Wrong codes count against the number and network. */
export async function checkCode(
  phone: string,
  code: string,
): Promise<CheckResult> {
  if (!/^\d{6}$/.test(code)) return "wrong";
  const ip = await clientIp();
  const [c] = await db
    .select({
      badHere: sql<number>`count(*) filter (where ${smsEvents.kind} = 'bad_code' and ${smsEvents.phone} = ${phone} and ${smsEvents.ip} = ${ip} and ${smsEvents.createdAt} > now() - interval '1 day')::int`,
      badAnywhere: sql<number>`count(*) filter (where ${smsEvents.kind} = 'bad_code' and ${smsEvents.phone} = ${phone} and ${smsEvents.createdAt} > now() - interval '1 day')::int`,
      okHere: sql<number>`count(*) filter (where ${smsEvents.kind} = 'ok' and ${smsEvents.phone} = ${phone} and ${smsEvents.ip} = ${ip})::int`,
      checksHere: sql<number>`count(*) filter (where ${smsEvents.kind} = 'check' and ${smsEvents.ip} = ${ip} and ${smsEvents.createdAt} > now() - interval '1 hour')::int`,
    })
    .from(smsEvents)
    .where(inArray(smsEvents.kind, ["bad_code", "ok", "check"]));
  if (c.checksHere >= LIMITS.checksPerIpHour) {
    console.warn(`[sms] cap checks/hour hit`);
    throw new SmsError("Whoa, lots of tries from here! Try again in an hour.");
  }
  await db.insert(smsEvents).values({ kind: "check", phone, ip, known: false });
  if (
    c.badHere >= LIMITS.badCodesPerPhoneIpDay ||
    (!c.okHere && c.badAnywhere >= LIMITS.badCodesPerPhoneDay)
  ) {
    console.warn(`[sms] cap bad codes hit for ${last4(phone)}`);
    return "locked";
  }

  let result: CheckResult;
  if (fakeSms()) {
    result = code === "000000" ? "approved" : "wrong";
  } else {
    let reply: TwilioReply;
    try {
      reply = await callTwilio("VerificationCheck", { To: phone, Code: code });
    } catch (e) {
      console.error(
        `[sms] check for ${last4(phone)} failed to reach Twilio: ${(e as Error)?.name}`,
      );
      throw new SmsError("Couldn't check that code just now. Try again?");
    }
    const tcode = Number(reply.body.code);
    if (reply.status === 200)
      result = reply.body.status === "approved" ? "approved" : "wrong";
    // 404: no pending code (expired, already used, or never sent)
    else if (reply.status === 404 || tcode === 20404) result = "expired";
    else if (tcode === 60202 || tcode === 60203) result = "too_many";
    else {
      console.error(
        `[sms] check for ${last4(phone)} failed: HTTP ${reply.status}, Twilio ${tcode}`,
      );
      throw new SmsError("Couldn't check that code just now. Try again?");
    }
  }
  if (result === "wrong" || result === "approved")
    await db.insert(smsEvents).values({
      kind: result === "wrong" ? "bad_code" : "ok",
      phone,
      ip,
      known: false,
    });
  await sweep();
  return result;
}

/** What to tell people when a check didn't approve. */
export function checkMessage(r: Exclude<CheckResult, "approved">): string {
  return {
    wrong: "Hmm, not quite. Try again?",
    expired: "That code expired. Tap below for a fresh one.",
    too_many: "Too many tries on that code. Tap below for a fresh one.",
    locked: "Too many wrong codes for this number today. Try again tomorrow.",
  }[r];
}
