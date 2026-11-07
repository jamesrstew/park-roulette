"use client";

import { useState } from "react";
import { signOut } from "@/lib/actions";

/** Two taps on purpose: without a password, your crew link is the way back. */
export function SignOutButton({ name }: { name: string }) {
  const [sure, setSure] = useState(false);
  if (!sure)
    return (
      <button
        type="button"
        onClick={() => setSure(true)}
        className="mx-auto min-h-11 px-4 font-hand text-xl text-ink-soft underline underline-offset-4"
      >
        Not {name}? Sign out
      </button>
    );
  return (
    <form
      action={signOut}
      className="doodle-box-alt flex animate-pop-in flex-col items-center gap-3 px-4 py-4 text-center"
    >
      <p className="leading-snug">
        Sign out on this phone? To come back, tap your crew link and pick{" "}
        <b>That&apos;s me!</b>
      </p>
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
