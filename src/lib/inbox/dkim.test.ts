import { describe, expect, it } from "vitest";
import {
  decide,
  type InboxConfig,
  parseRawHeaders,
  parseSenders,
  type ReceivedEmail,
} from "./accept";
import { verifyDkim } from "./dkim";
import {
  downResolver,
  forwardedBy,
  signed,
  testResolver,
} from "./dkim.testkit";

/**
 * DKIM verified by us on the raw message: only a signature that verifies
 * counts. Messages are built in the shape of the real newsletters (a
 * beehiiv issue sent through SendGrid, signed by the sender's domain and
 * by sendgrid.info; a beehiiv issue signed by mail.beehiiv.com), signed
 * with a throwaway key whose lookup is stubbed. Names are synthetic.
 */
const INBOX = "issues-test@in.example.org";
const OWNER = "owner@gmail.com";
const DAILY = "hello@daily-news.example";
const WEEKLY = "weekly@mail.beehiiv.com";
const cfg: InboxConfig = {
  address: INBOX,
  forwarder: OWNER,
  senders: parseSenders(`daily:${DAILY}:sendgrid,weekly:${WEEKLY}:beehiiv`),
};
/** The headers the real newsletters' signatures cover (h=). */
const H = [
  "Content-Type",
  "Date",
  "From",
  "Mime-Version",
  "Subject",
  "Reply-To",
  "Feedback-ID",
  "List-Unsubscribe",
  "List-Unsubscribe-Post",
  "To",
];

const issue = (from: string) =>
  [
    'Content-Type: text/html; charset="utf-8"',
    "Date: Fri, 20 Nov 2026 14:02:38 +0000",
    `From: The Newsletter <${from}>`,
    "Mime-Version: 1.0",
    "Message-ID: <synthetic-1@mta.example>",
    "Subject: Synthetic issue",
    `Reply-To: The Newsletter <${from}>`,
    "Feedback-ID: SYNTHETIC:newsletter",
    "List-Unsubscribe: <mailto:SYNTHETIC@lists.daily-news.example>",
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    'x-beehiiv-ids: {"campaign_id":"SYNTHETIC"}',
    "x-beehiiv-type: newsletter",
    "X-SG-EID: SYNTHETIC",
    `To: ${OWNER}`,
    "",
    "<p>Saturday 11/21 Winter Lights 12-7pm</p>",
    "",
  ].join("\r\n");

const email = (from: string): ReceivedEmail => ({
  id: "00000000-0000-4000-8000-000000000001",
  from,
  to: [OWNER],
  received_for: [INBOX],
  subject: "Synthetic issue",
  html: "<p>x</p>",
  text: "x",
  headers: { from: `The Newsletter <${from}>` },
  created_at: "2026-11-20T14:02:41.000Z",
  message_id: "<synthetic-1@mta.example>",
  authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
});

const check = async (raw: string, from: string, resolver = testResolver) => {
  const dkim = await verifyDkim(Buffer.from(raw), resolver);
  return { dkim, v: decide(email(from), parseRawHeaders(raw), cfg, dkim) };
};

describe("DKIM we verify ourselves", () => {
  it("keeps a forwarded issue shaped like the real ones", async () => {
    const daily = forwardedBy(
      OWNER,
      INBOX,
      await signed(issue(DAILY), [
        { domain: "daily-news.example", headers: H },
        { domain: "sendgrid.info", headers: H },
      ]),
    );
    const d = await check(daily, DAILY);
    expect(d.dkim.verified.map((x) => x.domain)).toEqual([
      "daily-news.example",
      "sendgrid.info",
    ]);
    expect(d.v).toMatchObject({ kind: "issue", source: "daily" });

    const weekly = forwardedBy(
      OWNER,
      INBOX,
      await signed(issue(WEEKLY), [
        { domain: "bhmta.beehiiv.com", headers: H },
        { domain: "mail.beehiiv.com", headers: H },
      ]),
    );
    expect((await check(weekly, WEEKLY)).v).toMatchObject({
      kind: "issue",
      source: "weekly",
    });
  });

  it("drops the reviewer's probe: a staff reply with a forged signature header", async () => {
    // A genuine reply from the newsletter's staff: signed, but not a
    // newsletter (no List-Unsubscribe under its signature).
    const reply = await signed(
      [
        "Date: Fri, 20 Nov 2026 14:02:38 +0000",
        `From: Staff <${DAILY}>`,
        "Subject: Re: your question",
        `To: ${OWNER}`,
        "",
        "Thanks!",
        "",
      ].join("\r\n"),
      [
        {
          domain: "daily-news.example",
          headers: ["From", "To", "Subject", "Date"],
        },
      ],
    );
    const probe = forwardedBy(
      OWNER,
      INBOX,
      [
        "DKIM-Signature: v=1; a=rsa-sha256; d=daily-news.example; s=s1; h=from:list-unsubscribe; bh=FORGED=; b=FORGED",
        "DKIM-Signature: v=1; a=rsa-sha256; d=sendgrid.info; s=s1; h=from:list-unsubscribe; bh=FORGED=; b=FORGED",
        "List-Unsubscribe: <mailto:x@unsub.beehiiv.com>",
        'X-Beehiiv-Ids: {"campaign_id":"FORGED"}',
        "X-SG-EID: FORGED",
        reply,
      ].join("\r\n"),
    );
    const r = await check(probe, DAILY);
    // Only the staff signature verifies; the forged ones don't count.
    expect(r.dkim.verified).toHaveLength(1);
    expect(r.dkim.verified[0].domain).toBe("daily-news.example");
    expect(r.dkim.verified[0].headers).not.toContain("list-unsubscribe");
    expect(r.v).toMatchObject({ kind: "drop", suspicious: true });
  });

  it("never takes a platform header signed by someone else's domain (the reviewer's probe)", async () => {
    // Genuine sender signature (List-Unsubscribe covered), plus a real,
    // verifying signature by an attacker's own domain over X-Beehiiv-Ids.
    const msg = issue(DAILY);
    const raw = forwardedBy(
      OWNER,
      INBOX,
      await signed(msg, [
        {
          domain: "daily-news.example",
          headers: ["From", "Date", "List-Unsubscribe"],
        },
        { domain: "attacker.example", headers: ["From", "x-beehiiv-ids"] },
      ]),
    );
    const dkim = await verifyDkim(Buffer.from(raw), testResolver);
    expect(dkim.verified.map((v) => v.domain).sort()).toEqual([
      "attacker.example",
      "daily-news.example",
    ]);
    const beehiiv = {
      ...cfg,
      senders: parseSenders(`daily:${DAILY}:beehiiv`),
    };
    expect(
      decide(email(DAILY), parseRawHeaders(raw), beehiiv, dkim),
    ).toMatchObject({ kind: "drop", suspicious: true });
    // The sender's own signature over it does count.
    const own = forwardedBy(
      OWNER,
      INBOX,
      await signed(msg, [
        {
          domain: "daily-news.example",
          headers: ["From", "Date", "List-Unsubscribe", "x-beehiiv-ids"],
        },
      ]),
    );
    const ownDkim = await verifyDkim(Buffer.from(own), testResolver);
    expect(
      decide(email(DAILY), parseRawHeaders(own), beehiiv, ownDkim),
    ).toMatchObject({ kind: "issue" });
  });

  describe("beehiiv's mark by its signed unsubscribe links (the real Bend Buzz shape)", () => {
    /** Signed by the sender and SendGrid; beehiiv's own headers unsigned. */
    const SIGNED = [
      "From",
      "List-Unsubscribe",
      "List-Unsubscribe-Post",
      "Feedback-ID",
      "Date",
      "Subject",
    ];
    const shaped = (unsub: string) =>
      [
        "Date: Fri, 20 Nov 2026 14:02:38 +0000",
        `From: The Daily <${DAILY}>`,
        "Subject: Synthetic issue",
        "Feedback-ID: SYNTHETIC:newsletter",
        `List-Unsubscribe: ${unsub}`,
        "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
        `To: ${OWNER}`,
        "",
        "<p>Saturday 11/21 Winter Lights 12-7pm</p>",
        "",
      ].join("\r\n");
    /** Headers added after signing (unsigned, as in the real one). */
    const unsignedMarks = [
      'x-beehiiv-ids: {"campaign_id":"SYNTHETIC"}',
      "x-beehiiv-type: newsletter",
      "X-SG-EID: SYNTHETIC",
      "X-SG-ID: SYNTHETIC",
    ].join("\r\n");
    const BEEHIIV_UNSUB =
      "<mailto:SYNTHETIC+SYNTHETIC@unsub.beehiiv.com>, <https://the-daily.beehiiv.com/unsubscribe/SYNTHETIC-TOKEN>";
    const as = (platforms: string) => ({
      ...cfg,
      senders: parseSenders(`daily:${DAILY}:${platforms}`),
    });
    const run = async (raw: string, platforms: string) => {
      const dkim = await verifyDkim(Buffer.from(raw), testResolver);
      return decide(email(DAILY), parseRawHeaders(raw), as(platforms), dkim);
    };

    it("keeps it: the sender's verified signature covers List-Unsubscribe on beehiiv.com", async () => {
      const raw = forwardedBy(
        OWNER,
        INBOX,
        `${unsignedMarks}\r\n${await signed(shaped(BEEHIIV_UNSUB), [
          { domain: "daily-news.example", headers: SIGNED },
          { domain: "sendgrid.info", headers: SIGNED },
        ])}`,
      );
      expect(await run(raw, "beehiiv")).toMatchObject({ kind: "issue" });
      expect(await run(raw, "beehiiv+sendgrid")).toMatchObject({
        kind: "issue",
      });
    });

    it("drops it when the unsubscribe links point anywhere else", async () => {
      const raw = forwardedBy(
        OWNER,
        INBOX,
        `${unsignedMarks}\r\n${await signed(
          shaped(
            "<mailto:SYNTHETIC@unsub.beehiiv.com>, <https://evil.example/unsubscribe>",
          ),
          [{ domain: "daily-news.example", headers: SIGNED }],
        )}`,
      );
      expect(await run(raw, "beehiiv")).toMatchObject({
        kind: "drop",
        suspicious: true,
      });
    });

    it("never takes an attacker's own signature over a beehiiv-pointing List-Unsubscribe", async () => {
      // The sender signed only From (a staff reply); the attacker added a
      // beehiiv-pointing List-Unsubscribe and signed it with their domain.
      const reply = await signed(shaped(BEEHIIV_UNSUB), [
        { domain: "daily-news.example", headers: ["From", "Date", "Subject"] },
        { domain: "attacker.example", headers: SIGNED },
      ]);
      const raw = forwardedBy(OWNER, INBOX, `${unsignedMarks}\r\n${reply}`);
      expect(await run(raw, "beehiiv")).toMatchObject({
        kind: "drop",
        suspicious: true,
      });
      // ...nor when the sender's signature covers a List-Unsubscribe of
      // its own and the attacker signs a second, beehiiv-pointing one.
      const own = await signed(
        shaped("<mailto:unsubscribe@daily-news.example>"),
        [{ domain: "daily-news.example", headers: SIGNED }],
      );
      const two = forwardedBy(
        OWNER,
        INBOX,
        `List-Unsubscribe: ${BEEHIIV_UNSUB}\r\n${unsignedMarks}\r\n${own}`,
      );
      expect(await run(two, "beehiiv")).toMatchObject({ kind: "drop" });
    });
  });

  it("drops an issue whose body was changed after signing", async () => {
    const raw = forwardedBy(
      OWNER,
      INBOX,
      await signed(issue(DAILY), [
        { domain: "daily-news.example", headers: H },
        { domain: "sendgrid.info", headers: H },
      ]),
    ).replace("Winter Lights", "Winter Nights");
    const r = await check(raw, DAILY);
    expect(r.dkim.verified).toEqual([]);
    expect(r.v).toMatchObject({ kind: "drop", suspicious: true });
  });

  it("never counts a signature that covers only part of the body (l=)", async () => {
    const raw = forwardedBy(
      OWNER,
      INBOX,
      await signed(issue(DAILY), [
        { domain: "daily-news.example", headers: H, maxBodyLength: 10 },
      ]),
    );
    expect((await check(raw, DAILY)).dkim.verified).toEqual([]);
  });

  it("drops for a retry when DNS is down (fail closed)", async () => {
    const raw = forwardedBy(
      OWNER,
      INBOX,
      await signed(issue(DAILY), [
        { domain: "daily-news.example", headers: H },
      ]),
    );
    const r = await check(raw, DAILY, downResolver);
    expect(r.dkim).toEqual({ verified: [], temporary: true });
    expect(r.v).toMatchObject({ kind: "drop", retry: true });
  });
});
