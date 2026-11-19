import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { NEWS_NAME } from "@/lib/park-news";
import { subscriberForUnsubscribe } from "@/lib/news/subscribers";
import { maskEmail } from "@/lib/news/tokens";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = { title: "Stop emails", ...NOINDEX };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The unsubscribe link in every email. Opening it never unsubscribes
 * anyone (link scanners and forwarded emails open links); the "Stop
 * emails" button does, with no sign-in.
 */
async function Unsubscribe({ searchParams }: Props) {
  const sp = await searchParams;
  if (sp.done === "1")
    return (
      <Box icon="check" line="Done. No more emails from us.">
        <p className="text-sm text-ink-soft">
          Changed your mind?{" "}
          <Link href="/newsletter#signup" className="underline">
            Sign up again
          </Link>{" "}
          anytime.
        </p>
      </Box>
    );
  const t = typeof sp.t === "string" ? sp.t : "";
  const who = await subscriberForUnsubscribe(t);
  if (!who)
    return (
      <Box
        icon="mail"
        line="You're not on the list, so there's nothing to stop."
      >
        <p className="text-sm text-ink-soft">
          Still getting emails? Write to hello@parkroulette.quest and we&apos;ll
          fix it today.
        </p>
      </Box>
    );
  return (
    <form
      method="post"
      action={`/api/news/unsubscribe?t=${encodeURIComponent(t)}`}
      className="doodle-box flex flex-col items-center gap-3 px-4 py-8 text-center"
    >
      <Icon name="mail" size={56} />
      <p className="leading-snug">
        Stop {NEWS_NAME} for <b>{maskEmail(who.email)}</b>?
      </p>
      <input type="hidden" name="from" value="page" />
      <button
        type="submit"
        className="crayon-btn wax min-h-12 bg-crayon-red px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
      >
        Stop emails
      </button>
    </form>
  );
}

function Box({
  icon,
  line,
  children,
}: {
  icon: "check" | "mail";
  line: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="doodle-box flex flex-col items-center gap-3 px-4 py-8 text-center">
      <Icon name={icon} size={56} />
      <p className="font-hand text-2xl">{line}</p>
      {children}
      <Link
        href="/"
        className="crayon-btn wax min-h-12 bg-crayon-yellow px-5 text-xl"
      >
        Spin for a park
      </Link>
    </div>
  );
}

export default function UnsubscribePage(props: Props) {
  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        lead="Stop"
        accent="emails"
        color="red"
        underline="yellow"
        underlineWidth="w-32"
      />
      <Suspense fallback={<CrayonLoading label="Finding your email…" />}>
        <Unsubscribe {...props} />
      </Suspense>
    </div>
  );
}
