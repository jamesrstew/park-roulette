/** "Crooked River Ranch" -> "crooked-river-ranch" (town page URLs). */
export function townSlug(city: string): string {
  return city
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function townHref(city: string): string {
  return `/towns/${townSlug(city)}`;
}
