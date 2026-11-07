"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { updateProfile } from "@/lib/actions";
import { AvatarPicker } from "./AvatarPicker";
import { CrayonPicker } from "./CrayonPicker";
import { NameTag } from "./NameTag";

type Profile = {
  name: string;
  color: string;
  avatar: string;
  crewName: string;
};

/** Your name tag, with an inline "fix my tag" editor. */
export function ProfileCard({ initial }: { initial: Profile }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const shown = editing ? draft : initial;

  function open() {
    setDraft(initial);
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await updateProfile(draft);
      if (res.ok) {
        setEditing(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else setError(res.error);
    });
  }

  return (
    <section aria-label="Your explorer" className="flex flex-col gap-4">
      <div className="relative">
        <NameTag
          name={shown.name}
          color={shown.color}
          avatar={shown.avatar}
          crewName={shown.crewName}
        />
        {saved ? (
          <span
            role="status"
            className="absolute -top-2 right-2 inline-flex rotate-6 animate-pop-in items-center gap-1 rounded-full border-2 border-ink bg-crayon-green px-3 py-0.5 font-hand text-xl text-white shadow-[2px_3px_0_#2b2a33]"
          >
            Saved! <Icon name="sparkles" size={20} />
          </span>
        ) : null}
      </div>

      {!editing ? (
        <button
          type="button"
          onClick={open}
          className="mx-auto inline-flex min-h-11 items-center gap-1.5 px-3 font-hand text-xl underline decoration-crayon-orange decoration-wavy underline-offset-4"
        >
          <Icon name="edit" size={24} /> Change my name tag
        </button>
      ) : (
        <form
          onSubmit={save}
          className="doodle-box-alt flex animate-pop-in flex-col gap-5 px-4 py-5"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-hand text-2xl">My name</span>
            <input
              className="field font-hand text-2xl"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              maxLength={40}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-hand text-2xl">Our crew name</span>
            <input
              className="field font-hand text-2xl"
              value={draft.crewName}
              onChange={(e) => setDraft({ ...draft, crewName: e.target.value })}
              maxLength={40}
              required
            />
            <span className="text-sm text-ink-soft">
              Changes it for everyone in your crew.
            </span>
          </label>
          <fieldset>
            <legend className="mb-1 font-hand text-2xl">My crayon</legend>
            <CrayonPicker
              value={draft.color}
              onChange={(color) => setDraft({ ...draft, color })}
            />
          </fieldset>
          <fieldset>
            <legend className="mb-2 font-hand text-2xl">My buddy</legend>
            <AvatarPicker
              value={draft.avatar}
              color={draft.color}
              onChange={(avatar) => setDraft({ ...draft, avatar })}
            />
          </fieldset>
          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-crayon-red/15 px-3 py-2 text-center font-hand text-xl"
            >
              {error}
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="crayon-btn flex-1 bg-[#fffdf7] text-xl"
            >
              Never mind
            </button>
            <button
              type="submit"
              disabled={pending || !draft.name.trim() || !draft.crewName.trim()}
              className="crayon-btn wax flex-[1.4] bg-crayon-green text-xl text-white"
            >
              {pending ? "Saving…" : "Save it!"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
