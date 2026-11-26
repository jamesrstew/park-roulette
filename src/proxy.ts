import { type NextRequest, NextResponse } from "next/server";
import { guideGone } from "@/lib/guide-gone";

/**
 * A gone guide is a real 404, not a streamed "not found" under a 200
 * (lib/guide-gone.ts). Only the guide pages pass through here.
 */
export const config = {
  matcher: ["/guides/:slug", "/guides/pairings/:slug"],
};

export async function proxy(req: NextRequest) {
  const gone = await guideGone(req.nextUrl.pathname).catch(() => false);
  if (gone)
    return NextResponse.rewrite(new URL("/_not-found", req.url), {
      status: 404,
    });
  return NextResponse.next();
}
