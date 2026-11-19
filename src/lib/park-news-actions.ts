"use server";

import { eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { explorers } from "@/db/schema";
import {
  flush,
  resendFor,
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
import { cleanEmail } from "./park-news";
import { clientIp } from "./sms";

/**
 * Bend Playground Passport sign-ups and stops. Every sign-up gets the same
 * answer ("check your email"), whether the address is new, waiting,
 * already on the list, stopped or over a limit, and the email itself goes
 * out after the response, so nothing here reveals who subscribes. Only an
 * invalid address gets a different reply.
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
 * onboarding or settings. Signed in as a trusted grown-up, the address
 * joins the account when its link is tapped; otherwise it's a sign-up with
 * no account. `website` is the honeypot: people never fill it in.
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
    const out = await subscribe({
      email,
      source: where,
      explorerId,
      ip: await clientIp(),
    });
    after(() => flush(out));
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

/** "Send the link again", for whatever this account is waiting on. */
export async function resendParkNewsConfirmation(): Promise<ActionResult> {
  try {
    const me = await requireTrustedGrownUp();
    const out = await resendFor(me.id, await clientIp());
    after(() => flush(out));
    return { ok: true };
  } catch (e) {
    return fail("resendParkNewsConfirmation", e);
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
