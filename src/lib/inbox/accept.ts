import "server-only";
import type { DkimCheck } from "./dkim";

/**
 * Which inbound emails the private newsletter inbox keeps (pure).
 *
 * The owner's Gmail forwards only the configured newsletters' senders to
 * our inbound address. Gmail keeps the original headers and the sender's
 * DKIM signature, and adds X-Forwarded-For: <owner> <inbox>. We keep an
 * email only when all of these hold (fail closed: any doubt drops it):
 *
 * 1. INBOX_ADDRESS and INBOX_FORWARDER are set, and it was addressed to
 *    the inbox (recipient, received-for or X-Forwarded-To).
 * 2. One From: the raw message has exactly one From header, and it,
 *    Resend's `from` and Resend's From header each parse (strictly) to
 *    the same single address, on the INBOX_SENDERS allowlist.
 * 3. Resend's own check (from its mail server, which a sender can't
 *    forge) found a passing DKIM signature for the From domain, and DMARC
 *    didn't fail.
 * 4. Gmail's X-Forwarded-For names INBOX_FORWARDER.
 * 5. Newsletter traits, from DKIM signatures WE verified on the raw
 *    message (lib/inbox/dkim.ts; a DKIM-Signature header alone proves
 *    nothing): a List-Unsubscribe header, covered (h=) by a verified
 *    signature whose d= is the From domain (or its parent), and, for
 *    every sending platform the sender is configured with (PLATFORMS),
 *    a verified signature by the platform's domain, or one of its
 *    headers covered by a verified signature. A failed key lookup (DNS)
 *    drops the email for Resend to retry.
 * 6. Its Date is at most 3 days before it reached us and at most 1 day
 *    after. Never replaced by the arrival time.
 *
 * Reply-To is never a reason to keep anything: anyone can set it. A
 * manual forward ("Fwd:") carries the forwarder's From, so 2 drops it.
 * Volume (at most 2 issues per source a day) is checked where they're
 * stored (lib/inbox/store.ts).
 *
 * Gmail's forwarding-confirmation email (forwarding-noreply@google.com,
 * one From, DKIM-signed by google.com) is the one other email we keep.
 */

export type ReceivedEmail = {
  id: string;
  /** "Name <address>" or a bare address. */
  from: string | null;
  to: string[] | null;
  received_for?: string[] | null;
  subject: string | null;
  html: string | null;
  text: string | null;
  /** Lowercase keys; a repeated header may come as a list. */
  headers: Record<string, string | string[]> | null;
  created_at: string | null;
  message_id: string | null;
  authentication?: {
    spf?: string | null;
    dkim?: string | null;
    dmarc?: string | null;
  } | null;
  /** The raw MIME message (signed, short-lived link). */
  raw?: { download_url?: string | null; expires_at?: string | null } | null;
};

/**
 * A sending platform's marks on a genuine newsletter: any one of its
 * headers, or a DKIM signature by one of its domains.
 */
export const PLATFORMS = {
  beehiiv: {
    headers: ["x-beehiiv-ids", "x-beehiiv-type"],
    dkim: ["beehiiv.com"],
    /** Where its List-Unsubscribe links point (unsub.beehiiv.com, <pub>.beehiiv.com). */
    unsubscribe: ["beehiiv.com"],
  },
  sendgrid: {
    headers: ["x-sg-eid", "x-sg-id"],
    dkim: ["sendgrid.info", "sendgrid.net"],
    unsubscribe: ["sendgrid.net"],
  },
} as const;

/**
 * The hosts a List-Unsubscribe value points at: each <mailto:...> by its
 * address's domain, each <https://...> by its host. Null when any entry
 * is something else (a broken or unexpected value counts for nothing).
 */
export function unsubscribeHosts(value: string): string[] | null {
  const entries = [...value.matchAll(/<([^<>]*)>/g)].map((m) => m[1].trim());
  if (!entries.length || value.replace(/<[^<>]*>/g, "").replace(/[\s,]/g, ""))
    return null;
  const hosts: string[] = [];
  for (const t of entries) {
    const mail = t.match(/^mailto:[^@?\s]+@([a-z0-9.-]+)(?:\?.*)?$/i);
    if (mail) {
      hosts.push(mail[1].toLowerCase());
      continue;
    }
    let u: URL;
    try {
      u = new URL(t);
    } catch {
      return null;
    }
    if (u.protocol !== "https:") return null;
    hosts.push(u.hostname.toLowerCase());
  }
  return hosts;
}
export type Platform = keyof typeof PLATFORMS;

export type Sender = { id: string; from: string; platforms: Platform[] };

export type InboxConfig = {
  /** The inbound address the Gmail filter forwards to. */
  address: string | undefined;
  /** The owner's Gmail address (X-Forwarded-For). Required. */
  forwarder: string | undefined;
  senders: readonly Sender[];
};

export const GMAIL_FORWARDING = "forwarding-noreply@google.com";
export const GMAIL_FORWARDING_SOURCE = "gmail-forwarding";

export type Verdict =
  | { kind: "issue"; source: string; from: string; sentAt: Date }
  | {
      kind: "gmail-forwarding";
      code: string | null;
      link: string | null;
      /** The Gmail account asking to forward here (from the subject). */
      requester: string | null;
    }
  | {
      kind: "drop";
      reason: string;
      /**
       * It claimed to be an allowlisted sender (or Gmail) but didn't
       * prove it: worth telling the owner (spoofing, or setup trouble).
       */
      suspicious: boolean;
      /** The inbox isn't configured: every email drops until it is. */
      setup?: boolean;
      /** A DNS failure kept us from verifying: a retry may succeed. */
      retry?: boolean;
    };

/** local@domain: one @, dot-separated labels, no trailing dot. */
const ADDR =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** An unquoted display name: no address characters at all. */
const PHRASE = /^[^"<>@,;:\\()[\]\0]*$/;
/** A quoted display name (escapes allowed, no NUL). */
const QUOTED = /^"(?:[^"\\\0\r\n]|\\[^\0\r\n])*"$/;

/**
 * A From value as exactly one address: an optional display name, then
 * <local@domain>; or a bare local@domain alone. Anchored at both ends:
 * nothing after ">", one "@", no NUL or line breaks, no trailing dot.
 * Anything else is null.
 */
export function parseAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (/[\0\r\n]/.test(value)) return null;
  const v = value.trim();
  if (!v) return null;
  const angle = v.match(/^(.*?)\s*<([^<>]*)>$/);
  let addr: string;
  if (angle) {
    const name = angle[1].trim();
    if (name && !QUOTED.test(name) && !PHRASE.test(name)) return null;
    addr = angle[2].trim();
  } else {
    addr = v;
  }
  if (!ADDR.test(addr) || addr.length > 254) return null;
  return addr.toLowerCase();
}

/**
 * INBOX_SENDERS: "id:address:platform[+platform], ..." (e.g.
 * "daily:hello@example.com:beehiiv+sendgrid"). Bad entries are skipped.
 */
export function parseSenders(env: string | undefined): Sender[] {
  const out: Sender[] = [];
  for (const part of (env ?? "").split(",")) {
    const [id, from, platforms, ...rest] = part.trim().split(":");
    if (rest.length || !id || !from || !platforms) continue;
    if (!/^[a-z0-9-]{1,40}$/.test(id) || id === GMAIL_FORWARDING_SOURCE)
      continue;
    const addr = parseAddress(from);
    const p = platforms.split("+");
    if (!addr || !p.every((x) => x in PLATFORMS)) continue;
    if (out.some((s) => s.id === id || s.from === addr)) continue;
    out.push({ id, from: addr, platforms: p as Platform[] });
  }
  return out;
}

export type RawHeader = { name: string; value: string };

/** The raw message's top-level headers, unfolded, names lowercase. */
export function parseRawHeaders(raw: string): RawHeader[] {
  const end = raw.search(/\r?\n\r?\n/);
  const block = end < 0 ? raw : raw.slice(0, end);
  const out: RawHeader[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1].value += ` ${line.trim()}`;
      continue;
    }
    const i = line.indexOf(":");
    if (i < 1) continue;
    out.push({
      name: line.slice(0, i).trim().toLowerCase(),
      value: line.slice(i + 1).trim(),
    });
  }
  return out;
}

const all = (h: readonly RawHeader[], name: string) =>
  h.filter((x) => x.name === name).map((x) => x.value);

const underDomain = (host: string, d: string) =>
  host === d || host.endsWith(`.${d}`);

const drop = (reason: string, suspicious = false, setup = false): Verdict => ({
  kind: "drop",
  reason,
  suspicious,
  ...(setup ? { setup } : {}),
});

/** No verified signature that does the job: retry on a DNS failure. */
const unverified = (reason: string, dkim: DkimCheck): Verdict =>
  dkim.temporary
    ? {
        kind: "drop",
        reason: `${reason} (a DKIM key lookup failed: retry)`,
        suspicious: false,
        retry: true,
      }
    : drop(reason, true);

/** Days an issue's Date may run before its arrival, or after it. */
export const DATE_BEFORE_DAYS = 3;
export const DATE_AFTER_DAYS = 1;

/**
 * When it was sent: its Date header, only when it's at most 3 days
 * before `arrived` and at most 1 day after. Otherwise null: never the
 * arrival time instead.
 */
export function sentAt(
  date: string | undefined | null,
  arrived: string | null,
): Date | null {
  if (!date || !arrived) return null;
  const t = new Date(date);
  const a = new Date(arrived);
  if (Number.isNaN(t.getTime()) || Number.isNaN(a.getTime())) return null;
  const day = 86_400_000;
  if (t.getTime() < a.getTime() - DATE_BEFORE_DAYS * day) return null;
  if (t.getTime() > a.getTime() + DATE_AFTER_DAYS * day) return null;
  return t;
}

export function decide(
  e: ReceivedEmail,
  raw: readonly RawHeader[],
  cfg: InboxConfig,
  dkim: DkimCheck,
): Verdict {
  const inbox = parseAddress(cfg.address);
  if (!inbox) return drop("INBOX_ADDRESS isn't set", false, true);
  const recipients = [
    ...(e.to ?? []),
    ...(e.received_for ?? []),
    ...all(raw, "x-forwarded-to"),
  ].flatMap((r) =>
    String(r)
      .split(/[\s,]+/)
      .map(parseAddress),
  );
  if (!recipients.includes(inbox))
    return drop("it wasn't addressed to the inbox");

  // One From: exactly one in the raw message, and it, Resend's `from` and
  // Resend's From header all the same single address.
  const rawFroms = all(raw, "from");
  if (rawFroms.length !== 1)
    return drop(`it has ${rawFroms.length} From lines instead of one`, true);
  const header = e.headers?.from;
  if (typeof header !== "string")
    return drop("Resend reported more than one From line", true);
  const from = parseAddress(rawFroms[0]);
  if (!from)
    return drop("its From line isn't a single plain email address", true);
  if (parseAddress(header) !== from || parseAddress(e.from) !== from)
    return drop(
      "its sender address doesn't match across Resend's copies of it",
      true,
    );

  const auth = e.authentication;
  const dkimPass = auth?.dkim === "pass";
  const dmarcFail = auth?.dmarc === "fail";

  if (from === GMAIL_FORWARDING) {
    if (!dkimPass || dmarcFail)
      return drop(
        "it says it's Gmail's forwarding email, but Resend's signature check failed",
        true,
      );
    if (
      !dkim.verified.some(
        (v) => v.domain === "google.com" && v.headers.includes("from"),
      )
    )
      return unverified(
        "it says it's Gmail's forwarding email, but no google.com signature checked out",
        dkim,
      );
    return { kind: "gmail-forwarding", ...forwardingDetails(e) };
  }

  const sender = cfg.senders.find((s) => s.from === from);
  if (!sender)
    return drop("its sender isn't one of the newsletters (INBOX_SENDERS)");
  const forwarder = parseAddress(cfg.forwarder);
  if (!forwarder) return drop("INBOX_FORWARDER isn't set", false, true);
  if (!auth)
    return drop(`Resend had no signature check results for ${from}`, true);
  if (!dkimPass)
    return drop(
      `Resend found no valid DKIM signature for ${from} (it said ${auth.dkim ?? "nothing"})`,
      true,
    );
  if (dmarcFail) return drop(`its DMARC check failed for ${from}`, true);

  const by = all(raw, "x-forwarded-for").flatMap((v) =>
    v.split(/[\s,]+/).map(parseAddress),
  );
  if (!by.includes(forwarder))
    return drop(
      "it wasn't forwarded by the owner's Gmail (its X-Forwarded-For line doesn't name INBOX_FORWARDER)",
      true,
    );

  // Newsletter traits, from signatures we verified ourselves.
  if (!all(raw, "list-unsubscribe").some((v) => v.trim()))
    return drop(
      `it has no unsubscribe line (List-Unsubscribe), so it doesn't look like a newsletter from ${from}`,
      true,
    );
  const domain = from.split("@")[1];
  const covered = dkim.verified.some(
    (v) =>
      underDomain(domain, v.domain) &&
      v.headers.includes("from") &&
      v.headers.includes("list-unsubscribe"),
  );
  if (!covered)
    return unverified(
      `its unsubscribe line isn't covered by a valid signature from ${domain}`,
      dkim,
    );
  const names = new Set(raw.map((x) => x.name));
  const unsubs = all(raw, "list-unsubscribe");
  const unsubHosts = unsubs.length === 1 ? unsubscribeHosts(unsubs[0]) : null;
  for (const p of sender.platforms) {
    const marks = PLATFORMS[p];
    const trusted = (v: { domain: string }) =>
      underDomain(domain, v.domain) ||
      marks.dkim.some((m) => underDomain(v.domain, m));
    const marked =
      // A verified signature by the platform itself.
      dkim.verified.some((v) =>
        marks.dkim.some((m) => underDomain(v.domain, m)),
      ) ||
      // Its header, under a verified signature by the sender or the
      // platform (an attacker's own domain can sign anything).
      marks.headers.some(
        (n) =>
          names.has(n) &&
          dkim.verified.some((v) => v.headers.includes(n) && trusted(v)),
      ) ||
      // Its unsubscribe links: the one List-Unsubscribe line, under a
      // verified signature by the sender or the platform, pointing only
      // at the platform's own domains.
      (!!unsubHosts &&
        unsubHosts.every((h) =>
          marks.unsubscribe.some((m) => underDomain(h, m)),
        ) &&
        dkim.verified.some(
          (v) => v.headers.includes("list-unsubscribe") && trusted(v),
        ));
    if (!marked)
      return unverified(
        `it doesn't carry ${p}'s signed marks (a valid ${p} signature, or a signed ${p} header or unsubscribe link)`,
        dkim,
      );
  }

  const dates = all(raw, "date");
  const sent = dates.length === 1 ? sentAt(dates[0], e.created_at) : null;
  if (!sent)
    return drop(
      `its Date is missing, repeated, or over ${DATE_BEFORE_DAYS} days before or ${DATE_AFTER_DAYS} day after it arrived`,
      true,
    );
  return { kind: "issue", source: sender.id, from, sentAt: sent };
}

/** The code, link and requesting account in Gmail's confirmation email. */
export function forwardingDetails(
  e: Pick<ReceivedEmail, "subject" | "text" | "html">,
): {
  code: string | null;
  link: string | null;
  requester: string | null;
} {
  const subject = e.subject ?? "";
  const body = `${e.text ?? ""}\n${(e.html ?? "").replace(/&amp;/g, "&")}`;
  const code =
    subject.match(/\(#\s*(\d{6,12})\)/)?.[1] ??
    body.match(/confirmation code:?\s*(\d{6,12})/i)?.[1] ??
    null;
  // Only Google's own confirmation pages.
  const link =
    body.match(
      /https:\/\/(?:mail-settings\.google\.com|mail\.google\.com|isolated\.mail\.google\.com)\/mail\/[^\s"'<>)]+/i,
    )?.[0] ?? null;
  const requester = parseAddress(
    subject.match(/receive mail from\s+(\S+)\s*$/i)?.[1] ?? null,
  );
  return { code, link, requester };
}

/** The Message-ID we key on (with the source; a stand-in without one). */
export function messageKey(e: ReceivedEmail): string {
  const h = e.headers?.["message-id"];
  const raw =
    e.message_id ?? (typeof h === "string" ? h : null) ?? `resend:${e.id}`;
  return raw.trim().slice(0, 500);
}
