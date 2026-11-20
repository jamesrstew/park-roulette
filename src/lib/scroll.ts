/**
 * scrollIntoView that respects prefers-reduced-motion (a jump, not a
 * glide, for people who asked for less motion).
 */
export function scrollIntoViewGently(
  el: Element | null,
  block: ScrollLogicalPosition,
) {
  if (!el) return;
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
}
