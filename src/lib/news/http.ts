import "server-only";
import { addDays, isIsoDate, pacific, weekdayOf } from "./time";
import { bearerOk } from "./tokens";

/**
 * Shared bits of the writer's endpoints (/api/news/plan, check, drafts).
 * The writer authenticates with NEWS_INGEST_TOKEN, which its environment's
 * proxy injects; it never sees the token, and the token can do nothing
 * but read the plan and hand in a draft.
 */

export function ingestOk(req: Request): boolean {
  return bearerOk(req, process.env.NEWS_INGEST_TOKEN, 24);
}

export const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

export const nope = () => json({ error: "Not allowed" }, 401);

/** A request body as JSON, at most 64 KB. Null when it isn't. */
export async function readJson(req: Request): Promise<unknown | null> {
  const text = await req.text();
  if (text.length > 64 * 1024) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Is this a Thursday the writer may work on: today (Pacific) or within the
 * next week? Returns why not, or null.
 */
export function issueDateProblem(
  date: unknown,
  now = new Date(),
): string | null {
  if (!isIsoDate(date)) return "issue_date must be YYYY-MM-DD.";
  if (weekdayOf(date) !== 4) return "issue_date must be a Thursday.";
  const today = pacific(now).date;
  if (date < today) return "That Thursday has passed.";
  if (date > addDays(today, 7))
    return "Too far ahead: plan one week at a time.";
  return null;
}
