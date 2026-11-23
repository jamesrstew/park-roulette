import "server-only";
import { alertLater } from "@/lib/alerts";
import {
  decide,
  GMAIL_FORWARDING_SOURCE,
  type InboxConfig,
  messageKey,
  parseAddress,
  parseRawHeaders,
  parseSenders,
  sentAt,
} from "./accept";
import { type DnsResolver, liveResolver, verifyDkim } from "./dkim";
import { cleanIssue } from "./extract";
import { fetchRaw, fetchReceived } from "./resend";
import { MAX_PER_DAY, saveIssue, tempFailCount } from "./store";

/**
 * One email.received delivery: fetch the email and its raw message from
 * Resend, decide (lib/inbox/accept.ts), and store an issue (at most 2 per
 * source a day), or Gmail's forwarding code (and email it to the owner
 * when the owner's own account asked), or drop it with a log line.
 * Returns the HTTP status for Resend: 5xx only when a retry could help.
 *
 * Env: INBOX_ADDRESS, INBOX_FORWARDER (both required), INBOX_SENDERS
 * ("id:address:platform[+platform],..."), INBOX_GREETING_NAMES (the
 * owner's names a greeting may print, scrubbed), RESEND_INBOUND_API_KEY.
 */

export function inboxConfig(): InboxConfig {
  return {
    address: process.env.INBOX_ADDRESS,
    forwarder: process.env.INBOX_FORWARDER,
    senders: parseSenders(process.env.INBOX_SENDERS),
  };
}

/** Kept at most: html 1 MB (else dropped), text 200 KB (cut). */
export const MAX_HTML_BYTES = 1024 * 1024;
export const MAX_TEXT_CHARS = 200 * 1024;

export type InboundResult = {
  status: number;
  outcome:
    | "stored"
    | "would_store"
    | "duplicate"
    | "forwarding"
    | "dropped"
    | "ignored"
    | "failed";
  reason?: string;
  id?: number;
  /** A dry run's issue, as it would be stored. */
  preview?: {
    source: string;
    subject: string;
    sentAt: string;
    chars: number;
    links: number;
  };
};

export type HandleOptions = {
  /** Decide and clean, store nothing (scripts/inbox-reprocess.mts). */
  dryRun?: boolean;
  /** Send no alerts (a person is running it by hand). */
  quiet?: boolean;
};

/** How to run this email through again, for an alert. */
const again = (id: string) =>
  `Resend id: ${id}. Once it's fixed, run it through again with: pnpm exec tsx --conditions react-server scripts/inbox-reprocess.mts ${id} (add --apply to store it).`;

const DAY = 24 * 60;
/** Temporary failures for one email before the owner hears about it. */
export const TEMP_FAIL_ALERT_AFTER = 3;

export async function handleReceived(
  emailId: string,
  fetchImpl: typeof fetch = fetch,
  cfg: InboxConfig = inboxConfig(),
  resolver: DnsResolver = liveResolver,
  opts: HandleOptions = {},
): Promise<InboundResult> {
  const alert: typeof alertLater =
    opts.quiet || opts.dryRun ? () => {} : alertLater;
  const failed = (error: string, retry = true): InboundResult => {
    console.error(`[inbox] couldn't read ${emailId}: ${error}`);
    alert({
      key: "inbox:fetch-failed",
      subject: "The newsletter inbox couldn't read an email",
      text: `Resend delivered an email to the newsletter inbox, but reading it failed (${error}). Check RESEND_INBOUND_API_KEY (the inbound team's full-access key) and the Vercel logs for [inbox].${retry ? " Resend retries for a while." : ""}\n\n${again(emailId)}`,
      everyMinutes: DAY,
    });
    return retry
      ? { status: 502, outcome: "failed", reason: error }
      : { status: 200, outcome: "dropped", reason: error };
  };
  const got = await fetchReceived(emailId, fetchImpl);
  if (!got.ok) return failed(got.error, got.error !== "too_big");
  const e = got.email;
  const raw = await fetchRaw(e.raw?.download_url, fetchImpl);
  if (!raw.ok) return failed(raw.error, raw.retry);
  const dkim = await verifyDkim(raw.raw, resolver);
  const v = decide(e, parseRawHeaders(raw.raw.toString("utf8")), cfg, dkim);
  if (v.kind === "drop" && v.retry) {
    // DNS let us down: nothing stored, Resend tries again later. Past
    // 3 tries for one email, tell the owner (once a day).
    console.warn(`[inbox] ${emailId}: ${v.reason}`);
    const tries = opts.dryRun ? 0 : await tempFailCount(emailId).catch(() => 0);
    if (tries > TEMP_FAIL_ALERT_AFTER)
      alert({
        key: "inbox:tempfail",
        subject: "The newsletter inbox keeps failing to check an email",
        text: `An email has failed its signature check ${tries} times because a DKIM key lookup (DNS) failed: ${v.reason}. Nothing is stored until a retry succeeds. If DNS is fine, check the Vercel logs for [inbox].\n\n${again(emailId)}`,
        everyMinutes: DAY,
      });
    return { status: 503, outcome: "failed", reason: v.reason };
  }
  if (v.kind === "drop")
    return dropped(emailId, e.from, v.reason, v.suspicious, v.setup, alert);

  const scrub = [cfg.forwarder, cfg.address].filter(Boolean) as string[];
  const names = (process.env.INBOX_GREETING_NAMES ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  if (v.kind === "gmail-forwarding") {
    // Only the owner's own Gmail account gets the code: anyone can ask to
    // forward here, and the code would let them.
    const owner = parseAddress(cfg.forwarder);
    const mine = !!owner && v.requester === owner;
    if (opts.dryRun)
      return {
        status: 200,
        outcome: "forwarding",
        reason: mine ? "owner" : "another account",
      };
    const saved = await saveIssue({
      source: GMAIL_FORWARDING_SOURCE,
      messageId: messageKey(e),
      subject: (e.subject ?? "").slice(0, 500),
      sentAt: sentAt(e.headers?.date as string, e.created_at) ?? new Date(),
      html: "",
      text: mine
        ? [
            v.code ? `Confirmation code: ${v.code}` : "",
            v.link ? `Link: ${v.link}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "Requested by another Gmail account: not kept.",
      links: [],
    });
    if (!saved.saved) return { status: 200, outcome: "duplicate" };
    alert({
      key: "inbox:gmail-forwarding",
      subject: mine
        ? "Confirm Gmail forwarding to the newsletter inbox"
        : "Someone asked to forward Gmail to the newsletter inbox",
      text: mine
        ? [
            "Gmail wants to confirm forwarding to the newsletter inbox, asked for by the Gmail account in INBOX_FORWARDER.",
            v.code
              ? `Confirmation code: ${v.code}`
              : "No code found in the email.",
            v.link ? `Or open: ${v.link}` : "",
            "Enter the code in Gmail: Settings, Forwarding and POP/IMAP, Verify. Then add the filter (the setup notes).",
          ]
            .filter(Boolean)
            .join("\n\n")
        : `A Gmail account that isn't the one in INBOX_FORWARDER${owner ? "" : " (it isn't set)"} asked to forward its mail to the newsletter inbox. Its code isn't kept or sent. Nothing to do unless you meant to set this up from another account.`,
      everyMinutes: DAY,
    });
    console.info(
      `[inbox] Gmail forwarding confirmation (${mine ? "owner" : "another account"})`,
    );
    return { status: 200, outcome: "forwarding", id: saved.id };
  }

  if ((e.html ?? "").length > MAX_HTML_BYTES)
    return dropped(
      emailId,
      e.from,
      "its html is over 1 MB",
      false,
      false,
      alert,
    );
  const clean = cleanIssue({ html: e.html, plain: e.text, scrub, names });
  if (opts.dryRun)
    return {
      status: 200,
      outcome: "would_store",
      preview: {
        source: v.source,
        subject: e.subject ?? "",
        sentAt: v.sentAt.toISOString(),
        chars: Math.min(clean.text.length, MAX_TEXT_CHARS),
        links: clean.links.length,
      },
    };
  const saved = await saveIssue(
    {
      source: v.source,
      messageId: messageKey(e),
      subject: e.subject ?? "",
      sentAt: v.sentAt,
      ...clean,
      text: clean.text.slice(0, MAX_TEXT_CHARS),
    },
    { maxPerDay: MAX_PER_DAY },
  );
  if (!saved.saved) {
    if (saved.why === "duplicate") {
      console.info(`[inbox] ${v.source}: already stored`);
      return { status: 200, outcome: "duplicate" };
    }
    console.warn(`[inbox] ${v.source}: over ${MAX_PER_DAY} issues a day`);
    alert({
      key: "inbox:volume",
      subject: "The newsletter inbox dropped extra issues",
      text: `More than ${MAX_PER_DAY} issues from one newsletter (${v.source}) arrived within 24 hours, so the extra ones were dropped. A special edition does this; so would a replay. Check the Vercel logs for [inbox].\n\n${again(emailId)}`,
      everyMinutes: DAY,
    });
    return { status: 200, outcome: "dropped", reason: "over_limit" };
  }
  console.info(
    `[inbox] stored ${v.source} issue ${saved.id} (${clean.text.length} chars, ${clean.links.length} links)`,
  );
  return { status: 200, outcome: "stored", id: saved.id };
}

function dropped(
  emailId: string,
  from: string | null,
  reason: string,
  suspicious: boolean,
  setup = false,
  alert: typeof alertLater = alertLater,
): InboundResult {
  const domain = (from ?? "").match(/@([a-z0-9.-]+)/i)?.[1] ?? "?";
  console.info(`[inbox] dropped ${emailId} from @${domain}: ${reason}`);
  if (setup)
    alert({
      key: "inbox:setup",
      subject: "The newsletter inbox isn't set up",
      text: `An email reached the newsletter inbox and was dropped because ${reason}. Set INBOX_ADDRESS, INBOX_FORWARDER and INBOX_SENDERS in Vercel (the setup notes).\n\n${again(emailId)}`,
      everyMinutes: DAY,
    });
  else if (suspicious)
    alert({
      key: "inbox:suspicious",
      subject: "The newsletter inbox dropped a suspicious email",
      text: `An email from @${domain} that claimed to be one of the newsletters (or Gmail) was dropped because ${reason}. Nothing was stored. If it was a real issue, the check may be too strict: get it fixed, then run it through again. Otherwise someone tried to spoof one.\n\n${again(emailId)}`,
      everyMinutes: DAY,
    });
  return { status: 200, outcome: "dropped", reason };
}
