import { connection } from "next/server";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { AppMoments } from "@/components/AppMoments";
import { PhoneNudge } from "@/components/PhoneNudge";
import { SpinScreen } from "@/components/SpinScreen";
import { WelcomeSheet } from "@/components/WelcomeSheet";
import type { Metadata } from "next";
import { GuideLinks } from "@/components/seo/GuideLinks";
import { JsonLd } from "@/components/seo/JsonLd";
import type { AskServer } from "@/components/AskRow";
import { ASK_LAUNCH, type Wet, wetFrom } from "@/lib/asks";
import {
  getBucketList,
  getMe,
  lastStamp,
  type Me,
  phoneFresh,
} from "@/lib/data";
import {
  FORECAST_TOWNS,
  townForecast,
  weatherFor,
} from "@/lib/events/forecast";
import { subscriptionFor } from "@/lib/news/subscribers";
import { addDays, pacific } from "@/lib/news/time";
import { publicParks } from "@/lib/seo-data";
import { readOn } from "@/lib/on-cookie";
import { textsAvailable as textsAvailableNow } from "@/lib/signup-core";
import { SITE_URL } from "@/lib/site";
import { TEXTS_FROM } from "@/lib/texts";
import { confirmationsEnabled, textsOn } from "@/lib/texts-store";

export const metadata: Metadata = {
  title: { absolute: "Park Roulette: find a playground in Central Oregon" },
  description:
    "A free game and guide to 100+ playgrounds and parks in Bend, Redmond, Sisters, Prineville and nearby. Spin for a park, see splash pads, toddler areas and ratings from local families.",
  alternates: { canonical: "/" },
};

/** The ask moments' facts for this visitor (lib/asks.ts). */
async function askFacts(me: Me | null): Promise<AskServer> {
  // Texts are offered only when the Friday text really goes to families
  // (the same gate as the picks page and the footer).
  const [textsAvailable, here] = await Promise.all([
    textsAvailableNow(),
    readOn(),
  ]);
  const base = {
    isKid: !!me?.isKid,
    borrowed: !!me && !me.trusted,
    textsAvailable,
    textsSendingOn: confirmationsEnabled(),
    textsFrom: TEXTS_FROM,
    device: { email: here.email, text: here.texts },
  };
  if (!me || me.isKid || !me.trusted)
    return {
      ...base,
      signedIn: !!me,
      lastStamp: null,
      phone: null,
      phoneFresh: false,
    };
  const [stamp, sub, on, fresh] = await Promise.all([
    lastStamp(me.crew.id),
    subscriptionFor(me.id),
    me.phone ? textsOn(me.phone) : false,
    me.phone ? phoneFresh(me.id) : false,
  ]);
  return {
    ...base,
    signedIn: true,
    lastStamp: stamp,
    phone: me.phone,
    phoneFresh: fresh,
    account: {
      emailOn: sub.status !== "off",
      textsOn: on,
      emailNo: me.picksEmailDeclined,
      textNo: me.picksTextDeclined,
      // An onboarding "Not now" from before the asks launched counts as one
      // ignored Moment 1 (only while the email is off).
      legacyIgnored:
        !!me.parkNewsAskedAt &&
        pacific(new Date(me.parkNewsAskedAt)).date < ASK_LAUNCH &&
        sub.status === "off",
    },
  };
}

/**
 * Monday to Wednesday (Pacific) only: the coming Saturday's or Sunday's
 * wet day per town, from the NWS forecast (cached an hour). Streamed: the
 * page never waits for it (SpinScreen reads it under its own Suspense),
 * and it gives up after 2.5 seconds.
 */
async function wetWeekend(): Promise<Record<string, Wet | null>> {
  // Today's date: request time, never a prerender.
  await connection();
  const now = new Date();
  const p = pacific(now);
  if (p.weekday < 1 || p.weekday > 3) return {};
  const sat = addDays(p.date, 6 - p.weekday);
  const sun = addDays(sat, 1);
  const work = Promise.all(
    Object.keys(FORECAST_TOWNS).map(async (town) => {
      const f = await townForecast(town);
      if (!f) return [town, undefined] as const;
      const pop = (day: string) =>
        f.daily.find((x) => x.isDaytime && x.startTime.slice(0, 10) === day)
          ?.probabilityOfPrecipitation?.value ?? null;
      return [
        town,
        wetFrom([
          {
            day: "Saturday",
            w: weatherFor(f, town, sat, undefined, "Saturday", null),
            pop: pop(sat),
          },
          {
            day: "Sunday",
            w: weatherFor(f, town, sun, undefined, "Sunday", null),
            pop: pop(sun),
          },
        ]),
      ] as const;
    }),
  ).then((rows) => {
    const out: Record<string, Wet | null> = {};
    for (const [town, w] of rows) if (w !== undefined) out[town] = w;
    return out;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Record<string, Wet | null>>((r) => {
    timer = setTimeout(() => r({}), 2500);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function Spin() {
  const me = await getMe();
  const [parks, all, asks] = await Promise.all([
    getBucketList(me),
    publicParks(),
    askFacts(me),
  ]);
  // Only when the rain ask could show: not for kids or borrowed links, and
  // not when the account already gets the email or said no to it.
  const a = asks.account;
  const wet =
    asks.isKid ||
    asks.borrowed ||
    a?.emailOn ||
    a?.emailNo ||
    asks.device?.email
      ? Promise.resolve({})
      : wetWeekend();
  return (
    <>
      <AppMoments signedIn={!!me} />
      <SpinScreen parks={parks} signedIn={!!me} asks={asks} wet={wet} />
      {me && !me.phone && me.trusted ? <PhoneNudge /> : null}
      {me ? (
        <WelcomeSheet
          name={me.name}
          avatar={me.avatar}
          color={me.color}
          crewName={me.crew.name}
          crewLink={`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/join/${me.crew.joinCode}`}
          hasPhone={!!me.phone}
        />
      ) : null}
      <GuideLinks parks={all} />
    </>
  );
}

export default function Home() {
  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": `${SITE_URL}/#website`,
            name: "Park Roulette",
            url: SITE_URL,
            description:
              "A free game and guide for visiting every playground in Central Oregon.",
            publisher: { "@id": `${SITE_URL}/#org` },
            inLanguage: "en-US",
          },
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            "@id": `${SITE_URL}/#org`,
            name: "Park Roulette",
            legalName: "True Craft Ventures LLC",
            url: SITE_URL,
            email: "hello@parkroulette.quest",
            logo: `${SITE_URL}/icon/512`,
            areaServed: "Central Oregon",
          },
        ]}
      />
      <Suspense fallback={<CrayonLoading />}>
        <Spin />
      </Suspense>
    </>
  );
}
