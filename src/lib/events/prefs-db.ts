import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { eventHides, eventSaves } from "@/db/schema";
import { UserError } from "@/lib/action-utils";
import {
  MAX_BATCH,
  MAX_HIDES,
  MAX_SAVES,
  type SaveRef,
  saveKey,
  splitKey,
} from "./prefs";
import { pastCutoff } from "./shortlist";

/**
 * A family's saved and hidden kid events in Postgres. Every function takes
 * the crew id from getMe() (never from the browser). Server only.
 */

export type FamilyPrefs = { crewId: number; saves: string[]; hides: string[] };

export async function familyPrefs(crewId: number): Promise<FamilyPrefs> {
  const [saves, hides] = await Promise.all([
    db
      .select({ slug: eventSaves.slug, occ: eventSaves.occ })
      .from(eventSaves)
      .where(eq(eventSaves.crewId, crewId))
      .limit(MAX_SAVES),
    db
      .select({ slug: eventHides.slug })
      .from(eventHides)
      .where(eq(eventHides.crewId, crewId))
      .limit(MAX_HIDES),
  ]);
  return {
    crewId,
    saves: saves.map((r) => saveKey(r.slug, r.occ)),
    hides: hides.map((r) => r.slug),
  };
}

/** Dated saves more than 30 days past: gone from the shortlist, so here too. */
async function prunePast(crewId: number, now: Date) {
  await db
    .delete(eventSaves)
    .where(
      and(
        eq(eventSaves.crewId, crewId),
        sql`${eventSaves.occ} <> '' and left(${eventSaves.occ}, 10) < ${pastCutoff(now)}`,
      ),
    );
}

async function countOf(
  table: typeof eventSaves | typeof eventHides,
  crewId: number,
) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.crewId, crewId));
  return n;
}

export async function setSaved(
  crewId: number,
  ref: SaveRef,
  on: boolean,
  now = new Date(),
): Promise<void> {
  if (!on) {
    await db
      .delete(eventSaves)
      .where(
        and(
          eq(eventSaves.crewId, crewId),
          eq(eventSaves.slug, ref.slug),
          eq(eventSaves.occ, ref.occ),
        ),
      );
    return;
  }
  await prunePast(crewId, now);
  if ((await countOf(eventSaves, crewId)) >= MAX_SAVES)
    throw new UserError(
      "That's a lot of saved events! Remove a few you're done with first.",
    );
  await db
    .insert(eventSaves)
    .values({ crewId, slug: ref.slug, occ: ref.occ })
    .onConflictDoNothing();
}

export async function setHidden(
  crewId: number,
  slugs: readonly string[],
  on: boolean,
): Promise<void> {
  const list = [...new Set(slugs)].slice(0, MAX_BATCH);
  if (!list.length) return;
  if (!on) {
    await db
      .delete(eventHides)
      .where(
        and(eq(eventHides.crewId, crewId), inArray(eventHides.slug, list)),
      );
    return;
  }
  if ((await countOf(eventHides, crewId)) + list.length > MAX_HIDES)
    throw new UserError(
      "That's a lot of hidden events! Show a few again first.",
    );
  await db
    .insert(eventHides)
    .values(list.map((slug) => ({ crewId, slug })))
    .onConflictDoNothing();
}

/**
 * This phone's own list joins the family (sign-in): a union, nothing on
 * the server is removed. Over the caps, the rest are quietly left out.
 */
export async function mergePrefs(
  crewId: number,
  saveKeys: readonly string[],
  hideSlugs: readonly string[],
  known: ReadonlySet<string>,
  now = new Date(),
): Promise<void> {
  const cutoff = pastCutoff(now);
  const saves = [...new Set(saveKeys)]
    .map(splitKey)
    .filter(
      (r): r is SaveRef =>
        !!r &&
        known.has(r.slug) &&
        (r.occ === "" || r.occ.slice(0, 10) >= cutoff),
    );
  const hides = [...new Set(hideSlugs)].filter((s) => known.has(s));
  await prunePast(crewId, now);
  const room = {
    saves: Math.max(0, MAX_SAVES - (await countOf(eventSaves, crewId))),
    hides: Math.max(0, MAX_HIDES - (await countOf(eventHides, crewId))),
  };
  if (saves.length && room.saves)
    await db
      .insert(eventSaves)
      .values(saves.slice(0, room.saves).map((r) => ({ crewId, ...r })))
      .onConflictDoNothing();
  if (hides.length && room.hides)
    await db
      .insert(eventHides)
      .values(hides.slice(0, room.hides).map((slug) => ({ crewId, slug })))
      .onConflictDoNothing();
}
