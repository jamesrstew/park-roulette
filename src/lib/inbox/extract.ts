import { cleanLink } from "@/lib/events/validate";
import { normalizeText, pageText } from "@/lib/news/validate";

/**
 * A newsletter email as we keep it (lib/inbox): its HTML without tracking
 * pixels or subscriber-only links (unsubscribe, preferences, referral),
 * every other link unwrapped to its real target where we can tell it,
 * and its text exactly as the events checker reads a web page
 * (lib/news/validate.ts pageText), so a quote from it is verifiable the
 * same way. Pure: no network, no database.
 *
 * Where a link's target is in the link itself (?url=, ?u=, google.com/url?q=,
 * a path holding https%3A%2F%2F...) it is unwrapped. Beehiiv's and
 * SendGrid's click links are opaque, but their text/plain part prints the
 * real targets as [anchor](url), in the same order: an opaque link takes
 * the target of the plain part's link with the same anchor text, matched
 * in order. Otherwise the link stays as it is.
 */

export type IssueLink = { text: string; url: string };
export type CleanIssue = { html: string; text: string; links: IssueLink[] };

/** Query keys that carry a redirect's target. */
const TARGET_KEYS = [
  "url",
  "u",
  "target",
  "targeturl",
  "target_url",
  "redirect",
  "redirect_url",
  "redirect_uri",
  "redir",
  "dest",
  "destination",
  "link",
  "to",
  "goto",
  "r",
];

/** Click trackers whose links hide the target (only the plain part has it). */
const TRACKER_HOSTS = [
  "link.mail.beehiiv.com",
  "list-manage.com",
  "ct.sendgrid.net",
  "sendgrid.net",
  "mailchimp.com",
  "click.convertkit-mail.com",
  "convertkit-mail2.com",
  "substack.com",
];

const isHttp = (u: string) => /^https?:\/\/[^/\s]+/i.test(u);

/**
 * A click tracker's link (its target isn't in the URL): a known tracker
 * host, a tracking subdomain, or a branded tracking path on the sender's
 * own domain (SendGrid's url1234.example.com/ls/click?upn=..., a
 * /c/<opaque token> or /ss/c/... path).
 */
export function isTracker(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  const h = url.hostname.toLowerCase();
  const path = url.pathname;
  return (
    TRACKER_HOSTS.some((d) => h === d || h.endsWith(`.${d}`)) ||
    /^(link|links|click|clicks|track|trk|email|e)\.[^.]+\.[a-z]+/.test(h) ||
    /^u\d+\.ct\./.test(h) ||
    /^url\d+\./.test(h) ||
    /^\/(ls\/click|wf\/click)\b/i.test(path) ||
    /^\/(ss\/c|v2\/c)\//i.test(path) ||
    opaqueClick(path)
  );
}

/**
 * A /c/<token> path whose token is opaque (digits, mixed case, or 16+
 * characters), on any host or subdomain: a click tracker's, not a page
 * like /c/family.
 */
function opaqueClick(path: string): boolean {
  const m = path.match(/^\/c\/([^/]+)/);
  if (!m) return false;
  const t = m[1];
  return t.length >= 16 || /\d/.test(t) || (/[a-z]/.test(t) && /[A-Z]/.test(t));
}

/**
 * A link the harvest may follow: not a tracker, unless its anchor prints
 * the very page it opens (an organizer's address, "example.org/c/x1").
 */
export function keepLink(url: string, text: string): boolean {
  if (!isTracker(url)) return true;
  if (!opaqueClick(new URL(url).pathname)) return false;
  const shown = text
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
  const real = url
    .replace(/^https?:\/\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "");
  return !!shown && shown.replace(/^www\./, "") === real.replace(/^www\./, "");
}

function decodeOnce(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * A redirect's target when the URL carries it, else the URL itself.
 * Unwraps up to 3 layers, then strips tracking parameters (utm_*...).
 */
export function unwrapLink(href: string): string {
  let u = href.trim();
  for (let i = 0; i < 3; i++) {
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      return u;
    }
    if (!/^https?:$/.test(url.protocol)) return u;
    let next: string | null = null;
    const google = /(^|\.)google\.[a-z.]+$/.test(url.hostname);
    for (const k of google && url.pathname === "/url"
      ? ["q", ...TARGET_KEYS]
      : TARGET_KEYS) {
      const v = url.searchParams.get(k);
      if (v && isHttp(v)) {
        next = v;
        break;
      }
    }
    if (!next) {
      // A target inside the path: /click/https%3A%2F%2Fexample.org%2F...
      const m = url.pathname.match(/\/(https?(?::|%3A)(?:\/\/|%2F%2F).+)$/i);
      if (m) {
        const v = decodeOnce(m[1]);
        if (isHttp(v)) next = v + url.search;
      }
    }
    if (!next) break;
    u = next;
  }
  return isHttp(u) ? cleanLink(u) : u;
}

/** Anchor words that mean the link belongs to the subscriber. */
const PRIVATE_TEXT =
  /\b(unsubscribe|manage (your )?(subscription|preferences|account)|update (your )?(profile|preferences)|email preferences|opt[- ]?out|refer(ral)?s?\b|share your (referral )?link|click to share)/i;
/** URL parts that do (an unsubscribe token, a referral code...). */
const PRIVATE_URL =
  /unsub|unsubscribe|\/preferences|manage[-_]?subscription|update[-_]?profile|opt[-_]?out|\/referral|[?&]ref(erral)?_?code=|\/subscribe(\/|\?|$)/i;

/** Words just before a link that say it's the subscriber's own. */
const PRIVATE_NEAR =
  /\b(unsubscrib\w*|opt[- ]?out|(email |your |subscription )preferences|manag\w* (your )?(subscription|preferences|account)|update (your )?(profile|preferences)|refer(ral)? (a friend|program|link)|share your (referral )?link)\b/i;
/** How much text before a link counts as "near" it. */
const NEAR_CHARS = 120;

/**
 * A link that carries the subscriber (never kept: the html is ours): by
 * its URL, its anchor text, or the words just before it ("Update your
 * email preferences or unsubscribe here").
 */
export function isPrivateLink(url: string, text = "", before = ""): boolean {
  if (/^mailto:/i.test(url)) return /unsub/i.test(url);
  return (
    PRIVATE_URL.test(url) ||
    PRIVATE_TEXT.test(text) ||
    PRIVATE_NEAR.test(before.slice(-NEAR_CHARS))
  );
}

/** Pixel or open-tracking images: 0 or 1 pixel, hidden, or an open tracker. */
export function isPixel(img: string): boolean {
  const attr = (n: string) =>
    img.match(new RegExp(`\\b${n}\\s*=\\s*["']?\\s*([\\d.]+)`, "i"))?.[1];
  const w = attr("width");
  const h = attr("height");
  if ((w && Number(w) <= 1) || (h && Number(h) <= 1)) return true;
  if (/(width|height)\s*:\s*[01](\.0+)?px/i.test(img)) return true;
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(img)) return true;
  const src = img.match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "";
  return /\/(ss\/o|v2\/o)\/|\/(wf|track|e)\/open\b|\/open\.(gif|png)\b|[?&](open|pixel)=|\/pixel(\.gif|\.png|\/)/i.test(
    src,
  );
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  "#39": "'",
  "#x27": "'",
  "#x2f": "/",
  "#47": "/",
  "#61": "=",
  "#x3d": "=",
};
const attrDecode = (s: string) =>
  s.replace(/&(amp|quot|apos|lt|gt|#39|#x27|#x2f|#47|#61|#x3d);/gi, (_m, e) =>
    String(ENTITIES[String(e).toLowerCase()] ?? _m),
  );
const attrEncode = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Anchor text for matching: page text, lowercase, no markdown marks. */
const anchorKey = (s: string) =>
  normalizeText(s.replace(/[*_~`]+/g, " "))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The plain part's links, in order: [anchor](url), and beehiiv's
 * "Follow image link: (url)" (an image link: no anchor text).
 */
export function plainLinks(plain: string): IssueLink[] {
  const out: { at: number; text: string; url: string }[] = [];
  for (const m of plain.matchAll(
    /\[([^\]\n]{0,300})\]\((https?:\/\/[^\s)]+)\)/g,
  ))
    out.push({ at: m.index ?? 0, text: m[1], url: m[2] });
  for (const m of plain.matchAll(
    /Follow image link:\s*\((https?:\/\/[^\s)]+)\)/g,
  ))
    out.push({ at: m.index ?? 0, text: "", url: m[1] });
  return out
    .sort((a, b) => a.at - b.at)
    .map(({ text, url }) => ({ text, url }));
}

/** How far ahead to look for an anchor's twin in the plain part. */
const LOOKAHEAD = 12;

/** Most links kept per issue. */
export const MAX_LINKS = 400;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A pattern for an address and its variants: any +tag, "@" as "%40",
 * and for Gmail, dots anywhere in the local part and googlemail.com.
 */
export function addressPattern(address: string): RegExp | null {
  const m = address
    .trim()
    .toLowerCase()
    .match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return null;
  const local = m[1].split("+")[0];
  const gmail = m[2] === "gmail.com" || m[2] === "googlemail.com";
  const localRe = gmail
    ? [...local.replace(/\./g, "")].map(esc).join("\\.?")
    : esc(local);
  const domainRe = gmail ? "(?:gmail|googlemail)\\.com" : esc(m[2]);
  return new RegExp(
    `(?<![\\w.+-])${localRe}(?:\\+[\\w.-]*)?(?:@|%40)${domainRe}`,
    "gi",
  );
}

/** Greetings that may carry the subscriber's name ("Hi James,"). */
const GREETING =
  "(hi|hello|hey|howdy|dear|welcome|good (?:morning|afternoon|evening)|thanks|thank you)";

/**
 * The subscriber's addresses (and their variants) become "[subscriber]";
 * a greeting with one of their names becomes "there" ("Hi there,").
 */
function scrubAddresses(
  s: string,
  scrub: readonly string[],
  names: readonly string[] = [],
): string {
  let out = s;
  for (const a of scrub) {
    const re = a && addressPattern(a);
    if (re) out = out.replace(re, "[subscriber]");
  }
  // Any address in a greeting ("Hi jane@example.com,") is the subscriber's.
  out = out.replace(
    new RegExp(
      `\\b${GREETING}([,!]?\\s+)[^\\s@<>"']+(?:@|%40)[^\\s<>,!;"']+`,
      "gi",
    ),
    "$1$2there",
  );
  for (const n of names) {
    const name = n.trim();
    if (!name) continue;
    out = out.replace(
      new RegExp(`\\b${GREETING}([,!]?\\s+)${esc(name)}\\b`, "gi"),
      "$1$2there",
    );
  }
  return out;
}

/** The plain part as text: links as their words, URLs and image lines out. */
function plainText(plain: string): string {
  return plain
    .replace(/^\s*View image:.*$/gim, " ")
    .replace(/^\s*Follow image link:.*$/gim, " ")
    .replace(/\[([^\]\n]{0,300})\]\((?:https?:\/\/|mailto:)[^\s)]*\)/g, "$1")
    .replace(/\((?:https?:\/\/|mailto:)[^\s)]*\)/g, " ")
    .replace(/<?(?:https?:\/\/|mailto:)[^\s<>)\]]+>?/g, " ")
    .replace(/[*_]{1,3}/g, "");
}

/**
 * Clean one issue. `plain` is the email's text/plain part (for opaque
 * click links); `scrub` the subscriber's own addresses (never kept).
 */
export function cleanIssue(input: {
  html: string | null;
  plain?: string | null;
  scrub?: readonly string[];
  /** The subscriber's names, as a greeting may print them. */
  names?: readonly string[];
}): CleanIssue {
  const scrub = input.scrub ?? [];
  const names = input.names ?? [];
  const plain = input.plain ?? "";
  if (!input.html?.trim()) {
    // The same link rules as html: unwrapped, no trackers, nothing of
    // the subscriber's (by URL, anchor or the words before it).
    const links: IssueLink[] = [];
    for (const m of plain.matchAll(
      /\[([^\]\n]{0,300})\]\((https?:\/\/[^\s)]+)\)/g,
    )) {
      const text = anchorText(m[1]);
      const url = unwrapLink(m[2]);
      const before = normalizeText(
        plainText(plain.slice(Math.max(0, (m.index ?? 0) - 400), m.index)),
      );
      if (
        !isHttp(url) ||
        !keepLink(url, text) ||
        isPrivateLink(url, text, before)
      )
        continue;
      links.push({ text: scrubAddresses(text, scrub, names), url });
    }
    return {
      html: "",
      text: normalizeText(scrubAddresses(plainText(plain), scrub, names)),
      links: dedupeLinks(links),
    };
  }
  const twins = plainLinks(plain);
  let ptr = 0;
  const links: IssueLink[] = [];
  let html = input.html
    // Pixels: dropped outright.
    .replace(/<img\b[^>]*>/gi, (img) => (isPixel(img) ? "" : img));
  const source = html;
  html = html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi,
    (whole, attrs: string, inner: string, at: number) => {
      const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (!m) return whole;
      const href = attrDecode((m[2] ?? m[3] ?? m[4] ?? "").trim());
      const text = anchorText(pageText(inner));
      // Its twin in the plain part, matched in order. An image link (no
      // anchor text) only takes the very next one: the plain part skips
      // some images, and a long jump would skip real links.
      const key = anchorKey(text);
      let twin: IssueLink | undefined;
      const span = key ? LOOKAHEAD : 1;
      for (let j = ptr; j < Math.min(twins.length, ptr + span); j++)
        if (anchorKey(twins[j].text) === key) {
          twin = twins[j];
          ptr = j + 1;
          break;
        }
      let url = unwrapLink(href);
      if (isTracker(url) && twin && !isTracker(unwrapLink(twin.url)))
        url = unwrapLink(twin.url);
      const without = whole.replace(m[0], "");
      if (!isHttp(url)) return /^mailto:/i.test(url) ? without : whole;
      const before = pageText(source.slice(Math.max(0, at - 2000), at));
      if (
        isPrivateLink(url, text, before) ||
        (twin && isPrivateLink(twin.url, text))
      )
        return without;
      // A click tracker we couldn't resolve stays in the html (it's never
      // shown) but never in the links the harvest reads.
      if (keepLink(url, text)) links.push({ text, url });
      return whole.replace(m[0], `href="${attrEncode(url)}"`);
    },
  );
  html = scrubAddresses(html, scrub, names);
  return {
    html,
    text: pageText(html),
    links: dedupeLinks(
      links.map((l) => ({ ...l, text: scrubAddresses(l.text, scrub, names) })),
    ),
  };
}

/** Anchor text as kept: page text, markdown marks out, 200 characters. */
function anchorText(s: string): string {
  return normalizeText(s.replace(/[*_]{1,3}/g, "")).slice(0, 200);
}

function dedupeLinks(links: IssueLink[]): IssueLink[] {
  const seen = new Set<string>();
  const out: IssueLink[] = [];
  for (const l of links) {
    const k = `${l.text}\n${l.url}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}
