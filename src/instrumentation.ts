import type { Instrumentation } from "next";

/**
 * Any server error while rendering a page, a route handler or an action:
 * email James (throttled per route). Imported lazily so the alert code
 * (database, Resend) only loads on the Node.js server when needed.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  _request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // notFound() and redirect() are control flow, not errors.
  const digest = (err as { digest?: string })?.digest ?? "";
  if (/^(NEXT_NOT_FOUND|NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK)/.test(digest))
    return;
  const { sendAlert } = await import("./lib/alerts");
  await sendAlert({
    key: `error:${context.routeType}:${context.routePath}`,
    subject: `Something broke on ${context.routePath}`,
    text: `A server error happened while handling ${context.routePath} (${context.routeType}). People may have seen the "crayon snapped" page. Details are in the Vercel logs.`,
  });
};
