"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { claimExplorer, joinWithCode } from "@/lib/actions";
import { AVATARS, CRAYON_NAMES, crayon } from "@/lib/crayons";
import { AvatarPicker } from "./AvatarPicker";
import { CrayonPicker } from "./CrayonPicker";
import { PartyDoodles } from "./Doodles";
import { AvatarBlob, NameTag } from "./NameTag";

type Member = { id: number; name: string; color: string; avatar: string };

export function JoinScreen({
  kind,
  code,
  crewName,
  crewColor,
  members,
  me,
}: {
  kind: "join" | "friend";
  code: string;
  crewName: string;
  crewColor: string;
  members: Member[];
  me: { id: number; name: string; crewName: string } | null;
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
      });
      if (res && !res.ok) setError(res.error);
    });
  }

  function claim(id: number) {
    setError(null);
    setClaiming(id);
    start(async () => {
      const res = await claimExplorer(code, id);
      if (res && !res.ok) {
        setError(res.error);
        setClaiming(null);
      }
    });
  }

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
          <h1 className="my-1 font-sketch text-[2.6rem] leading-[1.05] font-bold">
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
              You&apos;ll start your own crew with its own passport. Everyone
              shares reviews, so you can see their tips and they can see yours.
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
              </Link>
            </>
          ) : (
            <>
              This phone is signed in as <b>{me.name}</b> ({me.crewName}).
              Joining here switches it over.
            </>
          )}
        </p>
      ) : null}

      {/* ---- "That's me!" ---- */}
      {!isFriend && members.length > 0 ? (
        <section aria-labelledby="claim-h">
          <h2 id="claim-h" className="text-center text-3xl">
            Already in the crew?
          </h2>
          <p className="mb-3 text-center text-ink-soft">
            New phone? Tap yourself.
          </p>
          <ul className="grid grid-cols-2 gap-3">
            {members.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => claim(m.id)}
                  disabled={pending}
                  className="doodle-box flex w-full flex-col items-center gap-1.5 px-2 pt-4 pb-3 shadow-[3px_4px_0_#2b2a33] transition-transform active:translate-x-[3px] active:translate-y-[4px] active:shadow-none disabled:opacity-60"
                  style={{ rotate: `${i % 2 ? 1.5 : -1.5}deg` }}
                >
                  <AvatarBlob avatar={m.avatar} color={m.color} size="lg" />
                  <span className="max-w-full truncate font-hand text-2xl">
                    {m.name}
                  </span>
                  <span
                    className="wax rounded-full border-2 border-ink px-3 py-0.5 font-hand text-lg"
                    style={{ backgroundColor: crayon(m.color) }}
                  >
                    {claiming === m.id ? "Hi again!…" : "That's me!"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-7 flex items-center gap-3 font-hand text-xl text-ink-soft">
            <Squiggle />
            <span className="shrink-0">or, new here?</span>
            <Squiggle />
          </div>
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
              What&apos;s your crew called?
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
              Your family or whoever plays with you. You can change it later.
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

        {error ? (
          <p
            role="alert"
            className="doodle-box-alt bg-crayon-red/15 px-4 py-2 text-center font-hand text-xl"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="crayon-btn wax w-full bg-crayon-yellow py-4 text-3xl"
        >
          {pending && claiming === null
            ? "Sharpening…"
            : isFriend
              ? "Start our quest! 🚀"
              : `Join ${crewName}! 🎉`}
        </button>
      </form>
    </div>
  );
}

function Squiggle() {
  return (
    <svg viewBox="0 0 100 12" className="h-3 flex-1" aria-hidden>
      <path
        d="M2 6 Q 8 1 14 6 T 26 6 T 38 6 T 50 6 T 62 6 T 74 6 T 86 6 T 98 6"
        fill="none"
        stroke="#5d5a6b"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
