import { generateKeyPairSync } from "node:crypto";
import { dkimSign } from "mailauth/lib/dkim/sign";
import type { DnsResolver } from "./dkim";

/**
 * Test-only DKIM: one throwaway RSA key pair, a signer, and a resolver
 * stub that serves its public key for any "s1._domainkey.<domain>" (and
 * nothing else). Never imported by app code.
 */
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicKey = pair.publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");

const notFound = () =>
  Object.assign(new Error("not found"), { code: "ENOTFOUND" });

/** Serves the test key for selector s1 on any domain. */
export const testResolver: DnsResolver = async (name, rrtype) => {
  if (rrtype === "TXT" && /^s1\._domainkey\./.test(name))
    return [[`v=DKIM1; k=rsa; p=${publicKey}`]];
  throw notFound();
};

/** A resolver whose lookups time out (a DNS outage). */
export const downResolver: DnsResolver = async () => {
  throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
};

/** A message with these DKIM signatures prepended (selector s1). */
export async function signed(
  message: string,
  sigs: { domain: string; headers: string[]; maxBodyLength?: number }[],
): Promise<string> {
  const r = await dkimSign(message, {
    signatureData: sigs.map((s) => ({
      signingDomain: s.domain,
      selector: "s1",
      privateKey,
      headerList: s.headers,
      ...(s.maxBodyLength != null ? { maxBodyLength: s.maxBodyLength } : {}),
    })),
  });
  return r.signatures + message;
}

/** What Gmail's filter adds on top when it forwards a message. */
export const forwardedBy = (owner: string, inbox: string, message: string) =>
  `X-Forwarded-To: ${inbox}\r\nX-Forwarded-For: ${owner} ${inbox}\r\nDelivered-To: ${owner}\r\n${message}`;
