import { sendAlert } from "@/lib/alerts";
import { json, maintainerOk, nope, readJson } from "@/lib/news/http";
import {
  prRef,
  repoUrl,
  SummarySchema,
  summaryProblem,
} from "@/lib/news/lessons";
import { GITHUB_REPO } from "@/lib/news/lessons-store";
import { pacific } from "@/lib/news/time";

/**
 * The Sunday maintainer's one email to James (bearer MAINTAINER_TOKEN):
 * {text (1200 at most), pr_url?}, sent through the alerts channel (Resend
 * to ALERT_EMAIL) under one key, "maintainer", so at most one email every
 * 6 days whatever the date. The answer says whether it went or was held
 * back. No addresses, phone numbers or links but this repository's.
 */
export async function POST(req: Request) {
  if (!maintainerOk(req)) return nope();
  const parsed = SummarySchema.safeParse(await readJson(req));
  if (!parsed.success)
    return json({ error: "Send {text (1200 max), pr_url?}." }, 400);
  const { text, pr_url } = parsed.data;
  const problem = summaryProblem(text, GITHUB_REPO);
  if (problem) return json({ error: problem }, 422);
  if (pr_url && !(prRef(pr_url, GITHUB_REPO) || repoUrl(pr_url, GITHUB_REPO)))
    return json({ error: "pr_url must be on this repository." }, 422);
  const day = pacific(new Date()).date;
  const outcome = await sendAlert({
    key: "maintainer",
    subject: `Writer maintenance, ${day}`,
    text: pr_url ? `${text}\n\n${pr_url}` : text,
    everyMinutes: 6 * 24 * 60,
  });
  if (outcome === "suppressed")
    return json(
      {
        sent: false,
        suppressed: true,
        error:
          "A summary already went out in the last 6 days, so this one was held back.",
      },
      429,
    );
  if (outcome === "failed")
    return json({ sent: false, error: "The email didn't go. Try again." }, 502);
  return json({ sent: true });
}
