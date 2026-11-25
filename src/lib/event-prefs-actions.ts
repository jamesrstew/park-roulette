"use server";

import { z } from "zod";
import { type ActionResult, fail, requireMe } from "./action-utils";
import { getMe } from "./data";
import {
  MAX_BATCH,
  MAX_HIDES,
  MAX_SAVES,
  OCC_RE,
  SLUG_RE,
} from "./events/prefs";
import {
  type FamilyPrefs,
  familyPrefs,
  mergePrefs,
  setHidden,
  setSaved,
} from "./events/prefs-db";
import { type ShortFact, shortlistFacts } from "./events/shortlist";
import { allEvents } from "./events/store";

/** Every page we know (from the cached list, no extra query). */
async function eventSlugs(): Promise<Set<string>> {
  return new Set((await allEvents()).map((r) => r.slug));
}

/**
 * Saved and hidden kid events (/events, /events/saved). The family is
 * always getMe()'s crew; nothing here takes a crew id from the browser.
 * No refresh(): nothing server-rendered depends on these rows (the shared
 * listing is personalized on the phone), so there's nothing to re-render.
 */

const slug = z.string().regex(SLUG_RE);
const occ = z.string().regex(OCC_RE);

export type PrefsResult =
  | (ActionResult & { ok: true; prefs: FamilyPrefs | null })
  | (ActionResult & { ok: false });

/** The family's list, or prefs: null when nobody is signed in. */
export async function loadEventPrefs(): Promise<PrefsResult> {
  try {
    const me = await getMe();
    return { ok: true, prefs: me ? await familyPrefs(me.crew.id) : null };
  } catch (e) {
    return fail("loadEventPrefs", e);
  }
}

const saveInput = z.object({ slug, occ, on: z.boolean() });

export async function setEventSaved(
  input: z.input<typeof saveInput>,
): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const data = saveInput.parse(input);
    if (data.on && !(await eventSlugs()).has(data.slug))
      return { ok: false, error: "That event isn't on our list anymore." };
    await setSaved(me.crew.id, { slug: data.slug, occ: data.occ }, data.on);
    return { ok: true };
  } catch (e) {
    return fail("setEventSaved", e);
  }
}

const hideInput = z.object({
  slugs: z.array(slug).min(1).max(MAX_BATCH),
  on: z.boolean(),
});

export async function setEventHidden(
  input: z.input<typeof hideInput>,
): Promise<ActionResult> {
  try {
    const me = await requireMe();
    const data = hideInput.parse(input);
    const known = await eventSlugs();
    const slugs = data.on ? data.slugs.filter((s) => known.has(s)) : data.slugs;
    await setHidden(me.crew.id, slugs, data.on);
    return { ok: true };
  } catch (e) {
    return fail("setEventHidden", e);
  }
}

const mergeInput = z.object({
  saves: z.array(z.string().max(170)).max(MAX_SAVES),
  hides: z.array(slug).max(MAX_HIDES),
});

/** This phone's own list joins the family; hands back the family's list. */
export async function mergeEventPrefs(
  input: z.input<typeof mergeInput>,
): Promise<PrefsResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: true, prefs: null };
    const data = mergeInput.parse(input);
    await mergePrefs(me.crew.id, data.saves, data.hides, await eventSlugs());
    return { ok: true, prefs: await familyPrefs(me.crew.id) };
  } catch (e) {
    return fail("mergeEventPrefs", e);
  }
}

const refsInput = z.array(z.object({ slug, occ })).max(MAX_SAVES);

/**
 * Fresh facts for the shortlist's saved refs: public event data only
 * (titles, dates, status), the same anyone sees on the event pages. Sent
 * in the request body, never a URL.
 */
export async function shortlistInfo(
  refs: z.input<typeof refsInput>,
): Promise<
  (ActionResult & { facts?: ShortFact[] }) | { ok: false; error: string }
> {
  try {
    const data = refsInput.parse(refs);
    return {
      ok: true,
      facts: shortlistFacts(await allEvents(), data, new Date()),
    };
  } catch (e) {
    return fail("shortlistInfo", e);
  }
}
