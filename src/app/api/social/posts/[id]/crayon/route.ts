import { z } from "zod";
import { json, nope, readJson } from "@/lib/news/http";
import { socialOk } from "@/lib/social/settings";
import { downgradeToCrayon } from "@/lib/social/store";

export const maxDuration = 120;

/**
 * The routine saw a person in a stored post's rendered slides (review M3):
 * the photo is flagged for good and the post is redrawn as the crayon park
 * card, with the credit taken out of the caption. Queued posts only.
 * Body (optional): {"note": "<a few words: what was seen>"}.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!socialOk(req)) return nope();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) return json({ error: "Not a post id." }, 400);
  const body = z
    .object({ note: z.string().max(200).optional() })
    .safeParse((await readJson(req)) ?? {});
  const r = await downgradeToCrayon(
    Number(id),
    body.success ? body.data.note : undefined,
  );
  return json(r, r.ok ? 200 : 409);
}
