import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { EmailSignup } from "@/components/ParkNews";
import { ParkTextsCard } from "@/components/ParkTexts";
import { getMe } from "@/lib/data";
import { nextIssueDate, sentIssues } from "@/lib/news/data";
import { subscriptionFor } from "@/lib/news/subscribers";
import { PARK_NEWS } from "@/lib/park-news";
import { textsAvailable } from "@/lib/signup-core";
import { NOINDEX } from "@/lib/site";
import { igSource } from "@/lib/social/model";
import { TEXTS_FROM } from "@/lib/texts";
import { confirmationsEnabled, textsOn } from "@/lib/texts-store";

/**
 * Instagram's link in bio (parkroulette.quest/ig?from=ig), the keyword
 * DM's link (?from=ig_dm) and Facebook's (?from=fb). Deliberately thin:
 * the email signup and the Weekend Pick card are the shared components
 * (being redesigned on another branch), with the visit's source on them.
 */

export const metadata: Metadata = {
  title: "Free park picks for Central Oregon kids",
  description:
    "The weekend forecast plus one great plan, every Thursday. Free, from a Bend family.",
  alternates: { canonical: "/ig" },
  ...NOINDEX,
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** "Thursday, November 26" */
function thursdayLine(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

async function Signup({ searchParams }: Props) {
  const from = (await searchParams).from;
  const source = igSource(from);
  const [me, next, latest] = await Promise.all([
    getMe(),
    nextIssueDate(),
    sentIssues(1),
  ]);
  const emailOn = me ? (await subscriptionFor(me.id)).status === "on" : false;
  const textsAlready = me?.phone ? await textsOn(me.phone) : false;
  const textsLive = await textsAvailable();
  return (
    <>
      <section
        aria-labelledby="ig-email-h"
        className="doodle-box-alt flex flex-col gap-2 px-4 py-4"
      >
        <h2
          id="ig-email-h"
          className="flex items-center gap-2 font-hand text-3xl leading-tight"
        >
          <Icon name="mail" size={32} /> Every Thursday
        </h2>
        {emailOn ? (
          <p className="leading-snug">You already get it. See you Thursday!</p>
        ) : (
          <>
            <p className="-mt-1 leading-snug">
              {PARK_NEWS.pitch} Next one: {thursdayLine(next)}.
            </p>
            <EmailSignup source={source} fine={PARK_NEWS.fineFull} />
          </>
        )}
      </section>
      {me?.isKid || textsAlready || !textsLive ? null : me && !me.trusted ? (
        <p className="leading-snug">
          Want the Weekend Pick by text?{" "}
          <Link href="/texts" className="underline">
            Turn it on here
          </Link>
          .
        </p>
      ) : (
        <ParkTextsCard
          number={me?.phone ?? null}
          source={source}
          sendingOn={confirmationsEnabled()}
          textsFrom={TEXTS_FROM}
        />
      )}
      {latest[0] ? (
        <Link
          href={`/newsletter/${latest[0].issueDate}`}
          className="flex min-h-11 items-center gap-2 font-hand text-2xl underline"
        >
          <Icon name="book" size={28} /> See this week&apos;s issue
        </Link>
      ) : null}
    </>
  );
}

export default function IgPage({ searchParams }: Props) {
  return (
    <div className="flex flex-col gap-6 pb-32">
      <PageTitle
        lead="Free"
        accent="park picks"
        color="orange"
        underline="blue"
        subtitle={
          <p>For Central Oregon kids, matched to the weekend weather.</p>
        }
      />
      <Suspense fallback={<CrayonLoading label="One sec…" />}>
        <Signup searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
