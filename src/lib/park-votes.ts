import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { explorers, parkChanges, parks, parkVotes } from "@/db/schema";
import { FEATURE_KEYS } from "./features";

/**
 * Park facts belong to everyone, so no single family changes them. A family
 * suggests a fix; it applies once another family agrees (two in all), or an
 * admin says so. Only families with a grown-up who signs in with a number
 * count, so nobody can out-vote the town with throwaway families.
 *
 * Exceptions: the family that added a park can fix it freely until another
 * family confirms it, and a family-added park needs just one other family
 * to say "it's real".
 */

export const AGREE_NEEDED = 2;

export type Topic = `feature:${string}` | "play" | "status" | "exists";

const STATUS_VALUES = ["active", "closed", "private"] as const;
const PLAY_VALUES = ["playground", "nature", "none"] as const;

export function validVote(topic: string, value: string): boolean {
  if (topic.startsWith("feature:"))
    return (
      FEATURE_KEYS.includes(topic.slice(8)) &&
      (value === "yes" || value === "no")
    );
  if (topic === "play")
    return (PLAY_VALUES as readonly string[]).includes(value);
  if (topic === "status")
    return (STATUS_VALUES as readonly string[]).includes(value);
  // Turning a new park down is an admin's rejectPark, not a vote.
  if (topic === "exists") return value === "yes";
  return false;
}

type ParkRow = typeof parks.$inferSelect;

/** What the park says today for a topic. */
export function currentValue(p: ParkRow, topic: string): string {
  if (topic.startsWith("feature:"))
    return p.features.includes(topic.slice(8)) ? "yes" : "no";
  if (topic === "play") return p.status === "no_playground" ? "none" : p.play;
  if (topic === "status")
    return p.status === "no_playground" ? "active" : p.status;
  if (topic === "exists") return p.approvedAt ? "yes" : "pending";
  return "";
}

/**
 * Does a tally of votes change the park? `votes` maps each value to the
 * number of verified families for it.
 */
export function winner(
  topic: string,
  current: string,
  votes: Map<string, number>,
): string | null {
  if (topic === "exists")
    return current !== "yes" && (votes.get("yes") ?? 0) >= 1 ? "yes" : null;
  const keep = votes.get(current) ?? 0;
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of votes)
    if (v !== current && n > bestN) [best, bestN] = [v, n];
  return best && bestN >= AGREE_NEEDED && bestN > keep ? best : null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function patchFor(p: ParkRow, topic: string, value: string) {
  if (topic.startsWith("feature:")) {
    const key = topic.slice(8);
    const set = new Set(p.features);
    if (value === "yes") set.add(key);
    else set.delete(key);
    return {
      features: [...set],
      confidence: "confirmed",
      sources: sql`array(select distinct unnest(${parks.sources} || array['crowd']::text[]))`,
    };
  }
  if (topic === "play")
    return {
      play: value,
      status: p.status === "no_playground" ? "active" : p.status,
      statusNote: null,
      sources: sql`array(select distinct unnest(${parks.sources} || array['crowd:play']::text[]))`,
    };
  if (topic === "status")
    return {
      status: value,
      statusNote: null,
      ...(value === "active" ? { confidence: "confirmed" } : {}),
    };
  return { approvedAt: new Date() };
}

export type VoteOutcome = "applied" | "waiting" | "same";

/**
 * A family's say on one fact. Returns "applied" if the park changed,
 * "waiting" if it needs another family, "same" if it already says that.
 */
export async function castVote(opts: {
  parkId: number;
  topic: string;
  value: string;
  note?: string;
  me: { id: number; crew: { id: number }; isAdmin: boolean };
}): Promise<VoteOutcome> {
  const { parkId, topic, value, me } = opts;
  if (!validVote(topic, value)) throw new Error("bad vote");
  return db.transaction(async (tx) => {
    // One vote at a time per park, so two families agreeing at once both count.
    const [p] = await tx
      .select()
      .from(parks)
      .where(eq(parks.id, parkId))
      .for("update");
    if (!p) throw new Error("no park");
    const current = currentValue(p, topic);

    const ownUnconfirmed =
      !p.approvedAt &&
      p.addedBy != null &&
      (await addedByCrew(tx, p)) === me.crew.id;
    if (topic === "exists" && ownUnconfirmed) return "waiting";

    if (me.isAdmin || (ownUnconfirmed && topic !== "exists")) {
      if (value === current) return "same";
      await apply(tx, p, topic, value, me.isAdmin ? 0 : 1);
      return "applied";
    }

    await tx
      .insert(parkVotes)
      .values({
        parkId,
        crewId: me.crew.id,
        explorerId: me.id,
        topic,
        value,
        note: opts.note || null,
      })
      .onConflictDoUpdate({
        target: [parkVotes.parkId, parkVotes.crewId, parkVotes.topic],
        set: {
          value,
          explorerId: me.id,
          note: opts.note || null,
          createdAt: sql`now()`,
        },
      });

    const tallies = await tally(tx, parkId, topic);
    const win = winner(topic, current, tallies);
    if (win) {
      await apply(tx, p, topic, win, tallies.get(win) ?? 0);
      return "applied";
    }
    if (value === current) return "same";
    return "waiting";
  });
}

async function addedByCrew(tx: Tx, p: ParkRow): Promise<number | null> {
  if (p.addedBy == null) return null;
  const [a] = await tx
    .select({ crewId: explorers.crewId })
    .from(explorers)
    .where(eq(explorers.id, p.addedBy));
  return a?.crewId ?? null;
}

/** Verified families per value on one topic. */
async function tally(
  tx: Tx,
  parkId: number,
  topic: string,
): Promise<Map<string, number>> {
  const rows = await tx.execute<{ value: string; n: number }>(sql`
    select v.value, count(*)::int as n
    from ${parkVotes} v
    where v.park_id = ${parkId} and v.topic = ${topic}
      and exists (
        select 1 from ${explorers} e
        where e.crew_id = v.crew_id and e.phone is not null
      )
    group by v.value`);
  return new Map(rows.map((r) => [r.value, r.n]));
}

async function apply(
  tx: Tx,
  p: ParkRow,
  topic: string,
  value: string,
  families: number,
) {
  await tx
    .update(parks)
    .set(patchFor(p, topic, value))
    .where(eq(parks.id, p.id));
  await tx
    .delete(parkVotes)
    .where(and(eq(parkVotes.parkId, p.id), eq(parkVotes.topic, topic)));
  await tx.insert(parkChanges).values({ parkId: p.id, topic, value, families });
}

export type PendingFix = {
  topic: string;
  value: string;
  /** Verified families who said this value. */
  families: number;
  /** Families who say it's still the way the park shows it. */
  against: number;
  /** What my family said on this topic, if anything. */
  mine: string | null;
};

/** Open suggestions on a park, for its page. */
export async function pendingFixes(
  parkId: number,
  crewId: number | null,
): Promise<PendingFix[]> {
  const [p] = await db.select().from(parks).where(eq(parks.id, parkId));
  if (!p) return [];
  const rows = await db
    .select({
      topic: parkVotes.topic,
      value: parkVotes.value,
      crewId: parkVotes.crewId,
      verified: sql<boolean>`exists (select 1 from ${explorers} e where e.crew_id = ${parkVotes.crewId} and e.phone is not null)`,
    })
    .from(parkVotes)
    .where(eq(parkVotes.parkId, parkId));
  const byTopic = new Map<string, typeof rows>();
  for (const r of rows)
    byTopic.set(r.topic, [...(byTopic.get(r.topic) ?? []), r]);
  const out: PendingFix[] = [];
  for (const [topic, votes] of byTopic) {
    if (topic === "exists") continue;
    const current = currentValue(p, topic);
    const count = new Map<string, number>();
    for (const v of votes)
      if (v.verified) count.set(v.value, (count.get(v.value) ?? 0) + 1);
    const mine = votes.find((v) => v.crewId === crewId)?.value ?? null;
    // The leading suggestion that isn't the park's current value.
    const options = [...new Set(votes.map((v) => v.value))].filter(
      (v) => v !== current,
    );
    if (!options.length) continue;
    options.sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));
    out.push({
      topic,
      value: options[0],
      families: Math.max(
        count.get(options[0]) ?? 0,
        mine === options[0] ? 1 : 0,
      ),
      against: count.get(current) ?? 0,
      mine,
    });
  }
  return out;
}
