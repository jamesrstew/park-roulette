import "server-only";
import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
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

const UA =
  "Mozilla/5.0 (compatible; ParkRouletteNews/1.0; +https://parkroulette.quest; hello@parkroulette.quest)";
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

async function publicHost(hostname: string): Promise<boolean> {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (isIP(h)) return !privateAddress(h);
  try {
    const all = await lookup(h, { all: true });
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
  lookup(hostname, { ...options, all: true })
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
  for (let hop = 0; ; hop++) {
    const u = new URL(url);
    if (!allowedLink(url, domains) || !(await publicHost(u.hostname)))
      return { refused: 0, url };
    const res = await undiciFetch(url, {
      dispatcher: agent,
      redirect: "manual",
      headers: { "user-agent": UA, accept },
      signal,
    });
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
): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const got = await safeFetch(
      url,
      domains,
      "image/*",
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

export const fetchPage: Fetcher = async (start, domains) => {
  const got = await safeFetch(
    start,
    domains,
    "text/html,image/*,*/*;q=0.8",
    AbortSignal.timeout(15_000),
  );
  if ("refused" in got)
    return { status: got.refused, finalUrl: got.url, text: "" };
  const { res, url } = got;
  const contentType = res.headers.get("content-type") ?? "";
  let html = "";
  // An image only needs its status and type; don't read it.
  if (contentType.startsWith("image/") || !res.ok) await res.body?.cancel();
  else {
    const bytes = await readCapped(res, MAX_BYTES);
    // Over 2 MB: not a page we quote from (its text stays empty).
    html = bytes ? new TextDecoder().decode(bytes) : "";
  }
  return {
    status: res.status,
    finalUrl: url,
    text: pageText(html),
    contentType,
  };
};
