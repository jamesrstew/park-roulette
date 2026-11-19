import { unsubscribe } from "@/lib/news/subscribers";

/**
 * Unsubscribe, with no sign-in. Mail apps POST "List-Unsubscribe=One-Click"
 * here (RFC 8058) and get a plain 200, no redirect. The "Stop emails"
 * button on /news/unsubscribe POSTs here too and lands back on that page.
 * A GET never unsubscribes: it goes to the page with the button.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  const token = url.searchParams.get("t") ?? form?.get("t");
  const fromPage = form?.get("from") === "page";
  await unsubscribe(token, fromPage ? "email_link" : "one_click");
  if (fromPage)
    return new Response(null, {
      status: 303,
      headers: {
        location: "/news/unsubscribe?done=1",
        "cache-control": "no-store",
      },
    });
  // Same answer whether or not the token matched: nothing to learn here.
  return new Response("You're unsubscribed.", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  return new Response(null, {
    status: 303,
    headers: {
      location: `/news/unsubscribe?t=${encodeURIComponent(t)}`,
      "cache-control": "no-store",
    },
  });
}
