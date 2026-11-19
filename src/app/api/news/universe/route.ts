import { z } from "zod";
import { ingestOk, json, nope, readJson } from "@/lib/news/http";
import { DROP_REASONS, growUniverse } from "@/lib/news/universe-store";

export const maxDuration = 30;

const Body = z.strictObject({
  add: z
    .array(
      z.strictObject({
        username: z.string().max(16),
        roundups: z.array(z.string().max(500)).max(10),
      }),
    )
    .max(20)
    .optional(),
  drop: z
    .array(
      z.strictObject({
        username: z.string().max(16),
        reason: z.enum(DROP_REASONS),
      }),
    )
    .max(20)
    .optional(),
});

/**
 * Parents' corner v4: the weekly routine grows and prunes the X account
 * universe (bearer NEWS_INGEST_TOKEN). Adds need two or more roundup
 * links and pass one users lookup; drops (political, commercial, adult)
 * are for good. Inactive accounts drop on their own after 3 months.
 */
export async function POST(req: Request) {
  if (!ingestOk(req)) return nope();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success)
    return json(
      {
        error:
          "Send {add: [{username, roundups}], drop: [{username, reason}]}.",
      },
      400,
    );
  return json(await growUniverse(parsed.data));
}
