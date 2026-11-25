import registryJson from "../../../data/ig-handles.json";
import type { DiscoveredAccount } from "./graph";
import { CAPTION_MAX, type PostKind, type PostSpec } from "./model";

/**
 * Host tags: @-mentions of the organizations behind a post's events and
 * parks, so they see the post and can share it. Accuracy is the whole
 * point, so a handle is tagged only when both directions are proven:
 *
 *   1. Forward: the organization's own site links instagram.com/<handle>.
 *   2. Back: that account (Business Discovery) names the same site, in its
 *      website field or a link in its bio.
 *
 * Proven pairs live in data/ig-handles.json (scripts/ig-handles.mts builds
 * it; every entry is reviewed by hand), keyed by the organization's
 * registrable domain, with the account's id, which survives a rename.
 * Right before a caption goes to Instagram, every tag is checked again
 * (recheckTags); any doubt drops the tag, never the post. No name
 * matching, ever, and Facebook never gets a handle. Pure.
 */

/** One proven account, keyed in the registry by its organization's domain. */
export type HandleEntry = {
  /** The Instagram username, as the account spells it (no @). */
  handle: string;
  /** The account's Instagram id (Business Discovery): survives renames. */
  igId: string;
  /** Who it is (the organizer's own name, for the review). */
  org: string;
  /** The account's display name and followers when it was verified. */
  name: string | null;
  followers: number | null;
  /** The page on the organization's site that links the handle. */
  forward: string;
  /** Where the account names the site ("website: <url>" or "bio: <url>"). */
  back: string;
  /** YYYY-MM-DD. */
  verifiedOn: string;
  /** Park slugs whose official page is on this domain (it runs them). */
  parks?: string[];
};

export type Registry = {
  note?: string;
  entries: Record<string, HandleEntry>;
};

export const REGISTRY = registryJson as Registry;

/** At most this many handles in one caption (Instagram allows 20). */
export const MAX_TAGS = 10;

/** A tag a post carries: re-checked before it goes out. */
export type Tag = {
  /** The registry key (registrable domain). */
  domain: string;
  handle: string;
  igId: string;
  /** host: runs an event; park: runs a park; place: an Unpack venue. */
  role: "host" | "park" | "place";
};

// --- Domains -----------------------------------------------------------------

/**
 * Suffixes under which each name is a different owner: the public ones
 * our region uses, plus hosting platforms (one site per subdomain) and
 * the state's agencies (stateparks.oregon.gov isn't oregon.gov's).
 */
const SHARED_SUFFIXES = [
  "or.us",
  "k12.or.us",
  "co.uk",
  "com.au",
  "oregon.gov",
  "beehiiv.com",
  "substack.com",
  "wixsite.com",
  "squarespace.com",
  "wordpress.com",
  "blogspot.com",
  "github.io",
  "myshopify.com",
  "square.site",
  "weebly.com",
  "godaddysites.com",
  "netlify.app",
  "vercel.app",
];

/** The registrable domain of a host: "www.bendparksandrec.org" -> "bendparksandrec.org". */
export function registrableDomain(host: string): string {
  const h = host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\d?\./, "");
  const labels = h.split(".");
  let keep = 2;
  for (const s of SHARED_SUFFIXES)
    if (h === s || h.endsWith(`.${s}`))
      keep = Math.max(keep, s.split(".").length + 1);
  // ci.madras.or.us: a city's own name sits under its state's locality.
  if (/\.or\.us$/.test(h) && labels.length >= 4) keep = Math.max(keep, 4);
  return labels.slice(-keep).join(".");
}

/** A URL's registrable domain, or null when it isn't a web link. */
export function siteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  // Another scheme (mailto:, issue:) isn't a site.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:\/\//i.test(url))
    return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname.includes(".") || u.username || u.password) return null;
  return registrableDomain(u.hostname);
}

// --- Never tagged ------------------------------------------------------------

/** Other newsletters (never named, never tagged), by name, handle or domain. */
const COMPETITOR = /bend[\s_.-]*(family[\s_.-]*loop|buzz)/i;
export const COMPETITOR_DOMAINS = [
  "bendbuzz.com",
  "bendbuzz.beehiiv.com",
  "bendfamilyloop.com",
  "bendfamilyloop.beehiiv.com",
];

/** A competitor's name, handle or site anywhere in these strings. */
export function competitor(...parts: (string | null | undefined)[]): boolean {
  return parts.some(
    (p) =>
      !!p &&
      (COMPETITOR.test(p) ||
        COMPETITOR_DOMAINS.some((d) => {
          const dom = siteDomain(p);
          return dom === d || p.toLowerCase().includes(d);
        })),
  );
}

/**
 * Domains we never tag, after the hand review, with why: proven accounts,
 * but not ones a family account should tag (the roundup screens bars and
 * breweries out anyway).
 */
export const NEVER_TAG: Record<string, string> = {
  "bevelbeer.com": "a brewery and taproom, not a family host",
  "mcmenamins.com": "a pub chain's corporate account, not the local venue",
};

/**
 * Sites that are never an event's host: social networks, ticketing and
 * signup platforms, link shorteners, listings and tourism calendars. An
 * event with one of these as its page has no host domain.
 */
export const NOT_HOST_DOMAINS = new Set([
  "instagram.com",
  "facebook.com",
  "fb.me",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "linktr.ee",
  "eventbrite.com",
  "runsignup.com",
  "hisawyer.com",
  "unleashedbrands.com",
  "ticketmaster.com",
  "tixr.com",
  "universe.com",
  "allevents.com",
  "allevents.in",
  "evvnt.com",
  "google.com",
  "forms.gle",
  "bit.ly",
  "tinyurl.com",
  "visitbend.com",
  "visitcentraloregon.com",
  "visitredmondoregon.com",
  "exploresisters.com",
  "sunriverchamber.com",
  "bendbulletin.com",
  "bendsource.com",
  "ktvz.com",
  ...COMPETITOR_DOMAINS.map(registrableDomain),
]);

/**
 * An event's host domain: its organizer's site, else its own page's site
 * when that's an organization's own (never a platform or a listing).
 */
export function hostDomain(e: {
  url: string;
  organizer?: { url: string } | null;
}): string | null {
  const d = siteDomain(e.organizer?.url ?? e.url);
  if (!d || NOT_HOST_DOMAINS.has(d) || competitor(d)) return null;
  return d;
}

// --- Forward links: the site names the handle --------------------------------

/** instagram.com paths that are never an account. */
const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "explore",
  "stories",
  "accounts",
  "direct",
  "about",
  "developer",
  "legal",
  "web",
  "share",
  "sharer",
  "sharer.php",
  "intent",
  "oauth",
  "challenge",
  "privacy",
  "terms",
  "help",
  "embed.js",
  "static",
]);

/** The username an instagram.com link points at, or null (a post, a share link). */
export function igHandleFromUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href.trim().replace(/^\/\//, "https://"));
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host !== "instagram.com" && host !== "instagr.am") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  // instagram.com/<handle>/ or instagram.com/<handle>/<a tab>; never a post.
  if (parts.length === 2 && !/^(reels|tagged|guides|channel)$/.test(parts[1]))
    return null;
  const h = decodeURIComponent(parts[0]).replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) return null;
  if (IG_RESERVED.has(h.toLowerCase())) return null;
  if (/^\.|\.$|\.\./.test(h)) return null;
  return h.toLowerCase();
}

/**
 * Every Instagram account a page's HTML links, in page order: its links
 * (href) first, then the profile URLs its own markup names elsewhere (a
 * schema.org "sameAs", a site builder's social-bar data, JSON-escaped).
 */
export function igLinksIn(html: string): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const h = igHandleFromUrl(raw.replace(/\\\//g, "/").replace(/&amp;/g, "&"));
    if (h && !out.includes(h)) out.push(h);
  };
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(
    /https?:(?:\\?\/){2}(?:www\.)?instagram\.com(?:\\?\/)[A-Za-z0-9._@]{1,31}(?:\\?\/)?(?=["'\s<?#\\]|$)/gi,
  ))
    push(m[0]);
  return out;
}

// --- Back links: the account names the site ----------------------------------

/** Link-in-bio services: a website on one of these is a page of links, not a site. */
export const LINK_IN_BIO = new Set([
  "linktr.ee",
  "linkin.bio",
  "lnk.bio",
  "beacons.ai",
  "campsite.bio",
  "taplink.cc",
  "bio.site",
  "msha.ke",
  "solo.to",
  "carrd.co",
  "hoo.be",
]);

/** Web addresses written in free text ("bendparksandrec.org", "https://x.org/y"). */
export function urlsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(
    /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|us|info|biz|co|io|ee|ai|bio|site|cc|ke|to|app)\b(?:\/[^\s)"'<>]*)?/gi,
  )) {
    // An email address isn't a link to the site ("hello@x.org" names it,
    // but only a link counts).
    const before = text[m.index - 1];
    if (before === "@") continue;
    out.push(m[0]);
  }
  return out;
}

/**
 * Does the account name this domain? Its website field first, then any
 * link written in its bio; `linkPages` are pages of links a link-in-bio
 * website resolved to (the builder fetches them; publish-time checks pass
 * none, so such an account must match directly then). Returns the
 * evidence ("website: https://...") or null.
 */
export function backLink(
  account: Pick<DiscoveredAccount, "website" | "biography">,
  domain: string,
  linkPages: readonly string[] = [],
): string | null {
  const site = siteDomain(account.website);
  if (site && site === domain) return `website: ${account.website}`;
  for (const u of urlsInText(account.biography ?? ""))
    if (siteDomain(u) === domain) return `bio: ${u}`;
  if (site && LINK_IN_BIO.has(site))
    for (const u of linkPages)
      if (siteDomain(u) === domain)
        return `website: ${account.website} -> ${u}`;
  return null;
}

/**
 * The verdict on one candidate: both links hold, and nothing about it
 * is a competitor. `forwardHandles` are the handles the organization's
 * page links (igLinksIn).
 */
export function verifyPair(p: {
  domain: string;
  handle: string;
  forwardHandles: readonly string[];
  account: DiscoveredAccount | null;
  linkPages?: readonly string[];
}): { ok: true; back: string } | { ok: false; why: string } {
  if (competitor(p.domain, p.handle))
    return { ok: false, why: "a competitor newsletter" };
  if (!p.forwardHandles.includes(p.handle.toLowerCase()))
    return { ok: false, why: "the site doesn't link this handle" };
  if (!p.account)
    return {
      ok: false,
      why: "not a business or creator account (Business Discovery)",
    };
  if (p.account.username.toLowerCase() !== p.handle.toLowerCase())
    return { ok: false, why: "Business Discovery named another username" };
  if (competitor(p.account.website, p.account.name, p.account.biography ?? ""))
    return { ok: false, why: "the account points at a competitor" };
  const back = backLink(p.account, p.domain, p.linkPages);
  if (!back)
    return {
      ok: false,
      why: `the account's website and bio don't name ${p.domain}`,
    };
  return { ok: true, back };
}

// --- Tags for a post ---------------------------------------------------------

/** The registry's tag for a domain, or null. */
export function tagFor(
  domain: string | null | undefined,
  role: Tag["role"],
  registry: Registry = REGISTRY,
): Tag | null {
  if (!domain) return null;
  const e = registry.entries[domain];
  if (!e || NEVER_TAG[domain] || competitor(domain, e.handle)) return null;
  return { domain, handle: e.handle, igId: e.igId, role };
}

/** The operator's tag for a park (its official page is on the operator's site). */
export function parkTag(
  slug: string,
  registry: Registry = REGISTRY,
): Tag | null {
  for (const [domain, e] of Object.entries(registry.entries))
    if (e.parks?.includes(slug)) return tagFor(domain, "park", registry);
  return null;
}

/** Tags in order, one per account, at most MAX_TAGS. */
export function dedupeTags(tags: readonly (Tag | null | undefined)[]): Tag[] {
  const seen = new Set<string>();
  const out: Tag[] = [];
  for (const t of tags) {
    if (!t || seen.has(t.igId) || seen.has(t.handle.toLowerCase())) continue;
    seen.add(t.igId);
    seen.add(t.handle.toLowerCase());
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * The caption lines that tag, one line per post: "Hosts this week: @a @b"
 * on the roundup, "Park by @x" (the park's operator) on the park post and
 * the teaser, "On this list: @a @b" on the Unpack carousel. [] when none.
 */
export function mentionLines(kind: PostKind, tags: readonly Tag[]): string[] {
  const used = usedTags(kind, tags);
  if (!used.length) return [];
  const at = used.map((t) => `@${t.handle}`).join(" ");
  if (kind === "events_week") return [`Hosts this week: ${at}`];
  if (kind === "unpack") return [`On this list: ${at}`];
  return [`Park by ${at}`];
}

/** The tags a post's caption prints, in order (mentionLines' own list). */
export function usedTags(kind: PostKind, tags: readonly Tag[]): Tag[] {
  if (kind === "events_week")
    return dedupeTags(tags.filter((t) => t.role === "host"));
  if (kind === "park_post" || kind === "teaser")
    return dedupeTags(tags.filter((t) => t.role === "park")).slice(0, 1);
  if (kind === "unpack") return dedupeTags(tags);
  return [];
}

/** A line mentionLines writes (what Facebook and a re-check take out). */
export const MENTION_LINE =
  /^(?:Hosts this week:|Park by|On this list:)(?: @[A-Za-z0-9._]{1,30})+$/;

/** The caption with every tag line taken out (Facebook's copy). */
export function withoutMentions(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (MENTION_LINE.test(lines[i])) {
      // A tag line between blank lines leaves one blank line.
      if (out.at(-1) === "" && (lines[i + 1] ?? "") === "") i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Every @handle in a caption (not an email address), lowercased. */
export function captionMentions(caption: string): string[] {
  return [
    ...caption.matchAll(/(?<![A-Za-z0-9._@])@([A-Za-z0-9._]{1,30})/g),
  ].map((m) => m[1].replace(/\.+$/, "").toLowerCase());
}

/**
 * Any @handle that isn't a proven one: `allowed` is the registry's
 * handles (when a post is made) or the tags that passed the re-check
 * (right before it goes out). A model-written @ can't get through.
 */
export function mentionProblems(
  caption: string | null,
  allowed: Iterable<string>,
): string[] {
  if (!caption) return [];
  const ok = new Set([...allowed].map((h) => h.toLowerCase()));
  const bad = [...new Set(captionMentions(caption).filter((h) => !ok.has(h)))];
  const out = bad.length
    ? [
        `The caption tags ${bad.map((h) => `@${h}`).join(", ")}, which isn't a verified host handle (data/ig-handles.json).`,
      ]
    : [];
  if (captionMentions(caption).length > MAX_TAGS)
    out.push(`The caption tags more than ${MAX_TAGS} accounts.`);
  return out;
}

/** The registry's handles (what a caption may tag). */
export function registryHandles(registry: Registry = REGISTRY): string[] {
  return Object.entries(registry.entries)
    .filter(([d, e]) => !NEVER_TAG[d] && !competitor(d, e.handle))
    .map(([, e]) => e.handle.toLowerCase());
}

// --- The check right before publishing ----------------------------------------

export type RecheckDeps = {
  /** Business Discovery (throws on any error: a personal or missing account). */
  discover: (handle: string) => Promise<DiscoveredAccount>;
  /**
   * The handles the organization's page links now (for a renamed account):
   * fetched again from the entry's forward page. Optional: without it, a
   * rename drops the tag.
   */
  forwardHandles?: (domain: string) => Promise<string[]>;
  registry?: Registry;
};

export type Recheck = {
  kept: Tag[];
  dropped: { tag: Tag; why: string }[];
};

/**
 * Check every tag again, right before the caption goes out: the account
 * must still be there with the same id and username. A rename (same id,
 * new username) keeps the tag only when the organization's page now links
 * the new username and its back link to the site still holds. Anything
 * else (an error, another id, a broken back link) drops the tag. Never
 * throws: tagging never holds up a post.
 */
export async function recheckTags(
  tags: readonly Tag[],
  deps: RecheckDeps,
): Promise<Recheck> {
  const kept: Tag[] = [];
  const dropped: Recheck["dropped"] = [];
  const registry = deps.registry ?? REGISTRY;
  for (const tag of tags) {
    try {
      const entry = registry.entries[tag.domain];
      if (!entry || entry.igId !== tag.igId) {
        dropped.push({ tag, why: "no longer in the registry" });
        continue;
      }
      if (NEVER_TAG[tag.domain] || competitor(tag.domain, tag.handle)) {
        dropped.push({ tag, why: "never tagged" });
        continue;
      }
      let acct: DiscoveredAccount | null = null;
      try {
        acct = await deps.discover(tag.handle);
      } catch {
        acct = null;
      }
      if (
        acct &&
        acct.id === tag.igId &&
        acct.username.toLowerCase() === tag.handle.toLowerCase()
      ) {
        kept.push({ ...tag, handle: acct.username });
        continue;
      }
      if (acct && acct.id !== tag.igId) {
        dropped.push({
          tag,
          why: `@${tag.handle} is now another account (id changed)`,
        });
        continue;
      }
      // Gone under this name (or an error): maybe renamed. The site's own
      // page decides which name to look at; the id and back link decide
      // whether it's the same account.
      const renamed = await renamedTo(tag, deps);
      if (renamed) {
        kept.push({ ...tag, handle: renamed });
        continue;
      }
      dropped.push({
        tag,
        why: acct
          ? "Business Discovery named another username"
          : `@${tag.handle} can't be found (Business Discovery)`,
      });
    } catch (e) {
      dropped.push({ tag, why: `check failed (${(e as Error)?.message})` });
    }
  }
  return { kept, dropped };
}

async function renamedTo(tag: Tag, deps: RecheckDeps): Promise<string | null> {
  if (!deps.forwardHandles) return null;
  let linked: string[];
  try {
    linked = await deps.forwardHandles(tag.domain);
  } catch {
    return null;
  }
  for (const h of linked) {
    if (h === tag.handle.toLowerCase()) continue;
    let acct: DiscoveredAccount;
    try {
      acct = await deps.discover(h);
    } catch {
      continue;
    }
    if (acct.id !== tag.igId) continue;
    const v = verifyPair({
      domain: tag.domain,
      handle: acct.username,
      forwardHandles: linked,
      account: acct,
    });
    if (v.ok) return acct.username;
  }
  return null;
}

/**
 * The caption as it goes out: the tag lines made from `before` are
 * replaced with the lines from the tags that passed (renames applied), or
 * taken out (with their blank line) when none did.
 */
export function finalizeMentions(
  caption: string,
  kind: PostKind,
  before: readonly Tag[],
  kept: readonly Tag[],
): string {
  const old = mentionLines(kind, before);
  if (!old.length) return caption;
  const next = mentionLines(kind, kept);
  let lines = caption.split("\n");
  const at = lines.indexOf(old[0]);
  if (at < 0 || !next.length) return withoutMentions(caption);
  lines = lines.filter((l) => !old.includes(l) && !MENTION_LINE.test(l));
  lines.splice(at, 0, ...next);
  return lines.join("\n");
}

/**
 * The caption as it goes to Instagram: every tag checked again first
 * (Business Discovery, cached a few hours), and the tag line rewritten
 * with the ones that held. A tag that fails is dropped, never the post.
 * Any other @handle left (one no code put there) stops the post.
 */
export async function publishCaption(
  post: { kind: string; caption: string | null; spec: unknown },
  deps: RecheckDeps,
): Promise<{ caption: string | null; notes: string[] } | { error: string }> {
  const spec = post.spec as PostSpec;
  const tags = spec.tags ?? [];
  // The composed caption is the source, so a second try writes the same.
  const source = tags.length ? (spec.caption ?? post.caption) : post.caption;
  if (source == null) return { caption: null, notes: [] };
  const notes: string[] = [];
  let caption = source;
  let allowed: string[] = [];
  if (tags.length) {
    const r = await recheckTags(tags, deps);
    for (const d of r.dropped)
      notes.push(`tag @${d.tag.handle} dropped: ${d.why}`);
    for (const k of r.kept)
      if (k.handle !== tags.find((t) => t.igId === k.igId)?.handle)
        notes.push(`tag renamed to @${k.handle}`);
    caption = finalizeMentions(source, post.kind as PostKind, tags, r.kept);
    allowed = r.kept.map((t) => t.handle);
    if (caption.length > CAPTION_MAX) {
      caption = withoutMentions(caption);
      allowed = [];
      notes.push("tags dropped: the caption ran long");
    }
  }
  const bad = mentionProblems(caption, allowed);
  if (bad.length) {
    // Not ours: strip our tag lines and look again.
    const bare = withoutMentions(caption);
    if (mentionProblems(bare, []).length) return { error: bad.join(" ") };
    return { caption: bare, notes: [...notes, "tags dropped: unverified"] };
  }
  return { caption, notes };
}

/** A short in-memory cache of Business Discovery answers (a few hours). */
export function cachedDiscover(
  discover: (handle: string) => Promise<DiscoveredAccount>,
  {
    ttlMs = 3 * 3_600_000,
    cache = DISCOVERY_CACHE,
    now = () => Date.now(),
  }: {
    ttlMs?: number;
    cache?: Map<string, { at: number; acct: DiscoveredAccount }>;
    now?: () => number;
  } = {},
): (handle: string) => Promise<DiscoveredAccount> {
  return async (handle) => {
    const key = handle.toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.acct;
    // Errors aren't cached: the next post asks again.
    const acct = await discover(handle);
    cache.set(key, { at: now(), acct });
    return acct;
  };
}

/** Forget the cached answers (tests; a registry change). */
export function forgetDiscoveries() {
  DISCOVERY_CACHE.clear();
}

const DISCOVERY_CACHE = new Map<
  string,
  { at: number; acct: DiscoveredAccount }
>();
