/**
 * ?welcome=1 out of the address bar (the welcome sheet's one-time flag).
 * A refresh() can put it back (the router's copy of the address), so the
 * sheet drops it again whenever it saves or finishes: a reload never
 * greets twice.
 */
export function dropWelcome(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("welcome")) return;
  url.searchParams.delete("welcome");
  window.history.replaceState(window.history.state, "", url);
}
