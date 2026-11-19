import { confirmEmail } from "@/lib/news/subscribers";

/**
 * The "Yes, send me park picks" button on /news/confirm. A POST, never the
 * link itself: mail scanners open links, and a scanner shouldn't be able
 * to say yes for anyone.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  // Whether it joined a family is shown from the account itself on the
  // result page (never from a query flag someone could type).
  const { result } = await confirmEmail(form?.get("t"));
  return new Response(null, {
    status: 303,
    headers: {
      location: `/news/confirm?r=${result}`,
      "cache-control": "no-store",
    },
  });
}
