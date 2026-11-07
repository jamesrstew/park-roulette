import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { Icon } from "@/components/icons";
import { SmudgedCrayon } from "@/components/me/Doodles";
import { JoinScreen } from "@/components/me/JoinScreen";
import { findCrewByCode, getMe } from "@/lib/data";

export const metadata: Metadata = {
  title: "You're invited!",
  description:
    "Come play! Join the quest to visit every playground in Central Oregon.",
};

async function Join({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [found, me] = await Promise.all([
    findCrewByCode(decodeURIComponent(code).trim().toLowerCase()),
    getMe(),
  ]);

  if (!found) return <Smudged />;

  const members = [...found.members]
    .sort((a, b) => a.id - b.id)
    .map((m) => ({ id: m.id, name: m.name, color: m.color, avatar: m.avatar }));

  return (
    <JoinScreen
      kind={found.kind}
      code={found.kind === "join" ? found.crew.joinCode : found.crew.friendCode}
      crewName={found.crew.name}
      crewColor={found.crew.color}
      members={members}
      me={me ? { id: me.id, name: me.name, crewName: me.crew.name } : null}
    />
  );
}

function Smudged() {
  return (
    <div className="flex flex-col items-center gap-4 pt-10 text-center">
      <SmudgedCrayon className="w-60 animate-pop-in" />
      <h1 className="font-sketch text-4xl font-bold">Oops, smudged!</h1>
      <p className="max-w-xs text-lg leading-snug">
        This invite link got a little smudged. Ask whoever sent it for a fresh
        one.
      </p>
      <div className="mt-4 flex w-full max-w-xs flex-col gap-3">
        <Link href="/" className="crayon-btn wax bg-crayon-yellow">
          Spin the wheel anyway <Icon name="spin" size={28} />
        </Link>
        <Link href="/me" className="crayon-btn bg-[#fffdf7] text-xl">
          What&apos;s Park Roulette?
        </Link>
      </div>
    </div>
  );
}

export default function JoinPage({ params }: PageProps<"/join/[code]">) {
  return (
    <Suspense fallback={<CrayonLoading label="Opening your invite…" />}>
      <Join params={params} />
    </Suspense>
  );
}
