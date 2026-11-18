"use server";

import { and, eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contactConsents, explorers } from "@/db/schema";
import {
  type ActionResult,
  fail,
  requireGrownUp,
  UserError,
} from "./action-utils";
import { ev, EVENTS } from "./events";
import { cleanEmail, CONSENT_VERSION, type ParkNewsSource } from "./park-news";

const source = z.enum(["stamp_card", "passport_card", "settings"]);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Replace stored addresses (except `keep`) with a sha256 fingerprint. */
async function scrub(tx: Tx, explorerId: number, keep: string | null) {
  await tx.execute(sql`
    update ${contactConsents}
    set address = 'sha256:' || encode(sha256(convert_to(address, 'UTF8')), 'hex')
    where explorer_id = ${explorerId}
      and address not like 'sha256:%'
      ${keep ? sql`and address <> ${keep}` : sql``}`);
}

/** Park news is for grown-ups signed in properly (not by a borrowed link). */
async function requireParkNewsMe() {
  const me = await requireGrownUp();
  if (!me.trusted)
    throw new UserError("Sign in with your own number to get park news.");
  return me;
}

/** "Count us in!": save the email and record the yes. */
export async function joinParkNews(
  rawEmail: string,
  from: ParkNewsSource,
): Promise<ActionResult> {
  try {
    const me = await requireParkNewsMe();
    const where = source.parse(from);
    const email = cleanEmail(z.string().max(300).parse(rawEmail));
    if (!email) throw new UserError("That email looks off. Try again?");
    // Saving the same address again: nothing to do.
    if (me.emailOptIn && me.email === email) return { ok: true };
    const changing = me.emailOptIn && me.email && me.email !== email;
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contactConsents)
      .where(
        and(
          eq(contactConsents.explorerId, me.id),
          sql`${contactConsents.createdAt} > now() - interval '1 day'`,
        ),
      );
    if (n >= 10)
      throw new UserError("Whoa, that's a lot of tries. Try again tomorrow.");
    await db.transaction(async (tx) => {
      await tx
        .update(explorers)
        .set({
          email,
          emailOptIn: true,
          emailConfirmedAt: null,
          parkNewsAskedAt: sql`coalesce(${explorers.parkNewsAskedAt}, now())`,
        })
        .where(eq(explorers.id, me.id));
      await tx.insert(contactConsents).values({
        explorerId: me.id,
        channel: "email",
        action: changing ? "change" : "opt_in",
        address: email,
        consentVersion: CONSENT_VERSION,
        source: where,
      });
      // Only the current address is kept as typed; older ones are scrubbed.
      await scrub(tx, me.id, email);
    });
    refresh();
    return { ok: true, track: ev(EVENTS.parkNews, { via: where }) };
  } catch (e) {
    return fail("joinParkNews", e);
  }
}

/** "No thanks": never ask again (settings still offers it). */
export async function dismissParkNews(quiet = false): Promise<ActionResult> {
  try {
    const me = await requireParkNewsMe();
    await db
      .update(explorers)
      .set({
        parkNewsAskedAt: sql`coalesce(${explorers.parkNewsAskedAt}, now())`,
      })
      .where(eq(explorers.id, me.id));
    // The card gave up after a few views: no refresh, so nothing jumps.
    if (!quiet) refresh();
    return { ok: true };
  } catch (e) {
    return fail("dismissParkNews", e);
  }
}

/**
 * "Stop emails": one tap, effective now, for any grown-up (stopping only
 * ever reduces access). The address leaves the account, and our consent
 * records keep only a sha256 fingerprint of it, so the stop can be proven.
 */
export async function stopParkNews(): Promise<ActionResult> {
  try {
    const me = await requireGrownUp();
    if (!me.email) return { ok: true };
    await db.transaction(async (tx) => {
      await tx.insert(contactConsents).values({
        explorerId: me.id,
        channel: "email",
        action: "opt_out",
        address: me.email!,
        consentVersion: CONSENT_VERSION,
        source: "settings",
      });
      await scrub(tx, me.id, null);
      await tx
        .update(explorers)
        .set({ email: null, emailOptIn: false, emailConfirmedAt: null })
        .where(eq(explorers.id, me.id));
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("stopParkNews", e);
  }
}
