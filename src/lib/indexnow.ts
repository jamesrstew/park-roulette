import "server-only";
import { SITE_URL } from "./site";

/**
 * IndexNow, from inside the app: the moment something public appears (an
 * issue goes out, events are added or canceled), tell Bing and the other
 * IndexNow engines, instead of waiting for the daily run
 * (scripts/indexnow-ping.mjs, which catches anything this misses). Only on
 * the production deployment (VERCEL_ENV=production at parkroulette.quest),
 * never from tests, previews or local runs; a failed ping is logged and
 * never breaks the caller.
 */

/** The public key; public/<key>.txt proves we own the host. */
export const INDEXNOW_KEY = "955df2379927b5b312f36a3ae28fbb24";
const PROD_HOST = "parkroulette.quest";

/** The URLs a ping would send: ours, https, de-duplicated (pure). */
export function indexNowBody(urls: readonly string[], site = SITE_URL) {
  const host = new URL(site).host;
  const list = [
    ...new Set(
      urls.filter((u) => {
        try {
          const x = new URL(u);
          return x.host === host && x.protocol === "https:";
        } catch {
          return false;
        }
      }),
    ),
  ].slice(0, 10_000);
  return {
    host,
    key: INDEXNOW_KEY,
    keyLocation: `${site}/${INDEXNOW_KEY}.txt`,
    urlList: list,
  };
}

export async function pingIndexNow(urls: readonly string[]): Promise<void> {
  if (
    process.env.VERCEL_ENV !== "production" ||
    new URL(SITE_URL).host !== PROD_HOST
  )
    return;
  const body = indexNowBody(urls);
  if (!body.urlList.length) return;
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status !== 200 && res.status !== 202)
      console.warn(`[indexnow] said ${res.status}`);
  } catch (e) {
    console.warn("[indexnow] failed", (e as Error)?.message);
  }
}
