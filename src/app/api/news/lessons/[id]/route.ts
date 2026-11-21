import { json, maintainerOk, nope, readJson } from "@/lib/news/http";
import { LessonPatch } from "@/lib/news/lessons";
import { patchLesson } from "@/lib/news/lessons-store";

/**
 * Triage a lesson (bearer MAINTAINER_TOKEN): {status, note?, pr_url?}.
 * needs_james takes the decision needed, fix_proposed a written fix plan,
 * wontfix the reason. fixed is only ever an explicit call after a
 * reviewed fix ships. A compliance lesson only moves to needs_james.
 */
export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/news/lessons/[id]">,
) {
  if (!maintainerOk(req)) return nope();
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return json({ error: "No such lesson." }, 404);
  const parsed = LessonPatch.safeParse(await readJson(req));
  if (!parsed.success)
    return json({ error: "Send {status, note?, pr_url?}." }, 400);
  const r = await patchLesson(Number(id), parsed.data);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
