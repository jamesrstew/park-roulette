/* eslint-disable @next/next/no-img-element -- Satori (next/og) draws plain <img>. */
/**
 * Parents' corner: a faithful X post card for the Bend Playground Passport
 * email. Pure JSX + inline styles + inline SVG for next/og ImageResponse
 * (Satori). SVG helpers are plain functions (xLogo(), heart(), ...), never
 * JSX components, because Satori needs that.
 *
 *   const fonts = await loadInterFonts(); // vendored TTFs in public/fonts
 *   const { text, links } = xDisplayText(apiText, { urls: entities?.urls, quotedPostId });
 *   const post = { ...fromApi, text, links }; // or cardPost(snapshot, images)
 *   new ImageResponse(<PostCard post={post} />, {
 *     ...postCardSize(post, fonts), fonts, emoji: "twemoji",
 *   });
 *
 * 1200 wide (2x for a 536px slot, ~340px on phones). Height depends on the
 * text, so postCardSize() wraps the text with Inter's real advance widths
 * (read from the same font buffers) to compute it.
 *
 * The X post itself keeps X's light-mode layout, colors and type ramp. Only
 * the backdrop is Park Roulette: a cream paper mat with a crayon ink border
 * and offset ink shadow, on a transparent canvas for dark inboxes.
 */

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type XMedia = {
  /** Server-fetched image as a data URL (photo, or a video's preview_image_url). */
  src: string;
  width: number;
  height: number;
  kind: "photo" | "video" | "animated_gif";
};

export type CardPost = {
  /** Display name, as returned (may contain emoji). */
  name: string;
  /** Without the "@". */
  handle: string;
  /** Server-fetched avatar as a data URL; null/undefined draws X's default. */
  avatar?: string | null;
  verified?: boolean;
  /**
   * X's badge color: "blue" (default when verified), "business" (gold badge,
   * square avatar), "government" (gray badge). From the API's verified_type.
   */
  verifiedType?: "blue" | "business" | "government";
  /** Display text: run the API text through xDisplayText() first. */
  text: string;
  /** Display URLs in the text (xDisplayText().links), drawn in X blue. */
  links?: string[];
  /** ISO time of the latest edit, if the post was edited (X shows "Last edited ..."). */
  editedAt?: string | null;
  /** True for X "long posts" (note_tweet). Text over 280 chars is treated the same. */
  isLongPost?: boolean;
  /** ISO timestamp (created_at). */
  createdAt: string;
  likes?: number | null;
  /** Reply and repost counts for the action row (null hides the count). */
  replies?: number | null;
  reposts?: number | null;
  /** Only the first item is shown, as a single thumbnail. */
  media?: XMedia[];
};

export type FontDef = {
  name: string;
  data: ArrayBuffer | Buffer;
  weight: 400 | 700;
  style: "normal";
};

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

/**
 * Inter 400 + 700, vendored as static TTFs in public/fonts (SIL OFL 1.1; the
 * license ships next to them as public/fonts/Inter-OFL.txt), read the same way
 * og-card.tsx reads Gochi Hand. Satori needs TTF/OTF, not WOFF2. No network at
 * render time, and the measured wrap can't drift because Google Fonts changed
 * its Inter build. Unlike handFont(), this throws on a missing file: the card's
 * height is computed from these exact glyph widths, so there is no safe
 * fallback. Cache the promise at module scope in the route.
 */
export async function loadInterFonts(): Promise<FontDef[]> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const one = async (file: string, weight: 400 | 700): Promise<FontDef> => ({
    name: "Inter",
    data: await readFile(join(process.cwd(), "public/fonts", file)),
    weight,
    style: "normal",
  });
  return Promise.all([
    one("Inter-Regular.ttf", 400),
    one("Inter-Bold.ttf", 700),
  ]);
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

/** An entities.urls item from the X API (v2). */
export type XUrlEntity = {
  url: string;
  display_url?: string;
  expanded_url?: string;
  media_key?: string;
};

/**
 * X API text -> what X displays (X display requirements: "URLs display the
 * display_url value"):
 * - each t.co link becomes its display_url ("parkroulette.com/bend…");
 * - t.co links X hides are dropped: attached media (media_key) and the
 *   trailing link to a quoted post (expanded_url ends in /status/<quotedPostId>);
 * - HTML entities X escapes (&lt; &gt; &amp;) are decoded, &amp; last.
 * Nothing else is touched. `links` lists the display URLs, for blue styling.
 * Without entities, only a trailing t.co is dropped when `hasMedia` is set.
 */
export function xDisplayText(
  apiText: string,
  opts: { urls?: XUrlEntity[]; quotedPostId?: string; hasMedia?: boolean } = {},
): { text: string; links: string[] } {
  let t = apiText;
  const links: string[] = [];
  const hidden = (u: XUrlEntity) =>
    !!u.media_key ||
    (!!opts.quotedPostId &&
      !!u.expanded_url?.match(
        new RegExp(`/status/${opts.quotedPostId}(?:\\D|$)`),
      ));
  for (const u of opts.urls ?? []) {
    if (hidden(u)) {
      t = t.split(u.url).join("");
    } else if (u.display_url) {
      t = t.split(u.url).join(u.display_url);
      links.push(u.display_url);
    }
  }
  if (opts.hasMedia && !opts.urls)
    t = t.replace(/\s*https:\/\/t\.co\/\w+\s*$/, "");
  t = t.replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
  return {
    text: t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
    links,
  };
}

/**
 * Alt text, which is also the link's accessible name (the image is the whole
 * link): "Post by Name (@handle) on X, with a photo: <text>". Uses the visible
 * text, on one line, so a screen reader hears what a sighted reader sees.
 */
export function postAlt(post: CardPost, fonts: FontDef[]): string {
  const { shown, truncated } = layoutText(post, fonts);
  const body = shown.replace(/\s*\n\s*/g, " ").trim();
  const kind = post.media?.[0]?.kind;
  const media =
    kind === "photo"
      ? ", with a photo"
      : kind === "video"
        ? ", with a video"
        : kind === "animated_gif"
          ? ", with a GIF"
          : "";
  const head = `Post by ${post.name} (@${post.handle}) on X${media}`;
  if (!body) return `${head}.`;
  return `${head}: ${body}${truncated && !body.endsWith("…") ? "…" : ""}`;
}

/* ------------------------------------------------------------------ */
/* Design tokens (2x)                                                  */
/* ------------------------------------------------------------------ */

export const INK = "#2b2a33";
export const PAPER = "#fffaf0";
const X_TEXT = "#0f1419";
const X_GRAY = "#536471";
const X_LINE = "#cfd9de";
const X_BLUE = "#1d9bf0";
const X_LINK = "#006fd6"; // X's embed button text color

export const W = 1200;
// canvas -> paper mat (left/top 8, right/bottom 20 leave room for the shadow)
export const MAT = { left: 8, top: 8, right: 20, bottom: 20, border: 6 };
const MAT_PAD = 34; // cream visible around the post
const CARD_BORDER = 2;
const CARD_PAD_X = 48;
const CARD_PAD_TOP = 44;
const CARD_PAD_BOTTOM = 36;
const CARD_W = W - MAT.left - MAT.right - 2 * MAT.border - 2 * MAT_PAD; // 1104
const CONTENT_W = CARD_W - 2 * CARD_BORDER - 2 * CARD_PAD_X; // 1004

const AVATAR = 112; // ~32px on a phone
const HEADER_H = 116;
const NAME_SIZE = 50;
const HANDLE_SIZE = 46;
const TEXT_SIZE = 54; // ~15px on a phone, X's body size
const TEXT_LH = 72;
const GAP_HEADER_TEXT = 30;
const MEDIA_GAP = 30;
const MEDIA_MAX_RATIO = 1; // tall photos crop to square (keeps the email short)
const MEDIA_MIN_RATIO = 9 / 16; // panoramas crop to 16:9
const META_GAP = 30;
const META_H = 56;
const META_SIZE = 44;
const ACTIONS_GAP = 18;
const ACTIONS_H = 84;
const BUTTON_GAP = 24;
const BUTTON_H = 104;

const MAX_CHARS = 280; // X shows ~280 chars of a long post, then "Show more"
// Long posts only: X's preview also stops early when a long post is many short
// lines. A standard (<=280) post is always drawn in full, as X draws it: the
// display rules say the text "may not be altered", so no cap applies to it.
const MAX_LINES = 14;

/* ------------------------------------------------------------------ */
/* Text measurement: Inter's real advance widths                       */
/* ------------------------------------------------------------------ */

type Metrics = (cp: number) => number | undefined; // advance in em

const metricsCache = new WeakMap<object, Metrics>();

/** Minimal TTF reader: cmap (format 4/12) + hmtx. Kerning ignored (it only narrows). */
function fontMetrics(data: ArrayBuffer | Buffer): Metrics {
  const cached = metricsCache.get(data);
  if (cached) return cached;
  const u8 =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tables: Record<string, number> = {};
  for (let i = 0; i < dv.getUint16(4); i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    tables[tag] = dv.getUint32(o + 8);
  }
  const upem = dv.getUint16(tables.head + 18);
  const nHM = dv.getUint16(tables.hhea + 34);
  const adv = (gid: number) =>
    dv.getUint16(tables.hmtx + 4 * Math.min(gid, nHM - 1)) / upem;

  let lookup: (cp: number) => number = () => 0;
  const cmap = tables.cmap;
  let f4 = -1;
  let f12 = -1;
  for (let i = 0; i < dv.getUint16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8;
    const pid = dv.getUint16(rec);
    const eid = dv.getUint16(rec + 2);
    const sub = cmap + dv.getUint32(rec + 4);
    const fmt = dv.getUint16(sub);
    if (fmt === 12 && pid === 3 && eid === 10) f12 = sub;
    if (fmt === 4 && pid === 3 && (eid === 1 || eid === 0)) f4 = sub;
  }
  if (f12 >= 0) {
    const n = dv.getUint32(f12 + 12);
    lookup = (cp) => {
      for (let g = 0; g < n; g++) {
        const o = f12 + 16 + g * 12;
        const s = dv.getUint32(o);
        const e = dv.getUint32(o + 4);
        if (cp >= s && cp <= e) return dv.getUint32(o + 8) + (cp - s);
      }
      return 0;
    };
  } else if (f4 >= 0) {
    const seg = dv.getUint16(f4 + 6) / 2;
    const ends = f4 + 14;
    const starts = ends + seg * 2 + 2;
    const deltas = starts + seg * 2;
    const ranges = deltas + seg * 2;
    lookup = (cp) => {
      if (cp > 0xffff) return 0;
      for (let i = 0; i < seg; i++) {
        if (cp > dv.getUint16(ends + i * 2)) continue;
        const s = dv.getUint16(starts + i * 2);
        if (cp < s) return 0;
        const ro = dv.getUint16(ranges + i * 2);
        const d = dv.getInt16(deltas + i * 2);
        if (ro === 0) return (cp + d) & 0xffff;
        const gi = dv.getUint16(ranges + i * 2 + ro + (cp - s) * 2);
        return gi === 0 ? 0 : (gi + d) & 0xffff;
      }
      return 0;
    };
  }
  const memo = new Map<number, number | undefined>();
  const m: Metrics = (cp) => {
    if (!memo.has(cp)) {
      const gid = lookup(cp);
      memo.set(cp, gid ? adv(gid) : undefined);
    }
    return memo.get(cp);
  };
  metricsCache.set(data, m);
  return m;
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function textWidth(s: string, m: Metrics, size: number): number {
  let w = 0;
  for (const { segment } of segmenter.segment(s)) {
    if (PICTO.test(segment)) {
      w += 1.0; // Twemoji renders as a 1em square
      continue;
    }
    for (const ch of segment) {
      const cp = ch.codePointAt(0)!;
      if (cp >= 0x300 && cp <= 0x36f) continue; // combining marks
      w += m(cp) ?? 1.0; // missing glyph: a Noto fallback, assume 1em
    }
  }
  return w * size;
}

/**
 * Greedy wrap: breaks after spaces and hyphens, hard breaks on "\n",
 * over-long words broken by grapheme. The card draws exactly these lines, one
 * row each, so the computed height is exact.
 */
function wrapLines(
  text: string,
  m: Metrics,
  size: number,
  maxW: number,
): string[] {
  const limit = maxW; // kerning is ignored, so measured widths run a little wide: safe
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    const tokens = para.match(/\s+|[^\s-]*-|[^\s-]+/g) ?? [];
    for (const tok of tokens) {
      if (/^\s+$/.test(tok)) {
        if (line) line += tok;
        continue;
      }
      const trial = line + tok;
      if (textWidth(trial.trimEnd(), m, size) <= limit) {
        line = trial;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      // a single token wider than the line: break it by grapheme
      let rest = tok;
      while (textWidth(rest, m, size) > limit) {
        let cut = "";
        for (const { segment } of segmenter.segment(rest)) {
          if (textWidth(cut + segment, m, size) > limit) break;
          cut += segment;
        }
        if (!cut) cut = [...segmenter.segment(rest)][0].segment;
        out.push(cut);
        rest = rest.slice(cut.length);
      }
      line = rest;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** What actually prints: the text, cut to X's long-post preview or the line cap. */
function layoutText(post: CardPost, fonts: FontDef[]) {
  const regular = fonts.find((f) => f.weight === 400) ?? fonts[0];
  const m = fontMetrics(regular.data);
  let shown = post.text.replace(/\s+$/, "");
  let truncated = false;
  const chars = [...segmenter.segment(shown)];
  if (post.isLongPost || chars.length > MAX_CHARS) {
    if (chars.length > MAX_CHARS) {
      const head = chars
        .slice(0, MAX_CHARS)
        .map((c) => c.segment)
        .join("");
      const at = head.search(/\s\S*$/);
      shown =
        (at > MAX_CHARS * 0.6 ? head.slice(0, at) : head).replace(
          /[\s.,;:!?-]+$/,
          "",
        ) + "…";
    }
    truncated = true;
  }
  let lines = wrapLines(shown, m, TEXT_SIZE, CONTENT_W);
  if (truncated && lines.length > MAX_LINES) {
    // too many lines: keep MAX_LINES - 1 and end with an ellipsis
    lines = lines.slice(0, MAX_LINES - 1);
    lines[lines.length - 1] =
      lines[lines.length - 1].replace(/[\s.,;:!?-]*$/, "") + "…";
    shown = lines.join("\n");
    lines = wrapLines(shown, m, TEXT_SIZE, CONTENT_W);
    truncated = true;
  }
  if (!shown.trim()) lines = [];
  return { shown, lines, truncated };
}

/* ------------------------------------------------------------------ */
/* Size                                                                */
/* ------------------------------------------------------------------ */

function mediaBox(media?: XMedia[]) {
  const first = media?.[0];
  if (!first) return null;
  const ratio = Math.min(
    MEDIA_MAX_RATIO,
    Math.max(MEDIA_MIN_RATIO, first.height / first.width || 1),
  );
  return { media: first, height: Math.round(CONTENT_W * ratio) };
}

/** Exact image size. Use it for ImageResponse and the email <img width/height>. */
export function postCardSize(post: CardPost, fonts: FontDef[]) {
  const t = layoutText(post, fonts);
  const mb = mediaBox(post.media);
  const textH = t.lines.length
    ? GAP_HEADER_TEXT + (t.lines.length + (t.truncated ? 1 : 0)) * TEXT_LH
    : 0;
  const cardH =
    2 * CARD_BORDER +
    CARD_PAD_TOP +
    HEADER_H +
    textH +
    (mb ? MEDIA_GAP + mb.height : 0) +
    META_GAP +
    META_H +
    (post.editedAt ? META_H : 0) +
    ACTIONS_GAP +
    ACTIONS_H +
    BUTTON_GAP +
    BUTTON_H +
    CARD_PAD_BOTTOM;
  return {
    width: W,
    height: MAT.top + 2 * MAT.border + 2 * MAT_PAD + cardH + MAT.bottom,
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** X's timestamp line, in Bend's time zone: "9:41 AM · Nov 18, 2026". */
export function xDate(iso: string): string {
  const d = new Date(iso);
  const tz = "America/Los_Angeles";
  const time = d.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
  const date = d.toLocaleDateString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${time} · ${date}`;
}

/** X's count style: 5,432 / 12.3K / 123K / 1.2M. */
export function xCount(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  const fmt = (v: number, s: string) =>
    `${v < 100 ? Math.floor(v * 10) / 10 : Math.floor(v)}${s}`;
  return n < 1_000_000 ? fmt(n / 1000, "K") : fmt(n / 1_000_000, "M");
}

/* ------------------------------------------------------------------ */
/* SVG helpers (called as functions)                                   */
/* ------------------------------------------------------------------ */

function xLogo(size: number, color = X_TEXT): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        fill={color}
        d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
      />
    </svg>
  );
}

const BADGE: Record<NonNullable<CardPost["verifiedType"]>, string> = {
  blue: X_BLUE,
  business: "#e2b719", // X's gold check for verified organizations
  government: "#829aab", // X's gray check for government accounts
};

function verifiedBadge(size: number, color = X_BLUE): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        fill={color}
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"
      />
    </svg>
  );
}

function heart(size: number, color = X_GRAY): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        fill={color}
        d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"
      />
    </svg>
  );
}

/** X's reply icon: a speech bubble. */
function replyIcon(size: number, color = X_GRAY): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M9.5 4h5C18.6 4 21 6.7 21 10s-2.4 6-6.5 6H13l-5 3.5V16C5.2 15.4 3 13 3 10c0-3.3 2.4-6 6.5-6z"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** X's repost icon: two arrows chasing each other. */
function repostIcon(size: number, color = X_GRAY): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M4.5 9.5L7.5 6.5L10.5 9.5M7.5 6.8V15c0 1.4 1 2.5 2.4 2.5H13M19.5 14.5L16.5 17.5L13.5 14.5M16.5 17.2V9c0-1.4-1-2.5-2.4-2.5H11"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** X's default profile image: a pale silhouette on blue-gray. */
function defaultAvatar(size: number): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#cfd9de" />
      <circle cx="50" cy="39" r="17" fill="#ffffff" />
      <path
        d="M18 86 C22 66 35 58 50 58 C65 58 78 66 82 86 C73 94 62 98 50 98 C38 98 27 94 18 86 Z"
        fill="#ffffff"
      />
    </svg>
  );
}

/** Play button for a video's preview image: X's blue disc with a white triangle. */
export function playButton(
  size: number,
  disc = X_BLUE,
  ring = "#ffffff",
): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle
        cx="50"
        cy="50"
        r="46"
        fill={disc}
        stroke={ring}
        strokeWidth="5"
      />
      <path
        d="M40 31 L71 50 L40 69 Z"
        fill="#ffffff"
        strokeLinejoin="round"
        stroke="#ffffff"
        strokeWidth="4"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Paper mat (shared with TikTokTile)                                  */
/* ------------------------------------------------------------------ */

/** The weather card's crayon mat: cream paper, 6px ink edge, wobbly radii, offset ink shadow, tape. */
export function paperMat(
  opts: { background?: string; tapeLeft?: number; tape?: boolean } = {},
): ReactNode {
  const parts: ReactNode[] = [
    <div
      key="mat"
      style={{
        position: "absolute",
        left: MAT.left,
        top: MAT.top,
        right: MAT.right,
        bottom: MAT.bottom,
        display: "flex",
        border: `${MAT.border}px solid ${INK}`,
        borderRadius: "40px 18px 46px 16px",
        background: opts.background ?? PAPER,
        boxShadow: `10px 11px 0 ${INK}`,
      }}
    />,
    <div
      key="tape"
      style={{
        position: "absolute",
        left: opts.tapeLeft ?? 525,
        top: -6,
        width: 150,
        height: 40,
        background: "rgba(247, 201, 51, 0.6)",
        transform: "rotate(-3deg)",
        display: "flex",
      }}
    />,
  ];
  // The tape sits over the mat's top edge; only use it where that edge is paper.
  return opts.tape === false ? parts.slice(0, 1) : parts;
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

/**
 * One wrapped line with X's blue entities: @mentions, #hashtags, $cashtags and
 * display URLs (a URL the wrap split across lines stays blue on both lines).
 */
function richText(text: string, links: string[] = []): ReactNode[] {
  const ENTITY =
    /((?:^|(?<=[^\w]))(?:[@#][\p{L}\p{N}_]+|\$[A-Za-z]{1,6}(?:_[A-Za-z]{1,2})?(?![\w])))/u;
  // A wrapped display URL splits only at a hyphen or mid-token, so its pieces
  // are: the head (ends a line, starts the URL, has "." or "/"), the tail
  // (starts a line, ends the URL), or a middle piece that is a whole line.
  // Plain words that merely occur inside a URL stay black.
  const first = text.match(/^\s*(\S+)/)?.[1];
  const isLink = (tok: string) =>
    links.some(
      (l) =>
        l === tok ||
        (l.startsWith(tok) && /[./]/.test(tok)) ||
        (tok === first &&
          (l.endsWith(tok) || (tok === text.trim() && l.includes(tok)))),
    );
  const out: ReactNode[] = [];
  const span = (s: string, blue: boolean) =>
    out.push(
      <span
        key={out.length}
        style={{ whiteSpace: "pre", ...(blue ? { color: X_BLUE } : {}) }}
      >
        {s}
      </span>,
    );
  for (const tok of text.split(/(\s+)/)) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) span(tok, false);
    else if (isLink(tok)) span(tok, true);
    else
      for (const p of tok.split(ENTITY))
        if (p) span(p, ENTITY.test(p) && p.match(ENTITY)![0] === p);
  }
  return out;
}

/** X's "GIF" label, bottom-left on an animated GIF's still. */
function gifBadge(): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        left: 24,
        bottom: 24,
        display: "flex",
        padding: "2px 14px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.77)",
        color: "#ffffff",
        fontSize: 34,
        fontWeight: 700,
        lineHeight: "44px",
      }}
    >
      GIF
    </div>
  );
}

export function PostCard({
  post,
  fonts,
}: {
  post: CardPost;
  fonts: FontDef[];
}) {
  const { width, height } = postCardSize(post, fonts);
  const t = layoutText(post, fonts);
  const mb = mediaBox(post.media);
  const isVideo = mb && mb.media.kind !== "photo";
  const vType = post.verifiedType ?? (post.verified ? "blue" : undefined);
  // X draws verified organizations' avatars as rounded squares, people as circles.
  const avatarRadius = vType === "business" ? 22 : AVATAR / 2;
  const BADGE_SIZE = 60; // X's check is ~1.25x the name's size

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        fontFamily: "Inter",
        color: X_TEXT,
      }}
    >
      {paperMat()}
      <div
        style={{
          position: "absolute",
          left: MAT.left + MAT.border + MAT_PAD,
          top: MAT.top + MAT.border + MAT_PAD,
          width: CARD_W,
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          border: `${CARD_BORDER}px solid ${X_LINE}`,
          borderRadius: 32,
          padding: `${CARD_PAD_TOP}px ${CARD_PAD_X}px ${CARD_PAD_BOTTOM}px ${CARD_PAD_X}px`,
        }}
      >
        {/* header: avatar, name (+ badge), @handle, X logo */}
        <div
          style={{ display: "flex", alignItems: "center", height: HEADER_H }}
        >
          {post.avatar ? (
            <img
              alt=""
              src={post.avatar}
              width={AVATAR}
              height={AVATAR}
              style={{ borderRadius: avatarRadius, objectFit: "cover" }}
            />
          ) : (
            defaultAvatar(AVATAR)
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginLeft: 26,
              width: CONTENT_W - AVATAR - 26 - 80,
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  display: "block",
                  fontSize: NAME_SIZE,
                  fontWeight: 700,
                  lineHeight: "60px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth:
                    CONTENT_W - AVATAR - 26 - 80 - (vType ? BADGE_SIZE + 6 : 0),
                }}
              >
                {post.name}
              </div>
              {vType && (
                <div style={{ display: "flex", marginLeft: 6 }}>
                  {verifiedBadge(BADGE_SIZE, BADGE[vType])}
                </div>
              )}
            </div>
            <div
              style={{
                display: "block",
                fontSize: HANDLE_SIZE,
                lineHeight: "56px",
                color: X_GRAY,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {`@${post.handle}`}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: "auto",
              alignSelf: "flex-start",
              marginTop: 4,
            }}
          >
            {xLogo(58)}
          </div>
        </div>

        {/* post text, unaltered (or X's long-post preview + Show more) */}
        {t.lines.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: GAP_HEADER_TEXT,
              fontSize: TEXT_SIZE,
            }}
          >
            {/* one row per wrapped line: the wrap we measured is the wrap we draw */}
            {t.lines.map((line, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  height: TEXT_LH,
                  alignItems: "center",
                  whiteSpace: "pre",
                }}
              >
                {richText(line, post.links)}
              </div>
            ))}
            {t.truncated && (
              <div
                style={{
                  display: "flex",
                  fontSize: TEXT_SIZE,
                  lineHeight: `${TEXT_LH}px`,
                  color: X_BLUE,
                }}
              >
                Show more
              </div>
            )}
          </div>
        )}

        {/* one thumbnail: the photo, or a video's preview image with a play button */}
        {mb && (
          <div
            style={{
              display: "flex",
              position: "relative",
              marginTop: MEDIA_GAP,
              width: CONTENT_W,
              height: mb.height,
              borderRadius: 32,
              overflow: "hidden",
              border: `${CARD_BORDER}px solid ${X_LINE}`,
            }}
          >
            <img
              alt=""
              src={mb.media.src}
              width={CONTENT_W - 2 * CARD_BORDER}
              height={mb.height - 2 * CARD_BORDER}
              style={{ objectFit: "cover" }}
            />
            {isVideo && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {playButton(168)}
              </div>
            )}
            {mb.media.kind === "animated_gif" && gifBadge()}
          </div>
        )}

        {/* an edited post must say so (X display requirements): X's "Last edited" line */}
        {post.editedAt && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: META_GAP,
              height: META_H,
              fontSize: META_SIZE,
              color: X_GRAY,
            }}
          >
            {`Last edited ${xDate(post.editedAt)}`}
          </div>
        )}

        {/* the timestamp (likes sit in the action row below) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: post.editedAt ? 0 : META_GAP,
            height: META_H,
            fontSize: META_SIZE,
            color: X_GRAY,
          }}
        >
          <div style={{ display: "flex" }}>{xDate(post.createdAt)}</div>
        </div>

        {/* X's action row: reply, repost and like, with their counts */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: ACTIONS_GAP,
            height: ACTIONS_H,
            borderTop: `${CARD_BORDER}px solid ${X_LINE}`,
            borderBottom: `${CARD_BORDER}px solid ${X_LINE}`,
            fontSize: META_SIZE,
            color: X_GRAY,
          }}
        >
          {(
            [
              [replyIcon, post.replies],
              [repostIcon, post.reposts],
              [heart, post.likes],
            ] as const
          ).map(([icon, n], i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                width: CONTENT_W / 3,
              }}
            >
              {icon(50, X_GRAY)}
              {n != null && n > 0 && (
                <div
                  style={{ display: "flex", marginLeft: 10, fontWeight: 700 }}
                >
                  {xCount(n)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* X embed-style button: makes "this links to the post" obvious */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: BUTTON_GAP,
            height: BUTTON_H,
            borderRadius: BUTTON_H / 2,
            border: `${CARD_BORDER}px solid ${X_LINE}`,
            fontSize: 46,
            fontWeight: 700,
            color: X_LINK,
          }}
        >
          View on X
        </div>
      </div>
    </div>
  );
}
