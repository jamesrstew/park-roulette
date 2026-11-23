import { igRedirectPath } from "@/lib/social/links";

/**
 * Instagram's bio link (parkroulette.quest/ig) and older keyword DMs: the
 * grid of our posts lives at /social now. A permanent redirect that keeps
 * every query param, adding from=ig when there's none (the bio link).
 */
export function GET(req: Request) {
  const url = new URL(req.url);
  return new Response(null, {
    status: 308,
    headers: {
      location: igRedirectPath(url.searchParams),
      "cache-control": "public, max-age=3600",
    },
  });
}
