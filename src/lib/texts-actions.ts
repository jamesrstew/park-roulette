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
import { getMe, phoneFresh } from "./data";
import { ev, EVENTS, type Tracked } from "./events";
import { nextIssueDate } from "./news/data";
import { subscriptionFor } from "./news/subscribers";
import { markOn, readOn } from "./on-cookie";
import { normalizeUSPhone } from "./phone-format";
import { emailYes, subscriberProof, textsAvailable } from "./signup-core";
import { checkCode, checkMessage, clientIp, sendCode } from "./sms";
import {
  agreementOk,
  type Agreement,
  checkboxLine,
  consentVersionFor,
  TEXT_SOURCES,
  TEXTS_CONSENT_TEXT,
  TEXTS_COPY,
} from "./texts";
import {
  confirmationsEnabled,
  type OptInResult,
  optIn,
  optOut,
  textsOn,
} from "./texts-store";

/**
 * Weekend texts: single opt-in, but a yes counts only from a number that
 * passed a code in the last 30 days (a reassigned number can't inherit
 * one). Signed out, or with a stale code, the button texts a code first.
 * Consent is keyed by the number; the reply never says whether a number
 * already gets texts. Every yes is an unchecked box the person checks,
 * then a button (the filed CQXRMSG flow): never one tap, the site
 * footer's card included (batch 6, decision 11).
 */

const FRESH_DAYS = 30;

/** A US mobile number in E.164, or the "US numbers only" words. */
function phoneFrom(raw: unknown): string {
  const phone = typeof raw === "string" ? normalizeUSPhone(raw) : null;
  if (!phone) throw new UserError("Park texts are for US numbers only.");
  return phone;
}
const sources = z.enum(TEXT_SOURCES);

export type TextsResult =
  | { ok: true; state: OptInResult; track?: ActionResult["track"] }
  | { ok: false; error: string; reason?: "code" };

/**
 * The box must be checked, and the words the ones this surface shows now
 * (another surface's words never count here).
 */
function agreed(a: unknown, phone: string, source: string): Agreement {
  if (!agreementOk(a, phone, source)) {
    // A tab opened before the words changed: checked, but the old words.
    const x = a as Partial<Agreement> | null;
    if (x?.agreed === true && x.version !== consentVersionFor(source))
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
    buttonShown: TEXTS_CONSENT_TEXT[agreement.version].button,
    path: z.string().max(200).catch("").parse(path),
    ip: await clientIp(),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    codeAt: codeAt?.toISOString() ?? null,
    verifySid: null,
    explorerId,
    shown: checkboxLine(agreement.version, phone),
  };
}

/** A yes for a signed-in grown-up's own number (fresh code checked by the caller). */
async function yesForMe(
  me: { id: number; phone: string },
  source: string,
  codeAt: Date,
  path: string,
  agreement: unknown,
): Promise<OptInResult> {
  const a = agreed(agreement, me.phone, source);
  const state = await optIn(
    me.phone,
    source,
    await details(me.phone, codeAt, me.id, path, a),
    a.version,
  );
  if (state === "on" || state === "already") await markOn("t", true);
  return state;
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
    const state = await yesForMe(
      { id: me.id, phone: me.phone },
      source,
      row!.at!,
      path,
      agreement,
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
    const agreement2 = agreed(agreement, phone, source);
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
      agreement2.version,
    );
    if (state === "on" || state === "already") await markOn("t", true);
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
    await markOn("t", false);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("stopTexts", e);
  }
}

// --- The welcome sheet's picks page (batch 6) -------------------------------

/** What the picks page needs to know about this grown-up. */
export type PicksFacts = {
  /** Show the page at all (a trusted grown-up with something to offer). */
  show: boolean;
  /** The account gets the email (or is connecting one). */
  emailOn: boolean;
  /** Only this browser's pr_on says so. */
  emailOnHere: boolean;
  textsOn: boolean;
  /** The texts card shows: a fresh code, and texts really going out. */
  textsOffer: boolean;
  /** Confirmation texts go out now (else the done line says when). */
  confirmationsOn: boolean;
  /** The grown-up's number (E.164), for the box and the "already" line. */
  phone: string | null;
  /** "2026-12-03": the first issue a new subscriber gets. */
  nextIssue: string | null;
  /** Confirmed subscribers floored to ten, or null under 50. */
  proof: number | null;
};

const NO_PICKS: PicksFacts = {
  show: false,
  emailOn: false,
  emailOnHere: false,
  textsOn: false,
  textsOffer: false,
  confirmationsOn: false,
  phone: null,
  nextIssue: null,
  proof: null,
};

/**
 * The picks page's facts, read when the welcome sheet opens (and again
 * after the phone page adds a number). Never for kids or borrowed links.
 */
export async function loadPicks(): Promise<PicksFacts> {
  try {
    const me = await getMe();
    if (!me || me.isKid || !me.trusted) return NO_PICKS;
    const [sub, on, here, fresh, next, proof, available] = await Promise.all([
      subscriptionFor(me.id),
      me.phone ? textsOn(me.phone) : false,
      readOn(),
      me.phone ? phoneFresh(me.id) : false,
      nextIssueDate().catch(() => null),
      subscriberProof().catch(() => null),
      textsAvailable().catch(() => false),
    ]);
    const emailOn = sub.status !== "off";
    const textsOffer = !on && fresh && available;
    return {
      // Nothing left to offer: skip the page.
      show: !(emailOn && !textsOffer),
      emailOn,
      emailOnHere: !emailOn && here.email,
      textsOn: on,
      textsOffer,
      confirmationsOn: confirmationsEnabled(),
      phone: me.phone,
      nextIssue: next,
      proof,
    };
  } catch (e) {
    console.error("[picks] facts failed", (e as Error)?.message);
    return NO_PICKS;
  }
}

export type PicksResult = {
  ok: true;
  /** Absent: not asked for (unchecked, blank, or already on). */
  email?:
    { ok: true; firstIssue: string | null } | { ok: false; error: string };
  texts?: TextsResult;
  tracks: Tracked[];
};

/**
 * "Let's spin!" on the picks page: the email (pre-checked, with an
 * address) and the texts (an unchecked box they checked) in one action,
 * with one refresh. Each part answers on its own, so a failed part can be
 * retried or unchecked while the other stays done.
 */
export async function savePicks(input: {
  email: string | null;
  website?: string;
  texts: unknown;
  path: string;
}): Promise<PicksResult | { ok: false; error: string }> {
  try {
    const me = await requireGrownUp();
    const path = z.string().max(200).catch("/").parse(input.path);
    const out: PicksResult = { ok: true, tracks: [] };
    if (typeof input.email === "string" && input.email.trim()) {
      try {
        const r = await emailYes(
          input.email,
          "welcome_sheet",
          typeof input.website === "string" ? input.website : "",
          { prechecked: true, path },
        );
        out.email = { ok: true, firstIssue: r.firstIssue ?? null };
        out.tracks.push(r.track);
      } catch (e) {
        out.email = fail("savePicks email", e);
      }
    }
    if (input.texts != null) {
      try {
        if (!me.trusted || !me.phone) throw new UserError(TEXTS_COPY.borrowed);
        // The same gate as the card: no yes while texts aren't going out.
        if (!(await textsAvailable())) throw new UserError(TEXTS_COPY.failure);
        const [row] = await db
          .select({ at: explorers.phoneVerifiedAt })
          .from(explorers)
          .where(eq(explorers.id, me.id));
        const fresh =
          row?.at && Date.now() - row.at.getTime() < FRESH_DAYS * 86_400_000;
        if (!fresh) throw new UserError(TEXTS_COPY.failure);
        const state = await yesForMe(
          { id: me.id, phone: me.phone },
          "welcome_sheet",
          row!.at!,
          path,
          input.texts,
        );
        out.texts = { ok: true, state };
        if (state === "on" || state === "already")
          out.tracks.push(ev(EVENTS.textSignup, { source: "welcome_sheet" }));
      } catch (e) {
        out.texts = fail("savePicks texts", e);
      }
    }
    refresh();
    return out;
  } catch (e) {
    return fail("savePicks", e);
  }
}
