import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { SpinScreen } from "@/components/SpinScreen";
import { WelcomeSheet } from "@/components/WelcomeSheet";
import { getBucketList, getMe } from "@/lib/data";

async function Spin() {
  const me = await getMe();
  const parks = await getBucketList(me?.crew.id ?? null);
  return (
    <>
      <SpinScreen parks={parks} signedIn={!!me} />
      {me ? (
        <WelcomeSheet
          name={me.name}
          avatar={me.avatar}
          color={me.color}
          crewName={me.crew.name}
          crewLink={`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/join/${me.crew.joinCode}`}
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
