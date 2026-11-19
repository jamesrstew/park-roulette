import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailSubscribers, newsChunkState, newsSends } from "@/db/schema";
import type { Recipient } from "./chunks";
import { stopByAddress, type Tx } from "./subscribers";

/**
 * Who Bend Playground Passport goes to, in one place: confirmed rows in
 * email_subscribers (with or without an account), one per address. The
 * sender, /admin and the webhook only use the functions here (and
 * stopByAddress); nothing else joins subscribers to explorers.
 */

const live = and(
  eq(emailSubscribers.status, "confirmed"),
  sql`${emailSubscribers.email} is not null and ${emailSubscribers.token} is not null`,
);

/** How many would get an issue right now. */
export async function audienceCount(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailSubscribers)
    .where(live);
  return r?.n ?? 0;
}

/**
 * Freeze the audience for an issue, numbered into chunks of 100. Returns
 * how many rows it made.
 */
export async function snapshotAudience(
  tx: Tx,
  issueId: number,
): Promise<number> {
  const rows = await tx.execute(sql`
    insert into ${newsSends} (issue_id, subscriber_id, chunk)
    select ${issueId}, ${emailSubscribers.id}, ((row_number() over (order by ${emailSubscribers.id})) - 1) / 100
    from ${emailSubscribers}
    where ${live}
    on conflict do nothing
    returning id`);
  return rows.length;
}

/** A chunk's queued or mid-send readers, with their address as it is now. */
export async function chunkRecipients(
  issueId: number,
  chunk: number,
): Promise<{
  recipients: Recipient[];
  keyAttempt: number;
  oneByOne: boolean;
  attemptIds: number[] | null;
}> {
  const rows = await db
    .select({
      sendId: newsSends.id,
      keyAttempt: newsSends.keyAttempt,
      email: emailSubscribers.email,
      token: emailSubscribers.token,
      ok: sql<boolean>`${emailSubscribers.status} = 'confirmed'`,
    })
    .from(newsSends)
    .leftJoin(emailSubscribers, eq(emailSubscribers.id, newsSends.subscriberId))
    .where(
      and(
        eq(newsSends.issueId, issueId),
        eq(newsSends.chunk, chunk),
        inArray(newsSends.status, ["queued", "sending"]),
      ),
    )
    .orderBy(newsSends.id);
  const keyAttempt = Math.max(0, ...rows.map((r) => r.keyAttempt));
  const [state] = await db
    .select({
      attempts: newsChunkState.attempts,
      oneByOne: newsChunkState.oneByOne,
    })
    .from(newsChunkState)
    .where(
      and(eq(newsChunkState.issueId, issueId), eq(newsChunkState.chunk, chunk)),
    );
  return {
    keyAttempt,
    oneByOne: !!state?.oneByOne,
    attemptIds: state?.attempts?.[String(keyAttempt)] ?? null,
    recipients: rows.map((r) => ({
      sendId: r.sendId,
      email: r.ok ? r.email : null,
      token: r.ok ? r.token : null,
    })),
  };
}

export { stopByAddress };
