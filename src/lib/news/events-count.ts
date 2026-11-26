import "server-only";
import { buildPrograms } from "@/lib/events/programs";
import { allEvents } from "@/lib/events/store";

/**
 * How many kids' events /events lists right now (the same programs the
 * listing draws), for the link at the end of This weekend. Null when the
 * events can't be read: the link then shows without a number.
 */
export async function listedEventsCount(
  now = new Date(),
): Promise<number | null> {
  try {
    return buildPrograms(await allEvents(), now).length;
  } catch (e) {
    console.error("[news] events count failed", (e as Error)?.name);
    return null;
  }
}
