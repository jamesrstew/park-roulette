import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { crews, explorers } from "@/db/schema";
import { isUniqueViolation, UserError } from "./action-utils";
import { setExplorer, type SignedInBy } from "./session";

/**
 * Server-side building blocks for phone sign-in. NOT a "use server" file on
 * purpose: these take an explorer id on trust, so they must never become
 * public endpoints. Only phone-actions.ts calls them, after proving who's who.
 */

export async function explorerByPhone(phone: string) {
  const [row] = await db
    .select({
      id: explorers.id,
      name: explorers.name,
      crewId: explorers.crewId,
      crewName: crews.name,
      sessionEpoch: explorers.sessionEpoch,
    })
    .from(explorers)
    .innerJoin(crews, eq(crews.id, explorers.crewId))
    .where(eq(explorers.phone, phone));
  return row ?? null;
}

export async function explorerForClaim(id: number) {
  const [row] = await db
    .select({
      id: explorers.id,
      name: explorers.name,
      crewId: explorers.crewId,
      phone: explorers.phone,
      sessionEpoch: explorers.sessionEpoch,
      joinCode: crews.joinCode,
    })
    .from(explorers)
    .innerJoin(crews, eq(crews.id, explorers.crewId))
    .where(eq(explorers.id, id));
  return row ?? null;
}

/** Sign this phone in as an explorer, at their current epoch. */
export async function signInAs(
  e: { id: number; sessionEpoch: number },
  by: Exclude<SignedInBy, "legacy">,
) {
  await setExplorer(e.id, e.sessionEpoch, by);
  console.info(
    `[auth] signed in as explorer ${e.id} by ${by === "c" ? "code" : by === "l" ? "link" : "join"}`,
  );
}

/**
 * Give a verified number to an explorer. Proving you hold a number wins: if
 * another explorer had it (a recycled number, or a phone that changed hands),
 * it moves, and they're signed out everywhere. The explorer who gets it is
 * also signed out everywhere else (anyone who claimed them by link before is
 * out), and this phone is signed back in (`by`: how it's signed in now).
 */
export async function attachPhone(
  explorerId: number,
  phone: string | null,
  by: Exclude<SignedInBy, "legacy">,
) {
  try {
    const epoch = await db.transaction(async (tx) => {
      if (phone)
        await tx
          .update(explorers)
          .set({
            phone: null,
            phoneVerifiedAt: null,
            sessionEpoch: sql`${explorers.sessionEpoch} + 1`,
          })
          .where(and(eq(explorers.phone, phone), ne(explorers.id, explorerId)));
      const [row] = await tx
        .update(explorers)
        .set({
          phone,
          phoneVerifiedAt: phone ? new Date() : null,
          sessionEpoch: sql`${explorers.sessionEpoch} + 1`,
        })
        .where(eq(explorers.id, explorerId))
        .returning({ epoch: explorers.sessionEpoch });
      if (!row) throw new UserError("Couldn't find that explorer.");
      return row.epoch;
    });
    await setExplorer(explorerId, epoch, by);
    console.info(
      `[auth] explorer ${explorerId} ${phone ? `now signs in with …${phone.slice(-4)}` : "removed their number"}; other sessions signed out`,
    );
  } catch (e) {
    if (isUniqueViolation(e))
      throw new UserError("Someone just grabbed that number. Try again?");
    throw e;
  }
}
