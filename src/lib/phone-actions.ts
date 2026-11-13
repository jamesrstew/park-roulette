"use server";

/**
 * Phone sign-in. Every export here is a public endpoint, so each one proves
 * who's who itself: a code texted to the number, a valid session, or a family
 * link. Nothing here signs anyone in from a client-supplied id alone, except
 * "That's me!" for a member with no number, which the family link has always
 * allowed (the link is the family's key; kids don't have phones). Those
 * link sign-ins can't add a number (see SignedInBy in session.ts), so a
 * borrowed link can't be turned into a takeover.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import { fail, requireMe, UserError } from "./action-utils";
import { getMe } from "./data";
import {
  attachPhone,
  explorerByPhone,
  explorerForClaim,
  signInAs,
} from "./phone-auth";
import {
  formatPhone,
  maskPhone,
  normalizeUSPhone,
  safeNext,
} from "./phone-format";
import {
  forgetVerifiedPhone,
  grownUpOnThisPhone,
  readSession,
  rememberGrownUp,
  rememberVerifiedPhone,
  verifiedPhone,
} from "./session";
import { type CheckResult, checkCode, checkMessage, sendCode } from "./sms";

export type PhoneResult =
  | {
      ok: true;
      /** The number as we'll show it: "(541) 555-0123" or "(•••) •••-0123". */
      shown?: string;
      /** Signed in (or switched) right away; no code needed. */
      done?: boolean;
      /** Who's signed in now, for "Welcome back, Mom!" */
      name?: string;
      next?: string;
    }
  | {
      ok: false;
      error: string;
      /**
       * unknown: proved the number, but no explorer has it (we remember it).
       * crewmate: proved it; it signs in someone in my family.
       * conflict: proved it; it signs in someone in another family.
       * expired / too_many: that code can't be used; text a new one.
       * locked: too many wrong codes today; no more codes for now.
       */
      reason?:
        "unknown" | "crewmate" | "conflict" | "expired" | "too_many" | "locked";
      who?: { id: number; name: string; crewName: string };
    };

const codeInput = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Codes are 6 numbers.");
const idInput = z.number().int().positive();
const joinCodeInput = z.string().trim().min(4).max(80).optional();

function phoneFrom(raw: unknown): string {
  const phone = typeof raw === "string" ? normalizeUSPhone(raw) : null;
  if (!phone)
    throw new UserError("Hmm, that doesn't look like a US cell number.");
  return phone;
}

function notApproved(
  r: Exclude<CheckResult, "approved">,
): Extract<PhoneResult, { ok: false }> {
  return {
    ok: false,
    error: checkMessage(r),
    reason: r === "wrong" ? undefined : r,
  };
}

/** Adding or changing a number takes a trusted sign-in on this phone. */
async function requireTrustedMe() {
  const me = await requireMe();
  if (!me.trusted)
    throw new UserError(
      "Numbers can only be added on the phone you joined with, or after signing in with a code. Kids don't need one!",
    );
  return me;
}

// ---------- signed out: sign in with your number ----------

/**
 * Text a code. Sent whether or not the number belongs to anyone, so the
 * answer never tells a stranger who plays.
 */
export async function sendSignInCode(raw: string): Promise<PhoneResult> {
  try {
    const phone = phoneFrom(raw);
    const owner = await explorerByPhone(phone);
    await sendCode(phone, !!owner, { quiet: true });
    return { ok: true, shown: formatPhone(phone) };
  } catch (e) {
    return fail("sendSignInCode", e);
  }
}

export async function checkSignInCode(
  raw: string,
  code: string,
  next?: string,
): Promise<PhoneResult> {
  try {
    const phone = phoneFrom(raw);
    const r = await checkCode(phone, codeInput.parse(code));
    if (r !== "approved") return notApproved(r);
    const owner = await explorerByPhone(phone);
    if (!owner) {
      // They proved the number. If they join next, it can come along.
      await rememberVerifiedPhone(phone);
      return {
        ok: false,
        reason: "unknown",
        error: "We don't know that number yet.",
      };
    }
    await signInAs(owner, "c");
    await forgetVerifiedPhone();
    return { ok: true, name: owner.name, next: safeNext(next) };
  } catch (e) {
    return fail("checkSignInCode", e);
  }
}

// ---------- signed in: add or change my number ----------

export async function sendAddPhoneCode(raw: string): Promise<PhoneResult> {
  try {
    const me = await requireTrustedMe();
    const phone = phoneFrom(raw);
    if (phone === me.phone) throw new UserError("That's already your number!");
    // No "that's Mom's number" before the code: that would let anyone in the
    // family test numbers without owning them. We say so once it's proved.
    const owner = await explorerByPhone(phone);
    await sendCode(phone, !!owner, { quiet: true });
    return { ok: true, shown: formatPhone(phone) };
  } catch (e) {
    return fail("sendAddPhoneCode", e);
  }
}

export async function checkAddPhoneCode(
  raw: string,
  code: string,
): Promise<PhoneResult> {
  try {
    const me = await requireTrustedMe();
    const phone = phoneFrom(raw);
    const r = await checkCode(phone, codeInput.parse(code));
    if (r !== "approved") return notApproved(r);
    const owner = await explorerByPhone(phone);
    if (owner && owner.id !== me.id) {
      // Held for "Move it here" or "I'm Mom: switch to me".
      await rememberVerifiedPhone(phone);
      const who = { id: owner.id, name: owner.name, crewName: owner.crewName };
      return owner.crewId === me.crew.id
        ? {
            ok: false,
            reason: "crewmate",
            error: `That's ${owner.name}'s number!`,
            who,
          }
        : {
            ok: false,
            reason: "conflict",
            error: `That number signs in ${owner.name} in ${owner.crewName}.`,
            who,
          };
    }
    await attachPhone(me.id, phone, "c");
    refresh();
    return { ok: true, shown: formatPhone(phone), name: me.name };
  } catch (e) {
    return fail("checkAddPhoneCode", e);
  }
}

/** After a crewmate/conflict: move the number I just proved over to me. */
export async function movePhoneHere(): Promise<PhoneResult> {
  try {
    const me = await requireTrustedMe();
    const phone = await verifiedPhone();
    if (!phone)
      throw new UserError("That took a while. Let's send a fresh code.");
    await attachPhone(me.id, phone, "c");
    await forgetVerifiedPhone();
    refresh();
    return { ok: true, shown: formatPhone(phone), name: me.name };
  } catch (e) {
    return fail("movePhoneHere", e);
  }
}

export async function removePhone(): Promise<PhoneResult> {
  try {
    const me = await requireTrustedMe();
    await attachPhone(me.id, null, "c");
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("removePhone", e);
  }
}

// ---------- "That's me!" (family link) and "Who's playing?" (shared phone) ----------

/**
 * May this caller switch to explorer `id`? Yes if they hold that family's
 * join link, or they're signed in as someone in the same family.
 */
async function claimable(id: number, joinCode: string | undefined) {
  const target = await explorerForClaim(id);
  if (!target) return null;
  if (joinCode && joinCode.toLowerCase() === target.joinCode) return target;
  const me = await getMe();
  if (me && me.crew.id === target.crewId) return target;
  return null;
}

/**
 * Start switching to a family member. No number on them: switch now (a
 * link sign-in, which can't add a number). A number: text it a code (we only
 * ever show the last 4 digits), unless this phone just proved that number.
 */
export async function startClaim(
  explorerId: number,
  joinCode?: string,
): Promise<PhoneResult> {
  try {
    const target = await claimable(
      idInput.parse(explorerId),
      joinCodeInput.parse(joinCode),
    );
    if (!target) throw new UserError("Couldn't find that explorer.");
    // Back to the grown-up who handed this phone to a kid: no code needed.
    const back = await grownUpOnThisPhone();
    if (back && back.id === target.id && back.epoch === target.sessionEpoch) {
      await signInAs(target, back.by);
      return { ok: true, done: true, name: target.name };
    }
    if (!target.phone) {
      // A properly signed-in grown-up handing the phone to their kid.
      const now = await readSession();
      const me = now ? await getMe() : null;
      if (
        now &&
        me &&
        !me.isKid &&
        target.isKid &&
        me.crew.id === target.crewId
      )
        await rememberGrownUp(now);
      await signInAs(target, "l");
      return { ok: true, done: true, name: target.name };
    }
    if ((await verifiedPhone()) === target.phone) {
      await signInAs(target, "c");
      await forgetVerifiedPhone();
      return { ok: true, done: true, name: target.name };
    }
    await sendCode(target.phone, true, { quiet: true });
    return { ok: true, shown: maskPhone(target.phone) };
  } catch (e) {
    return fail("startClaim", e);
  }
}

export async function finishClaim(
  explorerId: number,
  code: string,
  joinCode?: string,
): Promise<PhoneResult> {
  try {
    const target = await claimable(
      idInput.parse(explorerId),
      joinCodeInput.parse(joinCode),
    );
    if (!target?.phone) throw new UserError("Couldn't find that explorer.");
    const r = await checkCode(target.phone, codeInput.parse(code));
    if (r !== "approved") return notApproved(r);
    await signInAs(target, "c");
    await forgetVerifiedPhone();
    return { ok: true, done: true, name: target.name };
  } catch (e) {
    return fail("finishClaim", e);
  }
}
