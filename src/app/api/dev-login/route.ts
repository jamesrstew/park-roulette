import { NextResponse, type NextRequest } from "next/server";
import { setExplorer } from "@/lib/session";

/** Local development only: /api/dev-login?id=1 signs you in as explorer 1. */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL)
    return new NextResponse("Not found", { status: 404 });
  // Only from this machine (next dev also listens on the LAN).
  const host = req.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
    return new NextResponse("Not found", { status: 404 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0)
    return new NextResponse("?id=<explorer id>", { status: 400 });
  await setExplorer(id);
  // Same-site paths only: "/list" yes, "//evil.com" or "https://…" no.
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(safe, req.url));
}
