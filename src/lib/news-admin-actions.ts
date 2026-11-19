"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, requireAdmin } from "./action-utils";
import { setNewsSettings } from "./news/data";

/**
 * /admin's two switches for Bend Playground Passport: the kill switch
 * (the sender sends nothing, even mid-send) and dry run (each issue goes
 * only to ALERT_EMAIL). Admins signed in with a code only.
 */
export async function setNewsSwitch(
  which: "paused" | "dryRun",
  on: boolean,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const key = z.enum(["paused", "dryRun"]).parse(which);
    await setNewsSettings({ [key]: z.boolean().parse(on) });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail("setNewsSwitch", e);
  }
}
