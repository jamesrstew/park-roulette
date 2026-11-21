import { z } from "zod";
import { getMe } from "@/lib/data";
import { preflight } from "@/lib/social/store";

export const maxDuration = 60;

/**
 * /admin's Instagram preflight (review L11): make real Meta containers for
 * a queued or dry-run post and read their status, never publishing (an
 * unpublished container expires in 24 hours). Admins signed in with a code
 * only. A route rather than a server action, so the renderer and Meta
 * client stay out of every page's bundle.
 */
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin || !me.trusted)
    return Response.json({ error: "That's for admins." }, { status: 403 });
  const body = z
    .object({ id: z.number().int().positive() })
    .safeParse(await req.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: "Which post?" }, { status: 400 });
  const r = await preflight(body.data.id);
  return Response.json(r, {
    headers: { "cache-control": "private, no-store" },
  });
}
