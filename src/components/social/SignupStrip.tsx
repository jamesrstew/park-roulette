import { connection } from "next/server";
import { Icon } from "@/components/icons";
import { EmailSignup } from "@/components/ParkNews";
import { getMe } from "@/lib/data";
import { nextIssueDate } from "@/lib/news/data";
import { subscriptionFor } from "@/lib/news/subscribers";
import { PARK_NEWS } from "@/lib/park-news";
import { igSource } from "@/lib/social/model";

/** "Thursday, Nov 26" */
function thursdayLine(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * The slim signup on /social and its post pages (what /ig used to be):
 * the email field and button on one line, the visit's source on it
 * (?from=ig, ig_dm or fb). Someone already on the list gets one line.
 */
export async function SignupStrip({
  from,
  pitch = null,
}: {
  from: string | string[] | undefined;
  /** A line under the heading (post pages); the grid keeps it to one line. */
  pitch?: string | null;
}) {
  await connection(); // the date and the visitor matter here
  const source = igSource(from);
  const [me, next] = await Promise.all([getMe(), nextIssueDate()]);
  const emailOn = me ? (await subscriptionFor(me.id)).status === "on" : false;
  if (emailOn)
    return (
      <p className="flex items-center gap-2 font-hand text-xl leading-snug">
        <Icon name="mail" size={28} /> You get our Thursday email. See you{" "}
        {thursdayLine(next).split(",")[0]}!
      </p>
    );
  return (
    <section
      aria-labelledby="strip-h"
      className="doodle-box-alt flex flex-col gap-1.5 px-3 py-3"
    >
      <h2
        id="strip-h"
        className="flex items-center gap-2 font-hand text-2xl leading-none"
      >
        <Icon name="mail" size={26} /> Free picks every Thursday
      </h2>
      {pitch ? (
        <p className="text-sm leading-snug">
          {pitch} Next one: {thursdayLine(next)}.
        </p>
      ) : null}
      <EmailSignup source={source} fine={PARK_NEWS.fineFull} inline compact />
    </section>
  );
}
