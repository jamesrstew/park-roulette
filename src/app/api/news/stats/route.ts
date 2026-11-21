import { json, maintainerOk, nope } from "@/lib/news/http";
import { newsStats } from "@/lib/news/stats";

/**
 * The maintainer's numbers for the last ?sends=4 sent issues (bearer
 * MAINTAINER_TOKEN). Aggregates only; opens aren't tracked.
 */
export async function GET(req: Request) {
  if (!maintainerOk(req)) return nope();
  const n = Number(new URL(req.url).searchParams.get("sends") ?? 4);
  if (!Number.isInteger(n) || n < 1 || n > 12)
    return json({ error: "sends is 1 to 12." }, 400);
  return json(await newsStats(n));
}
