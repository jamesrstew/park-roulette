import { json, maintainerOk, nope } from "@/lib/news/http";
import { LESSON_STATUSES, type LessonStatus } from "@/lib/news/lessons";
import { listLessons } from "@/lib/news/lessons-store";

/**
 * The Sunday maintainer's read (bearer MAINTAINER_TOKEN):
 * ?status=open,needs_james,fix_proposed (the default).
 */
export async function GET(req: Request) {
  if (!maintainerOk(req)) return nope();
  const raw = new URL(req.url).searchParams.get("status");
  const statuses = (raw ?? "open,needs_james,fix_proposed")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !statuses.length ||
    statuses.some((s) => !LESSON_STATUSES.includes(s as LessonStatus))
  )
    return json(
      { error: `status is a list of: ${LESSON_STATUSES.join(", ")}.` },
      400,
    );
  return json({ lessons: await listLessons(statuses as LessonStatus[]) });
}
