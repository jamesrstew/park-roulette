import type { Metadata } from "next";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { Icon } from "@/components/icons";
import { HomeScreenTip } from "@/components/me/HomeScreenTip";
import { AvatarBlob } from "@/components/me/NameTag";
import { ProfileCard } from "@/components/me/ProfileCard";
import { ShareCard } from "@/components/me/ShareCard";
import { SignedOutIntro } from "@/components/me/SignedOutIntro";
import { SignOutButton } from "@/components/me/SignOutButton";
import { SoundBox } from "@/components/me/SoundBox";
import { PageTitle } from "@/components/PageTitle";
import { CRAYON_NAMES, type CrayonName } from "@/lib/crayons";

import { getMe } from "@/lib/data";
import { getCrewMembers, getCrewStampCount } from "@/lib/data-me";

/** Light crayons (yellow, orange) are too pale for a title on paper. */
function titleCrayon(c: string): CrayonName {
  if (!(CRAYON_NAMES as string[]).includes(c)) return "purple";
  return c === "yellow" || c === "orange" ? "purple" : (c as CrayonName);
}

export const metadata: Metadata = { title: "Me" };

async function MeScreen() {
  const me = await getMe();
  if (!me) return <SignedOutIntro />;
  const [members, stamps] = await Promise.all([
    getCrewMembers(me.crew.id),
    getCrewStampCount(me.crew.id),
  ]);

  return (
    <div className="flex flex-col gap-7 pt-2">
      <PageTitle
        lead="Hi,"
        accent={me.name}
        trail="!"
        color={titleCrayon(me.color)}
        underline={me.color === "pink" ? "yellow" : "pink"}
        underlineWidth="w-44"
        subtitle={<p>Explorer with {me.crew.name}</p>}
      />

      <ProfileCard
        initial={{
          name: me.name,
          color: me.color,
          avatar: me.avatar,
          crewName: me.crew.name,
        }}
      />

      <section aria-labelledby="crew-h">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="crew-h" className="text-3xl">
            {me.crew.name}
          </h2>
          <span className="chip shrink-0">
            <Icon name="stamp" size={22} /> {stamps}{" "}
            {stamps === 1 ? "park" : "parks"}
          </span>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-3">
          {members.map((m) => (
            <li key={m.id} className="flex w-20 flex-col items-center gap-1">
              <AvatarBlob avatar={m.avatar} color={m.color} />
              <span className="max-w-full truncate font-hand text-xl leading-none">
                {m.id === me.id ? "You" : m.name}
              </span>
              <span className="text-xs text-ink-soft">
                {m.reviewCount} {m.reviewCount === 1 ? "review" : "reviews"}
              </span>
            </li>
          ))}
          <li className="flex w-20 flex-col items-center gap-1">
            <a
              href="#add-crew"
              aria-label="Add someone to our crew"
              className="grid size-14 place-items-center rounded-[var(--radius-blob)] border-[2.5px] border-dashed border-ink-soft"
            >
              <Icon name="plus" size={26} className="opacity-60" />
            </a>
            <span className="font-hand text-xl leading-none text-ink-soft">
              Add
            </span>
          </li>
        </ul>
      </section>

      <div id="add-crew" className="flex scroll-mt-6 flex-col gap-5">
        <h2 className="-mb-1 text-3xl">Bring more explorers</h2>
        <ShareCard
          icon="home"
          title="Add to our crew"
          blurb="For family. They share your passport, so every stamp counts for both of you."
          warning="Anyone with this link can join your crew and stamp your passport. Keep it in the family."
          path={`/join/${me.crew.joinCode}`}
          color="blue"
          shareTitle={`Join ${me.crew.name} on Park Roulette`}
          shareText={`Join ${me.crew.name} on Park Roulette! Tap to hop on our playground quest:`}
          tilt={-0.6}
        />
        <ShareCard
          icon="party"
          title="Invite a friend"
          blurb="Friends start their own crew and passport. Everyone's reviews are shared."
          path={`/join/${me.crew.friendCode}`}
          color="green"
          shareTitle="Come play Park Roulette!"
          shareText="We're trying to visit every playground in Central Oregon. Start your own quest with us:"
          tilt={0.6}
        />
      </div>

      <SoundBox />

      <HomeScreenTip />

      <SignOutButton name={me.name} />
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense fallback={<CrayonLoading />}>
      <MeScreen />
    </Suspense>
  );
}
