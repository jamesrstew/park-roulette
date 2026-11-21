import "server-only";
import { cache } from "react";
import { randomBytes } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  contactConsents,
  emailConfirmations,
  emailSubscribers,
  explorers,
  newsIssues,
  newsSalts,
} from "@/db/schema";
import { CONSENT_VERSION } from "@/lib/park-news";
import { SITE_URL } from "@/lib/site";
import { NEWS_FROM, NEWS_REPLY_TO, sendOne } from "./resend";
import { renderConfirmation, renderWelcome } from "./template";
import {
  addressHash,
  isToken,
  newToken,
  normalizeEmail,
  sha256,
} from "./tokens";
import { alertLater } from "@/lib/alerts";

/**
 * Who gets Bend Playground Passport (email_subscribers): single opt-in
 * with a welcome email, with or without an account, and every way of stopping. One live row per
 * address. Signing up never reveals whether an address is already on the
 * list: the reply, and its timing, are the same (the email goes out after
 * the response). An existing address joins an account only by a tap on a
 * connect link, never by matching addresses.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

/** Confirmation links work this long; pending rows are deleted after it. */
export const CONFIRM_DAYS = 7;
/**
 * Confirmation emails per address, per IP fingerprint, and in total, per
 * day. Hitting the total alerts James (someone may be abusing the form).
 */
export const CONFIRM_LIMITS = {
  perAddress: 3,
  perIp: 10,
  total: 300,
} as const;
/** Rows moved over from the old columns wait this long before the purge. */
export const MIGRATED_DAYS = 30;
/** Stopped rows (a fingerprint and their consent records) are kept this long. */
export const STOPPED_YEARS = 4;
/** IP fingerprint salts last this long, then are destroyed. */
export const SALT_DAYS = 30;

export type StopSource =
  | "settings"
  | "email_link"
  | "one_click"
  | "bounce"
  | "complaint"
  | "changed"
  | "account_deleted";

export type SignupSource =
  | "footer"
  | "newsletter"
  | "issue_page"
  | "issue_text"
  | "welcome_sheet"
  | "settings"
  | "texts_page"
  | "confirm_page"
  | "next_pick"
  | "rainy_spin"
  | "weekend_spin"
  // Instagram's link in bio, its keyword DM, and Facebook (lib/social).
  | "ig_bio"
  | "ig_dm"
  | "fb";

/** How an email yes was given, kept on its consent row. */
export type EmailConsentDetails = {
  /** The box was checked before they saw it. */
  prechecked: boolean;
  /** The page they were on. */
  path: string;
};

// --- IP fingerprints -----------------------------------------------------

/** sha256(salt + IP) with this 30-day period's salt (made on first use). */
export async function ipHash(
  ip: string | null,
  now = new Date(),
): Promise<string | null> {
  if (!ip || ip === "unknown") return null;
  const period = Math.floor(now.getTime() / (SALT_DAYS * 86_400_000));
  await db
    .insert(newsSalts)
    .values({ period, salt: randomBytes(32).toString("hex") })
    .onConflictDoNothing();
  const [s] = await db
    .select({ salt: newsSalts.salt })
    .from(newsSalts)
    .where(eq(newsSalts.period, period));
  return `ip:${sha256(`${s.salt}:${ip}`)}`;
}

// --- Stopping ------------------------------------------------------------

/** Replace stored addresses for this row (and account) with a fingerprint. */
export async function scrub(
  tx: Db,
  where: { subscriberId?: number; explorerId?: number },
) {
  await tx.execute(sql`
    update ${contactConsents}
    set address = 'sha256:' || encode(sha256(convert_to(address, 'UTF8')), 'hex')
    where channel = 'email' and address not like 'sha256:%'
      and (${where.subscriberId ? sql`subscriber_id = ${where.subscriberId}` : sql`false`}
        or ${where.explorerId ? sql`explorer_id = ${where.explorerId}` : sql`false`})`);
}

/**
 * Stop one subscriber row, right now: record the stop, keep only a
 * fingerprint of the address, clear the token (old links do nothing) and
 * any pending links.
 */
export async function stopSubscriber(
  id: number,
  source: StopSource,
  tx?: Tx,
): Promise<boolean> {
  const run = async (t: Tx) => {
    const [row] = await t
      .select({
        email: emailSubscribers.email,
        explorerId: emailSubscribers.explorerId,
        status: emailSubscribers.status,
      })
      .from(emailSubscribers)
      .where(eq(emailSubscribers.id, id))
      .for("update");
    if (!row || row.status === "stopped" || !row.email) return false;
    await t.insert(contactConsents).values({
      explorerId: row.explorerId,
      subscriberId: id,
      channel: "email",
      action: "opt_out",
      address: row.email,
      consentVersion: CONSENT_VERSION,
      source,
    });
    await scrub(t, {
      subscriberId: id,
      explorerId: row.explorerId ?? undefined,
    });
    await t
      .update(emailSubscribers)
      .set({
        status: "stopped",
        email: null,
        token: null,
        stoppedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(emailSubscribers.id, id));
    // Its links stop working, but the rows stay until the 30-day purge:
    // they're what the daily caps count.
    await t
      .update(emailConfirmations)
      .set({
        usedAt: sql`coalesce(${emailConfirmations.usedAt}, now())`,
        expiresAt: sql`now()`,
      })
      .where(eq(emailConfirmations.subscriberId, id));
    // The old per-account columns (read-only since email_subscribers):
    // cleared so nothing on the account still holds the address.
    if (row.explorerId)
      await t
        .update(explorers)
        .set({
          email: null,
          emailOptIn: false,
          emailConfirmedAt: null,
          emailToken: null,
        })
        .where(eq(explorers.id, row.explorerId));
    return true;
  };
  return tx ? run(tx) : db.transaction(run);
}

/** Stop everything an account has: its rows and its pending links. */
export async function stopForExplorers(
  ids: number[],
  source: StopSource,
  tx?: Tx,
): Promise<number> {
  if (!ids.length) return 0;
  const run = async (t: Tx) => {
    const rows = await t
      .select({ id: emailSubscribers.id })
      .from(emailSubscribers)
      .where(
        and(
          inArray(emailSubscribers.explorerId, ids),
          inArray(emailSubscribers.status, ["pending", "confirmed"]),
        ),
      );
    // Only rows this account is linked to. An address it merely asked to
    // connect (an unused link) isn't its own: that link just expires below.
    for (const r of rows) await stopSubscriber(r.id, source, t);
    await t
      .update(emailConfirmations)
      .set({
        usedAt: sql`coalesce(${emailConfirmations.usedAt}, now())`,
        expiresAt: sql`now()`,
      })
      .where(inArray(emailConfirmations.explorerId, ids));
    // The old per-account columns, whether or not a row exists: record
    // the stop (a fingerprint only), scrub, and clear them.
    const legacy = await t
      .select({ id: explorers.id, email: explorers.email })
      .from(explorers)
      .where(and(inArray(explorers.id, ids), isNotNull(explorers.email)));
    for (const l of legacy) {
      await t.insert(contactConsents).values({
        explorerId: l.id,
        channel: "email",
        action: "opt_out",
        address: addressHash(l.email!),
        consentVersion: CONSENT_VERSION,
        source,
      });
      await scrub(t, { explorerId: l.id });
    }
    await t
      .update(explorers)
      .set({
        email: null,
        emailOptIn: false,
        emailConfirmedAt: null,
        emailToken: null,
      })
      .where(inArray(explorers.id, ids));
    return rows.length;
  };
  return tx ? run(tx) : db.transaction(run);
}

/** A webhook's bounce or complaint: stop that address now. */
export async function stopByAddress(
  address: string,
  source: "bounce" | "complaint",
  tx: Tx,
): Promise<number> {
  const rows = await tx
    .select({ id: emailSubscribers.id })
    .from(emailSubscribers)
    .where(
      and(
        eq(emailSubscribers.email, normalizeEmail(address)),
        inArray(emailSubscribers.status, ["pending", "confirmed"]),
      ),
    );
  for (const r of rows) await stopSubscriber(r.id, source, tx);
  return rows.length;
}

/** The row an unsubscribe link belongs to (for the "Stop emails" page). */
export async function subscriberForUnsubscribe(token: unknown) {
  if (!isToken(token)) return null;
  const [r] = await db
    .select({ id: emailSubscribers.id, email: emailSubscribers.email })
    .from(emailSubscribers)
    .where(
      and(
        eq(emailSubscribers.token, token),
        inArray(emailSubscribers.status, ["pending", "confirmed"]),
      ),
    );
  return r?.email ? { id: r.id, email: r.email } : null;
}

/** One-click or the page's button. True if someone was subscribed. */
export async function unsubscribe(
  token: unknown,
  source: "email_link" | "one_click",
): Promise<boolean> {
  const who = await subscriberForUnsubscribe(token);
  return who ? stopSubscriber(who.id, source) : false;
}

// --- Signing up ----------------------------------------------------------

/** Emails to send once the response has gone (so timing reveals nothing). */
export type Outbox = (() => Promise<void>)[];

async function mail(
  to: string,
  m: { subject: string; html: string; text: string },
  headers?: Record<string, string>,
) {
  const r = await sendOne({
    from: NEWS_FROM(),
    to: [to],
    reply_to: NEWS_REPLY_TO(),
    ...m,
    ...(headers ? { headers } : {}),
  });
  if (!r.ok)
    console.error(`[news] signup email: Resend said ${r.status} ${r.error}`);
}

/** The newest issue that went out, as a link (null before issue 1). */
async function latestIssueUrl(t: Db): Promise<string | null> {
  const [r] = await t
    .select({ d: sql<string | null>`max(${newsIssues.issueDate})::text` })
    .from(newsIssues)
    .where(sql`${newsIssues.status} = 'sent'`);
  return r?.d ? `${SITE_URL}/newsletter/${r.d}` : null;
}

/** The welcome email, with RFC 8058 one-click unsubscribe headers. */
function welcomeMail(to: string, token: string, latest: string | null) {
  const unsubscribeUrl = `${SITE_URL}/news/unsubscribe?t=${token}`;
  return mail(
    to,
    renderWelcome({
      site: SITE_URL,
      unsubscribeUrl,
      latestIssueUrl: latest,
      postalAddress: process.env.NEWS_POSTAL_ADDRESS || null,
    }),
    {
      "List-Unsubscribe": `<${SITE_URL}/api/news/unsubscribe?t=${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  );
}

function confirmMail(token: string, purpose: "subscribe" | "link") {
  const url = `${SITE_URL}/news/confirm?t=${token}`;
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production")
    console.info(`[news] confirmation link: ${url}`);
  return renderConfirmation({
    url,
    purpose,
    site: SITE_URL,
    postalAddress: process.env.NEWS_POSTAL_ADDRESS || null,
  });
}

/**
 * Sign an address up (the footer, /newsletter, onboarding, settings).
 * Always "check your email": the same for a new, pending, confirmed,
 * stopped or rate-limited address. Returns the emails to send after the
 * response.
 *   - new address: a pending row and a confirmation link
 *   - pending: the link again
 *   - confirmed, signed out: "you're already on the list" (never a link)
 *   - someone else's (or nobody's) address, signed in: a link that joins
 *     it to the account on the tap
 *   - signed in, changing address: the old row stops, the new one waits
 */
export async function subscribe(input: {
  email: string;
  source: SignupSource;
  explorerId?: number | null;
  ip?: string | null;
  /** The words they saw (lib/park-news.ts EMAIL_CONSENT_TEXT); default today's. */
  consentVersion?: string;
  /** How they said yes, kept with the consent (e.g. {prechecked, path}). */
  details?: EmailConsentDetails;
}): Promise<Outbox & { busy?: boolean }> {
  const version = input.consentVersion ?? CONSENT_VERSION;
  const email = normalizeEmail(input.email);
  const hash = addressHash(email);
  const ipH = await ipHash(input.ip ?? null);
  const me = input.explorerId ?? null;
  const out: Outbox = [];
  const state = { busy: false };
  await db.transaction(async (tx) => {
    // One sign-up per address (and per account) at a time.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`subscribe:${hash}`}))`,
    );
    if (me)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`subscribe:explorer:${me}`}))`,
      );
    // The per-IP cap counts across addresses, so it takes its own lock:
    // two sign-ups from one IP can't both read "9" and both send.
    if (ipH)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`subscribe:ip:${ipH}`}))`,
      );
    // The daily total counts across everyone: one sign-up at a time reads it.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('subscribe:total'))`,
    );
    const [counts] = await tx
      .select({
        address: sql<number>`count(*) filter (where ${emailConfirmations.addressHash} = ${hash})::int`,
        ip: sql<number>`count(*) filter (where ${ipH ? sql`${emailConfirmations.ipHash} = ${ipH}` : sql`false`})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(emailConfirmations)
      .where(gt(emailConfirmations.createdAt, sql`now() - interval '1 day'`));
    // Over a limit: nothing is sent. The per-address cap is silent; the
    // per-IP and total caps tell the form (busy, try tomorrow).
    if (counts.total >= CONFIRM_LIMITS.total) {
      state.busy = true;
      alertLater({
        key: "news:signup-cap",
        subject: "Email sign-ups hit the daily cap",
        text: `${counts.total} confirmation emails went out in the last day, the most we send. New sign-ups get the usual answer but no email until the count falls. If this isn't a real rush, someone may be abusing the sign-up form.`,
        everyMinutes: 6 * 60,
      });
      return;
    }
    if (counts.ip >= CONFIRM_LIMITS.perIp) {
      state.busy = true;
      return;
    }
    if (counts.address >= CONFIRM_LIMITS.perAddress) return;

    const [row] = await tx
      .select({
        id: emailSubscribers.id,
        status: emailSubscribers.status,
        explorerId: emailSubscribers.explorerId,
        token: emailSubscribers.token,
      })
      .from(emailSubscribers)
      .where(
        and(
          eq(emailSubscribers.email, email),
          inArray(emailSubscribers.status, ["pending", "confirmed"]),
        ),
      )
      .for("update");

    // A signed-in grown-up switching addresses: the old one stops now.
    if (me && (!row || row.explorerId !== me)) {
      const old = await tx
        .select({ id: emailSubscribers.id })
        .from(emailSubscribers)
        .where(
          and(
            eq(emailSubscribers.explorerId, me),
            inArray(emailSubscribers.status, ["pending", "confirmed"]),
          ),
        );
      for (const o of old) await stopSubscriber(o.id, "changed", tx);
      // Expire this account's open links; the rows keep counting toward
      // the caps until the 30-day purge (never deleted here).
      await tx
        .update(emailConfirmations)
        .set({
          usedAt: sql`coalesce(${emailConfirmations.usedAt}, now())`,
          expiresAt: sql`now()`,
        })
        .where(
          and(
            eq(emailConfirmations.explorerId, me),
            isNull(emailConfirmations.usedAt),
          ),
        );
    }

    const link = async (
      subscriberId: number,
      purpose: "subscribe" | "link" | "notice" | "welcome",
    ) => {
      const token = newToken();
      await tx.insert(emailConfirmations).values({
        explorerId: me,
        subscriberId,
        purpose,
        ipHash: ipH,
        tokenHash: sha256(token),
        addressHash: hash,
        expiresAt: sql`now() + make_interval(days => ${CONFIRM_DAYS})`,
      });
      return token;
    };
    const consent = (subscriberId: number) =>
      tx.insert(contactConsents).values({
        explorerId: me,
        subscriberId,
        channel: "email",
        action: "opt_in",
        address: email,
        consentVersion: version,
        source: input.source,
        details: input.details ?? null,
      });

    // Single opt-in (James, November 2026): a new address is on the list
    // at once, with a welcome email that carries the one-tap way out.
    const welcome = async (id: number) => {
      const token = newToken();
      await tx
        .update(emailSubscribers)
        .set({
          status: "confirmed",
          confirmedAt: sql`coalesce(${emailSubscribers.confirmedAt}, now())`,
          token: sql`coalesce(${emailSubscribers.token}, ${token})`,
          explorerId: me ?? sql`${emailSubscribers.explorerId}`,
          updatedAt: sql`now()`,
        })
        .where(eq(emailSubscribers.id, id));
      const [r] = await tx
        .select({ token: emailSubscribers.token })
        .from(emailSubscribers)
        .where(eq(emailSubscribers.id, id));
      // Counted like a confirmation email (the caps), never usable as a link.
      await link(id, "welcome");
      const latest = await latestIssueUrl(tx);
      out.push(() => welcomeMail(email, r.token!, latest));
    };
    if (!row) {
      const [made] = await tx
        .insert(emailSubscribers)
        .values({
          email,
          emailHash: hash,
          status: "pending",
          explorerId: me,
          source: input.source,
          consentVersion: version,
        })
        .returning({ id: emailSubscribers.id });
      await consent(made.id);
      await welcome(made.id);
    } else if (row.status === "pending") {
      // An old pending row (before single opt-in): on the list now.
      await consent(row.id);
      if (me && row.explorerId && row.explorerId !== me) return;
      await welcome(row.id);
    } else if (me && row.explorerId === me) {
      // Already theirs and on: nothing to do.
    } else if (me && row.explorerId == null) {
      // On the list with no account: a link that connects it to this one
      // (joining an address to an account still needs its owner's tap).
      await consent(row.id);
      const token = await link(row.id, "link");
      out.push(() => mail(email, confirmMail(token, "link")));
    }
    // Otherwise (on the list already, signed out or another family's):
    // nothing is sent, and the answer on screen is the same.
  });
  return Object.assign(out, { busy: state.busy });
}

/**
 * Is the sign-up form over its per-IP or daily total cap right now? It
 * reads counts only (nothing about any address), so the form can say
 * "busy" before any address work happens; subscribe() still enforces
 * the caps under its locks.
 */
export async function signupsBusy(ip: string | null): Promise<boolean> {
  const ipH = await ipHash(ip);
  const [c] = await db
    .select({
      ip: sql<number>`count(*) filter (where ${ipH ? sql`${emailConfirmations.ipHash} = ${ipH}` : sql`false`})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(emailConfirmations)
    .where(gt(emailConfirmations.createdAt, sql`now() - interval '1 day'`));
  return c.ip >= CONFIRM_LIMITS.perIp || c.total >= CONFIRM_LIMITS.total;
}

/** Send the queued emails (call from after(), or await in scripts). */
export async function flush(out: Outbox): Promise<void> {
  for (const send of out)
    await send().catch((e) =>
      console.error("[news] mail failed", (e as Error)?.name),
    );
}

// --- Confirming ----------------------------------------------------------

export type ConfirmResult = {
  result: "confirmed" | "already" | "expired" | "invalid";
  /** The tap joined the address to an account. */
  linked: boolean;
};

/**
 * The tap on "Yes, send me park picks". Confirms a pending address, and
 * joins it to the account that asked, if one did.
 */
export async function confirmEmail(token: unknown): Promise<ConfirmResult> {
  const no = (result: ConfirmResult["result"]): ConfirmResult => ({
    result,
    linked: false,
  });
  if (!isToken(token)) return no("invalid");
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({
        id: emailConfirmations.id,
        explorerId: emailConfirmations.explorerId,
        subscriberId: emailConfirmations.subscriberId,
        purpose: emailConfirmations.purpose,
        expired: sql<boolean>`${emailConfirmations.expiresAt} < now()`,
        usedAt: emailConfirmations.usedAt,
      })
      .from(emailConfirmations)
      .where(eq(emailConfirmations.tokenHash, sha256(token)))
      .for("update");
    if (
      !c ||
      !c.subscriberId ||
      c.purpose === "notice" ||
      c.purpose === "welcome"
    )
      return no("invalid");
    const [row] = await tx
      .select({
        id: emailSubscribers.id,
        email: emailSubscribers.email,
        status: emailSubscribers.status,
        explorerId: emailSubscribers.explorerId,
      })
      .from(emailSubscribers)
      .where(eq(emailSubscribers.id, c.subscriberId))
      .for("update");
    if (!row || row.status === "stopped" || !row.email) return no("invalid");
    if (c.usedAt) return no("already");
    // Already on the list (and not joining an account): say so, even if
    // the link is old.
    if (
      row.status === "confirmed" &&
      (c.explorerId == null || row.explorerId === c.explorerId)
    )
      return no("already");
    if (c.expired) return no("expired");
    // A row that belongs to another family's account is never moved.
    if (
      c.explorerId != null &&
      row.explorerId != null &&
      row.explorerId !== c.explorerId &&
      row.status === "confirmed"
    )
      return no("invalid");
    const linking = c.explorerId != null && row.explorerId !== c.explorerId;
    if (row.status === "confirmed" && !linking) return no("already");
    if (linking) {
      // One live row per account: anything else it had stops.
      const others = await tx
        .select({ id: emailSubscribers.id })
        .from(emailSubscribers)
        .where(
          and(
            eq(emailSubscribers.explorerId, c.explorerId!),
            inArray(emailSubscribers.status, ["pending", "confirmed"]),
          ),
        );
      for (const o of others)
        if (o.id !== row.id) await stopSubscriber(o.id, "changed", tx);
    }
    await tx
      .update(emailSubscribers)
      .set({
        status: "confirmed",
        confirmedAt: sql`coalesce(${emailSubscribers.confirmedAt}, now())`,
        token: sql`coalesce(${emailSubscribers.token}, ${newToken()})`,
        explorerId: linking ? c.explorerId : row.explorerId,
        updatedAt: sql`now()`,
      })
      .where(eq(emailSubscribers.id, row.id));
    await tx
      .update(emailConfirmations)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(emailConfirmations.subscriberId, row.id),
          isNull(emailConfirmations.usedAt),
        ),
      );
    await tx.insert(contactConsents).values({
      explorerId: linking ? c.explorerId : row.explorerId,
      subscriberId: row.id,
      channel: "email",
      action: linking ? "link" : "confirm",
      address: row.email,
      consentVersion: CONSENT_VERSION,
      source: "email_link",
    });
    return { result: "confirmed", linked: linking };
  });
}

/** What a confirmation link is for (read only: opening changes nothing). */
export async function confirmationPurpose(
  token: unknown,
): Promise<"subscribe" | "link" | null> {
  if (!isToken(token)) return null;
  const [c] = await db
    .select({ purpose: emailConfirmations.purpose })
    .from(emailConfirmations)
    .where(eq(emailConfirmations.tokenHash, sha256(token)));
  return c?.purpose === "link" || c?.purpose === "subscribe" ? c.purpose : null;
}

// --- An account's view ---------------------------------------------------

export type Subscription = {
  /** off, on, or pending (an address it asked to connect, link not tapped) */
  status: "off" | "pending" | "on";
  email: string | null;
};

/**
 * Did this account stop the email (a stopped row of its own and no live
 * one)? The footer then stops offering it: a no is remembered.
 */
export async function emailStoppedFor(explorerId: number): Promise<boolean> {
  const rows = await db
    .select({ status: emailSubscribers.status })
    .from(emailSubscribers)
    .where(eq(emailSubscribers.explorerId, explorerId));
  return (
    rows.some((r) => r.status === "stopped") &&
    !rows.some((r) => r.status === "pending" || r.status === "confirmed")
  );
}

/**
 * What Family & settings shows: on (its own row, or an address it asked to
 * connect, while that link is open) or off. Never "already subscribed",
 * which is exactly what the public form hides.
 */
export const subscriptionFor = cache(loadSubscription);

/** One read per request: the footer, the page and settings share it. */
async function loadSubscription(explorerId: number): Promise<Subscription> {
  const mine = await db
    .select({ email: emailSubscribers.email, status: emailSubscribers.status })
    .from(emailSubscribers)
    .where(
      and(
        eq(emailSubscribers.explorerId, explorerId),
        inArray(emailSubscribers.status, ["pending", "confirmed"]),
      ),
    );
  const on = mine.find((m) => m.status === "confirmed");
  if (on) return { status: "on", email: on.email };
  const [waiting] = await db
    .select({ email: emailSubscribers.email })
    .from(emailConfirmations)
    .innerJoin(
      emailSubscribers,
      eq(emailSubscribers.id, emailConfirmations.subscriberId),
    )
    .where(
      and(
        eq(emailConfirmations.explorerId, explorerId),
        isNull(emailConfirmations.usedAt),
        gt(emailConfirmations.expiresAt, sql`now()`),
        inArray(emailConfirmations.purpose, ["subscribe", "link"]),
        inArray(emailSubscribers.status, ["pending", "confirmed"]),
      ),
    )
    .orderBy(desc(emailConfirmations.createdAt))
    .limit(1);
  if (waiting?.email) return { status: "pending", email: waiting.email };
  if (mine[0]) return { status: "pending", email: mine[0].email };
  return { status: "off", email: null };
}

// --- Daily cleanup -------------------------------------------------------

/**
 * Pending rows nobody confirmed are deleted (with their consent rows)
 * once their latest link has expired: we don't keep a stranger's address
 * without their yes. Rows moved over from the old columns (source
 * migrated) wait 30 days, so families have time to see "Waiting to
 * confirm". Stopped rows, which keep only a fingerprint, go with their
 * consent records 4 years after the stop. Old IP salts are destroyed.
 */
export async function purgePending(now = new Date()): Promise<number> {
  const gone = await db
    .delete(emailSubscribers)
    .where(
      and(
        eq(emailSubscribers.status, "pending"),
        lt(
          emailSubscribers.createdAt,
          sql`now() - make_interval(days => ${CONFIRM_DAYS})`,
        ),
        sql`(${emailSubscribers.source} <> 'migrated' or ${emailSubscribers.createdAt} < now() - make_interval(days => ${MIGRATED_DAYS}))`,
        sql`not exists (select 1 from ${emailConfirmations} c where c.subscriber_id = ${emailSubscribers.id} and c.expires_at > now())`,
      ),
    )
    .returning({ id: emailSubscribers.id });
  const period = Math.floor(now.getTime() / (SALT_DAYS * 86_400_000));
  await db.delete(newsSalts).where(lt(newsSalts.period, period));
  return gone.length;
}

/** Stopped rows and their consent records, 4 years after the stop. */
export async function purgeStopped(): Promise<number> {
  return db.transaction(async (tx) => {
    const old = await tx
      .select({ id: emailSubscribers.id })
      .from(emailSubscribers)
      .where(
        and(
          eq(emailSubscribers.status, "stopped"),
          lt(
            emailSubscribers.stoppedAt,
            sql`now() - make_interval(years => ${STOPPED_YEARS})`,
          ),
        ),
      );
    if (!old.length) return 0;
    const ids = old.map((o) => o.id);
    await tx
      .delete(contactConsents)
      .where(inArray(contactConsents.subscriberId, ids));
    await tx.delete(emailSubscribers).where(inArray(emailSubscribers.id, ids));
    return ids.length;
  });
}
