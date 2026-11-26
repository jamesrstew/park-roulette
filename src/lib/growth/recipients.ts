/**
 * Who gets the digest: the alerts address, plus anyone in
 * GROWTH_DIGEST_TO (comma-separated; kept in the environment, never in
 * this public repo). Bad entries are dropped; duplicates once. Pure on
 * its inputs.
 */
export function digestRecipients(extra: string, base: string): string[] {
  const ok = (e: string) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e);
  const all = [base, ...extra.split(",")].map((e) => e.trim()).filter(ok);
  const seen = new Set<string>();
  return all.filter((e) => {
    const k = e.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
