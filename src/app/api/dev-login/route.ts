import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { explorers } from "@/db/schema";
import { safeNext } from "@/lib/phone-format";
import { setExplorer } from "@/lib/session";

/** Local development only: /api/dev-login?id=1 signs you in as explorer 1. */
export async function GET(req: NextRequest) {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL ||
    // `next dev` listens on the whole Wi-Fi: only ever for a local database.
    !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
  )
    return new NextResponse("Not found", { status: 404 });
  // Only from this machine (next dev also listens on the LAN).
  const host = req.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
    return new NextResponse("Not found", { status: 404 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0)
    return new NextResponse("?id=<explorer id>", { status: 400 });
  const [row] = await db
    .select({ epoch: explorers.sessionEpoch })
    .from(explorers)
    .where(eq(explorers.id, id));
  if (!row) return new NextResponse("No such explorer", { status: 404 });
  await setExplorer(id, row.epoch, "c");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(new URL(next, req.url));
}
