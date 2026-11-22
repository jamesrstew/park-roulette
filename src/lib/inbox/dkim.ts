import "server-only";
import { Resolver } from "node:dns/promises";
import { dkimVerify } from "mailauth/lib/dkim/verify";

/**
 * DKIM, verified by us on the raw MIME message (mailauth), never read off
 * a header: anyone can add a "DKIM-Signature: d=..." header, only the
 * domain's key can make one that verifies. Keys come from DNS (a short
 * timeout); a DNS failure is temporary, so the caller drops the email and
 * lets Resend's retry try again.
 */

/** A signature that verified over the whole body (no l= cut). */
export type VerifiedSignature = {
  /** d=, lowercase. */
  domain: string;
  /** The header names it covers (h=), lowercase. */
  headers: string[];
};

export type DkimCheck = {
  verified: VerifiedSignature[];
  /** A key lookup failed (DNS): try again later. */
  temporary: boolean;
};

export type DnsResolver = (
  name: string,
  rrtype: string,
) => Promise<string[][] | string[]>;

const dns = new Resolver({ timeout: 3_000, tries: 2 });
export const liveResolver: DnsResolver = (name, rrtype) =>
  dns.resolve(name, rrtype) as Promise<string[][] | string[]>;

type Result = {
  signingDomain?: string;
  status?: { result?: string };
  signingHeaders?: { keys?: string };
  canonBodyLength?: number;
  canonBodyLengthTotal?: number;
};

export async function verifyDkim(
  raw: Buffer,
  resolver: DnsResolver = liveResolver,
): Promise<DkimCheck> {
  let results: Result[];
  try {
    const r = await dkimVerify(raw, { resolver });
    results = (r.results ?? []) as Result[];
  } catch {
    return { verified: [], temporary: true };
  }
  const verified: VerifiedSignature[] = [];
  let temporary = false;
  for (const x of results) {
    const result = x.status?.result;
    if (result === "temperror") temporary = true;
    if (result !== "pass" || !x.signingDomain) continue;
    // A signature that covers only part of the body (l=) leaves room
    // for anything appended after it.
    if (
      typeof x.canonBodyLength === "number" &&
      typeof x.canonBodyLengthTotal === "number" &&
      x.canonBodyLength !== x.canonBodyLengthTotal
    )
      continue;
    verified.push({
      domain: x.signingDomain.toLowerCase(),
      headers: (x.signingHeaders?.keys ?? "")
        .split(":")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    });
  }
  return { verified, temporary };
}
