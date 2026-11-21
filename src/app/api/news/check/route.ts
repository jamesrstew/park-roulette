import { nextDraftDate, validateContext } from "@/lib/news/data";
import {
  ingestOk,
  issueDateProblem,
  json,
  nope,
  readJson,
  SEND_CUTOFF_MINUTES,
} from "@/lib/news/http";
import { validateIssue } from "@/lib/news/validate";

export const maxDuration = 120;

/**
 * The writer's self-check: the exact validator the sender runs, with the
 * full report. Saves nothing. ?network=0 skips fetching links and
 * evidence (fast, for a first pass).
 */
export async function POST(req: Request) {
  if (!ingestOk(req)) return nope();
  const body = await readJson(req);
  if (body == null)
    return json({ error: "Send the issue as JSON (64 KB max)." }, 400);
  const date = (body as { issue_date?: unknown }).issue_date;
  // The same date rule as drafts: today after 7:00 is refused up front.
  const problem = issueDateProblem(date, new Date(), {
    cutoffMinutes: SEND_CUTOFF_MINUTES,
    nextIssueDate: await nextDraftDate(),
  });
  if (problem) return json({ error: problem }, 400);
  const network = new URL(req.url).searchParams.get("network") !== "0";
  const report = await validateIssue(
    body,
    await validateContext(date as string, { network }),
  );
  return json(report);
}
