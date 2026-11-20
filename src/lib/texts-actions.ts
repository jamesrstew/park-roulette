"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { explorers } from "@/db/schema";
import {
  type ActionResult,
  fail,
  requireGrownUp,
  UserError,
} from "./action-utils";
import { getMe } from "./data";
import { ev, EVENTS } from "./events";
import { normalizeUSPhone } from "./phone-format";
import { checkCode, checkMessage, clientIp, sendCode } from "./sms";
import {
  agreementOk,
  type Agreement,
  checkboxLine,
  TEXTS_CONSENT_VERSION,
  TEXTS_COPY,
} from "./texts";
import { type OptInResult, optIn, optOut, textsOn } from "./texts-store";

/**
 * Weekend texts: single opt-in, but a yes counts only from a number that
 * passed a code in the last 30 days (a reassigned number can't inherit
 * one). Signed out, or with a stale code, the button texts a code first.
 * Consent is keyed by the number; the reply never says whether a number
 * already gets texts.
 */

const FRESH_DAYS = 30;

/** A US mobile number in E.164, or the "US numbers only" words. */
function phoneFrom(raw: unknown): string {
  const phone = typeof raw === "string" ? normalizeUSPhone(raw) : null;
  if (!phone) throw new UserError("Park texts are for US numbers only.");
  return phone;
}
const sources = z.enum(["texts_page", "settings", "welcome_sheet"]);

export type TextsResult =
  | { ok: true; state: OptInResult; track?: ActionResult["track"] }
  | { ok: false; error: string; reason?: "code" };

/** The box must be checked, and the words the ones we show now. */
function agreed(a: unknown, phone: string): Agreement {
  if (!agreementOk(a, phone)) {
    // A tab opened before the words changed: checked, but the old words.
    const x = a as Partial<Agreement> | null;
    if (x?.agreed === true && x.version !== TEXTS_CONSENT_VERSION)
      throw new UserError(TEXTS_COPY.stale);
    throw new UserError(TEXTS_COPY.unchecked);
  }
  return a as Agreement;
}

async function details(
  phone: string,
  codeAt: Date | null,
  explorerId: number | null,
  path: string,
  agreement: Agreement,
) {
  const h = await headers();
  return {
    agreed: agreement.agreed,
    disclosureShown: agreement.disclosure,
    checkboxShown: agreement.checkbox,
    path: z.string().max(200).catch("").parse(path),
    ip: await clientIp(),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    codeAt: codeAt?.toISOString() ?? null,
    verifySid: null,
    explorerId,
    shown: checkboxLine(TEXTS_CONSENT_VERSION, phone),
  };
}

/**
 * The checked box, for a signed-in grown-up with a number. Needs a code
 * first ({reason: "code"}) when the number hasn't passed one in 30 days.
 */
export async function turnOnTexts(
  from: string,
  path: string,
  agreement: unknown,
): Promise<TextsResult> {
  try {
    const source = sources.parse(from);
    const me = await requireGrownUp();
    if (!me.trusted || !me.phone)
      throw new UserError("Sign in with your own number to get park texts.");
    const [row] = await db
      .select({ at: explorers.phoneVerifiedAt })
      .from(explorers)
      .where(eq(explorers.id, me.id));
    const fresh =
      row?.at && Date.now() - row.at.getTime() < FRESH_DAYS * 86_400_000;
    if (!fresh)
      return {
        ok: false,
        reason: "code",
        error: "First we'll text you a code.",
      };
    const state = await optIn(
      me.phone,
      source,
      await details(
        me.phone,
        row!.at,
        me.id,
        path,
        agreed(agreement, me.phone),
      ),
    );
    refresh();
    return { ok: true, state, track: ev(EVENTS.textSignup, { source }) };
  } catch (e) {
    return fail("turnOnTexts", e);
  }
}

/** Text a code to prove the number (signed out, or a stale code). */
export async function sendTextsCode(raw: string): Promise<ActionResult> {
  try {
    const me = await getMe();
    if (me?.isKid) throw new UserError("Ask a grown-up to turn on park texts.");
    const phone = phoneFrom(raw);
    const [owner] = await db
      .select({ id: explorers.id })
      .from(explorers)
      .where(eq(explorers.phone, phone));
    // The same reply whether or not the number plays (or gets texts).
    await sendCode(phone, !!owner, { quiet: true });
    return { ok: true };
  } catch (e) {
    return fail("sendTextsCode", e);
  }
}

/** The code is right: record the yes for that number. */
export async function confirmTextsCode(
  raw: string,
  code: string,
  from: string,
  path: string,
  agreement: unknown,
): Promise<TextsResult> {
  try {
    const source = sources.parse(from);
    const me = await getMe();
    if (me?.isKid) throw new UserError("Ask a grown-up to turn on park texts.");
    const phone = phoneFrom(raw);
    const agreement2 = agreed(agreement, phone);
    const r = await checkCode(
      phone,
      z
        .string()
        .regex(/^\d{6}$/)
        .catch("")
        .parse(code),
    );
    if (r !== "approved") return { ok: false, error: checkMessage(r) };
    const mine = me && !me.isKid && me.phone === phone ? me.id : null;
    const state = await optIn(
      phone,
      source,
      await details(phone, new Date(), mine, path, agreement2),
    );
    if (mine) refresh();
    return { ok: true, state, track: ev(EVENTS.textSignup, { source }) };
  } catch (e) {
    return fail("confirmTextsCode", e);
  }
}

/** "Stop texts": one tap, for any grown-up session (stopping only reduces). */
export async function stopTexts(): Promise<ActionResult> {
  try {
    const me = await requireGrownUp();
    if (me.phone && (await textsOn(me.phone)))
      await optOut(me.phone, "settings", me.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("stopTexts", e);
  }
}
