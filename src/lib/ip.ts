/** IP keys for rate limits. Pure, so it can be tested. */

/** "2001:db8::1" → ["2001","db8","0",…,"1"]: all 8 groups. */
export function expandIpv6(ip: string): string[] | null {
  const clean = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const halves = clean.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g)))
    return null;
  return groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
}

/** An IP for rate limits. IPv6 is grouped by /64 (one household's network). */
export function ipKey(raw: string): string {
  const ip = raw.trim();
  if (!ip) return "unknown";
  if (ip.includes(":")) {
    const g = expandIpv6(ip);
    return g ? `${g.slice(0, 4).join(":")}::/64` : "unknown";
  }
  return /^[\d.]{7,15}$/.test(ip) ? ip : "unknown";
}
