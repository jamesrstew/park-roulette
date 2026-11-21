import { z } from "zod";
import { json, nope, readJson } from "@/lib/news/http";
import { socialOk } from "@/lib/social/settings";
import { WeekDraft } from "@/lib/social/model";
import { handleDrafts } from "@/lib/social/store";

/** Rendering a carousel takes a while. */
export const maxDuration = 300;

/**
 * The Sunday routine hands in Monday's park post and Wednesday's carousel
 * (bearer SOCIAL_TOKEN). Each post is validated on its own; a good
 * one is rendered, stored in Blob by hash and queued (replacing a queued
 * post in the same slot). The answer lists each post with its report and,
 * when stored, keyed preview links. 422 when any post failed.
 */
export async function POST(req: Request) {
  if (!socialOk(req)) return nope();
  const body = await readJson(req);
  const draft = WeekDraft.safeParse(body);
  if (!draft.success)
    return json({ stored: false, error: z.prettifyError(draft.error) }, 400);
  const posts = await handleDrafts(draft.data, new Date(), { store: true });
  return json(
    { ok: posts.every((p) => p.stored), posts },
    posts.every((p) => p.stored) ? 200 : 422,
  );
}
