"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, requireAdmin } from "./action-utils";
import { setNewsSettings } from "./news/data";
import { removeEvent, splitEvent, trimEventDates } from "./events/store";
import { pingIndexNow } from "./indexnow";
import { SITE_URL } from "./site";
import { setSocialSettings } from "./social/settings";

export type NewsSwitch =
  | "paused"
  | "dryRun"
  | "textsPaused"
  | "textsDryRun"
  | "socialPaused"
  | "socialDryRun";

/**
 * /admin's two switches for Bend Playground Passport: the kill switch
 * (the sender sends nothing, even mid-send) and dry run (each issue goes
 * only to ALERT_EMAIL). Admins signed in with a code only.
 */
export async function setNewsSwitch(
  which: NewsSwitch,
  on: boolean,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const key = z
      .enum([
        "paused",
        "dryRun",
        "textsPaused",
        "textsDryRun",
        "socialPaused",
        "socialDryRun",
      ])
      .parse(which);
    const value = z.boolean().parse(on);
    // Instagram (lib/social): the kill switch is "enabled" in the database.
    if (key === "socialPaused") await setSocialSettings({ enabled: !value });
    else if (key === "socialDryRun") await setSocialSettings({ dryRun: value });
    else await setNewsSettings({ [key]: value });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("setNewsSwitch", e);
  }
}

// --- Kids' events repairs (/admin) -----------------------------------------------

const Occurrences = z
  .array(z.string().regex(/^\d{4}-\d{2}-\d{2}(-\d{4})?$/))
  .min(1)
  .max(200);

/** Tell search engines a repaired page (and the listing) changed. */
async function pingEvents(slugs: (string | undefined)[]) {
  await pingIndexNow([
    `${SITE_URL}/events`,
    ...slugs.filter(Boolean).map((s) => `${SITE_URL}/events/${s}`),
  ]);
}

/** Trim dates: take chosen occurrences off one event (logged). */
export async function trimEventDatesAction(
  id: number,
  occurrences: string[],
): Promise<ActionResult> {
  try {
    const me = await requireAdmin();
    const r = await trimEventDates(
      z.number().int().positive().parse(id),
      Occurrences.parse(occurrences),
      me.id,
    );
    if (!r.ok) return { ok: false, error: r.error };
    await pingEvents([r.slug]);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("trimEventDates", e);
  }
}

/** Split off: move chosen occurrences to their own page (logged). */
export async function splitEventAction(
  id: number,
  occurrences: string[],
  to: { title: string; venueName: string; venueTown: string },
): Promise<ActionResult> {
  try {
    const me = await requireAdmin();
    const dest = z
      .strictObject({
        title: z.string().trim().min(3).max(80),
        venueName: z.string().trim().min(2).max(100),
        venueTown: z.string().trim().min(2).max(40),
      })
      .parse(to);
    const r = await splitEvent(
      z.number().int().positive().parse(id),
      Occurrences.parse(occurrences),
      dest,
      me.id,
    );
    if (!r.ok) return { ok: false, error: r.error };
    await pingEvents([r.slug, r.newSlug]);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("splitEvent", e);
  }
}

/** Remove: delete a wrong event (the row is kept in the log). */
export async function removeEventAction(
  id: number,
  reason: string,
): Promise<ActionResult> {
  try {
    const me = await requireAdmin();
    const r = await removeEvent(
      z.number().int().positive().parse(id),
      z.string().trim().min(3).max(300).parse(reason),
      me.id,
    );
    if (!r.ok) return { ok: false, error: r.error };
    await pingEvents([r.slug]);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("removeEvent", e);
  }
}
