import { z } from "zod";
import { json, nope, readJson } from "@/lib/news/http";
import { socialOk } from "@/lib/social/settings";
import { PhotoCheckInput } from "@/lib/social/model";
import { savePhotoChecks } from "@/lib/social/store";

/**
 * The automated child-safety check (decision 10): the routine looks at
 * each photo with the vision model and reports, per photo URL and the
 * sha256 of the bytes it looked at, "clear" (no person visible), "people"
 * or "unsure". Only "clear" lets a photo into a post, and only while the
 * file still hashes the same; anything else gets the crayon park card.
 * Photos we don't use (not a catalog park photo or a sent issue's) are
 * refused.
 */
export async function POST(req: Request) {
  if (!socialOk(req)) return nope();
  const body = PhotoCheckInput.safeParse(await readJson(req));
  if (!body.success) return json({ error: z.prettifyError(body.error) }, 400);
  return json(await savePhotoChecks(body.data.checks));
}
