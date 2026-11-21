"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { explorers } from "@/db/schema";
import { type SignupSource, stopForExplorers } from "@/lib/news/subscribers";
import { type ActionResult, fail, requireGrownUp } from "./action-utils";
import { getMe } from "./data";
import { markOn } from "./on-cookie";
import { emailYes, FORM_SOURCES } from "./signup-core";

/**
 * Bend Playground Passport sign-ups and stops (single opt-in). Every
 * sign-up gets the same answer ("You're in!") whether the address is new,
 * already on the list or over its own cap, and all the work on the address
 * happens after the response, so nothing here reveals who subscribes. Only
 * an invalid address, or the per-IP and daily caps ("busy"), get a
 * different reply.
 */

/**
 * "Count us in!" from anywhere: the footer, /newsletter, an issue page,
 * onboarding or settings. A new address is on the list at once (signed in
 * as a trusted grown-up, on that account) and gets a welcome email; an
 * address already on the list with no account gets a link to connect it.
 * `website` is the honeypot: people never fill it in.
 */
export async function signUpForEmail(
  rawEmail: string,
  from: SignupSource,
  website = "",
): Promise<ActionResult & { firstIssue?: string }> {
  try {
    // Never the welcome sheet's pre-checked source: that's savePicks.
    const where = z.enum(FORM_SOURCES).parse(from);
    const r = await emailYes(rawEmail, where, website);
    if (r.explorerId) refresh();
    return { ok: true, track: r.track, firstIssue: r.firstIssue };
  } catch (e) {
    return fail("signUpForEmail", e);
  }
}

const channels = z
  .array(z.enum(["email", "text"]))
  .min(1)
  .max(2);

/**
 * "No thanks" on an ask (lib/asks.ts), signed in: that channel is never
 * offered again, on any phone. Signed out, the browser keeps it. Settings
 * and the footer still offer both.
 */
export async function declinePicks(
  which: ("email" | "text")[],
): Promise<ActionResult> {
  try {
    const list = channels.parse(which);
    const me = await getMe();
    // Only a trusted grown-up's answer goes on the account (a borrowed
    // family link never changes it); the browser keeps it either way.
    if (!me || me.isKid || !me.trusted) return { ok: true };
    await db
      .update(explorers)
      .set({
        ...(list.includes("email")
          ? {
              picksEmailDeclinedAt: sql`coalesce(${explorers.picksEmailDeclinedAt}, now())`,
            }
          : {}),
        ...(list.includes("text")
          ? {
              picksTextDeclinedAt: sql`coalesce(${explorers.picksTextDeclinedAt}, now())`,
            }
          : {}),
      })
      .where(eq(explorers.id, me.id));
    return { ok: true };
  } catch (e) {
    return fail("declinePicks", e);
  }
}

/**
 * "Stop emails": one tap, effective now, for any grown-up (stopping only
 * ever reduces access). The address leaves our records, and the consent
 * records keep only a fingerprint of it, so the stop can be proven. The
 * unsubscribe link in every email does the same (lib/news/subscribers).
 */
export async function stopParkNews(): Promise<ActionResult> {
  try {
    const me = await requireGrownUp();
    await stopForExplorers([me.id], "settings");
    await markOn("e", false);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("stopParkNews", e);
  }
}
