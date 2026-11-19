/**
 * X API v2 for Parents' corner (discovery v4), with an app-only Bearer
 * Token (X_BEARER_TOKEN, from the existing X developer app; never the
 * x-bot's user tokens, which this would rotate out from under it).
 *
 * Discovery is a known universe of parent-humor accounts (by permanent
 * user id), not a keyword search: 3 to 4 recent-search calls a week, each
 * `(from:a OR from:b ...) -is:retweet -is:reply lang:en` over the last 7
 * days. A post is scored by how far it beats its author's usual numbers.
 * Pure: the token and fetch are passed in, so tests mock X.
 */

import { xDisplayText, type XUrlEntity } from "@/components/news/PostCard";

/** No post under this many likes, however well it beats its author. */
export const LIKES_FLOOR = 1000;
/** The model sees this many, best first. */
export const CANDIDATES_MAX = 10;
/** X's documented recent-search query limit (non-Enterprise). */
export const QUERY_MAX = 512;
/** A standalone post X draws in full; longer posts get "Show more". */
export const STANDALONE_MAX_CHARS = 280;
/** Posts older than this are out (the email is weekly). */
export const MAX_AGE_DAYS = 7;
/** One account at most once in this many weeks. */
export const ACCOUNT_COOLDOWN_WEEKS = 8;
/** Followers below this share of the account's peak look like a takeover. */
export const TAKEOVER_FOLLOWER_SHARE = 0.25;

export const QUERY_SUFFIX = "-is:retweet -is:reply lang:en";

const FIELDS = new URLSearchParams({
  "tweet.fields":
    "created_at,author_id,public_metrics,attachments,lang,possibly_sensitive,note_tweet,entities,referenced_tweets,in_reply_to_user_id,edit_history_tweet_ids",
  expansions: "author_id,attachments.media_keys",
  "user.fields":
    "name,username,profile_image_url,verified,verified_type,public_metrics,protected",
  "media.fields": "type,url,preview_image_url,width,height,alt_text",
});

/** One X post, as code saw it: everything the card draws and the score needs. */
export type XPost = {
  kind: "x";
  id: string;
  /** The author's permanent user id. */
  authorId: string;
  /** Display text (xDisplayText): t.co swapped for display URLs, entities decoded. */
  text: string;
  /** Display URLs in the text, drawn in X blue. */
  links: string[];
  name: string;
  username: string;
  /** The author's avatar (400x400), fetched by our server, never readers. */
  avatar: string | null;
  verified: boolean;
  verifiedType: "blue" | "business" | "government" | null;
  createdAt: string;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  media: {
    type: "photo" | "video" | "animated_gif";
    /** The photo, or the video's preview image. */
    url: string;
    width: number;
    height: number;
    alt: string | null;
  }[];
  possiblySensitive: boolean;
  /**
   * True when it's an original post X draws in full: not a reply, quote or
   * repost, never edited, not a long post, and 280 characters or fewer.
   */
  standalone: boolean;
};

/** A post the plan offers the writer, with its score. */
export type Candidate = XPost & {
  /** Engagement over the author's trailing median (1 = a usual post). */
  score: number;
  /** The author's trailing median engagement, or null with no history. */
  baseline: number | null;
  via: "universe" | "roundup";
};

type ApiTweet = {
  id: string;
  text: string;
  note_tweet?: { text: string };
  created_at: string;
  author_id: string;
  lang?: string;
  possibly_sensitive?: boolean;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
  };
  attachments?: { media_keys?: string[] };
  entities?: { urls?: XUrlEntity[] };
  referenced_tweets?: { type: string; id: string }[];
  in_reply_to_user_id?: string;
  edit_history_tweet_ids?: string[];
};
export type ApiUser = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  verified?: boolean;
  verified_type?: string;
  protected?: boolean;
  public_metrics?: { followers_count?: number };
};
type ApiMedia = {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
  width?: number;
  height?: number;
  alt_text?: string;
};
type ApiResponse = {
  data?: ApiTweet | ApiTweet[] | ApiUser[];
  includes?: { users?: ApiUser[]; media?: ApiMedia[] };
};

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
/** Characters as a reader counts them (an emoji is one). */
export function charCount(s: string): number {
  return [...segmenter.segment(s)].length;
}

function verifiedType(u: ApiUser): XPost["verifiedType"] {
  if (u.verified_type === "business") return "business";
  if (u.verified_type === "government") return "government";
  return u.verified || u.verified_type === "blue" ? "blue" : null;
}

/** Likes + 2 x reposts + quotes. */
export function engagement(
  p: Pick<XPost, "likes" | "reposts" | "quotes">,
): number {
  return p.likes + 2 * p.reposts + p.quotes;
}

/** One post from an API response, with its author and media. */
export function toPost(
  t: ApiTweet,
  inc: ApiResponse["includes"],
): XPost | null {
  const user = inc?.users?.find((u) => u.id === t.author_id);
  if (!user) return null;
  const media = (t.attachments?.media_keys ?? [])
    .map((k) => inc?.media?.find((m) => m.media_key === k))
    .filter((m): m is ApiMedia => !!m)
    .flatMap((m) => {
      const url = m.type === "photo" ? m.url : m.preview_image_url;
      return url && m.width && m.height
        ? [
            {
              type: m.type,
              url,
              width: m.width,
              height: m.height,
              alt: m.alt_text ?? null,
            },
          ]
        : [];
    });
  const quoted = t.referenced_tweets?.find((r) => r.type === "quoted")?.id;
  const shown = xDisplayText(t.note_tweet?.text ?? t.text, {
    urls: t.entities?.urls,
    quotedPostId: quoted,
    hasMedia: media.length > 0,
  });
  const m = t.public_metrics ?? {};
  const standalone =
    !t.referenced_tweets?.length &&
    !t.in_reply_to_user_id &&
    (t.edit_history_tweet_ids?.length ?? 1) <= 1 &&
    !t.note_tweet &&
    charCount(shown.text) <= STANDALONE_MAX_CHARS;
  const vt = verifiedType(user);
  return {
    kind: "x",
    id: t.id,
    authorId: user.id,
    text: shown.text,
    links: shown.links,
    name: user.name,
    username: user.username,
    avatar: user.profile_image_url?.replace("_normal.", "_400x400.") ?? null,
    verified: vt !== null,
    verifiedType: vt,
    createdAt: t.created_at,
    likes: m.like_count ?? 0,
    replies: m.reply_count ?? 0,
    reposts: m.retweet_count ?? 0,
    quotes: m.quote_count ?? 0,
    media,
    possiblySensitive: !!t.possibly_sensitive,
    standalone,
  };
}

async function get(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<ApiResponse | null> {
  const res = await fetchImpl(`https://api.x.com/2${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn(`[news] X API ${path.split("?")[0]} said ${res.status}`);
    return null;
  }
  return (await res.json()) as ApiResponse;
}

/**
 * Pack handles into as few queries as fit X's 512-character limit, in the
 * order given (most-featured first): `(from:a OR from:b) -is:retweet ...`.
 */
export function universeQueries(
  handles: readonly string[],
  max = QUERY_MAX,
): string[] {
  const out: string[] = [];
  let batch: string[] = [];
  const q = (hs: string[]) =>
    `(${hs.map((h) => `from:${h}`).join(" OR ")}) ${QUERY_SUFFIX}`;
  for (const h of handles) {
    if (q([h]).length > max) continue; // can't fit even alone
    if (batch.length && q([...batch, h]).length > max) {
      out.push(q(batch));
      batch = [];
    }
    batch.push(h);
  }
  if (batch.length) out.push(q(batch));
  return out;
}

/** What one week's fetch saw: every post (for the stats) and their authors. */
export type UniverseFetch = { posts: XPost[]; users: ApiUser[] };

/** The last 7 days from every universe account, 3 to 4 calls. */
export async function fetchUniverse(
  token: string | undefined,
  handles: readonly string[],
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<UniverseFetch> {
  if (!token || !handles.length) return { posts: [], users: [] };
  const start = new Date(
    now.getTime() - MAX_AGE_DAYS * 86_400_000 + 60_000,
  ).toISOString();
  const results = await Promise.all(
    universeQueries(handles).map((query) => {
      const q = new URLSearchParams(FIELDS);
      q.set("query", query);
      q.set("max_results", "100");
      q.set("start_time", start);
      return get(`/tweets/search/recent?${q}`, token, fetchImpl).catch(
        () => null,
      );
    }),
  );
  const posts: XPost[] = [];
  const users = new Map<string, ApiUser>();
  for (const r of results) {
    for (const u of r?.includes?.users ?? []) users.set(u.id, u);
    const tweets = (Array.isArray(r?.data) ? r.data : []) as ApiTweet[];
    for (const t of tweets) {
      if ((t.lang ?? "en") !== "en") continue;
      const p = toPost(t, r?.includes);
      if (p) posts.push(p);
    }
  }
  return { posts, users: [...users.values()] };
}

/** Median of some numbers, or null for none. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** One universe account as we last knew it. */
export type KnownAccount = {
  id: string;
  username: string;
  /** The most followers we've seen (null: never seen). */
  followersPeak: number | null;
};

/**
 * A sign the account isn't the one we vetted: a different user id now
 * posts under the vetted handle (the handle was released and reused), the
 * vetted id posts under a new handle, or followers fell to under a
 * quarter of their peak (a reset or sold account). Null: looks fine.
 */
export function takeoverReason(
  known: KnownAccount,
  seen: { id: string; username: string; followers: number | null },
): string | null {
  const sameHandle =
    seen.username.toLowerCase() === known.username.toLowerCase();
  if (sameHandle && seen.id !== known.id)
    return `@${seen.username} now belongs to a different account (id ${seen.id}, vetted ${known.id}).`;
  if (!sameHandle && seen.id === known.id)
    return `Vetted as @${known.username}, now posting as @${seen.username}.`;
  if (
    seen.followers != null &&
    known.followersPeak != null &&
    known.followersPeak >= 1000 &&
    seen.followers < known.followersPeak * TAKEOVER_FOLLOWER_SHARE
  )
    return `Followers fell from ${known.followersPeak} to ${seen.followers}.`;
  return null;
}

/**
 * The plan's candidates: posts that beat their author's usual numbers.
 * Score = engagement / the author's trailing median (from x_author_stats,
 * before this week's posts). With under 3 past samples, this week's posts
 * by the author join the median. Only standalone, unflagged posts from
 * accounts that aren't excluded, with at least LIKES_FLOOR likes and under
 * 7 days old. Best first, top 10.
 */
export function rankCandidates(
  posts: readonly XPost[],
  opts: {
    now: Date;
    /** Trailing engagement samples per author id (before this fetch). */
    history: ReadonlyMap<string, readonly number[]>;
    /** Author ids (or "@handle", lowercase) that are out: flagged, dropped, cooling down. */
    excluded: ReadonlySet<string>;
    via?: Candidate["via"];
  },
): Candidate[] {
  const thisWeek = new Map<string, number[]>();
  for (const p of posts)
    thisWeek.set(p.authorId, [
      ...(thisWeek.get(p.authorId) ?? []),
      engagement(p),
    ]);
  const seen = new Set<string>();
  return posts
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      const age = opts.now.getTime() - new Date(p.createdAt).getTime();
      return (
        p.standalone &&
        !p.possiblySensitive &&
        p.likes >= LIKES_FLOOR &&
        age >= 0 &&
        age < MAX_AGE_DAYS * 86_400_000 &&
        !opts.excluded.has(p.authorId) &&
        !opts.excluded.has(`@${p.username.toLowerCase()}`)
      );
    })
    .map((p) => {
      const past = opts.history.get(p.authorId) ?? [];
      const base =
        past.length >= 3
          ? median(past)
          : median([...past, ...(thisWeek.get(p.authorId) ?? [])]);
      const score =
        Math.round((engagement(p) / Math.max(base ?? 1, 1)) * 100) / 100;
      return {
        ...p,
        score,
        baseline: past.length ? median(past) : null,
        via: opts.via ?? ("universe" as const),
      };
    })
    .sort((a, b) => b.score - a.score || b.likes - a.likes)
    .slice(0, CANDIDATES_MAX);
}

/** One post by id, as it is now (null if deleted, private or unreachable). */
export async function lookupPost(
  id: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<XPost | null> {
  if (!token || !/^\d{1,25}$/.test(id)) return null;
  const r = await get(`/tweets/${id}?${FIELDS}`, token, fetchImpl).catch(
    () => null,
  );
  const t = r?.data && !Array.isArray(r.data) ? (r.data as ApiTweet) : null;
  return t ? toPost(t, r?.includes) : null;
}

/** Accounts by handle (one call, up to 100), for growing the universe. */
export async function lookupUsers(
  handles: readonly string[],
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiUser[]> {
  const clean = handles.filter((h) => /^\w{1,15}$/.test(h)).slice(0, 100);
  if (!token || !clean.length) return [];
  const q = new URLSearchParams({
    usernames: clean.join(","),
    "user.fields": FIELDS.get("user.fields")!,
  });
  const r = await get(`/users/by?${q}`, token, fetchImpl).catch(() => null);
  return Array.isArray(r?.data) ? (r.data as ApiUser[]) : [];
}

/** The canonical link to a post. */
export function postUrl(p: Pick<XPost, "username" | "id">): string {
  return `https://x.com/${p.username}/status/${p.id}`;
}
