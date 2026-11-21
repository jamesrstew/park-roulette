import "server-only";
import { eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { emailSubscribers } from "@/db/schema";
import {
  type EmailConsentDetails,
  flush,
  signupsBusy,
  type SignupSource,
  subscribe,
} from "@/lib/news/subscribers";
import { UserError } from "./action-utils";
import { getMe } from "./data";
import { ev, EVENTS, type Tracked } from "./events";
import { getNewsSettings, nextIssueDate } from "./news/data";
import { TEXTS_FROM } from "./texts";
import { sendingEnabled } from "./texts-store";
import { markOn } from "./on-cookie";
import {
  cleanEmail,
  emailConsentVersionFor,
  issueDay,
  PARK_NEWS,
  proofCount,
} from "./park-news";
import { clientIp } from "./sms";

/**
 * The work behind every email yes (the "Count us in!" form and the welcome
 * sheet's picks page), shared by the server actions. Server-only: nothing
 * here is a public endpoint by itself.
 */

const SOURCES = [
  "footer",
  "newsletter",
  "issue_page",
  // An issue page reached from a Weekend Pick text (or a forward of one).
  "issue_text",
  "welcome_sheet",
  "settings",
  "texts_page",
  "confirm_page",
  // Ask moments (lib/asks.ts).
  "next_pick",
  "rainy_spin",
  "weekend_spin",
  // /ig: Instagram's link in bio, its keyword DM, Facebook.
  "ig_bio",
  "ig_dm",
  "fb",
] as const satisfies readonly SignupSource[];
const source = z.enum(SOURCES);

/**
 * The "Count us in!" form's sources: every one but the welcome sheet,
 * whose pre-checked yes only comes through savePicks (with its details).
 */
export const FORM_SOURCES = SOURCES.filter(
  (s): s is Exclude<(typeof SOURCES)[number], "welcome_sheet"> =>
    s !== "welcome_sheet",
);

/**
 * Sign an address up. The same answer whether the address is new, already
 * on the list or over its own cap; the address work runs after the
 * response. Throws UserError for a bad address or the busy caps. A kid's
 * session, or a filled honeypot, answers the same and does nothing.
 */
export async function emailYes(
  rawEmail: string,
  from: SignupSource,
  website = "",
  details?: EmailConsentDetails,
): Promise<{ track: Tracked; firstIssue?: string; explorerId: number | null }> {
  const where = source.parse(from);
  // The pre-checked yes is only ever recorded with how it was given.
  if (where === "welcome_sheet" && !details)
    throw new Error("welcome_sheet signups need their details");
  const email = cleanEmail(z.string().max(300).parse(rawEmail));
  if (!email) throw new UserError("That email looks off. Try again?");
  const track = ev(EVENTS.emailSignup, { source: where });
  // A bot filled the hidden field: the same answer, and nothing happens.
  if (website)
    return { track, firstIssue: await firstIssue(), explorerId: null };
  const me = await getMe();
  // Kids don't sign up for email: the same answer, and nothing happens.
  if (me?.isKid)
    return { track, firstIssue: await firstIssue(), explorerId: null };
  const explorerId = me && me.trusted ? me.id : null;
  const ip = await clientIp();
  // Over the per-IP or daily cap: a neutral "busy" (it says nothing
  // about the address). The per-address cap stays silent.
  if (await signupsBusy(ip)) throw new UserError(PARK_NEWS.busy);
  const consentVersion = emailConsentVersionFor(where);
  const safe = details
    ? {
        prechecked: details.prechecked === true,
        path: z.string().max(200).catch("").parse(details.path),
      }
    : undefined;
  // Everything about the address happens after the response, so its
  // timing is the same whether or not it's already on the list.
  after(async () => {
    try {
      await flush(
        await subscribe({
          email,
          source: where,
          explorerId,
          ip,
          consentVersion,
          details: safe,
        }),
      );
    } catch (e) {
      console.error("[news] signup failed", (e as Error)?.message);
    }
  });
  // This browser gets the email now: the site stops offering it.
  await markOn("e", true);
  return { track, firstIssue: await firstIssue(), explorerId };
}

/**
 * The success line's date ("Thursday, December 3"): the first issue a new
 * subscriber gets (skip weeks included). Never fails a signup: without it
 * the line says "Thursday morning".
 */
export async function firstIssue(): Promise<string | undefined> {
  try {
    return issueDay(await nextIssueDate());
  } catch (e) {
    console.error("[news] next issue date failed", (e as Error)?.message);
    return undefined;
  }
}

/**
 * "{N}+ grown-ups already get it": confirmed subscribers, counted live
 * and floored to the ten, or null under PROOF_MIN.
 */
export async function subscriberProof(): Promise<number | null> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailSubscribers)
    .where(eq(emailSubscribers.status, "confirmed"));
  return proofCount(r?.n ?? 0);
}

/**
 * Weekend Pick texts are offered anywhere (asks, the picks page, the
 * footer) only when the Friday text really goes to families: a texts
 * number, sending on, and /admin's dry run and kill switch both off.
 */
export async function textsAvailable(): Promise<boolean> {
  if (!TEXTS_FROM || !sendingEnabled()) return false;
  const settings = await getNewsSettings();
  return !settings.textsDryRun && !settings.textsPaused;
}
