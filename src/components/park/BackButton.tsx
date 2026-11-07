"use client";

import { useRouter } from "next/navigation";

/** Goes back if we came from inside the app, else to the wheel. */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="chip min-h-11 bg-paper"
      onClick={() => {
        const fromHere =
          document.referrer &&
          new URL(document.referrer).origin === location.origin;
        if (fromHere && history.length > 1) router.back();
        else router.push("/");
      }}
    >
      ← Back
    </button>
  );
}
