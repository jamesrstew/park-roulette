/**
 * Pin artwork for the map, as HTML strings for Leaflet divIcons.
 * The SVG filters (#wobble, #crayon, #hatch-yellow) live in CrayonDefs,
 * which is rendered once in the root layout, so inline SVGs can use them.
 */

const INK = "#2b2a33";
const STAR =
  "M12 1.8l3.1 6.4 7 1-5.1 4.9 1.2 7-6.2-3.3-6.3 3.3 1.2-7L1.9 9.2l7-1z";

/** Hand-wobbled circle outline (no SVG filter: dozens of pins pan smoothly). */
const BLOB =
  "M17 6.2 C 23.4 5.8 28.3 10.6 28 17.3 C 27.7 23.6 22.8 28.2 16.6 27.9 C 10.4 27.6 5.9 22.9 6.1 16.8 C 6.3 10.7 10.9 6.5 17 6.2 Z";

/** Unvisited playground: a scribbly crayon dot in the town's color. */
export function dotPinHtml(color: string, selected: boolean) {
  return `<div class="pin-hit${selected ? " is-selected" : ""}">
  <svg class="pin-art" viewBox="0 0 36 36" width="30" height="30" aria-hidden="true">
    <path d="${BLOB}" transform="translate(2.5 3)" fill="${INK}" />
    <path d="${BLOB}" fill="${color}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M10 15.5 L20 9.5 M9 20.5 L24 11 M11 24.5 L25.5 15.5 M15.5 26 L25 20"
      stroke="#fff" stroke-opacity=".5" stroke-width="2.2" stroke-linecap="round" fill="none" />
  </svg>
</div>`;
}

/** Unvisited park without a playground: a small crayon tree, quieter than a dot. */
export function treePinHtml(selected: boolean) {
  return `<div class="pin-hit${selected ? " is-selected" : ""}">
  <svg class="pin-art" viewBox="0 0 36 36" width="26" height="26" aria-hidden="true">
    <path d="M17 24 L17.4 32" stroke="${INK}" stroke-width="3" stroke-linecap="round" />
    <path d="M17 4.5 C 22 5 26.5 9.5 26 15.2 C 25.6 20.4 21.4 24.6 16.6 24.4 C 11.4 24.2 7.6 19.8 8 14.6 C 8.4 9.2 12.2 4.2 17 4.5 Z"
      fill="#7fcf95" stroke="${INK}" stroke-width="2.3" stroke-linejoin="round" />
    <path d="M12 12 L19 8 M11 17 L22 10.5 M13.5 21 L23.5 14.5" stroke="#3aa35b" stroke-width="2"
      stroke-linecap="round" fill="none" />
  </svg>
</div>`;
}

/** Visited: a gold star sticker with a check. */
export function starPinHtml(selected: boolean) {
  return `<div class="pin-hit${selected ? " is-selected" : ""}">
  <svg class="pin-art pin-star" viewBox="-2 -2 28 28" width="38" height="38" aria-hidden="true">
    <g filter="url(#wobble)" stroke-linejoin="round">
      <path d="${STAR}" transform="translate(1.6 1.8)" fill="${INK}" />
      <path d="${STAR}" fill="#fff" stroke="#fff" stroke-width="4.5" />
      <path d="${STAR}" fill="url(#hatch-yellow)" stroke="${INK}" stroke-width="1.5" />
      <path d="M8.2 12.6 L11 15.4 L16.4 9.4" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round" />
    </g>
  </svg>
</div>`;
}

/** A bunch of parks drawn as one blob when zoomed out. */
export function clusterPinHtml(opts: {
  count: number;
  visited: number;
  color: string;
  label: string | null;
}) {
  const { count, visited, color, label } = opts;
  const allDone = visited === count;
  const size = count >= 20 ? 54 : count >= 6 ? 48 : 44;
  return `<div class="pin-cluster" style="--c:${color};--s:${size}px">
  <div class="pin-cluster-blob${allDone ? " is-done" : ""}">
    <span class="pin-cluster-n">${count}</span>
  </div>
  ${
    label
      ? `<span class="pin-cluster-label">${escapeHtml(label)}${visited ? ` · ${visited}★` : ""}</span>`
      : visited
        ? `<span class="pin-cluster-label">${visited}★</span>`
        : ""
  }
</div>`;
}

/** "You are here": a pulsing doodle. */
export function mePinHtml() {
  return `<div class="pin-me">
  <span class="pin-me-pulse"></span>
  <span class="pin-me-dot"></span>
  <span class="pin-me-label">you!</span>
</div>`;
}

/** The draggable pushpin on the add-a-park map. */
export function pushPinHtml() {
  return `<div class="pin-push">
  <svg viewBox="0 0 40 52" width="40" height="52" aria-hidden="true">
    <g filter="url(#wobble)" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round">
      <path d="M20 50 C 17 40, 6 32, 6 20 A 14 14 0 1 1 34 20 C 34 32, 23 40, 20 50 Z" fill="#e5432f" />
      <circle cx="20" cy="20" r="6" fill="#fffdf7" />
      <path d="M12 12 L18 8" stroke="#fff" stroke-opacity=".6" stroke-linecap="round" fill="none" />
    </g>
  </svg>
</div>`;
}

/** A small faded dot for "already on the map" parks. */
export function ghostPinHtml(color: string) {
  return `<div class="pin-ghost" style="--c:${color}"></div>`;
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}
