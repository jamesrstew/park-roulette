import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { ParkTextsCard, TextsRow } from "@/components/ParkTexts";
import { getMe } from "@/lib/data";
import { NEWS_NAME } from "@/lib/park-news";
import { prettyPhone, TEXTS_COPY, TEXTS_FROM } from "@/lib/texts";
import { sendingEnabled, textsOn } from "@/lib/texts-store";

export const metadata: Metadata = {
  title: "Weekend texts: one park pick on Fridays",
  description:
    "Get one Central Oregon playground to try, by text, every Friday afternoon. Free. Reply STOP anytime.",
  alternates: { canonical: "/texts" },
};

/** A real sample (every link answered 200 when it was written). */
const SAMPLE =
  "Park Roulette: Weekend pick: Wildflower Park, Bend. Fenced toddler area. https://parkroulette.quest/parks/wildflower-park-bend Reply STOP to opt out";

async function Optin() {
  const me = await getMe();
  const sending = sendingEnabled();
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
    />
  );
}

export default function TextsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        lead="Park"
        accent="texts"
        color="green"
        underline="orange"
        underlineWidth="w-36"
        align="left"
      />
      <Suspense fallback={<CrayonLoading label="One sec…" />}>
        <Optin />
      </Suspense>
      <section aria-labelledby="sample-h" className="flex flex-col gap-2">
        <h2 id="sample-h" className="font-hand text-2xl">
          What a text looks like
        </h2>
        <p className="text-sm text-ink-soft">
          {TEXTS_FROM
            ? `From ${prettyPhone(TEXTS_FROM)}`
            : "From our park texts number"}
        </p>
        <p className="rounded-3xl border-2 border-ink bg-[#fffdf7] px-5 py-4 leading-snug break-words">
          {SAMPLE}
        </p>
      </section>
      <p className="flex min-h-11 items-center gap-2 leading-snug">
        <Icon name="mail" size={26} />
        <span>
          Rather get email?{" "}
          <Link href="/newsletter" className="underline">
            {NEWS_NAME}
          </Link>{" "}
          comes Thursday mornings.
        </span>
      </p>
    </div>
  );
}
