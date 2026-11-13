"use client";

import { useCallback, useState } from "react";
import { flushSync } from "react-dom";
import { CodeSheet, focusClaimCode } from "@/components/CodeSheet";
import { ErrorLine } from "@/components/ErrorLine";
import { sayHello } from "@/components/HelloToast";
import { Icon } from "@/components/icons";
import { PhoneCode } from "@/components/PhoneCode";
import { addKid, startClaim } from "@/lib/client-actions";
import { AVATARS, CRAYON_NAMES } from "@/lib/crayons";
import { AvatarPicker } from "./AvatarPicker";
import { CrayonPicker } from "./CrayonPicker";
import { AvatarBlob } from "./NameTag";

type Member = {
  id: number;
  name: string;
  color: string;
  avatar: string;
  reviewCount: number;
  hasPhone: boolean;
};

/** A full load, so every screen picks up who is signed in now. */
function go(to: string) {
  window.location.assign(to);
}

/**
 * "Who's playing?" The family, and on a shared phone (Mom's phone, kids'
 * explorers) a way to switch: tap someone with no number and you're them;
 * tap someone with a number and we text them a code. "+" adds a kid right
 * here on this phone, or sends a link to someone with their own.
 */
export function CrewSwitcher({
  members,
  meId,
  backTo = null,
}: {
  members: Member[];
  meId: number;
  /** The grown-up who handed this phone to a kid: switches back, no code. */
  backTo?: number | null;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeFor, setCodeFor] = useState<Member | null>(null);
  const closeCode = useCallback(() => setCodeFor(null), []);
  const [adding, setAdding] = useState<null | "choose" | "kid">(null);
  const closeAdding = useCallback(() => setAdding(null), []);

  function pick(m: Member) {
    if (m.id === meId || busy) return;
    setError(null);
    if (m.hasPhone && m.id !== backTo) {
      flushSync(() => setCodeFor(m));
      focusClaimCode(); // inside the tap, so iOS raises the keyboard
      return;
    }
    setBusy(m.id);
    startClaim(m.id).then((r) => {
      setBusy(null);
      if (!r.ok) return setError(r.error);
      sayHello(`Now playing: ${m.name}!`);
      go("/me");
    });
  }

  return (
    <>
      <ul className="flex flex-wrap gap-x-4 gap-y-3">
        {members.map((m) => {
          const mine = m.id === meId;
          return (
            <li key={m.id} className="w-20">
              <button
                type="button"
                onClick={() => pick(m)}
                disabled={mine}
                aria-label={mine ? "You" : `Switch to ${m.name}`}
                className="flex w-full flex-col items-center gap-1 transition-transform active:scale-95 disabled:active:scale-100"
              >
                <span className="relative">
                  <AvatarBlob avatar={m.avatar} color={m.color} />
                  {mine ? (
                    <span className="absolute -right-1 -bottom-1 rounded-full border-2 border-ink bg-crayon-yellow px-1.5 font-hand text-sm leading-tight">
                      you
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate font-hand text-xl leading-none">
                  {busy === m.id ? "…" : m.name}
                </span>
                <span className="text-xs text-ink-soft">
                  {m.reviewCount} {m.reviewCount === 1 ? "review" : "reviews"}
                </span>
              </button>
            </li>
          );
        })}
        <li className="w-20">
          <button
            type="button"
            onClick={() => setAdding("choose")}
            aria-label="Add someone to our family"
            className="flex w-full flex-col items-center gap-1"
          >
            <span className="grid size-14 place-items-center rounded-[var(--radius-blob)] border-[2.5px] border-dashed border-ink-soft">
              <Icon name="plus" size={26} className="opacity-60" />
            </span>
            <span className="font-hand text-xl leading-none text-ink-soft">
              Add
            </span>
          </button>
        </li>
      </ul>
      {members.length > 1 ? (
        <p className="mt-2 text-sm text-ink-soft">
          Sharing this phone? Tap someone to switch.
        </p>
      ) : null}
      {error ? (
        <div className="mt-1">
          <ErrorLine>{error}</ErrorLine>
        </div>
      ) : null}

      {adding === "choose" ? (
        <AddChooser
          onKid={() => setAdding("kid")}
          onOwnPhone={() => {
            setAdding(null);
            document
              .getElementById("add-crew")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
          onClose={closeAdding}
        />
      ) : adding === "kid" ? (
        <AddKidSheet taken={members} onClose={closeAdding} />
      ) : null}

      {codeFor ? (
        <CodeSheet
          title={`Switch to ${codeFor.name}?`}
          avatar={codeFor.avatar}
          color={codeFor.color}
          onClose={closeCode}
        >
          <PhoneCode
            mode="claim"
            next="/me"
            claim={{ explorerId: codeFor.id, name: codeFor.name }}
            codeLabel={`Switch to ${codeFor.name}`}
            hello={(name) => `Now playing: ${name}!`}
            onCancel={closeCode}
          />
        </CodeSheet>
      ) : null}
    </>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[1250] flex items-start justify-center overflow-y-auto">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-h"
        className="doodle-box relative mx-3 my-[max(env(safe-area-inset-top),1rem)] w-full max-w-md animate-pop-in px-5 pt-5 pb-4 shadow-[4px_6px_0_#2b2a33]"
      >
        <h2 id="add-h" className="mb-3 font-hand text-3xl leading-tight">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function AddChooser({
  onKid,
  onOwnPhone,
  onClose,
}: {
  onKid: () => void;
  onOwnPhone: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Who's joining?" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onKid}
          className="crayon-btn wax bg-crayon-yellow text-xl"
        >
          <Icon name="teddy" size={28} /> A kid on this phone
        </button>
        <button
          type="button"
          onClick={onOwnPhone}
          className="crayon-btn bg-[#fffdf7] text-xl"
        >
          <Icon name="phone" size={28} /> Someone with their own phone
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 font-hand text-lg text-ink-soft underline underline-offset-4"
        >
          Never mind
        </button>
      </div>
    </Sheet>
  );
}

/** Make a kid's explorer in my family, right here, and switch to them. */
function AddKidSheet({
  taken,
  onClose,
}: {
  taken: Member[];
  onClose: () => void;
}) {
  const takenColors = new Set(taken.map((m) => m.color));
  const takenAvatars = new Set(taken.map((m) => m.avatar));
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(
    CRAYON_NAMES.find((c) => !takenColors.has(c) && c !== "yellow") ?? "blue",
  );
  const [avatar, setAvatar] = useState(
    AVATARS.find((a) => !takenAvatars.has(a)) ?? AVATARS[0],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title="Add a kid" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !name.trim()) return;
          setBusy(true);
          setError(null);
          const r = await addKid({ name, color, avatar });
          if (!r.ok) {
            setBusy(false);
            setError(r.error);
            return;
          }
          sayHello(`Now playing: ${name.trim()}!`);
          go("/");
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="font-hand text-2xl">Their name</span>
          <input
            className="field font-hand text-2xl"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Theo"
            maxLength={40}
            autoComplete="off"
            enterKeyHint="done"
            required
          />
        </label>
        <fieldset>
          <legend className="mb-1 font-hand text-2xl">Their crayon</legend>
          <CrayonPicker value={color} onChange={setColor} />
        </fieldset>
        <fieldset>
          <legend className="mb-2 font-hand text-2xl">Their buddy</legend>
          <AvatarPicker value={avatar} color={color} onChange={setAvatar} />
        </fieldset>
        <p className="text-sm leading-snug text-ink-soft">
          Kids don&apos;t need a phone number. This phone switches to them; tap
          your face on the Me page to switch back.
        </p>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="crayon-btn wax bg-crayon-yellow py-3 text-2xl"
        >
          {busy
            ? "One sec…"
            : name.trim()
              ? `Add ${name.trim()}!`
              : "Add them!"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 font-hand text-lg text-ink-soft underline underline-offset-4"
        >
          Never mind
        </button>
      </form>
    </Sheet>
  );
}
