import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { JoinScreen } from "@/components/me/JoinScreen";
import { PageTitle } from "@/components/PageTitle";
import { PhoneCode } from "@/components/PhoneCode";
import { getMe } from "@/lib/data";
import { formatPhone } from "@/lib/phone-format";
import { verifiedPhone } from "@/lib/session";

export const metadata: Metadata = {
  title: "Start your family",
  description:
    "A free game for Central Oregon families: spin for a playground, go play, stamp your family's passport.",
};

/**
 * Start a family with no invite: prove a number by text, then make your
 * explorer. A number that already has an explorer just signs in.
 */
async function Start() {
  const [me, proved] = await Promise.all([getMe(), verifiedPhone()]);
  if (me) redirect("/");
  if (proved)
    return (
      <JoinScreen
        kind="start"
        code=""
        crewName=""
        crewColor="yellow"
        members={[]}
        me={null}
        provedPhone={formatPhone(proved)}
      />
    );
  return (
    <div className="flex flex-col gap-6 pt-2">
      <PageTitle
        lead="Start your"
        accent="family"
        color="green"
        underline="yellow"
        underlineWidth="w-40"
        subtitle={
          <p>
            Free, no app store, no ads. Spin for a playground, go play, stamp
            your family&apos;s passport.
          </p>
        }
      />
      <section className="doodle-box bg-[#fffdf7] px-5 pt-5 pb-4 shadow-[3px_4px_0_#2b2a33]">
        <h2 className="flex items-center gap-2 text-3xl">
          <Icon name="phone" size={34} /> First, your number
        </h2>
        <p className="mb-3 leading-snug text-ink-soft">
          It&apos;s how you sign in on any phone. No passwords, ever. Played
          before? This signs you right back in.
        </p>
        <PhoneCode mode="signin" next="/" />
      </section>
      <p className="text-center text-sm leading-snug text-ink-soft">
        Got an invite link from a friend or your family? Just tap it.{" "}
        <Link href="/" className="underline">
          Or just spin for now
        </Link>
        .
      </p>
    </div>
  );
}

export default function StartPage() {
  return (
    <Suspense fallback={<CrayonLoading />}>
      <Start />
    </Suspense>
  );
}
