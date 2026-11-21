import { json, nope } from "@/lib/news/http";
import { socialOk } from "@/lib/social/settings";
import { isIsoDate } from "@/lib/news/time";
import { mondayOf } from "@/lib/social/model";
import { socialPlan } from "@/lib/social/store";

/**
 * The Sunday routine's plan (bearer SOCIAL_TOKEN): the week's slots,
 * the code-picked park-post parks, verified venues, events and parks by ID,
 * breaks, recent posts, the photos still to look at, and the rules.
 * ?week_of=YYYY-MM-DD (a Monday) picks a week; default: the coming one.
 */
export async function GET(req: Request) {
  if (!socialOk(req)) return nope();
  const w = new URL(req.url).searchParams.get("week_of");
  if (w && (!isIsoDate(w) || mondayOf(w) !== w))
    return json({ error: "week_of must be a Monday (YYYY-MM-DD)." }, 400);
  return json(await socialPlan(new Date(), w ?? undefined));
}
