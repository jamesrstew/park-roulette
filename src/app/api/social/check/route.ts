import { z } from "zod";
import { json, nope, readJson } from "@/lib/news/http";
import { socialOk } from "@/lib/social/settings";
import { WeekDraft } from "@/lib/social/model";
import { handleDrafts } from "@/lib/social/store";

export const maxDuration = 120;

/**
 * The routine's self-check: the same validator as /drafts, with the
 * resolved caption and slides in the answer, and nothing stored or
 * rendered.
 */
export async function POST(req: Request) {
  if (!socialOk(req)) return nope();
  const body = await readJson(req);
  const draft = WeekDraft.safeParse(body);
  if (!draft.success)
    return json({ ok: false, error: z.prettifyError(draft.error) }, 400);
  const posts = await handleDrafts(draft.data, new Date(), { store: false });
  return json({ ok: posts.every((p) => p.ok), posts });
}
