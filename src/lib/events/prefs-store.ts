"use client";

import {
  loadEventPrefs,
  mergeEventPrefs,
  setEventHidden,
  setEventSaved,
} from "@/lib/client-actions";
import {
  adopt,
  applyOp,
  EMPTY,
  MAX_SAVES,
  type Op,
  parseState,
  PREFS_KEY,
  PREFS_STYLE_ID,
  markEmpty,
  type PrefsState,
  prefsCss,
  type SaveSnap,
} from "./prefs";

/**
 * The phone's saved and hidden events: one store for every heart, ×, the
 * shortlist and the hide stylesheet. Signed out it's the truth; signed in
 * it mirrors the family's list. Every edit is applied here first
 * (optimistic) and, signed in, queued; one serial chain talks to the
 * server: load the family's list, adopt it with the queued edits on top,
 * then send the queue. Because the load always comes before the sends in
 * the same chain, an acknowledged edit can never be undone by an older
 * snapshot. Storage that throws (private modes) leaves a memory-only store.
 */

let state: PrefsState = EMPTY;
let ready = false;
let showHidden = false;
let signedIn: boolean | null = null;
let chain: Promise<void> = Promise.resolve();
let lastSync = 0;
let merging = false;
let opId = Date.now();
const listeners = new Set<() => void>();

function read(): PrefsState {
  try {
    return parseState(window.localStorage.getItem(PREFS_KEY));
  } catch {
    return state;
  }
}

function ensure() {
  if (ready || typeof window === "undefined") return;
  ready = true;
  state = read();
  window.addEventListener("storage", (e) => {
    if (e.key !== PREFS_KEY) return;
    state = read();
    paint();
    emit();
  });
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      signedIn &&
      Date.now() - lastSync > 30_000
    )
      void sync(true);
  });
}

function emit() {
  for (const l of listeners) l();
}

/** Write the stylesheet the boot script started (same rules, same element). */
function paint() {
  if (typeof document === "undefined") return;
  let el = document.getElementById(PREFS_STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = PREFS_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = prefsCss(state, showHidden);
  // Only once the listing has hydrated: marking server HTML before React
  // takes it over would be a hydration mismatch.
  if (marks) markEmpty(document, state, showHidden);
}

let marks = 0;

/** The listing is on screen and hydrated (PrefsMarks): keep its marks. */
export function listingMounted(): () => void {
  ensure();
  marks++;
  paint();
  return () => {
    marks--;
  };
}

function write(next: PrefsState) {
  state = next;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Blocked or full: this page still works from memory.
  }
  paint();
  emit();
}

/** Re-apply the stylesheet (a client navigation into /events). */
export function repaint() {
  ensure();
  paint();
}

export function subscribe(l: () => void) {
  ensure();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getPrefs(): PrefsState {
  ensure();
  return state;
}

export const getServerPrefs = () => EMPTY;

export function getShowHidden() {
  return showHidden;
}

export function setShowHidden(on: boolean) {
  showHidden = on;
  paint();
  emit();
}

/** Is this phone signed in (known once the events layout says)? */
export function getSignedIn() {
  return signedIn;
}

function edit(op: Op, snap?: Omit<SaveSnap, "at">) {
  ensure();
  let next = applyOp(state, op, snap);
  // Signed in (mirroring a family, or joining one right now): queue it.
  const send = !!state.owner || merging;
  if (send) next = { ...next, pending: [...next.pending, op] };
  write(next);
  if (send) void flushSoon();
}

/** A signed-out phone's list holds what the server would (it caps too). */
export function canSave(): boolean {
  ensure();
  return Object.keys(state.saves).length < MAX_SAVES;
}

export function save(
  slug: string,
  occ: string,
  on: boolean,
  snap?: Omit<SaveSnap, "at">,
) {
  edit({ id: ++opId, k: "save", slug, occ, on }, snap);
}

export function hide(slugs: string[], on: boolean) {
  edit({ id: ++opId, k: "hide", slugs, on });
}

/** A one-time tip: true the first time only. */
export function firstTime(tip: "save" | "hide"): boolean {
  ensure();
  if (state.tips[tip]) return false;
  write({ ...state, tips: { ...state.tips, [tip]: 1 } });
  return true;
}

function queue(task: () => Promise<void>) {
  chain = chain.then(task).catch((e) => console.error(e));
  return chain;
}

/** Server errors per queued edit: after 3, it's dropped (never a stuck queue). */
const tries = new Map<number, number>();

const touches = (a: Op, b: Op) =>
  a.k === "save" && b.k === "save"
    ? a.slug === b.slug && a.occ === b.occ
    : a.k === "hide" &&
      b.k === "hide" &&
      a.slugs.some((x) => b.slugs.includes(x));

/** Drop a queued edit the server won't take, and undo it here unless a later edit already changed the same thing. */
function refuse(op: Op, msg: string) {
  const later = state.pending.some((p) => p.id !== op.id && touches(p, op));
  const rest = state.pending.filter((p) => p.id !== op.id);
  write(
    later
      ? { ...state, pending: rest }
      : { ...applyOp(state, { ...op, on: !op.on }), pending: rest },
  );
  toast({ msg });
}

/** Send the queued edits, oldest first; stop at the first that can wait. */
async function flushNow() {
  while (state.owner && state.pending.length) {
    const op = state.pending[0];
    const r =
      op.k === "save"
        ? await setEventSaved({ slug: op.slug, occ: op.occ, on: op.on })
        : await setEventHidden({ slugs: op.slugs, on: op.on });
    if (r.ok) {
      tries.delete(op.id);
      write({ ...state, pending: state.pending.filter((p) => p.id !== op.id) });
      continue;
    }
    if (/hop in first/i.test(r.error)) {
      // Signed out meanwhile: the family's mirror leaves this phone.
      write({ ...EMPTY, tips: state.tips });
      toast({
        msg: "You're signed out, so that didn't stick. Sign in to keep your list.",
      });
      return;
    }
    // No signal, or the app just updated: keep it for next time.
    if (/signal|reach|update/i.test(r.error)) return;
    // Our own hiccup: a few tries, then let it go.
    if (/try again in a sec/i.test(r.error)) {
      const n = (tries.get(op.id) ?? 0) + 1;
      tries.set(op.id, n);
      if (n < 3) return;
      tries.delete(op.id);
      refuse(op, "Hmm, that one didn't save. Try it again?");
      continue;
    }
    // A refusal the server means (over a cap, gone): undo it and say so.
    refuse(op, r.error);
  }
}

/** One tab sends at a time (two tabs share one queue in storage). */
function flush(): Promise<void> {
  const locks = (navigator as { locks?: LockManager }).locks;
  return locks
    ? (locks.request("pr-ev-flush", flushNow) as unknown as Promise<void>)
    : flushNow();
}

function flushSoon() {
  return queue(flush);
}

/**
 * Called by the events layout with whether a session cookie is here.
 * Signed out: a family's mirror leaves the phone. Signed in: load the
 * family's list (this phone's own list joins it the first time), then
 * send anything queued.
 */
export function sync(isSignedIn: boolean) {
  ensure();
  if (signedIn !== isSignedIn) {
    signedIn = isSignedIn;
    emit();
  }
  if (!isSignedIn) {
    if (state.owner) write({ ...EMPTY, tips: state.tips });
    return Promise.resolve();
  }
  lastSync = Date.now();
  return queue(async () => {
    const r = await loadEventPrefs();
    if (!r.ok) return;
    const fam = (
      r as {
        prefs: { crewId: number; saves: string[]; hides: string[] } | null;
      }
    ).prefs;
    if (!fam) {
      // The cookie didn't hold up (signed out elsewhere): forget the mirror.
      if (state.owner) write({ ...EMPTY, tips: state.tips });
      return;
    }
    if (state.owner === null) {
      // First visit signed in: this phone's list joins the family. Edits
      // made meanwhile are queued (merging) and sent after.
      merging = true;
      try {
        const m = await mergeEventPrefs({
          saves: Object.keys(state.saves),
          hides: Object.keys(state.hides),
        });
        const merged = m.ok ? (m as { prefs: typeof fam }).prefs : null;
        if (!merged) return;
        write(adopt(state, merged, true));
      } finally {
        merging = false;
      }
    } else {
      write(adopt(state, fam));
    }
    await flush();
  });
}

// --- The toast (hide's Undo, a few one-time tips) ----------------------------

export type Toast = {
  msg: string;
  sub?: string;
  action?: { label: string; run: () => void };
  id?: number;
};

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let paused = false;
const toastListeners = new Set<() => void>();

export function toast(t: Toast | null) {
  current = t ? { ...t, id: ++opId } : null;
  clearTimeout(timer);
  if (current) armToast();
  for (const l of toastListeners) l();
}

function armToast() {
  clearTimeout(timer);
  if (!paused) timer = setTimeout(() => toast(null), 6000);
}

/** Focus or a finger on the toast holds it open (WCAG 2.2.1). */
export function pauseToast(p: boolean) {
  paused = p;
  if (p) clearTimeout(timer);
  else if (current) armToast();
}

export function subscribeToast(l: () => void) {
  toastListeners.add(l);
  return () => toastListeners.delete(l);
}

export const getToast = () => current;
export const getServerToast = () => null;
