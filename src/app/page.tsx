import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { AppMoments } from "@/components/AppMoments";
import { PhoneNudge } from "@/components/PhoneNudge";
import { SpinScreen } from "@/components/SpinScreen";
import { WelcomeSheet } from "@/components/WelcomeSheet";
import type { Metadata } from "next";
import { GuideLinks } from "@/components/seo/GuideLinks";
import { JsonLd } from "@/components/seo/JsonLd";
import { getBucketList, getMe } from "@/lib/data";
import { publicParks } from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "Park Roulette: find a playground in Central Oregon" },
  description:
    "A free game and guide to 100+ playgrounds and parks in Bend, Redmond, Sisters, Prineville and nearby. Spin for a park, see splash pads, toddler areas and ratings from local families.",
  alternates: { canonical: "/" },
};

async function Spin() {
  const me = await getMe();
  const [parks, all] = await Promise.all([getBucketList(me), publicParks()]);
  return (
    <>
      <AppMoments signedIn={!!me} />
      <SpinScreen parks={parks} signedIn={!!me} />
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
