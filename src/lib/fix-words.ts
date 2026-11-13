import { ATTRIBUTES } from "./features";

/** "The splash pad is gone", in words, for a suggested fix. */
export function fixLine(topic: string, value: string): string {
  if (topic.startsWith("feature:")) {
    const a = ATTRIBUTES[topic.slice(8)];
    const label = a?.label ?? topic.slice(8);
    return value === "yes" ? `It has: ${label}` : `It doesn't have: ${label}`;
  }
  if (topic === "status")
    return value === "closed"
      ? "It's closed"
      : value === "private"
        ? "It's private (not open to everyone)"
        : "It's open again";
  if (topic === "play")
    return value === "none"
      ? "There's no playground, just a park"
      : value === "nature"
        ? "It's nature play (no play structure)"
        : "There's a playground";
  return value;
}
