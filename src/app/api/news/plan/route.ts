import { eq } from "drizzle-orm";
import { db } from "@/db";
import { newsIssues } from "@/db/schema";
import { ingestOk, issueDateProblem, json, nope } from "@/lib/news/http";
import { getPlan } from "@/lib/news/plan";
import { issueDateFor } from "@/lib/news/time";

export const maxDuration = 60;

/**
 * The writer's plan for an issue (bearer NEWS_INGEST_TOKEN): the Wheel
 * Pick, Plan B venues, park changes, cooldowns, calendar flags, forecast
 * labels and seasonal defaults. ?date=YYYY-MM-DD (default: this week's
 * Thursday). ?fresh=1 rebuilds it, until a draft is in. ?picks=id,id
 * adds up to 5 X posts a roundup featured to Parents' corner's pool (one
 * lookup each, the same rules as the universe's posts).
 */
export async function GET(req: Request) {
  if (!ingestOk(req)) return nope();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? issueDateFor(new Date());
  const problem = issueDateProblem(date);
  if (problem) return json({ error: problem }, 400);
  const fresh = url.searchParams.get("fresh") === "1";
  if (fresh) {
    const [row] = await db
      .select({ id: newsIssues.id })
      .from(newsIssues)
      .where(eq(newsIssues.issueDate, date));
    if (row)
      return json(
        { error: "A draft exists for this date, so the plan is locked." },
        409,
      );
  }
  try {
    const picks = (url.searchParams.get("picks") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{1,25}$/.test(s));
    return json(await getPlan(date, { fresh, picks }));
  } catch (e) {
    console.error("[news] plan failed", (e as Error).message);
    return json({ error: "Couldn't make the plan. Try again." }, 500);
  }
}
