import { sql } from "drizzle-orm";
import { db } from "@/db";
import { newsIssues } from "@/db/schema";
import { validateContext } from "@/lib/news/data";
import {
  ingestOk,
  issueDateProblem,
  json,
  nope,
  readJson,
} from "@/lib/news/http";
import { validateIssue } from "@/lib/news/validate";

export const maxDuration = 120;

/**
 * The writer hands in a draft: validated (links and evidence fetched),
 * then stored as this Thursday's draft, replacing an earlier draft. A
 * draft that fails comes back with the report (422) and isn't stored.
 * Once a send has started, or the week is decided, drafts are refused.
 * No IndexNow ping here: a draft changes no public page (the issue page
 * goes public, and is pinged, when the sender sends it; event pages are
 * pinged by POST /api/events when they change).
 */
export async function POST(req: Request) {
  if (!ingestOk(req)) return nope();
  const body = await readJson(req);
  if (body == null)
    return json({ error: "Send the issue as JSON (64 KB max)." }, 400);
  const date = (body as { issue_date?: unknown }).issue_date;
  const problem = issueDateProblem(date);
  if (problem) return json({ error: problem }, 400);
  // A draft stores its Parents' corner card (content-addressed, once).
  const ctx = await validateContext(date as string, {
    network: true,
    cards: { mode: "store" },
    // An Instagram pick also draws its X stand-in now (used if it dies).
    fallback: { mode: "store" },
  });
  const report = await validateIssue(body, ctx);
  if (!report.ok) return json({ stored: false, report }, 422);
  const saved = await db
    .insert(newsIssues)
    .values({ issueDate: date as string, body, report, plan: ctx.plan })
    .onConflictDoUpdate({
      target: newsIssues.issueDate,
      set: {
        body,
        report,
        plan: ctx.plan,
        dryRunAt: null,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${newsIssues.status} = 'draft' and ${newsIssues.sendStartedAt} is null`,
    })
    .returning({ id: newsIssues.id });
  if (!saved.length)
    return json(
      {
        stored: false,
        error: "This week is already sent, sending or skipped.",
        report,
      },
      409,
    );
  return json({ stored: true, id: saved[0].id, report });
}
