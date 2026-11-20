import { createHmac } from "node:crypto";
import { z } from "zod";
import raw from "../../../data/ig-universe.json";
import { igImageUrl, type IgMediaType } from "@/components/news/InstagramCard";
import { unsafeText } from "./safety";
import { median } from "./xapi";

/**
 * Parents' corner v5: Instagram through the Graph API's Business
 * Discovery (James chose this knowing the Meta policy 6.2 risk). One call
 * per page in data/ig-universe.json reads its recent media; a post is
 * scored, like X, by how far its likes beat the page's median. Only
 * original content, with likes showing, under 7 days old. Pure: the token,
 * our account id and fetch are passed in, so tests mock Meta.
 */

export const IG_GRAPH = "https://graph.facebook.com/v21.0";
/** Recent media read per page (enough for a median). */
export const IG_MEDIA_LIMIT = 25;
export const IG_LIKES_FLOOR = 1000;
export const IG_MAX_AGE_DAYS = 7;
export const IG_CANDIDATES_MAX = 10;
/** A meme page's posts score at this share (they mostly repost). */
export const MEME_PAGE_FACTOR = 0.5;

const IgAccount = z.object({
  username: z.string().regex(/^[a-z0-9._]{1,30}$/),
  name: z.string().optional(),
  /** person, brand, or meme_page (reposts others: ranked lower). */
  kind: z.enum(["person", "brand", "meme_page"]).default("brand"),
  followers: z.number().int().nonnegative(),
  /** When it was last checked (older entries). */
  verified: z.string().optional(),
  /** From the universe check: posts in the 14 days before it. */
  postsLast14d: z.number().int().nonnegative().optional(),
  medianLikes: z.number().nonnegative().optional(),
  /** Share of its last 15 captions that credit someone else (0 to 1). */
  creditShare: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
});
export const IG_UNIVERSE = z.array(IgAccount).parse(raw);

export type IgMedia = {
  id: string;
  caption?: string;
  media_type: IgMediaType;
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  children?: { data: { id: string; media_type?: IgMediaType }[] };
};

type Discovery = {
  business_discovery?: {
    username: string;
    profile_picture_url?: string;
    followers_count?: number;
    media?: { data: IgMedia[]; paging?: { cursors?: { after?: string } } };
  };
};

/** One Instagram post the plan offers the writer. */
export type IgCandidate = {
  kind: "instagram";
  id: string;
  username: string;
  avatar: string | null;
  permalink: string;
  mediaType: IgMediaType;
  productType: IgMedia["media_product_type"] | null;
  /** The URL to copy into Blob (never shown to readers). */
  imageUrl: string;
  carouselCount: number | null;
  likes: number;
  timestamp: string;
  caption: string;
  score: number;
  baseline: number | null;
};

const FIELDS = `username,profile_picture_url,followers_count,media.limit(${IG_MEDIA_LIMIT}){id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{id,media_type}}`;

/** One page's profile and recent media, or null (not professional, or Meta said no). */
export type IgOpts = {
  token?: string;
  igUserId?: string;
  /** Optional: signs each call (appsecret_proof) when the app requires it. */
  appSecret?: string;
  fetchImpl?: typeof fetch;
};

/** HMAC-SHA256 of the token with the app secret (Meta's appsecret_proof). */
export function appSecretProof(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function discoverPage(
  username: string,
  opts: IgOpts & { after?: string },
): Promise<Discovery["business_discovery"] | null> {
  if (!opts.token || !opts.igUserId) return null;
  if (!/^\d{5,25}$/.test(opts.igUserId)) return null;
  if (!/^[a-z0-9._]{1,30}$/.test(username)) return null;
  const media = opts.after
    ? FIELDS.replace(
        `media.limit(${IG_MEDIA_LIMIT})`,
        `media.after(${opts.after}).limit(${IG_MEDIA_LIMIT})`,
      )
    : FIELDS;
  const q = new URLSearchParams({
    fields: `business_discovery.username(${username}){${media}}`,
  });
  // The token goes in a header, never the URL (logs keep URLs).
  if (opts.appSecret)
    q.set("appsecret_proof", appSecretProof(opts.token, opts.appSecret));
  try {
    const res = await (opts.fetchImpl ?? fetch)(
      `${IG_GRAPH}/${opts.igUserId}?${q}`,
      {
        headers: { authorization: `Bearer ${opts.token}` },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.warn(`[news] Instagram ${username} said ${res.status}`);
      return null;
    }
    return ((await res.json()) as Discovery).business_discovery ?? null;
  } catch {
    return null;
  }
}

/**
 * Common words that can follow "via", "inspo" or sit in brackets without
 * being a handle ("inspo for", "[but]").
 */
const NOT_HANDLES = new Set(
  "the and for from with this that our you your her his him their them they she was are but not all any one two out off its it's what when who how why here there just like love now new day".split(
    " ",
  ),
);

/**
 * Credits Business Discovery leaves without their "@" (it strips them):
 * "Credit scarymommy", "(via kimberlydinaro)", "Inspo: thattwinmama_",
 * "IC: kimberlykarjadi.dance", "[indoor_mom]", and arrow lists
 * ("—> oneawkwardmom user1 user2").
 */
const BARE_CREDIT =
  /\b(?:(?:via|credits?|cred|inspo|repost(?:ed)?(?:\s+from)?)\s*[:\-–—/]?|ic\s*:)\s*\(?\s*@?([a-z0-9._]{3,30})/giu;
const BRACKETED = /\[\s*@?([a-z0-9._]{3,30})\s*\]/giu;
/** "—> handle" chains ("->" in plain text is a sequence, not a credit). */
const ARROW_LIST = /(?:[—–]+>|→|➡️?)\s*@?[a-z0-9._]{3,30}/iu;

function bareCredit(caption: string, owner: string): boolean {
  if (ARROW_LIST.test(caption)) return true;
  const own = owner.toLowerCase();
  const handle = (h: string) => {
    const x = h.toLowerCase().replace(/\.$/, "");
    return x !== own && !NOT_HANDLES.has(x);
  };
  for (const m of caption.matchAll(BARE_CREDIT)) if (handle(m[1])) return true;
  for (const m of caption.matchAll(BRACKETED)) if (handle(m[1])) return true;
  return false;
}

/** Captions that disclaim ownership: the post isn't the page's own. */
const DISCLAIMERS =
  /\b(re-?post(ed)?|regram|via|credit(s|ed)?|cr\b|dm (me )?for (credit|removal)|credit to (the )?(owner|creator)|all rights (belong|reserved|go)|no copyright|not mine|found (this|on)|tag the (creator|owner|og)|h\/t|source:)|©|🎥|📸|📷|🎬/iu;

/**
 * Does a caption credit someone else? Any mention of another account
 * counts, and so does a disclaimer ("dm for credit", "credit to owner",
 * "all rights", "©", "repost", "via"...). We only show a page's own posts.
 */
export function creditsAnother(
  caption: string | undefined,
  owner: string,
): boolean {
  if (!caption) return false;
  const c = caption.toLowerCase();
  if (DISCLAIMERS.test(c)) return true;
  if (bareCredit(c, owner)) return true;
  return mentionsOthers(c, owner);
}

/** Any @mention of an account other than the page itself. */
export function mentionsOthers(caption: string, owner: string): boolean {
  return [...caption.toLowerCase().matchAll(/@([a-z0-9._]{1,30})/g)]
    .map((m) => m[1].replace(/\.$/, ""))
    .some((h) => h !== owner.toLowerCase());
}

/** Why a post can't be offered, or null if it can. */
export function igIneligible(
  m: IgMedia,
  owner: string,
  now: Date,
): string | null {
  if (m.like_count == null) return "likes hidden";
  if (m.like_count < IG_LIKES_FLOOR) return "under the likes floor";
  const age = now.getTime() - Date.parse(m.timestamp);
  if (!(age >= 0 && age < IG_MAX_AGE_DAYS * 86_400_000)) return "not this week";
  if (m.media_product_type === "REELS" && !m.media_url)
    return "reel without media";
  if (
    m.media_type === "CAROUSEL_ALBUM" &&
    m.children?.data[0]?.media_type &&
    m.children.data[0].media_type !== "IMAGE"
  )
    return "carousel that opens on a video";
  if (!igImageUrl(m)) return "no image";
  if (creditsAnother(m.caption, owner)) return "credits another creator";
  const unsafe = unsafeText(m.caption);
  if (unsafe) return unsafe;
  return null;
}

/** A page's posts scored by likes over the page's median likes. */
export function scorePage(
  page: NonNullable<Discovery["business_discovery"]>,
  now: Date,
  kind: "person" | "brand" | "meme_page" = "brand",
): IgCandidate[] {
  const media = page.media?.data ?? [];
  const likes = media
    .map((m) => m.like_count)
    .filter((n): n is number => n != null);
  const base = median(likes);
  return media
    .filter((m) => !igIneligible(m, page.username, now))
    .map((m) => ({
      kind: "instagram" as const,
      id: m.id,
      username: page.username,
      avatar: page.profile_picture_url ?? null,
      permalink: m.permalink,
      mediaType: m.media_type,
      productType: m.media_product_type ?? null,
      imageUrl: igImageUrl(m)!,
      carouselCount: m.children?.data.length ?? null,
      likes: m.like_count!,
      timestamp: m.timestamp,
      caption: (m.caption ?? "").slice(0, 300),
      // Meme pages mostly repost others: even a post that passes the
      // credit filter ranks at half (Instagram strips the "@" a credit
      // used to show, so the caption can't be trusted to say).
      score:
        Math.round(
          (m.like_count! / Math.max(base ?? 1, 1)) *
            (kind === "meme_page" ? MEME_PAGE_FACTOR : 1) *
            100,
        ) / 100,
      baseline: base,
    }));
}

/**
 * This week's Instagram candidates across the universe (one call per
 * page), best first. Blocked accounts are skipped. Empty when Meta access
 * is missing or fails: then the plan falls back to X.
 */
export async function igCandidates(opts: {
  now: Date;
  token?: string;
  igUserId?: string;
  appSecret?: string;
  blocked?: ReadonlySet<string>;
  /** Accounts featured in the last 8 weeks (lowercase handles). */
  cooling?: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
}): Promise<IgCandidate[]> {
  if (!opts.token || !opts.igUserId) return [];
  const pages = await Promise.all(
    IG_UNIVERSE.filter(
      (a) => !opts.blocked?.has(a.username) && !opts.cooling?.has(a.username),
    ).map((a) => discoverPage(a.username, opts)),
  );
  return pages
    .flatMap((p) =>
      p
        ? scorePage(
            p,
            opts.now,
            IG_UNIVERSE.find((a) => a.username === p.username)?.kind,
          )
        : [],
    )
    .sort((a, b) => b.score - a.score || b.likes - a.likes)
    .slice(0, IG_CANDIDATES_MAX);
}

/**
 * One post as it is now: its page's media, paged back until we pass the
 * post's own timestamp (at most 4 pages). Null when it's gone.
 */
export async function igLookup(
  username: string,
  id: string,
  opts: IgOpts & { timestamp?: string },
): Promise<{ media: IgMedia; avatar: string | null } | null> {
  let after: string | undefined;
  for (let page = 0; page < 4; page++) {
    const p = await discoverPage(username, { ...opts, after });
    const data = p?.media?.data ?? [];
    const media = data.find((m) => m.id === id);
    if (media) return { media, avatar: p?.profile_picture_url ?? null };
    const oldest = data[data.length - 1]?.timestamp;
    after = p?.media?.paging?.cursors?.after;
    if (!after || !opts.timestamp || !oldest) return null;
    if (Date.parse(oldest) < Date.parse(opts.timestamp)) return null;
  }
  return null;
}

/** "https://www.instagram.com/p/<code>/" (the permalink is the canonical link). */
export function isIgPermalink(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      /^(www\.)?instagram\.com$/.test(u.hostname) &&
      /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
