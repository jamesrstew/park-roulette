/**
 * Which of our own links a landing came from, for the "Arrived" event:
 * ?from=ig | ig_dm | fb (our Instagram and Facebook links), ?via=email
 * (a newsletter link through /n/), ?src=text (the Weekend Pick text's
 * issue page). Only these fixed labels, never anything else from the
 * address. Pure, so the browser and tests share it.
 */
export type ArrivalSource = "ig" | "ig_dm" | "fb" | "email" | "text";

export function arrivalSource(
  from: string | null,
  via: string | null,
  src: string | null,
): ArrivalSource | null {
  if (from === "ig" || from === "ig_dm" || from === "fb") return from;
  if (via === "email") return "email";
  if (src === "text") return "text";
  return null;
}
