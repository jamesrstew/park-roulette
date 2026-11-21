import "server-only";
import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { structuredText } from "@/lib/events/structured";
import { allowedLink } from "./catalog";
import { pageText, type Fetcher } from "./validate";

/**
 * The validator's network: fetch a page (or image) the way a reader would
 * land on it, without letting a link walk us somewhere it shouldn't.
 * Redirects are followed by hand, at most 3, and every hop must be on the
 * link's allowlist and resolve to a public address (never a private,
 * loopback or link-local one), checked before any body is read. Bodies
 * are capped at 2 MB, and the whole fetch at 15 seconds.
 */

export { UA } from "./ua";
import { UA } from "./ua";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_HOPS = 3;

/** IPv4 as a 32-bit number. */
function v4(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

/** IPv4 ranges that aren't on the public internet (RFC 6890 and friends). */
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
];

/** Expand an IPv6 address to 8 groups of 16 bits (null if it isn't one). */
function v6Groups(ip: string): number[] | null {
  let x = ip.toLowerCase().split("%")[0];
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two groups.
  const dotted = x.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4(dotted[1]);
    x =
      x.slice(0, -dotted[1].length) +
      `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = x.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  const groups = [
    ...h,
    ...Array(tail !== undefined ? fill : 0).fill("0"),
    ...t,
  ];
  const out = groups.map((g) => parseInt(g, 16));
  return out.length === 8 && out.every((g) => g >= 0 && g <= 0xffff)
    ? out
    : null;
}

/** Private, loopback, link-local and other not-on-the-internet addresses. */
export function privateAddress(ip: string): boolean {
  const v = isIP(ip.split("%")[0]);
  if (v === 4) {
    const n = v4(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (v4(base) & mask) >>> 0;
    });
  }
  if (v === 6) {
    const g = v6Groups(ip);
    if (!g) return true;
    const embedded = (hi: number, lo: number) =>
      `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    // Unspecified and loopback.
    if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true;
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4.
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0))
      return privateAddress(embedded(g[6], g[7]));
    // NAT64 (64:ff9b::/96): judge the IPv4 inside.
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
      return privateAddress(embedded(g[6], g[7]));
    // 6to4 (2002::/16): the IPv4 is in groups 1 and 2.
    if (g[0] === 0x2002) return privateAddress(embedded(g[1], g[2]));
    return (
      (g[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
      (g[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
      (g[0] & 0xffc0) === 0xfec0 || // old site-local fec0::/10
      (g[0] & 0xff00) === 0xff00 || // multicast ff00::/8
      (g[0] === 0x2001 && g[1] === 0x0db8) || // documentation 2001:db8::/32
      (g[0] === 0x2001 && g[1] < 0x0200) || // IETF special 2001::/23 (Teredo, ORCHID...)
      g[0] === 0x0100 // discard 100::/64
    );
  }
  return true;
}

/** At most this long for one DNS lookup (the fetch's own timeout doesn't cover it). */
export const DNS_TIMEOUT_MS = 5_000;

/** A DNS lookup that gives up after DNS_TIMEOUT_MS. */
function lookupAll(hostname: string, options: LookupOptions = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    lookup(hostname, { ...options, all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(
          `${hostname} lookup timed out`,
        ) as NodeJS.ErrnoException;
        err.code = "ETIMEDOUT";
        reject(err);
      }, DNS_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function publicHost(hostname: string): Promise<boolean> {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (isIP(h)) return !privateAddress(h);
  try {
    const all = await lookupAll(h);
    return all.length > 0 && all.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}

/**
 * The connection's own DNS lookup, pinned: the address we connect to is
 * the one we checked, so a host can't pass the check with a public
 * address and then answer the real connection with a private one (DNS
 * rebinding). Every address the lookup returns must be public.
 */
export function pinnedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  lookupAll(hostname, options)
    .then((all) => {
      if (!all.length || all.some((a) => privateAddress(a.address))) {
        const err = new Error(
          `${hostname} resolves to a private address`,
        ) as NodeJS.ErrnoException;
        err.code = "EPRIVATE";
        return callback(err, []);
      }
      if (options.all) return callback(null, all);
      callback(null, all[0].address, all[0].family);
    })
    .catch((e) => callback(e as NodeJS.ErrnoException, []));
}

const agent = new Agent({ connect: { lookup: pinnedLookup } });

/** The registrable part of a host ("www.visitbend.com" -> "visitbend.com"). */
function registrable(host: string): string {
  const labels = host.toLowerCase().split(".");
  return labels.slice(/\.or\.us$/.test(host) ? -4 : -2).join(".");
}

/**
 * A bot check instead of the page: a redirect with nowhere to go, or a
 * known challenge page (Sucuri, Cloudflare). We report these; we never
 * try to get past them.
 */
export function botWall(
  status: number,
  server: string,
  html: string,
): string | null {
  const s = server.toLowerCase();
  const h = html.slice(0, 4000).toLowerCase();
  if (/sucuri/.test(s) || /sucuri_cloudproxy/.test(h))
    return "a Sucuri bot check (it needs JavaScript)";
  if (
    /cloudflare/.test(s) &&
    (status === 403 || status === 503 || /cf-chl|challenge-platform/.test(h))
  )
    return "a Cloudflare bot check";
  if (status >= 300 && status < 400) return "a redirect with nowhere to go";
  if (
    /javascript is required|enable javascript (and cookies )?to continue/.test(
      h,
    )
  )
    return "a page that needs JavaScript";
  return null;
}

/**
 * Follow redirects by hand (at most 3), checking every hop against the
 * allowlist and for a public address before connecting. `refused` when a
 * hop isn't allowed (0) or there are too many (310).
 */
async function safeFetch(
  start: string,
  domains: readonly string[],
  accept: string,
  signal: AbortSignal,
): Promise<{ res: Response; url: string } | { refused: number; url: string }> {
  let url = start;
  // Cookies a site sets on one hop go back to it on the next (a session
  // or consent cookie), within this one fetch only, and only to the same
  // site. Nothing is kept between fetches.
  const jar = new Map<string, string>();
  for (let hop = 0; ; hop++) {
    const u = new URL(url);
    if (!allowedLink(url, domains) || !(await publicHost(u.hostname)))
      return { refused: 0, url };
    const site = registrable(u.hostname);
    const cookie = [...jar]
      .filter(([k]) => k.startsWith(`${site}|`))
      .map(([k, v]) => `${k.split("|")[1]}=${v}`)
      .join("; ");
    const res = await undiciFetch(url, {
      dispatcher: agent,
      redirect: "manual",
      headers: {
        "user-agent": UA,
        accept,
        "accept-language": "en-US,en;q=0.9",
        ...(cookie ? { cookie } : {}),
      },
      signal,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0)
        jar.set(`${site}|${pair.slice(0, i).trim()}`, pair.slice(i + 1).trim());
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (hop >= MAX_HOPS) return { refused: 310, url };
      url = new URL(location, url).toString();
      continue;
    }
    return { res: res as unknown as Response, url };
  }
}

async function readCapped(
  res: Response,
  max: number,
): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/**
 * An image, safely (same hop rules as pages), for drawing into our own
 * images: at most 8 MB, image/* only. Null otherwise.
 */
export async function fetchImage(
  url: string,
  domains: readonly string[],
  /** The Accept header (social photos ask for anything, like curl does). */
  accept = "image/*",
): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const got = await safeFetch(
      url,
      domains,
      accept,
      AbortSignal.timeout(15_000),
    );
    if ("refused" in got) return null;
    const type = got.res.headers.get("content-type") ?? "";
    if (!got.res.ok || !type.startsWith("image/")) {
      await got.res.body?.cancel();
      return null;
    }
    const bytes = await readCapped(got.res, 8 * 1024 * 1024);
    return bytes ? { bytes, type: type.split(";")[0] } : null;
  } catch {
    return null;
  }
}

/**
 * A fetch that never got an answer: a reset, a timeout or a TLS failure
 * (undici wraps the cause, sometimes twice). Null for anything else, which
 * is a bug to surface, not a site to report.
 */
export function networkFailure(
  e: unknown,
): { reason: string; kind: "reset" | "timeout" } | null {
  const seen: string[] = [];
  for (
    let x = e as { code?: unknown; name?: unknown; cause?: unknown } | null,
      i = 0;
    x && i < 4;
    x = x.cause as typeof x, i++
  )
    seen.push(String(x.code ?? ""), String(x.name ?? ""));
  const has = (re: RegExp) => seen.some((s) => re.test(s));
  if (has(/^(ECONNRESET|EPIPE|ECONNREFUSED|UND_ERR_SOCKET|UND_ERR_CLOSED)$/))
    return { reason: "connection reset", kind: "reset" };
  if (
    has(
      /^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|TimeoutError|AbortError)$/,
    )
  )
    return { reason: "timed out", kind: "timeout" };
  if (
    has(/^(EPROTO|ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_)/)
  )
    return { reason: "TLS error", kind: "reset" };
  return null;
}

/** What a page reader accepts (with our own honest User-Agent). */
const PAGE_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
/** What a data reader accepts: the JSON (or .ics) a page's own script loads. */
const DATA_ACCEPT = "application/json,text/calendar;q=0.9,*/*;q=0.5";

/**
 * An organizer's data endpoint, not a page: an api. host, a REST path
 * (/wp-json/, /api/, /public/v2/), a .json or .ics file, or a format=json
 * query. We
 * ask these for their data the way the organizer's own page does; asking
 * for HTML gets a browsable API page (Django REST framework's) whose text
 * isn't the record.
 */
export function dataUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    /^api\./i.test(u.hostname) ||
    /\/(wp-json|api|graphql|public\/v\d+)(\/|$)/i.test(u.pathname) ||
    /\.(json|ics)$/i.test(u.pathname) ||
    /^(json|ics|ical)$/i.test(u.searchParams.get("format") ?? "")
  );
}

/**
 * The same data URL with the API's own format switch (format=json), for
 * when an API answered HTML anyway: a shared cache in front of it that
 * ignores Vary: Accept (Cloudflare in front of the High Desert Museum's
 * CMS, November 2026) hands back the browsable page another reader asked
 * for. The switch is part of the URL, so the cache keeps it apart.
 */
export function withJsonFormat(url: string): string | null {
  const u = new URL(url);
  if (u.searchParams.has("format")) return null;
  u.searchParams.set("format", "json");
  return u.toString();
}

export const fetchPage: Fetcher = async (start, domains) => {
  const data = dataUrl(start);
  const first = await fetchOnce(start, domains, data);
  // An API that answered a page: ask once more with its format switch.
  if (
    data &&
    first.status === 200 &&
    /html/i.test(first.contentType ?? "") &&
    !first.blocked
  ) {
    const again = withJsonFormat(start);
    if (again) {
      const second = await fetchOnce(again, domains, true);
      if (second.status === 200 && second.data) return second;
    }
  }
  return first;
};

async function fetchOnce(
  start: string,
  domains: readonly string[],
  data: boolean,
): ReturnType<Fetcher> {
  let got: Awaited<ReturnType<typeof safeFetch>>;
  try {
    got = await safeFetch(
      start,
      domains,
      // Browser-style Accept for pages, with our own honest User-Agent: we
      // never pretend to be a browser to get past a bot check.
      data ? DATA_ACCEPT : PAGE_ACCEPT,
      AbortSignal.timeout(15_000),
    );
  } catch (e) {
    const f = networkFailure(e);
    if (!f) throw e;
    return {
      status: 0,
      finalUrl: start,
      text: "",
      unreachable: f.reason,
      blockedKind: f.kind,
    };
  }
  if ("refused" in got)
    return { status: got.refused, finalUrl: got.url, text: "" };
  const { res, url } = got;
  const contentType = res.headers.get("content-type") ?? "";
  let html = "";
  // An image only needs its status and type; don't read it.
  if (contentType.startsWith("image/")) await res.body?.cancel();
  else {
    const bytes = await readCapped(res, MAX_BYTES);
    // Over 2 MB: not a page we quote from (its text stays empty).
    html = bytes ? new TextDecoder().decode(bytes) : "";
  }
  const wall =
    res.status === 200 && !/sucuri_cloudproxy|cf-chl/i.test(html.slice(0, 4000))
      ? null
      : botWall(res.status, res.headers.get("server") ?? "", html);
  // JSON and .ics are data, not a page: their records are the evidence.
  const machine = /json|text\/calendar/i.test(contentType);
  const records = res.ok && !wall ? structuredText(html, contentType) : "";
  return {
    status: res.status,
    finalUrl: url,
    text: res.ok && !machine ? pageText(html) : "",
    contentType,
    ...(wall ? { blocked: wall, blockedKind: "bot_check" as const } : {}),
    ...(records ? { data: records } : {}),
  };
}
