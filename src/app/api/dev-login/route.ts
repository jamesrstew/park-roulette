import { NextResponse, type NextRequest } from "next/server";
import { setExplorer } from "@/lib/session";

/** Local development only: /api/dev-login?id=1 signs you in as explorer 1. */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL)
    return new NextResponse("Not found", { status: 404 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0)
    return new NextResponse("?id=<explorer id>", { status: 400 });
  await setExplorer(id);
  return NextResponse.redirect(
    new URL(req.nextUrl.searchParams.get("next") ?? "/", req.url),
  );
}
