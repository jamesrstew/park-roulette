/**
 * Saved and hidden kid events, the pure part: the phone's state, how an
 * edit changes it, and the stylesheet that applies it to the shared,
 * cached listing. No React, no database. Design:
 * /tmp/pr-news/batch11/design.md.
 *
 * Save: a page and an occurrence ("2026-12-06", "2026-12-06-1400"), or a
 * page with occ "" (a regular, saved as a program: its next date, always).
 * Hide: pages (slugs). A program counts as hidden when any of its pages is.
 *
 * Signed out, the phone's state is the truth (localStorage). Signed in,
 * the phone mirrors the family's list (owner = the crew id) and keeps
 * edits the server hasn't acknowledged in `pending`.
 */

export const PREFS_KEY = "pr:ev:v1";
/** The <style> element that applies the state (boot script and store). */
export const PREFS_STYLE_ID = "pr-ev-css";

/** kid_events slugs: lowercase words and dashes (checked before any CSS). */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,150}$/;
/** "", "2026-12-06" or "2026-12-06-1400". */
export const OCC_RE = /^(\d{4}-\d{2}-\d{2}(-\d{4})?)?$/;

export const MAX_SAVES = 300;
export const MAX_HIDES = 600;
/** Slugs in one hide (a program's pages) or one merge. */
export const MAX_BATCH = 60;

export type SaveRef = { slug: string; occ: string };
/** Title and "Tue, Nov 25 · Downtown Library": the shortlist's first paint. */
export type SaveSnap = { at: number; t: string; w: string };

export type Op =
  | { id: number; k: "save"; slug: string; occ: string; on: boolean }
  | { id: number; k: "hide"; slugs: string[]; on: boolean };

export type PrefsState = {
  v: 1;
  /** The family this mirrors, or null: this phone's own list. */
  owner: number | null;
  /** By saveKey. */
  saves: Record<string, SaveSnap>;
  /** Slug → when hidden. */
  hides: Record<string, number>;
  /** Signed-in edits not yet acknowledged, oldest first. */
  pending: Op[];
  /** One-time tips already shown. */
  tips: { save?: 1; hide?: 1 };
};

export const EMPTY: PrefsState = {
  v: 1,
  owner: null,
  saves: {},
  hides: {},
  pending: [],
  tips: {},
};

export const saveKey = (slug: string, occ: string) => `${slug}|${occ}`;

export function splitKey(key: string): SaveRef | null {
  const i = key.indexOf("|");
  if (i < 0) return null;
  const slug = key.slice(0, i);
  const occ = key.slice(i + 1);
  return SLUG_RE.test(slug) && OCC_RE.test(occ) ? { slug, occ } : null;
}

const str = (x: unknown, max: number) =>
  typeof x === "string" ? x.slice(0, max) : "";
const num = (x: unknown) =>
  typeof x === "number" && Number.isFinite(x) ? x : 0;

/** Whatever is in storage, made safe (anything odd is dropped). */
/** Dated saves this old leave the phone too (the shortlist drops them at 30 days). */
function oldestDay(now: number): string {
  return new Date(now - 32 * 86_400_000).toISOString().slice(0, 10);
}

export function parseState(raw: string | null, now = Date.now()): PrefsState {
  let j: unknown;
  try {
    j = raw ? JSON.parse(raw) : null;
  } catch {
    return EMPTY;
  }
  if (!j || typeof j !== "object" || (j as { v?: unknown }).v !== 1)
    return EMPTY;
  const o = j as Record<string, unknown>;
  const saves: PrefsState["saves"] = {};
  if (o.saves && typeof o.saves === "object") {
    const cutoff = oldestDay(now);
    const list = Object.entries(o.saves)
      .filter(([k, v]) => {
        const r = splitKey(k);
        return (
          !!r &&
          !!v &&
          typeof v === "object" &&
          (!r.occ || r.occ.slice(0, 10) >= cutoff)
        );
      })
      .map(([k, v]) => {
        const s = v as Record<string, unknown>;
        return [
          k,
          { at: num(s.at), t: str(s.t, 160), w: str(s.w, 160) },
        ] as const;
      })
      // The newest are the ones to keep.
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_SAVES);
    for (const [k, v] of list) saves[k] = v;
  }
  const hides: PrefsState["hides"] = {};
  if (o.hides && typeof o.hides === "object")
    for (const [k, v] of Object.entries(o.hides).slice(0, MAX_HIDES))
      if (SLUG_RE.test(k)) hides[k] = num(v);
  const pending: Op[] = [];
  if (Array.isArray(o.pending))
    for (const p of o.pending.slice(0, 200)) {
      const op = p as Record<string, unknown>;
      if (op?.k === "save" && SLUG_RE.test(String(op.slug)))
        pending.push({
          id: num(op.id),
          k: "save",
          slug: String(op.slug),
          occ: OCC_RE.test(String(op.occ)) ? String(op.occ) : "",
          on: op.on === true,
        });
      else if (op?.k === "hide" && Array.isArray(op.slugs)) {
        const slugs = op.slugs
          .map(String)
          .filter((s) => SLUG_RE.test(s))
          .slice(0, MAX_BATCH);
        if (slugs.length)
          pending.push({
            id: num(op.id),
            k: "hide",
            slugs,
            on: op.on === true,
          });
      }
    }
  const owner =
    typeof o.owner === "number" && Number.isSafeInteger(o.owner) && o.owner > 0
      ? o.owner
      : null;
  const t = (o.tips ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    owner,
    saves,
    hides,
    pending: owner ? pending : [],
    tips: {
      ...(t.save ? { save: 1 as const } : {}),
      ...(t.hide ? { hide: 1 as const } : {}),
    },
  };
}

/** An edit applied to the state (pure; `pending` is the caller's job). */
export function applyOp(
  s: PrefsState,
  op: Op,
  snap?: Omit<SaveSnap, "at">,
  now = Date.now(),
): PrefsState {
  if (op.k === "save") {
    const k = saveKey(op.slug, op.occ);
    const saves = { ...s.saves };
    if (op.on)
      saves[k] = s.saves[k]
        ? { ...s.saves[k], ...snap }
        : { at: now, t: "", w: "", ...snap };
    else delete saves[k];
    return { ...s, saves };
  }
  const hides = { ...s.hides };
  for (const slug of op.slugs)
    if (op.on) hides[slug] = hides[slug] ?? now;
    else delete hides[slug];
  return { ...s, hides };
}

/**
 * The family's list from the server, taken as the truth, with this
 * phone's unacknowledged edits on top (so nothing blinks back). Titles
 * for the shortlist's first paint come from what the phone already had.
 */
export function adopt(
  s: PrefsState,
  server: { crewId: number; saves: string[]; hides: string[] },
  /** This phone's own list just joined the family: its queue stays. */
  joined = false,
): PrefsState {
  const saves: PrefsState["saves"] = {};
  for (const k of server.saves.slice(0, MAX_SAVES))
    if (splitKey(k)) saves[k] = s.saves[k] ?? { at: 0, t: "", w: "" };
  const hides: PrefsState["hides"] = {};
  for (const slug of server.hides.slice(0, MAX_HIDES))
    if (SLUG_RE.test(slug)) hides[slug] = s.hides[slug] ?? 0;
  const same = joined || s.owner === server.crewId;
  let next: PrefsState = {
    ...s,
    owner: server.crewId,
    saves,
    hides,
    // Another family's edits never follow a switch.
    pending: same ? s.pending : [],
  };
  for (const op of next.pending)
    next = applyOp(
      next,
      op,
      op.k === "save" ? s.saves[saveKey(op.slug, op.occ)] : undefined,
    );
  return next;
}

/** A program is hidden when any of its pages is. */
export const isHidden = (s: PrefsState, slugs: readonly string[]) =>
  slugs.some((x) => !!s.hides[x]);

/**
 * The stylesheet that applies the state to server-rendered markup:
 *  [data-ev~=slug]             a listing item (its program's pages): hidden,
 *                              or outlined when showing hidden ones
 *  [data-ev-box][data-ev-empty]   a box of items, all hidden: gone
 *  [data-ev-group][data-ev-empty] [data-ev-allhidden]  "You hid everything here"
 *  [data-ev-if-hidden~=slug]   shown only while that page is hidden
 *  [data-sv="slug|occ"]        a heart: filled when saved (first paint)
 * Keep in step with BOOT below (a test checks they agree).
 */
const EMPTY_RULES =
  "[data-ev-box][data-ev-empty]{display:none!important}\n[data-ev-group][data-ev-empty] [data-ev-allhidden]{display:flex!important}";

/**
 * Marks boxes and groups whose every item is hidden (data-ev-empty), so
 * the stylesheet stays one simple rule per hidden page (a :has() over
 * hundreds of hides cost 20+ ms a style pass on a throttled phone).
 * Browser only; reads attributes, never layout.
 */
export function markEmpty(
  root: ParentNode,
  s: PrefsState,
  showHidden: boolean,
): void {
  for (const el of root.querySelectorAll<HTMLElement>(
    "[data-ev-box], [data-ev-group]",
  )) {
    const items = el.querySelectorAll<HTMLElement>("[data-ev]");
    const empty =
      !showHidden &&
      items.length > 0 &&
      [...items].every((it) => isHidden(s, (it.dataset.ev ?? "").split(" ")));
    if (empty) el.setAttribute("data-ev-empty", "");
    else el.removeAttribute("data-ev-empty");
  }
}

export function prefsCss(s: PrefsState, showHidden = false): string {
  const hidden = Object.keys(s.hides).filter((x) => SLUG_RE.test(x));
  const saved = Object.keys(s.saves).filter((k) => !!splitKey(k));
  const out: string[] = [];
  if (hidden.length) {
    const sel = hidden.map((x) => `[data-ev~="${x}"]`).join(",");
    out.push(
      showHidden
        ? `${sel}{outline:2px dashed rgb(43 42 51/.55);outline-offset:5px;border-radius:10px;background:rgb(43 42 51/.06);box-shadow:0 0 0 5px rgb(43 42 51/.06)}`
        : `${sel}{display:none!important}`,
    );
    // Boxes and groups with nothing left are marked by markEmpty (a
    // walk in the store): two fixed rules, never a :has() over every hide.
    if (!showHidden) out.push(EMPTY_RULES);
    out.push(
      hidden.map((x) => `[data-ev-if-hidden~="${x}"]`).join(",") +
        "{display:flex!important}",
    );
  }
  if (saved.length) {
    const sel = saved.map((k) => `[data-sv="${k}"]`);
    out.push(
      `${sel.map((x) => `${x} [data-heart-on]`).join(",")}{display:inline-flex!important}`,
    );
    out.push(
      `${sel.map((x) => `${x} [data-heart-off]`).join(",")}{display:none!important}`,
    );
  }
  return out.join("\n");
}

/**
 * Runs in the page before the listing streams in (a hard load): reads the
 * phone's state and writes the same stylesheet prefsCss does (hidden mode
 * off), so hidden cards never flash and saved hearts are filled on first
 * paint. Plain ES5; never throws.
 */
export const BOOT = `(function(){try{var r=localStorage.getItem(${JSON.stringify(PREFS_KEY)});if(!r)return;var s=JSON.parse(r);if(!s||s.v!==1)return;var S=/^[a-z0-9][a-z0-9-]{0,150}$/,O=/^(\\d{4}-\\d{2}-\\d{2}(-\\d{4})?)?$/;var h=[],v=[],k,i,o=[];for(k in s.hides||{})if(S.test(k))h.push(k);for(k in s.saves||{}){i=k.indexOf("|");if(i>0&&S.test(k.slice(0,i))&&O.test(k.slice(i+1)))v.push(k)}if(h.length){var a=[],b=[];for(i=0;i<h.length;i++){a.push('[data-ev~="'+h[i]+'"]');b.push('[data-ev-if-hidden~="'+h[i]+'"]')}var q=a.join(",");o.push(q+"{display:none!important}");o.push(${JSON.stringify(EMPTY_RULES)});o.push(b.join(",")+"{display:flex!important}")}if(v.length){var c=[],d=[];for(i=0;i<v.length;i++){c.push('[data-sv="'+v[i]+'"] [data-heart-on]');d.push('[data-sv="'+v[i]+'"] [data-heart-off]')}o.push(c.join(",")+"{display:inline-flex!important}");o.push(d.join(",")+"{display:none!important}")}var e=document.getElementById(${JSON.stringify(PREFS_STYLE_ID)});if(!e){e=document.createElement("style");e.id=${JSON.stringify(PREFS_STYLE_ID)};document.head.appendChild(e)}e.textContent=o.join("\\n")}catch(x){}})()`;

/**
 * Signing out on this phone: a family's list leaves it (privacy on a
 * shared phone). A phone's own list (no owner) stays. Browser only;
 * never throws. Small on purpose: the sign-out button imports it.
 */
export function forgetFamilyList(): void {
  try {
    const s = parseState(window.localStorage.getItem(PREFS_KEY));
    if (!s.owner) return;
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ ...EMPTY, tips: s.tips }),
    );
    document.getElementById(PREFS_STYLE_ID)?.remove();
  } catch {
    // Storage blocked: nothing was kept here anyway.
  }
}
