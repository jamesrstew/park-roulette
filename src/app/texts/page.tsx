import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { ParkTextsCard, TextsRow } from "@/components/ParkTexts";
import { getMe } from "@/lib/data";
import { NEWS_NAME } from "@/lib/park-news";
import { TEXTS_COPY, TEXTS_FROM } from "@/lib/texts";
import { confirmationsEnabled, textsOn } from "@/lib/texts-store";

export const metadata: Metadata = {
  title: "Weekend Pick: a playground pick, texted Fridays",
  description:
    "Get one Central Oregon playground to try, by text, every Friday afternoon. Free. Reply STOP anytime.",
  alternates: { canonical: "/texts" },
};

/** The card is named by the page's H1 (its own heading was cut). */
const HEADING_ID = "weekend-pick-h";

async function Optin() {
  const me = await getMe();
  const sending = confirmationsEnabled();
  if (me?.isKid)
    return (
      <p className="doodle-box-alt px-4 py-4 font-hand text-2xl leading-snug">
        {TEXTS_COPY.kids}
      </p>
    );
  if (me && !me.trusted) {
    const on = me.phone ? await textsOn(me.phone) : false;
    return on ? (
      <TextsRow
        state="on"
        number={me.phone}
        sendingOn={sending}
        textsFrom={TEXTS_FROM}
      />
    ) : (
      <p className="doodle-box-alt px-4 py-4 leading-snug">
        {TEXTS_COPY.borrowed}
      </p>
    );
  }
  if (me?.phone && (await textsOn(me.phone)))
    return (
      <div className="doodle-box-alt px-4 py-4">
        <TextsRow
          state="on"
          number={me.phone}
          sendingOn={sending}
          textsFrom={TEXTS_FROM}
        />
      </div>
    );
  // Signed out, or no number on the account: type one in, then a code.
  return (
    <ParkTextsCard
      number={me?.phone ?? null}
      source="texts_page"
      sendingOn={sending}
      textsFrom={TEXTS_FROM}
      labelledBy={HEADING_ID}
      showSample
    />
  );
}

export default function TextsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        id={HEADING_ID}
        lead="Weekend"
        accent="Pick"
        color="green"
        underline="orange"
        underlineWidth="w-40"
        subtitle={<p>{TEXTS_COPY.subtitle}</p>}
      />
      <Suspense fallback={<CrayonLoading label="One sec…" />}>
        <Optin />
      </Suspense>
      <p className="flex min-h-11 items-center gap-2 leading-snug">
        <Icon name="mail" size={26} />
        <span>
          Prefer email?{" "}
          <Link href="/newsletter" className="underline">
            {NEWS_NAME}
          </Link>
        </span>
      </p>
    </div>
  );
}
