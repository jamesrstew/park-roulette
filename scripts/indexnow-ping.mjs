#!/usr/bin/env node
/**
 * IndexNow: tell Bing (and every engine that shares IndexNow) which pages
 * changed, instead of waiting for a crawl. Ported from Belief Systems
 * (apps/website/scripts/indexnow-ping.mjs).
 *
 * Runs daily (.github/workflows/indexnow.yml, 6:10 am Pacific), and by hand
 * after Thursday's draft and event submission (workflow_dispatch). It sends:
 *
 * - Sitemap pages whose lastmod falls in the window. Every lastmod in our
 *   sitemap is a real change time (a park added, a review, an issue sent,
 *   an event's facts changed), never a build time; pages with no real date
 *   carry no lastmod and are never sent.
 * - Pages that left the sitemap or changed state in the window, from
 *   /api/indexnow/changes: an event that passed, couldn't be confirmed,
 *   was canceled or rescheduled. IndexNow wants those too (a cancellation
 *   is the most valuable ping we send), and the sitemap can't show them.
 *
 * IndexNow asks for changed URLs only, so nothing else is sent.
 *
 * A failed ping breaks nothing: engines find the change at their normal
 * crawl pace. The workflow fails loudly (GitHub emails the repo owner) when
 * the run doesn't end with INDEXNOW_OK.
 *
 * The key is public by design. It proves we control the host; anyone
 * holding it can only ask engines to recrawl our own URLs (if it is ever
 * abused, rotate it). Keep the key file (public/<key>.txt) in place:
 * without it, engines ignore our pings.
 *
 * Usage: node scripts/indexnow-ping.mjs [--hours 48] [--all] [--dry-run]
 * Prints INDEXNOW_OK as its last line on success.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SITE = "https://parkroulette.quest";
export const HOST = "parkroulette.quest";
export const KEY = "955df2379927b5b312f36a3ae28fbb24";
export const KEY_LOCATION = `${SITE}/${KEY}.txt`;
export const SITEMAP = `${SITE}/sitemap.xml`;
export const CHANGES = `${SITE}/api/indexnow/changes`;
export const ENDPOINT = "https://api.indexnow.org/indexnow";
/** IndexNow accepts up to 10,000 URLs per request. */
export const MAX_URLS = 10000;
const FETCH_TIMEOUT_MS = 30000;
/** Never sent: private, per-person or utility pages. */
const NEVER = /^\/(api|admin|me|join|news\/(confirm|unsubscribe)|photos)(\/|$)/;

/** Sitemap entries as { loc, lastmod } (lastmod may be null). */
export function parseSitemap(xml) {
  const entries = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    const lastmod =
      block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1] ?? null;
    if (loc) entries.push({ loc: loc.replace(/&amp;/g, "&"), lastmod });
  }
  return entries;
}

/** One of our own public https URLs, normalized, or null. */
function ours(loc) {
  let url;
  try {
    url = new URL(loc);
  } catch {
    return null;
  }
  if (url.host !== HOST || url.protocol !== "https:") return null;
  if (NEVER.test(url.pathname)) return null;
  return url.href;
}

/**
 * The URLs to send: on our host, public, and (unless `all`) with a change
 * time from `hours` back through now (plus an hour of clock slack).
 * `changes` are /api/indexnow/changes entries ({ url, changedAt }).
 */
export function urlsToSend(
  entries,
  now,
  hours,
  { all = false, changes = [] } = {},
) {
  const since = now.getTime() - hours * 3600 * 1000;
  const until = now.getTime() + 3600 * 1000;
  const inWindow = (iso) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) && t >= since && t <= until;
  };
  const urls = new Set();
  for (const { loc, lastmod } of entries) {
    const href = ours(loc);
    if (href && (all || inWindow(lastmod))) urls.add(href);
  }
  for (const { url, changedAt } of changes) {
    const href = ours(url);
    if (href && inWindow(changedAt)) urls.add(href);
  }
  return [...urls].slice(0, MAX_URLS);
}

export function payload(urls) {
  return { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls };
}

export function parseArgs(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hours = value("--hours") === undefined ? 48 : Number(value("--hours"));
  if (!Number.isFinite(hours) || hours <= 0)
    throw new Error("--hours must be a positive number");
  return {
    hours,
    all: argv.includes("--all"),
    dryRun: argv.includes("--dry-run"),
  };
}

function get(url, init = {}) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function main() {
  const { hours, all, dryRun } = parseArgs(process.argv.slice(2));
  const now = new Date();

  const key = await get(KEY_LOCATION);
  if (!key.ok || (await key.text()).trim() !== KEY)
    throw new Error(
      `key file not live at ${KEY_LOCATION} (HTTP ${key.status}); not pinging`,
    );
  const res = await get(SITEMAP);
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status} at ${SITEMAP}`);
  const entries = parseSitemap(await res.text());
  // An HTML page or an empty sitemap parses to nothing: a fault, not "no changes".
  if (entries.length === 0) throw new Error(`no <url> entries in ${SITEMAP}`);

  const since = new Date(now.getTime() - hours * 3600 * 1000).toISOString();
  const ch = await get(`${CHANGES}?since=${encodeURIComponent(since)}`);
  if (!ch.ok) throw new Error(`changes HTTP ${ch.status} at ${CHANGES}`);
  const changes = (await ch.json()).changes;
  if (!Array.isArray(changes)) throw new Error(`no changes list at ${CHANGES}`);

  const urls = urlsToSend(entries, now, hours, { all, changes });
  const scope = all ? "every URL" : `changes in the last ${hours}h`;
  console.log(
    `IndexNow: ${entries.length} sitemap entries, ${changes.length} state changes, ${urls.length} to send (${scope})`,
  );
  if (all && urls.length === 0)
    throw new Error(`no URL on ${HOST} in ${SITEMAP}`);
  if (dryRun) {
    console.log(urls.join("\n"));
    console.log("INDEXNOW_OK");
    return;
  }
  if (urls.length > 0) {
    const ping = await get(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload(urls)),
    });
    // 200 = received, 202 = received (key check pending).
    console.log(`IndexNow: HTTP ${ping.status} ${ping.statusText}`);
    if (ping.status !== 200 && ping.status !== 202)
      throw new Error(
        `IndexNow refused the ping: ${(await ping.text()).slice(0, 300)}`,
      );
  }
  console.log("INDEXNOW_OK");
}

const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    const cause = err.cause?.code ?? err.cause?.message;
    console.error(`IndexNow: ${err.message}${cause ? ` (${cause})` : ""}`);
    process.exitCode = 1;
  });
}
