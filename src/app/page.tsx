import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { AppMoments } from "@/components/AppMoments";
import { PhoneNudge } from "@/components/PhoneNudge";
import { SpinScreen } from "@/components/SpinScreen";
import { WelcomeSheet } from "@/components/WelcomeSheet";
import { getBucketList, getMe } from "@/lib/data";

async function Spin() {
  const me = await getMe();
  const parks = await getBucketList(me?.crew.id ?? null);
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
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<CrayonLoading />}>
      <Spin />
    </Suspense>
  );
}
