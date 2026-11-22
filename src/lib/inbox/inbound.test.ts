import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type InboxConfig, parseSenders, type ReceivedEmail } from "./accept";
import {
  downResolver,
  forwardedBy,
  signed,
  testResolver,
} from "./dkim.testkit";

/**
 * One email.received delivery, end to end with Resend and the database
 * stubbed: a newsletter is cleaned and stored (at most 2 per source a
 * day), Gmail's confirmation code goes to the owner only when the owner's
 * account asked, anything else is dropped (spoofs with one alert), and a
 * failed read asks Resend to retry. All names and tokens are synthetic.
 */
type Saved = Record<string, unknown>;
const saved: Saved[] = [];
let recentCount = 0;
const alerts: { key: string; subject: string; text: string }[] = [];
const tempFails = new Map<string, number>();
vi.mock("./store", () => ({
  MAX_PER_DAY: 2,
  tempFailCount: async (id: string) => {
    tempFails.set(id, (tempFails.get(id) ?? 0) + 1);
    return tempFails.get(id)!;
  },
  saveIssue: async (i: Saved, opts: { maxPerDay?: number } = {}) => {
    if (saved.some((s) => s.source === i.source && s.messageId === i.messageId))
      return { saved: false, why: "duplicate" };
    if (opts.maxPerDay != null && recentCount >= opts.maxPerDay)
      return { saved: false, why: "over_limit" };
    saved.push(i);
    recentCount++;
    return { saved: true, id: saved.length };
  },
}));
vi.mock("@/lib/alerts", () => ({
  alertLater: (a: { key: string; subject: string; text: string }) =>
    alerts.push(a),
}));

const INBOX = "issues-test@in.example.org";
const OWNER = "owner@gmail.com";
const FROM = "hello@daily-news.example";
const cfg: InboxConfig = {
  address: INBOX,
  forwarder: OWNER,
  senders: parseSenders(`daily:${FROM}:sendgrid`),
};
const ID = "00000000-0000-4000-8000-000000000001";
const RAW_URL = "https://d1example.cloudfront.net/raw/SYNTHETIC?sig=x";

/** A signed message forwarded by the owner's Gmail (real DKIM, test key). */
async function rawFor(from: string, extra = ""): Promise<string> {
  const domain = from.match(/@([^>]+)>?$/)![1];
  const msg = [
    "Date: Fri, 20 Nov 2026 14:02:38 +0000",
    `From: ${from}`,
    "Subject: Synthetic issue",
    "List-Unsubscribe: <mailto:unsub-SYNTHETIC@unsub.beehiiv.com>",
    ...(extra ? [extra] : []),
    `To: ${OWNER}`,
    "",
    "<p>body</p>",
    "",
  ].join("\r\n");
  const H = ["From", "Date", "Subject", "List-Unsubscribe", "To"];
  return forwardedBy(
    OWNER,
    INBOX,
    await signed(msg, [
      { domain, headers: H },
      ...(domain === "google.com"
        ? []
        : [{ domain: "sendgrid.info", headers: H }]),
    ]),
  );
}
let DAILY_RAW = "";
let EVIL_RAW = "";
let GMAIL_RAW = "";
beforeAll(async () => {
  DAILY_RAW = await rawFor(`The Daily <${FROM}>`);
  EVIL_RAW = await EVIL_RAW;
  GMAIL_RAW = await rawFor("Gmail Team <forwarding-noreply@google.com>");
});

const email = (over: Partial<ReceivedEmail> = {}): ReceivedEmail => ({
  id: ID,
  from: FROM,
  to: [OWNER],
  received_for: [INBOX],
  subject: "Synthetic issue",
  html: '<p>Hi Pat, <a href="https://t.example.net/r?url=https%3A%2F%2Fexample-parks.org%2Fx">Go</a> from o.w.n.e.r+n@gmail.com</p><img src="https://x.example.com/open.gif" width="1" height="1">',
  text: "Hi",
  headers: {
    from: `The Daily <${FROM}>`,
    date: "Fri, 20 Nov 2026 14:02:38 +0000",
  },
  created_at: "2026-11-20T14:02:41.000Z",
  message_id: "<synthetic@mta.example>",
  authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
  raw: { download_url: RAW_URL, expires_at: "2026-11-20T15:02:41.000Z" },
  ...over,
});

const resend =
  (
    e: ReceivedEmail | null,
    raw?: string,
    status = 200,
    rawStatus = 200,
  ): typeof fetch =>
  async (input) => {
    const u = String(input);
    if (u === RAW_URL)
      return new Response(raw ?? DAILY_RAW, { status: rawStatus });
    expect(u).toBe(
      `https://api.resend.com/emails/receiving/${ID}?html_format=cid`,
    );
    return new Response(JSON.stringify(e ?? { name: "not_found" }), {
      status,
    });
  };

beforeEach(() => {
  saved.length = 0;
  alerts.length = 0;
  recentCount = 0;
  process.env.RESEND_INBOUND_API_KEY = "re_SYNTHETIC";
  process.env.INBOX_GREETING_NAMES = "Pat";
});

describe("handleReceived", () => {
  it("stores a newsletter issue, cleaned and scrubbed, once", async () => {
    const { handleReceived } = await import("./inbound");
    const r = await handleReceived(ID, resend(email()), cfg, testResolver);
    expect(r).toMatchObject({ status: 200, outcome: "stored" });
    expect(saved[0]).toMatchObject({
      source: "daily",
      messageId: "<synthetic@mta.example>",
      links: [{ text: "Go", url: "https://example-parks.org/x" }],
    });
    expect(saved[0].text).toBe("Hi there, Go from [subscriber]");
    expect((saved[0].sentAt as Date).toISOString()).toBe(
      "2026-11-20T14:02:38.000Z",
    );
    expect(
      await handleReceived(ID, resend(email()), cfg, testResolver),
    ).toMatchObject({
      outcome: "duplicate",
    });
    expect(saved).toHaveLength(1);
    expect(alerts).toEqual([]);
  });

  it("drops a third issue from one source in a day, and alerts", async () => {
    const { handleReceived } = await import("./inbound");
    for (const n of [1, 2, 3])
      await handleReceived(
        ID,
        resend(email({ message_id: `<m${n}@mta.example>` })),
        cfg,
        testResolver,
      );
    expect(saved).toHaveLength(2);
    expect(alerts.map((a) => a.key)).toEqual(["inbox:volume"]);
  });

  it("drops a spoof, stores nothing, and alerts", async () => {
    const { handleReceived } = await import("./inbound");
    const r = await handleReceived(
      ID,
      resend(email({ authentication: { dkim: "fail", dmarc: "fail" } })),
      cfg,
      testResolver,
    );
    expect(r).toMatchObject({ status: 200, outcome: "dropped" });
    expect(saved).toEqual([]);
    expect(alerts.map((a) => a.key)).toEqual(["inbox:suspicious"]);
  });

  it("drops two From headers in the raw message", async () => {
    const { handleReceived } = await import("./inbound");
    const r = await handleReceived(
      ID,
      resend(email(), EVIL_RAW),
      cfg,
      testResolver,
    );
    expect(r.outcome).toBe("dropped");
    expect(saved).toEqual([]);
  });

  it("fails closed without INBOX_FORWARDER, with a setup alert", async () => {
    const { handleReceived } = await import("./inbound");
    const r = await handleReceived(
      ID,
      resend(email()),
      {
        ...cfg,
        forwarder: undefined,
      },
      testResolver,
    );
    expect(r.outcome).toBe("dropped");
    expect(alerts.map((a) => a.key)).toEqual(["inbox:setup"]);
  });

  it("drops html over 1 MB, and cuts text at 200 KB", async () => {
    const { handleReceived } = await import("./inbound");
    const big = `<p>${"x".repeat(1024 * 1024 + 1)}</p>`;
    expect(
      (
        await handleReceived(
          ID,
          resend(email({ html: big })),
          cfg,
          testResolver,
        )
      ).outcome,
    ).toBe("dropped");
    const long = `<p>${"word ".repeat(60_000)}</p>`;
    await handleReceived(ID, resend(email({ html: long })), cfg, testResolver);
    expect((saved[0].text as string).length).toBe(200 * 1024);
  });

  const gmail = (requester: string) =>
    email({
      from: "forwarding-noreply@google.com",
      subject: `(#123456789) Gmail Forwarding Confirmation - Receive Mail from ${requester}`,
      html: null,
      text: "Confirmation code: 123456789\nhttps://mail-settings.google.com/mail/vf-%5BSYNTHETIC%5D-x",
      headers: { from: "Gmail Team <forwarding-noreply@google.com>" },
      message_id: `<g-${requester}@google.com>`,
    });
  const graw = () => GMAIL_RAW;

  it("emails the owner Gmail's code when the owner's account asked", async () => {
    const { handleReceived } = await import("./inbound");
    const r = await handleReceived(
      ID,
      resend(gmail(OWNER), graw()),
      cfg,
      testResolver,
    );
    expect(r.outcome).toBe("forwarding");
    expect(saved[0]).toMatchObject({ source: "gmail-forwarding" });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe("inbox:gmail-forwarding");
    expect(alerts[0].text).toContain("Confirmation code: 123456789");
    expect(alerts[0].text).toContain(
      "https://mail-settings.google.com/mail/vf-%5BSYNTHETIC%5D-x",
    );
    expect(alerts[0].text).not.toContain(OWNER);
  });

  it("only warns, without the code or link, when another account asked", async () => {
    const { handleReceived } = await import("./inbound");
    await handleReceived(
      ID,
      resend(gmail("stranger@gmail.com"), graw()),
      cfg,
      testResolver,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe("inbox:gmail-forwarding");
    expect(alerts[0].text).not.toMatch(/123456789|mail-settings|stranger/);
    expect(saved[0].text).not.toMatch(/123456789|mail-settings/);
  });

  it("asks Resend to retry when it can't read the email or its raw message", async () => {
    const { handleReceived } = await import("./inbound");
    expect(
      await handleReceived(ID, resend(null, "", 500), cfg, testResolver),
    ).toMatchObject({
      status: 502,
      outcome: "failed",
    });
    expect(
      await handleReceived(
        ID,
        resend(email(), "", 200, 503),
        cfg,
        testResolver,
      ),
    ).toMatchObject({ status: 502 });
    expect(alerts.map((a) => a.key)).toContain("inbox:fetch-failed");
    delete process.env.RESEND_INBOUND_API_KEY;
    expect(
      (await handleReceived(ID, resend(email()), cfg, testResolver)).status,
    ).toBe(502);
  });

  it("answers 503 while DNS is down, and alerts past 3 tries for one email", async () => {
    tempFails.clear();
    const { handleReceived } = await import("./inbound");
    for (let i = 1; i <= 3; i++)
      expect(
        await handleReceived(ID, resend(email()), cfg, downResolver),
      ).toMatchObject({ status: 503, outcome: "failed" });
    expect(alerts).toEqual([]);
    await handleReceived(ID, resend(email()), cfg, downResolver);
    expect(alerts.map((a) => a.key)).toEqual(["inbox:tempfail"]);
    expect(saved).toEqual([]);
  });

  it("never fetches a raw link off Resend's hosts, or a raw message over 1 MB", async () => {
    const { handleReceived } = await import("./inbound");
    const off = email({
      raw: { download_url: "https://evil.example.com/raw" },
    });
    expect(
      (await handleReceived(ID, resend(off), cfg, testResolver)).outcome,
    ).toBe("dropped");
    const huge = DAILY_RAW + "x".repeat(1024 * 1024);
    expect(
      (await handleReceived(ID, resend(email(), huge), cfg, testResolver))
        .outcome,
    ).toBe("dropped");
    expect(saved).toEqual([]);
  });
});
