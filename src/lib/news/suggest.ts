import { z } from "zod";
import raw from "../../../data/ig-suggesters.json";
import {
  IG_MAX_AGE_DAYS,
  type IgCandidate,
  igIneligible,
  type IgMedia,
} from "./igapi";
import type { Issue } from "./issue";
import type { Plan } from "./plan-types";
import { igImageUrl } from "@/components/news/InstagramCard";
import { blockedLink, MENTIONS } from "./validate";

/**
 * Parents' corner suggestions, the pure half (lib/news/suggestions.ts
 * talks to Meta and the database). James shares a post with
 * @park_roulette by Instagram DM; the post goes to the top of the plan's
 * Instagram list, marked suggested_by. A suggestion only raises priority:
 * the post still passes every rule a found post passes (likes showing and
 * over the floor, the page's own content, no other creator credited, no
 * politics or profanity, a still image or cover, not blocked, not taken
 * down, its account not featured in the last 8 weeks, no competitor
 * newsletter named or linked). The one difference: it may be up to
 * max_age_days old, not 7, because James shares what he sees when he
 * sees it (decision, November 2026). Suggestions older than that expire.
 */

const Config = z.strictObject({
  /** Instagram usernames whose shared posts count (lowercase). */
  senders: z.array(z.string().regex(/^[a-z0-9._]{1,30}$/)).min(1),
  max_age_days: z.number().int().min(1).max(90),
});
export const SUGGESTERS = Config.parse(raw);
export const SUGGESTION_SENDERS: ReadonlySet<string> = new Set(
  SUGGESTERS.senders,
);
export const SUGGESTION_MAX_AGE_DAYS = SUGGESTERS.max_age_days;
/** At most this many open suggestions are looked up per plan (Meta calls). */
export const SUGGESTIONS_PER_PLAN = 8;

/**
 * The account in an Instagram post page's og:url
 * ("https://www.instagram.com/corporate.bro/reel/DgDE7QIBEMP/"), when it
 * is the post with this shortcode. Null otherwise.
 */
export function accountFromPostPage(
  html: string,
  shortcode: string,
): string | null {
  const tag = html.match(
    /<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/i,
  );
  if (!tag) return null;
  try {
    const u = new URL(tag[1]);
    if (u.protocol !== "https:" || !/^(www\.)?instagram\.com$/.test(u.hostname))
      return null;
    const m = u.pathname.match(
      /^\/([a-z0-9._]{1,30})\/(?:p|reels?|tv)\/([A-Za-z0-9_-]{5,40})\/?$/,
    );
    return m && m[2] === shortcode ? m[1] : null;
  } catch {
    return null;
  }
}

/** Is a suggestion past its time (sent more than max_age_days ago)? */
export function suggestionExpired(sentAt: Date, now: Date): boolean {
  return (
    now.getTime() - sentAt.getTime() > SUGGESTION_MAX_AGE_DAYS * 86_400_000
  );
}

/** Why a suggested post can't run, or null when it passes every check. */
export function suggestionIneligible(
  m: IgMedia,
  owner: string,
  now: Date,
  o: {
    blocked: ReadonlySet<string>;
    cooling: ReadonlySet<string>;
    takenDown: (id: string) => boolean;
  },
): string | null {
  const who = owner.toLowerCase();
  if (o.blocked.has(who)) return "blocked account";
  if (o.takenDown(m.id)) return "taken down";
  if (o.cooling.has(who)) return "account featured in the last 8 weeks";
  const rule = igIneligible(m, who, now, SUGGESTION_MAX_AGE_DAYS);
  if (rule) return rule;
  const caption = m.caption ?? "";
  if (MENTIONS.test(caption) || MENTIONS.test(who))
    return "names another newsletter";
  const links = caption.match(/https?:\/\/[^\s)]+/gi) ?? [];
  if (links.some((l) => blockedLink(l))) return "links another newsletter";
  return null;
}

/** A suggested post as one of the plan's Instagram candidates. */
export function suggestedCandidate(
  m: IgMedia,
  owner: string,
  avatar: string | null,
  baseline: number | null,
  s: { sender: string; sentAt: Date },
): IgCandidate {
  return {
    kind: "instagram",
    id: m.id,
    username: owner.toLowerCase(),
    avatar,
    permalink: m.permalink,
    mediaType: m.media_type,
    productType: m.media_product_type ?? null,
    imageUrl: igImageUrl(m)!,
    carouselCount: m.children?.data.length ?? null,
    likes: m.like_count!,
    timestamp: m.timestamp,
    caption: (m.caption ?? "").slice(0, 300),
    score: Math.round((m.like_count! / Math.max(baseline ?? 1, 1)) * 100) / 100,
    baseline,
    suggested_by: s.sender,
    suggested_at: s.sentAt.toISOString(),
  };
}

/** Suggested first (newest suggestion first), then the rest, no repeats. */
export function withSuggestionsFirst(
  suggested: IgCandidate[],
  found: IgCandidate[],
): IgCandidate[] {
  const ids = new Set(suggested.map((c) => c.id));
  return [
    ...[...suggested].sort((a, b) =>
      (b.suggested_at ?? "").localeCompare(a.suggested_at ?? ""),
    ),
    ...found.filter((c) => !ids.has(c.id)),
  ];
}

/**
 * How old an Instagram pick may be: a week, or SUGGESTION_MAX_AGE_DAYS
 * when the stored plan (code's, never the writer's) offered it as one of
 * James's DM suggestions, for that same account, and the suggestion
 * hasn't expired.
 */
export function igMaxAgeDays(
  plan: Plan | null,
  meme: NonNullable<Issue["meme"]>,
  now: Date,
): number {
  if (meme.platform !== "instagram" || !meme.account) return IG_MAX_AGE_DAYS;
  const c = plan?.parents_corner?.instagram?.find(
    (c) => c.id === meme.postId && c.username === meme.account,
  );
  return c?.suggested_by &&
    c.suggested_at &&
    !suggestionExpired(new Date(c.suggested_at), now)
    ? SUGGESTION_MAX_AGE_DAYS
    : IG_MAX_AGE_DAYS;
}
