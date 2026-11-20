"use server";

import { eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { explorers } from "@/db/schema";
import {
  flush,
  signupsBusy,
  type SignupSource,
  stopForExplorers,
  subscribe,
} from "@/lib/news/subscribers";
import {
  type ActionResult,
  fail,
  requireGrownUp,
  UserError,
} from "./action-utils";
import { getMe } from "./data";
import { ev, EVENTS } from "./events";
import { cleanEmail, PARK_NEWS } from "./park-news";
import { clientIp } from "./sms";

/**
 * Bend Playground Passport sign-ups and stops (single opt-in). Every
 * sign-up gets the same answer ("You're in!") whether the address is new,
 * already on the list or over its own cap, and all the work on the address
 * happens after the response, so nothing here reveals who subscribes. Only
 * an invalid address, or the per-IP and daily caps ("busy"), get a
 * different reply.
 */

const SOURCES = [
  "footer",
  "newsletter",
  "issue_page",
  "welcome_sheet",
  "settings",
  "texts_page",
  "confirm_page",
] as const satisfies readonly SignupSource[];
const source = z.enum(SOURCES);

/** Park picks in settings are for grown-ups signed in properly. */
async function requireTrustedGrownUp() {
  const me = await requireGrownUp();
  if (!me.trusted)
    throw new UserError(
      "Sign in with your own number to get the weekly park picks.",
    );
  return me;
}

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
): Promise<ActionResult> {
  try {
    const where = source.parse(from);
    const email = cleanEmail(z.string().max(300).parse(rawEmail));
    if (!email) throw new UserError("That email looks off. Try again?");
    const track = ev(EVENTS.emailSignup, { source: where });
    // A bot filled the hidden field: the same answer, and nothing happens.
    if (website) return { ok: true, track };
    const me = await getMe();
    // Kids don't sign up for email: the same answer, and nothing happens.
    if (me?.isKid) return { ok: true, track };
    const explorerId = me && me.trusted ? me.id : null;
    const ip = await clientIp();
    // Over the per-IP or daily cap: a neutral "busy" (it says nothing
    // about the address). The per-address cap stays silent.
    if (await signupsBusy(ip)) throw new UserError(PARK_NEWS.busy);
    // Everything about the address happens after the response, so its
    // timing is the same whether or not it's already on the list.
    after(async () => {
      try {
        await flush(await subscribe({ email, source: where, explorerId, ip }));
      } catch (e) {
        console.error("[news] signup failed", (e as Error)?.message);
      }
    });
    if (explorerId) {
      await db
        .update(explorers)
        .set({
          parkNewsAskedAt: sql`coalesce(${explorers.parkNewsAskedAt}, now())`,
        })
        .where(eq(explorers.id, explorerId));
      refresh();
    }
    return { ok: true, track };
  } catch (e) {
    return fail("signUpForEmail", e);
  }
}

/** "Not now" on the welcome sheet: never ask again (settings still offers it). */
export async function dismissParkNews(): Promise<ActionResult> {
  try {
    const me = await requireTrustedGrownUp();
    await db
      .update(explorers)
      .set({
        parkNewsAskedAt: sql`coalesce(${explorers.parkNewsAskedAt}, now())`,
      })
      .where(eq(explorers.id, me.id));
    return { ok: true };
  } catch (e) {
    return fail("dismissParkNews", e);
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
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("stopParkNews", e);
  }
}
