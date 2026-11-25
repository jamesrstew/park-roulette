import { appSecretProof, IG_GRAPH } from "@/lib/news/igapi";

/**
 * The Instagram Graph API calls the publisher and the keyword DMs make
 * (Instagram API with Facebook Login, the existing long-lived Page token).
 * Pure: the token, ids and fetch come in, so every test mocks Meta. Same
 * conventions as lib/news/igapi.ts: the token goes in the Authorization
 * header, never the URL; appsecret_proof rides along when the app secret
 * is set.
 *
 * Publishing is two steps, in two cron runs: create a container (one per
 * carousel slide, then the carousel), and once its status_code is
 * FINISHED, publish it with media_publish. A container publishes once:
 * Meta refuses a second media_publish of the same creation_id.
 */

export type GraphOpts = {
  token: string;
  igUserId: string;
  appSecret?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Meta's codes that mean "try again later": rate limits (4, 17, 32, 613),
 * temporary errors (1, 2), and the Instagram subcodes for a media fetch
 * that timed out or failed on their side.
 */
const RETRY_CODES = new Set([1, 2, 4, 17, 32, 613]);
const RETRY_SUBCODES = new Set([
  2207001, 2207003, 2207008, 2207020, 2207032, 2207052, 2207053,
]);

export class GraphError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 for a network error or timeout. */
    readonly status: number,
    /** Meta's error code, when it said one. */
    readonly code: number | null,
    /**
     * True when we can't tell whether Meta acted (a timeout, a 5xx): a
     * publish is then settled from the container's status, never retried
     * blindly.
     */
    readonly ambiguous: boolean,
    /** True when trying again later may work (rate limits, fetch hiccups). */
    readonly retryable: boolean = ambiguous,
    readonly subcode: number | null = null,
  ) {
    super(message);
  }
}

/** Is this Meta error worth another try (until the post is 2 hours late)? */
export function retryableError(e: {
  code?: number | null;
  error_subcode?: number | null;
  is_transient?: boolean;
}): boolean {
  return (
    !!e.is_transient ||
    (e.code != null && RETRY_CODES.has(e.code)) ||
    (e.error_subcode != null && RETRY_SUBCODES.has(e.error_subcode))
  );
}

type Params = Record<string, string | number | boolean | undefined>;

async function call<T>(
  method: "GET" | "POST",
  path: string,
  params: Params,
  o: Pick<GraphOpts, "token" | "appSecret" | "fetchImpl">,
): Promise<T> {
  const q = new URLSearchParams();
  if (o.appSecret)
    q.set("appsecret_proof", appSecretProof(o.token, o.appSecret));
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) (method === "GET" ? q : body).set(k, String(v));
  const url = `${IG_GRAPH}/${path}${q.size ? `?${q}` : ""}`;
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(url, {
      method,
      headers: {
        authorization: `Bearer ${o.token}`,
        ...(method === "POST"
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: method === "POST" ? body.toString() : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new GraphError(
      `Meta didn't answer (${(e as Error)?.name ?? "error"})`,
      0,
      null,
      true,
    );
  }
  const json = (await res.json().catch(() => null)) as
    | (T & {
        error?: {
          message?: string;
          code?: number;
          error_subcode?: number;
          is_transient?: boolean;
        };
      })
    | null;
  if (!res.ok || !json || json.error) {
    const err = json?.error ?? {};
    const ambiguous = res.status >= 500 || res.status === 0;
    throw new GraphError(
      `Meta said ${res.status}: ${(err.message ?? `HTTP ${res.status}`).slice(0, 200)}`,
      res.status,
      err.code ?? null,
      ambiguous,
      ambiguous || retryableError(err),
      err.error_subcode ?? null,
    );
  }
  return json;
}

// --- Publishing ---------------------------------------------------------------

/** How many posts the account published through the API in the last 24 hours. */
export async function publishingQuota(o: GraphOpts): Promise<number | null> {
  const r = await call<{ data?: { quota_usage?: number }[] }>(
    "GET",
    `${o.igUserId}/content_publishing_limit`,
    { fields: "quota_usage,config" },
    o,
  );
  return r.data?.[0]?.quota_usage ?? null;
}

export type ContainerInput =
  | { kind: "image"; imageUrl: string; caption: string; altText: string }
  | { kind: "carousel_item"; imageUrl: string; altText: string }
  | { kind: "carousel"; children: string[]; caption: string }
  | { kind: "story"; imageUrl: string };

/** The parameters for one container, as Meta wants them (spec section 5). */
export function containerParams(c: ContainerInput): Params {
  switch (c.kind) {
    case "image":
      return { image_url: c.imageUrl, caption: c.caption, alt_text: c.altText };
    case "carousel_item":
      return {
        image_url: c.imageUrl,
        is_carousel_item: true,
        alt_text: c.altText,
      };
    case "carousel":
      return {
        media_type: "CAROUSEL",
        children: c.children.join(","),
        caption: c.caption,
      };
    case "story":
      // Stories take no caption and no alt_text.
      return { media_type: "STORIES", image_url: c.imageUrl };
  }
}

/** Create a container; returns its id. */
export async function createContainer(
  c: ContainerInput,
  o: GraphOpts,
): Promise<string> {
  const r = await call<{ id?: string }>(
    "POST",
    `${o.igUserId}/media`,
    containerParams(c),
    o,
  );
  if (!r.id)
    throw new GraphError("Meta gave no container id", 200, null, false);
  return r.id;
}

export type ContainerStatus =
  "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

export async function containerStatus(
  id: string,
  o: GraphOpts,
): Promise<{ code: ContainerStatus; detail: string | null }> {
  const r = await call<{ status_code?: ContainerStatus; status?: string }>(
    "GET",
    id,
    { fields: "status_code,status" },
    o,
  );
  return { code: r.status_code ?? "IN_PROGRESS", detail: r.status ?? null };
}

/** Publish a FINISHED container; returns the new media id. */
export async function publishContainer(
  creationId: string,
  o: GraphOpts,
): Promise<string> {
  const r = await call<{ id?: string }>(
    "POST",
    `${o.igUserId}/media_publish`,
    { creation_id: creationId },
    o,
  );
  if (!r.id) throw new GraphError("Meta gave no media id", 200, null, true);
  return r.id;
}

// --- Business Discovery (host tags) -----------------------------------------

/** A business or creator account, as Business Discovery describes it. */
export type DiscoveredAccount = {
  id: string;
  username: string;
  name: string | null;
  website: string | null;
  biography: string | null;
  followers: number | null;
  mediaCount: number | null;
};

/**
 * Look up another account by its username (Business Discovery). Meta
 * answers only for business and creator accounts; a personal account or a
 * handle that doesn't exist is an error. The handle goes in the field
 * expansion, so it must be a plain Instagram username.
 */
export async function businessDiscovery(
  handle: string,
  o: GraphOpts,
): Promise<DiscoveredAccount> {
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle))
    throw new GraphError("Not an Instagram username", 400, null, false);
  const r = await call<{
    business_discovery?: {
      id?: string;
      username?: string;
      name?: string;
      website?: string;
      biography?: string;
      followers_count?: number;
      media_count?: number;
    };
  }>(
    "GET",
    o.igUserId,
    {
      fields: `business_discovery.username(${handle}){id,username,name,website,biography,followers_count,media_count}`,
    },
    o,
  );
  const b = r.business_discovery;
  if (!b?.id || !b.username)
    throw new GraphError(
      "Business Discovery gave no account",
      200,
      null,
      false,
    );
  return {
    id: String(b.id),
    username: b.username,
    name: b.name ?? null,
    website: b.website ?? null,
    biography: b.biography ?? null,
    followers: b.followers_count ?? null,
    mediaCount: b.media_count ?? null,
  };
}

// --- The token -------------------------------------------------------------

/**
 * Is the token still good? A plain read of our own account, with the
 * token in the header as always. (debug_token would need the token in the
 * URL, so it isn't used; the expiry date isn't known, only validity.)
 */
export async function tokenValid(
  o: GraphOpts,
): Promise<{ valid: boolean; why: string | null }> {
  try {
    await call<{ id?: string }>("GET", o.igUserId, { fields: "id" }, o);
    return { valid: true, why: null };
  } catch (e) {
    const err = e as GraphError;
    // 190 is Meta's "invalid or expired token".
    if (err.code === 190 || err.status === 401)
      return { valid: false, why: err.message };
    throw e;
  }
}

// --- Comments and messages (keyword DMs) -----------------------------------

export type IgComment = {
  id: string;
  text?: string;
  timestamp?: string;
  from?: { id?: string };
};

/** At most this many pages of comments per post per poll. */
export const COMMENT_PAGES = 5;

/** A post's comments, newest first, paged (up to 5 pages of 50). */
export async function mediaComments(
  mediaId: string,
  o: GraphOpts,
): Promise<IgComment[]> {
  const out: IgComment[] = [];
  let after: string | undefined;
  for (let page = 0; page < COMMENT_PAGES; page++) {
    const r = await call<{
      data?: IgComment[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>(
      "GET",
      `${mediaId}/comments`,
      { fields: "id,text,timestamp,from", limit: 50, after },
      o,
    );
    out.push(...(r.data ?? []));
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

/** What Meta says back for a sent DM: ids only (spec: recipient_id, message_id). */
export type SentDm = { recipientId: string | null; messageId: string | null };

/**
 * A private reply to a comment: one DM to the commenter, keyed by the
 * comment (Meta allows one, within 7 days of the comment). Meta's current
 * Instagram Platform doc (Instagram API with Facebook Login, a Page token
 * on graph.facebook.com) sends it to the Instagram professional account's
 * own id, POST /{ig-user-id}/messages, with recipient.comment_id and
 * message.text; no messaging_type. Meta answers { recipient_id,
 * message_id }; both are returned so the send can be traced later.
 * https://developers.facebook.com/docs/instagram-platform/private-replies/
 */
export async function privateReply(
  commentId: string,
  text: string,
  o: GraphOpts,
): Promise<SentDm> {
  const r = await call<{ recipient_id?: string; message_id?: string }>(
    "POST",
    `${o.igUserId}/messages`,
    {
      recipient: JSON.stringify({ comment_id: commentId }),
      message: JSON.stringify({ text }),
    },
    o,
  );
  return sentDm(r);
}

function sentDm(r: { recipient_id?: unknown; message_id?: unknown }): SentDm {
  const s = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
  return { recipientId: s(r.recipient_id), messageId: s(r.message_id) };
}

export type IgMessage = {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id?: string };
  /** Set when the message is a reply to one of our Stories. */
  story?: { reply_to?: { id?: string } };
};

/** Recent Instagram conversations' latest messages (for Story replies). */
export async function recentMessages(
  page: string,
  o: GraphOpts,
): Promise<IgMessage[]> {
  const r = await call<{
    data?: { messages?: { data?: IgMessage[] } }[];
  }>(
    "GET",
    `${page}/conversations`,
    {
      platform: "instagram",
      fields: "messages.limit(5){id,message,created_time,from,story}",
      limit: 25,
    },
    o,
  );
  return (r.data ?? []).flatMap((c) => c.messages?.data ?? []);
}

/** A reply inside the 24-hour window that a person's own message opened. */
export async function sendMessage(
  page: string,
  recipientId: string,
  text: string,
  o: GraphOpts,
): Promise<SentDm> {
  const r = await call<{ recipient_id?: string; message_id?: string }>(
    "POST",
    `${page}/messages`,
    {
      recipient: JSON.stringify({ id: recipientId }),
      message: JSON.stringify({ text }),
      messaging_type: "RESPONSE",
    },
    o,
  );
  return sentDm(r);
}

// --- The DM diagnostic (/api/social/dm-debug, read only) --------------------

/** One comment as Meta has it, with who wrote it (never stored). */
export type CommentDetail = {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
  hidden?: boolean;
};

export async function commentDetail(
  commentId: string,
  o: GraphOpts,
): Promise<CommentDetail> {
  return call<CommentDetail>(
    "GET",
    commentId,
    { fields: "id,text,timestamp,username,from,media{id},hidden" },
    o,
  );
}

export type ConversationDetail = {
  id: string;
  updated_time?: string;
  messages?: {
    data?: {
      id: string;
      created_time?: string;
      message?: string;
      from?: { id?: string; username?: string };
      to?: { data?: { id?: string; username?: string }[] };
    }[];
  };
};

/**
 * Our Instagram conversation with one person (their Instagram-scoped id),
 * with its latest messages, from the Page's inbox. Empty when there is none.
 */
export async function conversationWith(
  page: string,
  igsid: string,
  o: GraphOpts,
): Promise<ConversationDetail[]> {
  const r = await call<{ data?: ConversationDetail[] }>(
    "GET",
    `${page}/conversations`,
    {
      platform: "instagram",
      user_id: igsid,
      fields:
        "id,updated_time,messages.limit(10){id,created_time,message,from,to}",
    },
    o,
  );
  return r.data ?? [];
}

/** One message by its id (the message_id a send returned). */
export async function messageDetail(
  messageId: string,
  o: GraphOpts,
): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>(
    "GET",
    messageId,
    { fields: "id,created_time,message,from,to" },
    o,
  );
}

// --- Facebook Page cross-posts (behind SOCIAL_FACEBOOK, off) ----------------

/**
 * The same images on the Page (FB_PAGE_ID), with the live link in the
 * caption. Needs pages_manage_posts and pages_read_engagement, which James
 * adds before the flag goes on. Photos are uploaded unpublished, then one
 * feed post attaches them all.
 */
export async function facebookPost(
  page: string,
  post: { imageUrls: string[]; caption: string },
  o: Pick<GraphOpts, "token" | "appSecret" | "fetchImpl">,
): Promise<string> {
  const ids: string[] = [];
  for (const url of post.imageUrls) {
    const r = await call<{ id?: string }>(
      "POST",
      `${page}/photos`,
      { url, published: false },
      o,
    );
    if (!r.id) throw new GraphError("No Facebook photo id", 200, null, false);
    ids.push(r.id);
  }
  const params: Params = { message: post.caption };
  ids.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const r = await call<{ id?: string }>("POST", `${page}/feed`, params, o);
  if (!r.id) throw new GraphError("No Facebook post id", 200, null, true);
  return r.id;
}
