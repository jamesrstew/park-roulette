import { z } from "zod";
import { setShort } from "@/lib/events/store";
import { ingestOk, json, nope, readJson } from "@/lib/news/http";

/**
 * Set one stored event's short line (bearer NEWS_INGEST_TOKEN, as POST
 * /api/events): {short}. The same checks as a hand-in (lib/events/
 * short.ts) run against that event's own `what` and title; only `short`
 * changes, and the old and new lines are logged. 422 with the problems
 * when it fails; 409 when the event's summary changed meanwhile; the event
 * is untouched either way.
 */
const Body = z.strictObject({ short: z.string().min(1).max(200) });

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/events/[slug]/short">,
) {
  if (!ingestOk(req)) return nope();
  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{1,160}$/.test(slug))
    return json({ error: "No such event." }, 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Send {short}." }, 400);
  const r = await setShort(slug, parsed.data.short);
  return r.ok
    ? json(r)
    : json(
        { error: r.error, ...(r.problems ? { problems: r.problems } : {}) },
        r.status,
      );
}
