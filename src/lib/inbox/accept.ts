import "server-only";

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
 * 5. Newsletter traits: a List-Unsubscribe header, covered (h=) by a
 *    DKIM signature of the From domain, and every sending platform's
 *    marker the sender is configured with (PLATFORMS).
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
  },
  sendgrid: {
    headers: ["x-sg-eid", "x-sg-id"],
    dkim: ["sendgrid.info", "sendgrid.net"],
  },
} as const;
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

/** A DKIM-Signature's tags (whitespace removed, names lowercase). */
function dkimTags(value: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of value.replace(/\s+/g, "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) tags[part.slice(0, i).toLowerCase()] = part.slice(i + 1);
  }
  return tags;
}

const underDomain = (host: string, d: string) =>
  host === d || host.endsWith(`.${d}`);

const drop = (reason: string, suspicious = false, setup = false): Verdict => ({
  kind: "drop",
  reason,
  suspicious,
  ...(setup ? { setup } : {}),
});

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
  if (!recipients.includes(inbox)) return drop("not addressed to the inbox");

  // One From: exactly one in the raw message, and it, Resend's `from` and
  // Resend's From header all the same single address.
  const rawFroms = all(raw, "from");
  if (rawFroms.length !== 1)
    return drop(`${rawFroms.length} From headers in the message`, true);
  const header = e.headers?.from;
  if (typeof header !== "string")
    return drop("Resend's From header isn't one value", true);
  const from = parseAddress(rawFroms[0]);
  if (!from) return drop("From isn't exactly one address", true);
  if (parseAddress(header) !== from || parseAddress(e.from) !== from)
    return drop("From disagrees with itself", true);

  const auth = e.authentication;
  const dkimPass = auth?.dkim === "pass";
  const dmarcFail = auth?.dmarc === "fail";

  if (from === GMAIL_FORWARDING) {
    if (!dkimPass || dmarcFail)
      return drop("a Gmail forwarding email without a passing signature", true);
    return { kind: "gmail-forwarding", ...forwardingDetails(e) };
  }

  const sender = cfg.senders.find((s) => s.from === from);
  if (!sender) return drop("sender isn't on the inbox allowlist");
  const forwarder = parseAddress(cfg.forwarder);
  if (!forwarder) return drop("INBOX_FORWARDER isn't set", false, true);
  if (!auth) return drop(`no authentication results for ${from}`, true);
  if (!dkimPass)
    return drop(
      `no passing DKIM signature for ${from} (dkim ${auth.dkim ?? "none"})`,
      true,
    );
  if (dmarcFail) return drop(`DMARC failed for ${from}`, true);

  const by = all(raw, "x-forwarded-for").flatMap((v) =>
    v.split(/[\s,]+/).map(parseAddress),
  );
  if (!by.includes(forwarder))
    return drop("not forwarded by the owner's Gmail (X-Forwarded-For)", true);

  // Newsletter traits.
  if (!all(raw, "list-unsubscribe").some((v) => v.trim()))
    return drop(`no List-Unsubscribe from ${from}`, true);
  const domain = from.split("@")[1];
  const sigs = all(raw, "dkim-signature").map(dkimTags);
  const covered = sigs.some((t) => {
    const d = (t.d ?? "").toLowerCase();
    const h = (t.h ?? "").toLowerCase().split(":");
    return (
      !!d &&
      underDomain(domain, d) &&
      h.includes("from") &&
      h.includes("list-unsubscribe")
    );
  });
  if (!covered)
    return drop(
      `List-Unsubscribe isn't covered by a DKIM signature of ${domain}`,
      true,
    );
  const names = new Set(raw.map((x) => x.name));
  const signers = sigs.map((t) => (t.d ?? "").toLowerCase()).filter(Boolean);
  for (const p of sender.platforms) {
    const marks = PLATFORMS[p];
    const marked =
      marks.headers.some((n) => names.has(n)) ||
      signers.some((d) => marks.dkim.some((m) => underDomain(d, m)));
    if (!marked) return drop(`no ${p} marks on ${from}`, true);
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
