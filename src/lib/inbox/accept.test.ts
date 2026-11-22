import { describe, expect, it } from "vitest";
import type { DkimCheck } from "./dkim";
import {
  decide,
  forwardingDetails,
  type InboxConfig,
  messageKey,
  parseAddress,
  parseRawHeaders,
  parseSenders,
  type ReceivedEmail,
  sentAt,
} from "./accept";

/**
 * The newsletter inbox keeps only the configured newsletters, forwarded
 * by the owner's Gmail with their DKIM signatures and newsletter traits
 * intact, and Gmail's forwarding confirmation. Anything else, however
 * it's dressed up, is dropped. Senders, addresses and tokens here are
 * synthetic.
 */
const INBOX = "issues-test@in.example.org";
const OWNER = "owner@gmail.com";
const DAILY = "hello@daily-news.example";
const WEEKLY = "weekly@mail.beehiiv.com";
const cfg: InboxConfig = {
  address: INBOX,
  forwarder: OWNER,
  senders: parseSenders(`daily:${DAILY}:sendgrid, weekly:${WEEKLY}:beehiiv`),
};
const ARRIVED = "2026-11-20T14:02:41.000Z";

/** A raw header block as Gmail forwards it (top headers first). */
function raw(
  over: { from?: string | string[]; drop?: string[]; add?: string[] } = {},
): string {
  const from = over.from ?? `The Daily <${DAILY}>`;
  const lines = [
    `X-Forwarded-To: ${INBOX}`,
    `X-Forwarded-For: ${OWNER} ${INBOX}`,
    `Delivered-To: ${OWNER}`,
    "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=daily-news.example;\r\n\th=content-type:date:from:mime-version:subject:reply-to:\r\n\tlist-unsubscribe:list-unsubscribe-post; s=s1; bh=SYNTHETIC=; b=SYNTHETIC=",
    "DKIM-Signature: v=1; a=rsa-sha256; d=sendgrid.info; h=from:subject:list-unsubscribe; s=smtpapi; b=SYNTHETIC=",
    "Date: Fri, 20 Nov 2026 14:02:38 +0000",
    ...(Array.isArray(from) ? from : [from]).map((f) => `From: ${f}`),
    "Message-ID: <synthetic-0001@mta.example>",
    "Subject: Synthetic issue",
    "List-Unsubscribe: <mailto:unsub-SYNTHETIC@unsub.beehiiv.com>",
    'x-beehiiv-ids: {"campaign_id":"SYNTHETIC"}',
    "x-beehiiv-type: newsletter",
    "X-SG-EID: SYNTHETIC",
    `To: ${OWNER}`,
    ...(over.add ?? []),
  ].filter(
    (l) => !(over.drop ?? []).some((d) => l.toLowerCase().startsWith(d)),
  );
  return `${lines.join("\r\n")}\r\n\r\n<html>body From: x@y.z</html>`;
}

const forwarded = (over: Partial<ReceivedEmail> = {}): ReceivedEmail => ({
  id: "00000000-0000-4000-8000-000000000001",
  from: DAILY,
  to: [OWNER],
  received_for: [INBOX],
  subject: "Synthetic issue",
  html: "<p>Hi</p>",
  text: "Hi",
  headers: {
    from: `The Daily <${DAILY}>`,
    date: "Fri, 20 Nov 2026 14:02:38 +0000",
    "message-id": "<synthetic-0001@mta.example>",
  },
  created_at: ARRIVED,
  message_id: "<synthetic-0001@mta.example>",
  authentication: { spf: "pass", dkim: "pass", dmarc: "gray" },
  ...over,
});
/**
 * decide() gets the signatures lib/inbox/dkim.ts verified. Here, by
 * default, the raw message's DKIM-Signature headers stand in for them (as
 * if each verified); dkim.test.ts signs and verifies real ones.
 */
const asVerified = (r: string): DkimCheck => ({
  temporary: false,
  verified: parseRawHeaders(r)
    .filter((h) => h.name === "dkim-signature")
    .map((h) => {
      const tag = (t: string) =>
        h.value
          .replace(/\s+/g, "")
          .match(new RegExp(`(?:^|;)${t}=([^;]*)`))?.[1] ?? "";
      return {
        domain: tag("d").toLowerCase(),
        headers: tag("h").toLowerCase().split(":"),
      };
    }),
});
const go = (
  e: ReceivedEmail = forwarded(),
  r: string = raw(),
  c: InboxConfig = cfg,
  dkim: DkimCheck = asVerified(r),
) => decide(e, parseRawHeaders(r), c, dkim);

const weekly = () => {
  const e = forwarded({
    from: WEEKLY,
    headers: { ...forwarded().headers, from: `The Weekly <${WEEKLY}>` },
  });
  const r = raw({
    from: `The Weekly <${WEEKLY}>`,
    drop: ["dkim", "x-sg"],
  }).replace(
    "Date:",
    "DKIM-Signature: v=1; d=mail.beehiiv.com; h=from:list-unsubscribe:date; b=SYNTHETIC=\r\nDate:",
  );
  return { e, r };
};

describe("strict From parsing", () => {
  it("takes one address, with or without a display name", () => {
    expect(parseAddress(`The Daily <${DAILY}>`)).toBe(DAILY);
    expect(parseAddress(`"The Daily, Inc." <Hello@Daily-News.example>`)).toBe(
      DAILY,
    );
    expect(parseAddress(DAILY)).toBe(DAILY);
    expect(parseAddress(`=?UTF-8?Q?The_Daily?= <${DAILY}>`)).toBe(DAILY);
  });
  it("refuses every probe", () => {
    for (const probe of [
      `${DAILY}@evil.com`,
      `<${DAILY}>@evil.com`,
      `${DAILY}\0@evil.com`,
      `${DAILY}.`,
      `<${DAILY}.>`,
      "forwarding-noreply@google.com@evil.com",
      `<${DAILY}> <evil@evil.com>`,
      `evil@evil.com, The Daily <${DAILY}>`,
      `${DAILY} <evil@evil.com>`,
      `The Daily <${DAILY}> trailing`,
      `The Daily <${DAILY}`,
      "",
      "no address",
      `${DAILY}\r\nBcc: x@y.com`,
    ])
      expect(parseAddress(probe), JSON.stringify(probe)).toBe(null);
  });
});

describe("the sender allowlist (INBOX_SENDERS)", () => {
  it("reads id:address:platforms entries, skipping bad ones", () => {
    expect(
      parseSenders(
        "daily:hello@daily-news.example:beehiiv+sendgrid, bad entry,x:y:z, weekly:weekly@mail.beehiiv.com:beehiiv",
      ),
    ).toEqual([
      {
        id: "daily",
        from: "hello@daily-news.example",
        platforms: ["beehiiv", "sendgrid"],
      },
      { id: "weekly", from: "weekly@mail.beehiiv.com", platforms: ["beehiiv"] },
    ]);
    expect(parseSenders(undefined)).toEqual([]);
  });

  it("keeps a forwarded issue from each newsletter, with its send time", () => {
    const v = go();
    expect(v).toEqual({
      kind: "issue",
      source: "daily",
      from: DAILY,
      sentAt: new Date("2026-11-20T14:02:38.000Z"),
    });
    const w = weekly();
    expect(go(w.e, w.r)).toMatchObject({ kind: "issue", source: "weekly" });
  });

  it("drops anyone else, quietly", () => {
    const e = forwarded({
      from: "deals@shop.example.com",
      headers: { ...forwarded().headers, from: "deals@shop.example.com" },
    });
    expect(go(e, raw({ from: "deals@shop.example.com" }))).toMatchObject({
      kind: "drop",
      suspicious: false,
    });
  });

  it("drops a manual forward (Fwd:) by anyone, even of a real issue", () => {
    const e = forwarded({
      from: OWNER,
      subject: "Fwd: Synthetic issue",
      headers: { ...forwarded().headers, from: `Me <${OWNER}>` },
    });
    expect(go(e, raw({ from: `Me <${OWNER}>` }))).toMatchObject({
      kind: "drop",
    });
  });

  it("drops a spoofed From without a passing DKIM signature, and says so", () => {
    for (const authentication of [
      { spf: "pass", dkim: "fail", dmarc: "fail" },
      { spf: "pass", dkim: "gray", dmarc: "gray" },
      { dkim: "pass", dmarc: "fail" },
      null,
    ])
      expect(go(forwarded({ authentication }))).toMatchObject({
        kind: "drop",
        suspicious: true,
      });
  });

  it("drops a real issue forwarded by someone else's Gmail, or by nobody", () => {
    expect(
      go(
        forwarded(),
        raw({
          drop: ["x-forwarded-for"],
          add: [`X-Forwarded-For: stranger@gmail.com ${INBOX}`],
        }),
      ),
    ).toMatchObject({ kind: "drop", suspicious: true });
    expect(go(forwarded(), raw({ drop: ["x-forwarded-for"] }))).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
  });

  it("fails closed without INBOX_FORWARDER or INBOX_ADDRESS", () => {
    expect(go(forwarded(), raw(), { ...cfg, forwarder: undefined })).toEqual(
      expect.objectContaining({ kind: "drop", setup: true }),
    );
    expect(go(forwarded(), raw(), { ...cfg, address: undefined })).toEqual(
      expect.objectContaining({ kind: "drop", setup: true }),
    );
  });

  it("drops mail not addressed to the inbox", () => {
    expect(
      go(
        forwarded({ received_for: ["other@in.example.org"] }),
        raw({ drop: ["x-forwarded-to"] }),
      ),
    ).toMatchObject({ kind: "drop" });
  });
});

describe("one From, three ways", () => {
  it("drops two From headers in the raw message", () => {
    expect(
      go(
        forwarded(),
        raw({ from: [`The Daily <${DAILY}>`, "x <evil@evil.com>"] }),
      ),
    ).toMatchObject({ kind: "drop", suspicious: true });
    expect(
      go(
        forwarded(),
        raw({ from: [`The Daily <${DAILY}>`, `The Daily <${DAILY}>`] }),
      ),
    ).toMatchObject({ kind: "drop", suspicious: true });
  });
  it("drops a raw message with no From", () => {
    expect(go(forwarded(), raw({ from: [] }))).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
  });
  it("drops when Resend's from, its From header and the raw From disagree", () => {
    expect(go(forwarded({ from: "other@daily-news.example" }))).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
    expect(
      go(
        forwarded({
          headers: {
            ...forwarded().headers,
            from: [`The Daily <${DAILY}>`, DAILY],
          },
        }),
      ),
    ).toMatchObject({ kind: "drop", suspicious: true });
    expect(
      go(
        forwarded(),
        raw({ from: "The Daily <hello@daily-news.example.evil.com>" }),
      ),
    ).toMatchObject({ kind: "drop", suspicious: true });
  });
  it("drops each From probe as Resend reports it", () => {
    for (const probe of [
      `${DAILY}@evil.com`,
      `<${DAILY}>@evil.com`,
      `${DAILY}\0@evil.com`,
      `${DAILY}.`,
    ]) {
      const e = forwarded({
        from: probe,
        headers: { ...forwarded().headers, from: probe },
      });
      expect(go(e, raw({ from: probe })).kind, probe).toBe("drop");
    }
  });
});

describe("newsletter traits (verified signatures only)", () => {
  it("never takes a DKIM-Signature header nobody verified (the reviewer's probe)", () => {
    // A real reply from the newsletter's staff (no List-Unsubscribe in
    // its verified signature), with a forged extra signature header,
    // List-Unsubscribe and platform headers added.
    const r = raw({
      add: [
        "DKIM-Signature: d=daily-news.example; h=from:list-unsubscribe; b=FORGED",
      ],
    });
    const staff: DkimCheck = {
      temporary: false,
      verified: [
        { domain: "daily-news.example", headers: ["from", "to", "subject"] },
      ],
    };
    expect(go(forwarded(), r, cfg, staff)).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
  });
  it("never takes a bare platform header: it must be under a verified h=", () => {
    const own: DkimCheck = {
      temporary: false,
      verified: [
        {
          domain: "daily-news.example",
          headers: ["from", "list-unsubscribe"],
        },
      ],
    };
    const c = { ...cfg, senders: parseSenders(`daily:${DAILY}:beehiiv`) };
    expect(go(forwarded(), raw(), c, own)).toMatchObject({ kind: "drop" });
    const covered: DkimCheck = {
      temporary: false,
      verified: [
        {
          domain: "daily-news.example",
          headers: ["from", "list-unsubscribe", "x-beehiiv-type"],
        },
      ],
    };
    expect(go(forwarded(), raw(), c, covered)).toMatchObject({
      kind: "issue",
    });
  });
  it("drops for a retry when a key lookup failed", () => {
    expect(
      go(forwarded(), raw(), cfg, { temporary: true, verified: [] }),
    ).toMatchObject({ kind: "drop", retry: true, suspicious: false });
  });

  it("needs List-Unsubscribe", () => {
    expect(go(forwarded(), raw({ drop: ["list-unsubscribe"] }))).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
  });
  it("needs it covered by the sender's own DKIM signature", () => {
    const r = raw().replace(
      /list-unsubscribe:list-unsubscribe-post/,
      "x-other",
    );
    expect(go(forwarded(), r)).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
  });
  it("needs every platform's verified mark the sender is configured with", () => {
    // SendGrid by its own verified signature (d=sendgrid.info)...
    expect(go(forwarded(), raw({ drop: ["x-sg"] }))).toMatchObject({
      kind: "issue",
    });
    // ...or by its header under a verified h=; a bare header never.
    const noSg = raw({
      drop: ["dkim-signature: v=1; a=rsa-sha256; d=sendgrid"],
    });
    expect(go(forwarded(), noSg)).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
    expect(
      go(
        forwarded(),
        noSg.replace(
          "list-unsubscribe-post;",
          "list-unsubscribe-post:x-sg-eid;",
        ),
      ),
    ).toMatchObject({ kind: "issue" });
    // beehiiv by a verified beehiiv.com signature.
    const w = weekly();
    expect(go(w.e, w.r)).toMatchObject({ kind: "issue" });
    const both = {
      ...cfg,
      senders: parseSenders(`daily:${DAILY}:beehiiv+sendgrid`),
    };
    expect(go(forwarded(), raw(), both)).toMatchObject({ kind: "drop" });
  });
});

describe("the Date", () => {
  const at = (date: string) =>
    go(
      forwarded({ headers: { ...forwarded().headers, date } }),
      raw().replace(/Date: [^\r]*/, `Date: ${date}`),
    );
  it("drops an issue dated more than 3 days before it arrived, or a day after", () => {
    expect(at("Tue, 17 Nov 2026 14:00:00 +0000")).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
    expect(at("Sat, 21 Nov 2026 15:00:00 +0000")).toMatchObject({
      kind: "drop",
      suspicious: true,
    });
    expect(at("nonsense")).toMatchObject({ kind: "drop", suspicious: true });
    expect(at("Tue, 17 Nov 2026 15:00:00 +0000")).toMatchObject({
      kind: "issue",
    });
  });
  it("never substitutes the arrival time", () => {
    expect(sentAt("Fri, 27 Nov 2026 14:00:00 +0000", ARRIVED)).toBe(null);
    expect(sentAt("Fri, 20 Feb 2026 14:00:00 +0000", ARRIVED)).toBe(null);
    expect(sentAt(undefined, ARRIVED)).toBe(null);
    expect(
      sentAt("Fri, 20 Nov 2026 14:02:38 +0000", ARRIVED)?.toISOString(),
    ).toBe("2026-11-20T14:02:38.000Z");
  });
});

describe("Gmail's forwarding confirmation", () => {
  const G = "forwarding-noreply@google.com";
  const confirm = (over: Partial<ReceivedEmail> = {}) =>
    forwarded({
      from: G,
      to: [INBOX],
      received_for: [INBOX],
      subject: `(#123456789) Gmail Forwarding Confirmation - Receive Mail from ${OWNER}`,
      text: `Confirmation code: 123456789\nhttps://mail-settings.google.com/mail/vf-%5BSYNTHETIC%5D-x`,
      html: null,
      headers: { ...forwarded().headers, from: `Gmail Team <${G}>` },
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
      ...over,
    });
  const graw = raw({
    from: `Gmail Team <${G}>`,
    drop: ["x-forwarded", "dkim-signature: v=1; a="],
    add: [
      "DKIM-Signature: v=1; d=google.com; h=from:to:subject:date; b=SYNTHETIC=",
    ],
  });

  it("keeps it with its code, link and requester", () => {
    expect(go(confirm(), graw)).toEqual({
      kind: "gmail-forwarding",
      code: "123456789",
      link: "https://mail-settings.google.com/mail/vf-%5BSYNTHETIC%5D-x",
      requester: OWNER,
    });
  });
  it("drops a fake one (no Google signature), or one with two From headers", () => {
    expect(
      go(confirm({ authentication: { dkim: "fail", dmarc: "fail" } }), graw),
    ).toMatchObject({ kind: "drop", suspicious: true });
    expect(
      go(
        confirm(),
        raw({ from: [`Gmail Team <${G}>`, `<${G}>`], drop: ["x-forwarded"] }),
      ),
    ).toMatchObject({ kind: "drop", suspicious: true });
  });
  it("only ever takes a link on Google's own hosts", () => {
    expect(
      forwardingDetails({
        subject: "Gmail Forwarding Confirmation",
        text: "Confirmation code: 987654321 https://evil.example.com/mail/vf-x",
        html: null,
      }),
    ).toEqual({ code: "987654321", link: null, requester: null });
  });
});

describe("details", () => {
  it("parses a raw header block: unfolded, lowercase names, body ignored", () => {
    const h = parseRawHeaders("A: 1\r\n\tmore\r\nB: 2\r\n\r\nC: 3");
    expect(h).toEqual([
      { name: "a", value: "1 more" },
      { name: "b", value: "2" },
    ]);
  });
  it("keys on the Message-ID, or Resend's id without one", () => {
    expect(messageKey(forwarded())).toBe("<synthetic-0001@mta.example>");
    expect(messageKey(forwarded({ message_id: null, headers: {} }))).toBe(
      "resend:00000000-0000-4000-8000-000000000001",
    );
  });
});
