import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { NEWS_NAME } from "@/lib/park-news";
import { NOINDEX } from "@/lib/site";
import { nextIssueDate } from "@/lib/news/data";
import { getMe } from "@/lib/data";
import { confirmationPurpose, subscriptionFor } from "@/lib/news/subscribers";

export const metadata: Metadata = { title: "Confirm your email", ...NOINDEX };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const RESULTS = {
  confirmed: {
    icon: "party",
    line: "You're on the list!",
  },
  already: {
    icon: "check",
    line: "You're already confirmed. See you Thursday.",
  },
  expired: {
    icon: "calendar",
    line: "That link ran out. Sign up again for a fresh one: it only takes a second.",
  },
  invalid: {
    icon: "warning",
    line: "That link doesn't work anymore. Your email may have changed since we sent it.",
  },
} as const;

/**
 * The link in the confirmation email lands here. Opening it changes
 * nothing (mail scanners open links too); the button does.
 */
async function Confirm({ searchParams }: Props) {
  await connection(); // the date and time matter here
  const sp = await searchParams;
  const r = typeof sp.r === "string" ? sp.r : null;
  const t = typeof sp.t === "string" ? sp.t : "";
  if (r && r in RESULTS) {
    const res = RESULTS[r as keyof typeof RESULTS];
    const ok = r === "confirmed" || r === "already";
    // The first issue's real date (not "Thursday morning": confirming after
    // a Thursday send, or in a skipped week, would make that wrong).
    const first = ok ? await nextIssueDate() : null;
    // From the account, not the URL: a signed-in grown-up whose email is on.
    const me = ok ? await getMe() : null;
    const family =
      !!me && !me.isKid && (await subscriptionFor(me.id)).status === "on";
    return (
      <div className="doodle-box flex flex-col items-center gap-3 px-4 py-8 text-center">
        <Icon name={res.icon} size={56} />
        <p className="font-hand text-3xl">{res.line}</p>
        {first ? (
          <p className="leading-snug">
            {r === "confirmed"
              ? "Your first issue comes"
              : "Your next issue comes"}{" "}
            <b>
              {new Date(`${first}T12:00:00Z`).toLocaleDateString("en-US", {
                timeZone: "UTC",
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </b>
            .
          </p>
        ) : r === "expired" ? (
          <Link href="/newsletter#signup" className="underline">
            Sign up again
          </Link>
        ) : null}
        {ok && family ? (
          <p className="leading-snug">
            <b>It&apos;s connected to your family.</b> Manage it in Family &amp;
            settings.
          </p>
        ) : null}
        <Link
          href="/"
          className="crayon-btn wax min-h-12 bg-crayon-yellow px-5 text-xl"
        >
          Spin for a playground
        </Link>
        {ok ? (
          <Link href="/texts" className="min-h-11 text-sm underline">
            Want a weekend park pick by text too?
          </Link>
        ) : null}
      </div>
    );
  }
  // A "link" confirmation connects an address to a family account; say so.
  const linking = (await confirmationPurpose(t)) === "link";
  return (
    <form
      method="post"
      action="/api/news/confirm"
      className="doodle-box flex flex-col items-center gap-3 px-4 py-8 text-center"
    >
      <Icon name="mail" size={56} />
      <p className="leading-snug">
        {linking
          ? `Connect this email to the Park Roulette family account that asked. ${NEWS_NAME} then shows in that account's Family & settings.`
          : "Weekly park picks for the forecast, closures and indoor backups, every Thursday morning. Unsubscribe anytime."}
      </p>
      <input type="hidden" name="t" value={t} />
      <button
        type="submit"
        className="crayon-btn wax min-h-12 bg-crayon-blue px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
      >
        {linking ? "Connect it to my family" : "Yes, send me park picks"}
      </button>
    </form>
  );
}

export default function ConfirmPage(props: Props) {
  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        lead="One"
        accent="tap"
        trail=" left"
        color="blue"
        underline="yellow"
        underlineWidth="w-32"
        subtitle={<p>{NEWS_NAME}</p>}
      />
      <Suspense fallback={<CrayonLoading label="Checking your link…" />}>
        <Confirm {...props} />
      </Suspense>
    </div>
  );
}
