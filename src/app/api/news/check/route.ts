import { validateContext } from "@/lib/news/data";
import { ingestOk, json, nope, readJson } from "@/lib/news/http";
import { isIsoDate } from "@/lib/news/time";
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
  if (!isIsoDate(date))
    return json({ error: "issue_date must be YYYY-MM-DD." }, 400);
  const network = new URL(req.url).searchParams.get("network") !== "0";
  const report = await validateIssue(
    body,
    await validateContext(date, { network }),
  );
  return json(report);
}
