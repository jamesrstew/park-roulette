"use client";

import { useRouter } from "next/navigation";
import { navHistory } from "@/lib/nav-history";

/** Goes back if we came from inside the app, else to the wheel. */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="chip min-h-11 bg-paper"
      onClick={() => {
        if (navHistory.canGoBack()) router.back();
        else router.push("/");
      }}
    >
      ← Back
    </button>
  );
}
