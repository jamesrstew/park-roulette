import {
  ingestOk,
  json,
  maintainerOk,
  nope,
  readJson,
  socialOk,
} from "@/lib/news/http";
import { personalDetails, RetroSchema } from "@/lib/news/lessons";
import { storeRetro } from "@/lib/news/lessons-store";

export const maxDuration = 30;

/**
 * Every routine's last step: a structured retro of what went wrong,
 * blocked hosts and rule conflicts. The writer and events routine send
 * it with NEWS_INGEST_TOKEN (kinds "writer" and "events"), the maintainer
 * with MAINTAINER_TOKEN (kind "maintainer" only), the Sunday Instagram
 * routine with SOCIAL_TOKEN (kind "social" only). Stored raw, then merged into lessons
 * (lib/news/lessons.ts); the plan carries the open ones. 64 KB at most,
 * unknown keys and personal details refused, 20 per kind a day.
 */
export async function POST(req: Request) {
  const writer = ingestOk(req);
  const maintainer = maintainerOk(req);
  const social = socialOk(req);
  if (!writer && !maintainer && !social) return nope();
  const body = await readJson(req);
  if (body == null)
    return json({ error: "Send the retro as JSON (64 KB max)." }, 400);
  const parsed = RetroSchema.safeParse(body);
  if (!parsed.success)
    return json(
      {
        error: "That retro doesn't fit the shape.",
        problems: parsed.error.issues
          .slice(0, 10)
          .map((i) => `${i.path.join(".") || "(retro)"}: ${i.message}`),
      },
      400,
    );
  const kind = parsed.data.run.kind;
  const allowed =
    kind === "maintainer" ? maintainer : kind === "social" ? social : writer;
  if (!allowed)
    return json(
      { error: "Each routine sends its own kind of retro with its own token." },
      403,
    );
  const pii = personalDetails(JSON.stringify(parsed.data));
  if (pii)
    return json(
      { error: `${pii} Retros never carry a reader's details.` },
      422,
    );
  try {
    const r = await storeRetro(parsed.data);
    return r.stored ? json(r) : json(r, 429);
  } catch (e) {
    console.error("[news] retro failed", (e as Error).message);
    return json({ error: "Couldn't store the retro. Try again." }, 500);
  }
}
