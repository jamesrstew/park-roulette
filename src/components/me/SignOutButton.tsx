"use client";

import { useState } from "react";
import { signOut } from "@/lib/client-actions";

/** Two taps on purpose: make sure they know the way back in first. */
export function SignOutButton({
  hasPhone,
  family,
}: {
  hasPhone: boolean;
  /** Others in the family: on a shared phone, switching beats signing out. */
  family: boolean;
}) {
  const [sure, setSure] = useState(false);
  if (!sure)
    return (
      <button
        type="button"
        onClick={() => setSure(true)}
        className="mx-auto min-h-11 px-4 font-hand text-xl text-ink-soft underline underline-offset-4"
      >
        Sign out of this phone
      </button>
    );
  return (
    <form
      action={signOut}
      className="doodle-box-alt flex animate-pop-in flex-col items-center gap-3 px-4 py-4 text-center"
    >
      <p className="leading-snug">
        {hasPhone ? (
          <>
            Sign out on this phone? To come back, sign in with your phone
            number.
          </>
        ) : (
          <>
            Sign out on this phone? You haven&apos;t added a number, so to come
            back you&apos;ll need your family link (then tap{" "}
            <b>That&apos;s me!</b>). Adding your number up top is easier.
          </>
        )}
      </p>
      {family ? (
        <p className="text-sm leading-snug text-ink-soft">
          Just passing the phone around? Tap a face above to switch instead.
        </p>
      ) : null}
      <div className="flex w-full gap-3">
        <button
          type="button"
          onClick={() => setSure(false)}
          className="crayon-btn flex-1 bg-[#fffdf7] text-xl"
        >
          Stay
        </button>
        <button
          type="submit"
          className="crayon-btn wax flex-1 bg-crayon-red text-xl text-white"
        >
          Sign out
        </button>
      </div>
    </form>
  );
}
