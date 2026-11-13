/**
 * What a page view tells Vercel Web Analytics: the page, never a secret.
 * Family invite links carry the family's key (/join/<code>, any letter
 * case, anywhere in the path), so the code is blanked out, and query
 * strings and #fragments are dropped.
 */
const JOIN = /\/join\/[^/?#]+/gi;

export function analyticsPath(path: string): string {
  return path.replace(/[?#].*$/, "").replace(JOIN, "/join/[code]");
}

export function analyticsUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${analyticsPath(u.pathname)}`;
  } catch {
    return analyticsPath(raw);
  }
}
