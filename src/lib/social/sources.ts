/**
 * Where a visit from one of our posts came from (?from=ig, ig_dm or fb),
 * as the signup source it records. Tiny and pure, so client components
 * (the footer's email field) can use it without the post model.
 */

/** /social?from= (and /ig?from=) to the signup source it records (anything else: the bio link). */
const IG_SOURCES = { ig: "ig_bio", ig_dm: "ig_dm", fb: "fb" } as const;
export type IgSource = (typeof IG_SOURCES)[keyof typeof IG_SOURCES];
export function igSource(from: string | string[] | null | undefined): IgSource {
  return igSourceOrNull(from) ?? "ig_bio";
}

/**
 * ?from= on a page our posts link to (a park, an issue, /events): its
 * social source, or null when there's none (the page keeps its own).
 * Only the three known keys, never anything else from the address.
 */
export function igSourceOrNull(
  from: string | string[] | null | undefined,
): IgSource | null {
  return typeof from === "string" && Object.hasOwn(IG_SOURCES, from)
    ? IG_SOURCES[from as keyof typeof IG_SOURCES]
    : null;
}

/** The `from` key to carry on to the next link (ig, ig_dm, fb), or null. */
export function carryFrom(
  from: string | string[] | null | undefined,
): string | null {
  return igSourceOrNull(from) ? (from as string) : null;
}
