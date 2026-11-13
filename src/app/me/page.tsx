import type { Metadata } from "next";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { Icon } from "@/components/icons";
import { HomeScreenTip } from "@/components/me/HomeScreenTip";
import { CrewSwitcher } from "@/components/me/CrewSwitcher";
import { PhoneCard } from "@/components/me/PhoneCard";
import { ProfileCard } from "@/components/me/ProfileCard";
import { ShareCard } from "@/components/me/ShareCard";
import { SignedOutIntro } from "@/components/me/SignedOutIntro";
import { SignOutButton } from "@/components/me/SignOutButton";
import { PageTitle } from "@/components/PageTitle";
import { CRAYON_NAMES, type CrayonName } from "@/lib/crayons";

import { AccountCard } from "@/components/me/AccountCard";
import { TermsCard } from "@/components/me/TermsCard";
import { getMe } from "@/lib/data";
import { adminQueueSize } from "@/lib/data-admin";
import Link from "next/link";
import { formatPhone, safeNext } from "@/lib/phone-format";
import { grownUpOnThisPhone } from "@/lib/session";
import { getCrewMembers, getCrewStampCount } from "@/lib/data-me";

/** Light crayons (yellow, orange) are too pale for a title on paper. */
function titleCrayon(c: string): CrayonName {
  if (!(CRAYON_NAMES as string[]).includes(c)) return "purple";
  return c === "yellow" || c === "orange" ? "purple" : (c as CrayonName);
}

export const metadata: Metadata = { title: "Me" };

async function MeScreen({
  searchParams,
}: {
  searchParams: PageProps<"/me">["searchParams"];
}) {
  const me = await getMe();
  if (!me) {
    const next = (await searchParams).next;
    return (
      <SignedOutIntro
        next={typeof next === "string" ? safeNext(next) : undefined}
      />
    );
  }
  const [members, stamps, queue, back] = await Promise.all([
    getCrewMembers(me.crew.id),
    getCrewStampCount(me.crew.id),
    me.isAdmin && me.trusted ? adminQueueSize() : Promise.resolve(0),
    grownUpOnThisPhone(),
  ]);
  const kids = members.filter((m) => m.isKid);
  const grownUps = members.filter((m) => !m.isKid);

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

      {me.isAdmin && me.trusted && (
        <Link
          href="/admin"
          className="doodle-box flex min-h-14 items-center gap-3 px-4 py-3 font-hand text-xl"
        >
          <Icon name="crown" size={32} />
          <span className="flex-1">Admin</span>
          <span className="chip">{queue} to look at</span>
        </Link>
      )}

      {!me.isKid && !me.termsAccepted && <TermsCard />}

      {me.isKid ? (
        <p className="doodle-box-alt flex items-center gap-3 px-4 py-3 leading-snug">
          <Icon name="teddy" size={34} />
          <span>
            <b className="font-hand text-xl font-normal">
              Playing as {me.name}.
            </b>{" "}
            Color in stars and pick stickers on any park! Tap a grown-up below
            to switch back.
          </span>
        </p>
      ) : (
        <>
          <ProfileCard
            initial={{
              name: me.name,
              color: me.color,
              avatar: me.avatar,
              crewName: me.crew.name,
            }}
          />

          <PhoneCard
            phone={me.phone ? formatPhone(me.phone) : null}
            trusted={me.trusted}
            name={me.name}
          />
        </>
      )}

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
        <CrewSwitcher
          members={members}
          meId={me.id}
          backTo={back?.id ?? null}
        />
      </section>

      {!me.isKid && (
        <div id="add-crew" className="flex scroll-mt-6 flex-col gap-5">
          <h2 className="-mb-1 text-3xl">Bring more explorers</h2>
          <ShareCard
            icon="home"
            title="Add to our family"
            blurb="Your family link. They share your passport, so every stamp counts for both of you."
            warning="Anyone with this link can join your family and stamp your passport. Only share it with family."
            path={`/join/${me.crew.joinCode}`}
            color="blue"
            shareTitle={`Join ${me.crew.name} on Park Roulette`}
            shareText={`Join ${me.crew.name} on Park Roulette! Tap to hop on our playground quest:`}
            tilt={-0.6}
          />
          <ShareCard
            icon="party"
            title="Invite a family"
            blurb="Another family gets its own passport. Everyone's reviews are shared."
            path={`/join/${me.crew.friendCode}`}
            color="green"
            shareTitle="Come play Park Roulette!"
            shareText="We're trying to visit every playground in Central Oregon. Start your family's quest with us:"
            tilt={0.6}
          />
        </div>
      )}

      {!me.isKid && (
        <HomeScreenTip
          hasPhone={!!me.phone}
          canAddPhone={me.trusted}
          crewLink={`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/join/${me.crew.joinCode}`}
        />
      )}

      <AccountCard
        canDelete={!me.isKid && me.trusted}
        kids={kids.map((k) => ({ id: k.id, name: k.name }))}
        lastGrownUp={grownUps.length <= 1}
        familyName={me.crew.name}
      />

      <SignOutButton hasPhone={!!me.phone} family={members.length > 1} />
    </div>
  );
}

export default function MePage({ searchParams }: PageProps<"/me">) {
  return (
    <Suspense fallback={<CrayonLoading />}>
      <MeScreen searchParams={searchParams} />
    </Suspense>
  );
}
