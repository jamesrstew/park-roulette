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
 *      website field or a link in its bio, or (when its link-in-bio page
 *      can't name a site) its display name is the organization's, exactly.
 *
 * Proven pairs live in data/ig-handles.json (scripts/ig-handles.mts builds
 * it; every entry is reviewed by hand), keyed by the organization's
 * registrable domain, with the account's id, which survives a rename.
 * Right before a caption goes to Instagram, every tag is checked again
 * (recheckTags); any doubt drops the tag, never the post. A name counts
 * only as a back link, on top of the site's own link (backLink), and only
 * when it is the organization's name exactly. Facebook never gets a
 * handle. Pure.
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
  // Calendars that list other people's events as well as their own: the
  // organizer named there isn't always who runs it.
  "downtownbend.org",
  "oldmilldistrict.com",
  "towertheatre.org",
  ...COMPETITOR_DOMAINS.map(registrableDomain),
]);

/**
 * An event's host domain: its named organizer's own site, and only that.
 * The event's page may be a venue's or a listing's, so it never names the
 * host; nor does a platform, a listing calendar or a competitor.
 */
export function hostDomain(e: {
  organizer?: { url: string } | null;
}): string | null {
  const d = siteDomain(e.organizer?.url);
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
  "linkinprofile.com",
  "sprout.link",
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
  account: Pick<DiscoveredAccount, "website" | "biography"> & {
    name?: string | null;
  },
  domain: string,
  linkPages: readonly string[] = [],
  orgName?: string,
): string | null {
  const site = siteDomain(account.website);
  if (site && site === domain) return `website: ${account.website}`;
  for (const u of urlsInText(account.biography ?? ""))
    if (siteDomain(u) === domain) return `bio: ${u}`;
  if (site && LINK_IN_BIO.has(site))
    for (const u of linkPages)
      if (siteDomain(u) === domain)
        return `website: ${account.website} -> ${u}`;
  // Some link-in-bio pages (linkinprofile.com) list only the account's own
  // posts, so no link can name the site. The account's display name, then,
  // must be the organization's own name, exactly (James, Nov 25: Deschutes
  // Public Library). Only on top of the forward link, never instead of it.
  // Only when the account's website is a link-in-bio page or empty: an
  // account whose website names some other site doesn't get a name match.
  if (
    orgName &&
    account.name &&
    (!site || LINK_IN_BIO.has(site)) &&
    sameName(account.name, orgName)
  )
    return `name: ${account.name}`;
  return null;
}

/**
 * The same organization name, ignoring case, punctuation, spacing and
 * "&" versus "and". No partial matches: "Deschutes Library" isn't
 * "Deschutes Public Library". Pure.
 */
export function sameName(a: string, b: string): boolean {
  const norm = (x: string) =>
    x
      .normalize("NFKD")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const na = norm(a);
  return na.length >= 6 && na === norm(b);
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
  /** The organizer's own name (events' organizer.name), for a name match. */
  orgName?: string;
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
  const back = backLink(p.account, p.domain, p.linkPages, p.orgName);
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
  return [...caption.matchAll(MENTION)].map((m) =>
    m[1].replace(/\.+$/, "").toLowerCase(),
  );
}
const MENTION = /(?<![A-Za-z0-9._@])@([A-Za-z0-9._]{1,30})/g;
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * Words from an event page, a venue, a host or a sent issue, with no "@"
 * left: an email address goes, and "@10am" or "@TheGrove" reads "at 10am",
 * "at TheGrove". Code-sourced text never tags anyone; only our tag line does.
 */
export function noAt(text: string): string;
export function noAt(text: string | null): string | null;
export function noAt(text: string | null): string | null {
  if (text == null || !text.includes("@")) return text;
  return text
    .replace(EMAIL, "")
    .replace(/\s*@+\s*/g, " at ")
    .replace(/ {2,}/g, " ")
    .replace(/ ([.,;:!?)])/g, "$1")
    .trim();
}

/**
 * The caption's @-problems, the same rule when a post is made and right
 * before it goes out: an @ belongs only in our tag line, and every handle
 * there is one of `allowed` (the post's own verified tags when it's made;
 * the ones that passed the re-check when it goes out). Any other @ is in
 * words someone wrote, and is refused when the draft is checked.
 */
export function mentionProblems(
  caption: string | null,
  allowed: Iterable<string>,
): string[] {
  if (!caption) return [];
  const ok = new Set([...allowed].map((h) => h.toLowerCase()));
  const out: string[] = [];
  const stray = new Set<string>();
  const bad = new Set<string>();
  let n = 0;
  for (const line of caption.split("\n")) {
    const found = captionMentions(line);
    n += found.length;
    if (!MENTION_LINE.test(line)) found.forEach((h) => stray.add(h));
    else found.filter((h) => !ok.has(h)).forEach((h) => bad.add(h));
  }
  if (stray.size)
    out.push(
      `An @ in the post's words (${[...stray].map((h) => `@${h}`).join(", ")}): no handles in the words; code adds the verified tag line.`,
    );
  if (bad.size)
    out.push(
      `The tag line has ${[...bad].map((h) => `@${h}`).join(", ")}, which isn't a verified host handle (data/ig-handles.json).`,
    );
  if (n > MAX_TAGS)
    out.push(`The caption tags more than ${MAX_TAGS} accounts.`);
  return out;
}

/** A post's own verified tags, as mentionProblems takes them. */
export function postHandles(
  spec: { tags?: readonly Tag[] },
  registry: Registry = REGISTRY,
): string[] {
  const proven = new Set(registryHandles(registry));
  return (spec.tags ?? [])
    .map((t) => t.handle.toLowerCase())
    .filter((h) => proven.has(h));
}

/** The registry's handles (what a caption may tag). */
export function registryHandles(registry: Registry = REGISTRY): string[] {
  return Object.entries(registry.entries)
    .filter(([d, e]) => !NEVER_TAG[d] && !competitor(d, e.handle))
    .map(([, e]) => e.handle.toLowerCase());
}

// --- The check right before publishing ----------------------------------------

export type RecheckDeps = {
  /**
   * Business Discovery. Throws on any error; a clear "no such user" (see
   * noSuchUser) is the only one that may mean a rename.
   */
  discover: (handle: string) => Promise<DiscoveredAccount>;
  /**
   * The handles the organization's page links now (for a renamed account):
   * fetched again from the entry's forward page. Optional: without it, a
   * rename drops the tag.
   */
  forwardHandles?: (domain: string) => Promise<string[]>;
  registry?: Registry;
  /** At most this many lookups and page fetches in all (default 15). */
  budget?: number;
  /** Each lookup or fetch gives up after this long (default 5 s). */
  timeoutMs?: number;
};

export type Recheck = {
  kept: Tag[];
  dropped: { tag: Tag; why: string }[];
};

/**
 * Meta's clear answer that no account has this username (Business
 * Discovery: code 110, subcode 2207013, "Cannot find User"). Rate limits,
 * outages and timeouts aren't: they never send us looking for a rename.
 */
export function noSuchUser(e: unknown): boolean {
  const x = e as { code?: number | null; subcode?: number | null } | null;
  return (
    !!x && (x.subcode === 2207013 || (x.code === 110 && x.subcode == null))
  );
}

type Budget = { left: number; timeoutMs: number };

/** One lookup or fetch, counted against the budget, with a time limit. */
async function spend<T>(b: Budget, f: () => Promise<T>): Promise<T> {
  if (b.left <= 0) throw new Error("check budget used up");
  b.left--;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      f(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), b.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check every tag again, right before the caption goes out, all at once
 * and within a budget: the account must still be there with the same id
 * and username. Only when Meta clearly says the username doesn't exist
 * does it look for a rename: the organization's page must now link the
 * new username, with the same id and the back link to the site intact.
 * Anything else (an error, a timeout, another id, a broken back link, the
 * budget used up) drops the tag. Never throws: tagging never holds up a
 * post.
 */
export async function recheckTags(
  tags: readonly Tag[],
  deps: RecheckDeps,
): Promise<Recheck> {
  const registry = deps.registry ?? REGISTRY;
  const budget: Budget = {
    left: deps.budget ?? 15,
    timeoutMs: deps.timeoutMs ?? 5_000,
  };
  const results = await Promise.all(
    tags.map(async (tag): Promise<{ kept: Tag } | { why: string }> => {
      try {
        const entry = registry.entries[tag.domain];
        if (!entry || entry.igId !== tag.igId)
          return { why: "no longer in the registry" };
        if (NEVER_TAG[tag.domain] || competitor(tag.domain, tag.handle))
          return { why: "never tagged" };
        let acct: DiscoveredAccount;
        try {
          acct = await spend(budget, () => deps.discover(tag.handle));
        } catch (e) {
          if (!noSuchUser(e))
            return {
              why: `can't check it now (${(e as Error)?.message ?? "error"})`,
            };
          const renamed = await renamedTo(tag, deps, budget);
          return renamed
            ? { kept: { ...tag, handle: renamed } }
            : { why: `@${tag.handle} can't be found (Business Discovery)` };
        }
        if (acct.id !== tag.igId)
          return { why: `@${tag.handle} is now another account (id changed)` };
        if (acct.username.toLowerCase() !== tag.handle.toLowerCase())
          return { why: "Business Discovery named another username" };
        return { kept: { ...tag, handle: acct.username } };
      } catch (e) {
        return { why: `check failed (${(e as Error)?.message})` };
      }
    }),
  );
  const kept: Tag[] = [];
  const dropped: Recheck["dropped"] = [];
  results.forEach((r, i) =>
    "kept" in r
      ? kept.push(r.kept)
      : dropped.push({ tag: tags[i], why: r.why }),
  );
  return { kept, dropped };
}

async function renamedTo(
  tag: Tag,
  deps: RecheckDeps,
  budget: Budget,
): Promise<string | null> {
  if (!deps.forwardHandles) return null;
  let linked: string[];
  try {
    linked = await spend(budget, () => deps.forwardHandles!(tag.domain));
  } catch {
    return null;
  }
  for (const h of linked.slice(0, 3)) {
    if (h === tag.handle.toLowerCase()) continue;
    let acct: DiscoveredAccount;
    try {
      acct = await spend(budget, () => deps.discover(h));
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

/** Any @ outside our tag lines reads "at" (it was never a tag of ours). */
export function neutralizeStray(caption: string): string {
  return caption
    .split("\n")
    .map((l) =>
      MENTION_LINE.test(l)
        ? l
        : l.replace(/(?<![A-Za-z0-9._@])@(?=[A-Za-z0-9._])/g, "at "),
    )
    .join("\n");
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
 * (fresh Business Discovery answers, no cache), and the tag line
 * rewritten with the ones that held. A tag that fails is dropped, never
 * the post. A validated caption has no other @ (mentionProblems refused
 * it when the draft was checked); if one is there anyway, it reads "at"
 * rather than tag anyone or hold the post up.
 */
export async function publishCaption(
  post: { kind: string; caption: string | null; spec: unknown },
  deps: RecheckDeps,
): Promise<{ caption: string | null; notes: string[] }> {
  const spec = post.spec as PostSpec;
  const tags = spec.tags ?? [];
  // The composed caption is the source, so a second try writes the same.
  const source = tags.length ? (spec.caption ?? post.caption) : post.caption;
  if (source == null) return { caption: null, notes: [] };
  const notes: string[] = [];
  let caption = neutralizeStray(source);
  if (caption !== source) notes.push('an @ in the words reads "at"');
  let allowed: string[] = [];
  if (tags.length) {
    const r = await recheckTags(tags, deps);
    for (const d of r.dropped)
      notes.push(`tag @${d.tag.handle} dropped: ${d.why}`);
    for (const k of r.kept)
      if (k.handle !== tags.find((t) => t.igId === k.igId)?.handle)
        notes.push(`tag renamed to @${k.handle}`);
    caption = finalizeMentions(caption, post.kind as PostKind, tags, r.kept);
    allowed = r.kept.map((t) => t.handle);
    if (caption.length > CAPTION_MAX) {
      caption = withoutMentions(caption);
      allowed = [];
      notes.push("tags dropped: the caption ran long");
    }
  }
  if (mentionProblems(caption, allowed).length) {
    caption = neutralizeStray(withoutMentions(caption));
    notes.push("tags dropped: unverified");
  }
  return { caption, notes };
}

/**
 * A short in-memory cache of Business Discovery answers (a few hours), for
 * previews only: the publish path always asks fresh.
 */
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

const DISCOVERY_CACHE = new Map<
  string,
  { at: number; acct: DiscoveredAccount }
>();
