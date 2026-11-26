import { type NextRequest, NextResponse } from "next/server";
import { guideGone } from "@/lib/guide-gone";

/**
 * A gone guide is a real 404, not a streamed "not found" under a 200
 * (lib/guide-gone.ts). Only the guide pages pass through here.
 */
export const config = {
  matcher: ["/guides/:slug", "/guides/pairings/:slug"],
};

/**
 * A slow database (a new connection through Railway's proxy can hang for
 * seconds) must never hold up a page: after this long, the page renders
 * as before and decides for itself.
 */
const GONE_CHECK_MS = 1_500;

export async function proxy(req: NextRequest) {
  // Link prefetches and client navigations (RSC requests) don't need a
  // status: only crawlers and first loads do. No query for them.
  if (req.headers.get("rsc") || req.nextUrl.searchParams.has("_rsc"))
    return NextResponse.next();
  const gone = await Promise.race([
    guideGone(req.nextUrl.pathname).catch(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(false), GONE_CHECK_MS)),
  ]);
  if (gone)
    return NextResponse.rewrite(new URL("/_not-found", req.url), {
      status: 404,
    });
  return NextResponse.next();
}
