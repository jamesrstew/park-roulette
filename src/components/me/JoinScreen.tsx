"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { joinWithCode, startClaim } from "@/lib/client-actions";
import { CodeSheet, focusClaimCode } from "@/components/CodeSheet";
import { ErrorLine } from "@/components/ErrorLine";
import { sayHello } from "@/components/HelloToast";
import { PhoneCode } from "@/components/PhoneCode";
import { Icon } from "@/components/icons";
import { AVATARS, CRAYON_NAMES, crayon } from "@/lib/crayons";
import { AvatarPicker } from "./AvatarPicker";
import { CrayonPicker } from "./CrayonPicker";
import { PartyDoodles } from "./Doodles";
import { AvatarBlob, NameTag } from "./NameTag";

type Member = {
  id: number;
  name: string;
  color: string;
  avatar: string;
  /** "That's me!" texts them a code (we never see the number here). */
  hasPhone: boolean;
};

export function JoinScreen({
  kind,
  code,
  crewName,
  crewColor,
  members,
  me,
  provedPhone,
}: {
  kind: "join" | "friend";
  code: string;
  crewName: string;
  crewColor: string;
  members: Member[];
  me: { id: number; name: string; crewName: string } | null;
  /** A number they just proved on the sign-in screen (can come along). */
  provedPhone?: string | null;
}) {
  const takenColors = new Set(members.map((m) => m.color));
  const takenAvatars = new Set(members.map((m) => m.avatar));
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(
    CRAYON_NAMES.find((c) => !takenColors.has(c) && c !== "yellow") ?? "blue",
  );
  const [avatar, setAvatar] = useState(
    AVATARS.find((a) => !takenAvatars.has(a)) ?? AVATARS[0],
  );
  const [newCrew, setNewCrew] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [claiming, setClaiming] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  /** A member with a phone: the code sheet (we text them as it opens). */
  const [codeFor, setCodeFor] = useState<Member | null>(null);
  const closeCode = useCallback(() => setCodeFor(null), []);
  /** A member with no phone: "Hop in as Wifey?" before switching. */
  const [confirmFor, setConfirmFor] = useState<Member | null>(null);
  const [usePhone, setUsePhone] = useState(true);
  // Signed in and holding a friend's link: you probably don't want to leave
  // your crew. Show "you're all set" first; the form is one tap away.
  const [startAnyway, setStartAnyway] = useState(false);

  const isFriend = kind === "friend";
  const alreadyHere = !isFriend && me && members.some((m) => m.id === me.id);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await joinWithCode({
        code,
        name,
        color,
        avatar,
        crewName: isFriend ? newCrew : undefined,
        usePhone: !!provedPhone && usePhone,
      });
      if (res && !res.ok) setError(res.error);
    });
  }

  /** Tap a face. A phone: open the code sheet now, inside the tap. */
  function claim(m: Member) {
    setClaimError(null);
    if (m.hasPhone) {
      setConfirmFor(null);
      flushSync(() => setCodeFor(m));
      focusClaimCode(); // inside the tap, so iOS raises the keyboard
      return;
    }
    setConfirmFor(m);
  }

  function hopIn(m: Member) {
    setClaiming(m.id);
    start(async () => {
      const res = await startClaim(m.id, code);
      if (!res.ok) {
        setClaimError(res.error);
        setClaiming(null);
        return;
      }
      sayHello(`Welcome back, ${m.name}!`);
      // A full load, so every screen picks up who is signed in now.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    });
  }

  if (isFriend && me && !startAnyway)
    return (
      <div className="flex flex-col gap-6 pt-6 text-center">
        <div className="doodle-box relative mx-2 rotate-[-1deg] px-5 pt-6 pb-5 shadow-[4px_5px_0_#2b2a33]">
          <span
            className="tape -top-3 left-1/2 -translate-x-1/2 -rotate-3"
            aria-hidden
          />
          <p className="font-hand text-xl text-ink-soft">
            Psst! It&apos;s an invite from
          </p>
          <h1 className="my-1 font-hand text-[2.4rem] leading-[1.05]">
            <span
              className="highlight"
              style={{ ["--hl" as string]: crayon(crewColor) }}
            >
              {crewName}
            </span>
          </h1>
          <p className="mt-2 text-lg leading-snug">
            You&apos;re already exploring with <b>{me.crewName}</b>, so
            you&apos;re all set! Everyone&apos;s reviews are shared anyway.
          </p>
        </div>
        <Link
          href="/"
          className="crayon-btn wax mx-2 bg-crayon-yellow py-3.5 text-2xl"
        >
          Back to spinning <Icon name="spin" size={28} />
        </Link>
        <button
          type="button"
          onClick={() => setStartAnyway(true)}
          className="mx-auto min-h-11 px-3 font-hand text-xl text-ink-soft underline underline-offset-4"
        >
          Start a new family passport anyway
        </button>
      </div>
    );

  return (
    <div className="flex flex-col gap-7">
      {/* ---- the invitation card ---- */}
      <section className="relative mt-3">
        <PartyDoodles className="pointer-events-none absolute -inset-x-2 -top-3 h-[calc(100%+1.5rem)] w-[calc(100%+1rem)]" />
        <div className="doodle-box relative mx-2 rotate-[-1.5deg] px-5 pt-6 pb-5 text-center shadow-[4px_5px_0_#2b2a33]">
          <span className="tape -top-3 left-6 -rotate-6" aria-hidden />
          <span className="tape -top-3 right-6 rotate-6" aria-hidden />
          <p className="font-hand text-xl text-ink-soft">
            {isFriend ? "Psst! Your friends at" : "Hooray! You're invited to"}
          </p>
          <h1 className="my-1 font-hand text-[2.6rem] leading-[1.05]">
            {isFriend ? (
              <span
                className="highlight"
                style={{ ["--hl" as string]: crayon(crewColor) }}
              >
                {crewName}
              </span>
            ) : (
              <>
                join{" "}
                <span
                  className="highlight"
                  style={{ ["--hl" as string]: crayon(crewColor) }}
                >
                  {crewName}
                </span>
              </>
            )}
          </h1>
          <p className="font-hand text-xl leading-snug">
            {isFriend
              ? "want you on the playground quest too!"
              : "on the quest to play at every playground in Central Oregon."}
          </p>
          {isFriend ? (
            <p className="mx-auto mt-3 max-w-[19rem] text-[0.95rem] leading-snug text-ink-soft">
              You&apos;ll get your own family passport. Everyone shares reviews,
              so you can see their tips and they can see yours.
            </p>
          ) : null}
        </div>
      </section>

      {me ? (
        <p className="doodle-box-alt mx-1 bg-crayon-yellow/25 px-4 py-3 text-center text-[0.95rem] leading-snug">
          {alreadyHere ? (
            <>
              You&apos;re already in <b>{crewName}</b> as <b>{me.name}</b>.{" "}
              <Link href="/" className="font-hand text-lg underline">
                Go spin!
              </Link>{" "}
              Adding a kid on this phone?{" "}
              <Link href="/me#crew-h" className="font-hand text-lg underline">
                Do it on Me
              </Link>
              .
            </>
          ) : (
            <>
              This phone is signed in as <b>{me.name}</b> ({me.crewName}).
              Joining here switches it over.
            </>
          )}
        </p>
      ) : null}

      {/* ---- "That's me!": a compact row, so the form stays near the top ---- */}
      {!isFriend && members.length > 0 ? (
        <section
          aria-labelledby="claim-h"
          className="doodle-box-alt px-4 pt-3 pb-4"
        >
          <h2 id="claim-h" className="text-center font-hand text-2xl">
            Already in the family? Tap yourself.
          </h2>
          <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-2">
            {members.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => claim(m)}
                  disabled={pending}
                  aria-pressed={confirmFor?.id === m.id}
                  className={`flex w-20 flex-col items-center gap-1 rounded-2xl py-1 transition-transform active:scale-95 disabled:opacity-60 ${confirmFor?.id === m.id ? "bg-crayon-yellow/40" : ""}`}
                >
                  <AvatarBlob avatar={m.avatar} color={m.color} />
                  <span className="max-w-full truncate font-hand text-xl leading-none">
                    {m.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {confirmFor ? (
            <div className="mt-3 flex animate-pop-in flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => hopIn(confirmFor)}
                disabled={pending}
                className="crayon-btn wax w-full bg-crayon-yellow text-xl"
              >
                {claiming === confirmFor.id
                  ? "One sec…"
                  : `Hop in as ${confirmFor.name}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirmFor(null)}
                className="min-h-11 font-hand text-lg text-ink-soft underline underline-offset-4"
              >
                Oops, not me
              </button>
            </div>
          ) : null}
          {claimError ? (
            <div className="mt-2">
              <ErrorLine>{claimError}</ErrorLine>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---- make your explorer ---- */}
      <form onSubmit={submit} className="flex flex-col gap-6">
        <h2 className="-mb-2 text-center text-3xl">Make your explorer</h2>

        <NameTag
          name={name}
          color={color}
          avatar={avatar}
          crewName={isFriend ? newCrew.trim() || undefined : crewName}
        />

        <label className="flex flex-col gap-1.5">
          <span className="font-hand text-2xl">What should we call you?</span>
          <input
            className="field font-hand text-2xl"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
            autoComplete="given-name"
            enterKeyHint="next"
            required
          />
        </label>

        {isFriend ? (
          <label className="flex flex-col gap-1.5">
            <span className="font-hand text-2xl">
              What&apos;s your family called?
            </span>
            <input
              className="field font-hand text-2xl"
              value={newCrew}
              onChange={(e) => setNewCrew(e.target.value)}
              placeholder="The Wild Rumpuses"
              maxLength={40}
              enterKeyHint="done"
            />
            <span className="text-sm text-ink-soft">
              Like “The Stewarts” or “Team Taco”. You can change it later.
            </span>
          </label>
        ) : null}

        <fieldset>
          <legend className="mb-1 font-hand text-2xl">Pick your crayon</legend>
          <CrayonPicker value={color} onChange={setColor} />
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-hand text-2xl">Pick a buddy</legend>
          <AvatarPicker value={avatar} color={color} onChange={setAvatar} />
        </fieldset>

        {provedPhone ? (
          <label className="doodle-box-alt flex min-h-11 items-center gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={usePhone}
              onChange={(e) => setUsePhone(e.target.checked)}
              className="size-6 shrink-0 accent-crayon-green"
            />
            <span className="leading-snug">
              Sign me in with <b className="whitespace-nowrap">{provedPhone}</b>{" "}
              from now on
            </span>
          </label>
        ) : null}

        {error ? <ErrorLine>{error}</ErrorLine> : null}

        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="crayon-btn wax w-full bg-crayon-yellow py-4 text-3xl"
        >
          {pending && claiming === null ? (
            "Sharpening…"
          ) : isFriend ? (
            <>
              Start our quest! <Icon name="sparkles" size={32} />
            </>
          ) : (
            <>
              Join {crewName}! <Icon name="party" size={32} />
            </>
          )}
        </button>
      </form>

      {codeFor ? (
        <CodeSheet
          title={`Hi, ${codeFor.name}!`}
          avatar={codeFor.avatar}
          color={codeFor.color}
          onClose={closeCode}
        >
          <PhoneCode
            mode="claim"
            claim={{
              explorerId: codeFor.id,
              joinCode: code,
              name: codeFor.name,
            }}
            onCancel={closeCode}
          />
        </CodeSheet>
      ) : null}
    </div>
  );
}
