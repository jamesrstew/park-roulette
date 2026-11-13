"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import { acceptTerms } from "@/lib/client-actions";

/** For grown-ups who joined before we had Terms: agree once. */
export function TermsCard() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="doodle-box flex flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-blue)_10%,#fffdf7)] p-4">
      <p className="flex items-center gap-2 font-hand text-2xl leading-tight">
        <Icon name="book" size={30} /> We wrote down the rules
      </p>
      <p className="text-sm leading-snug">
        Park Roulette now has{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>{" "}
        and a{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        . The short version: grown-ups hold accounts, photos stay with signed-in
        families, and we never sell anything.
      </p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await acceptTerms();
            if (!r.ok) setError(r.error);
          })
        }
        className="crayon-btn wax min-h-12 bg-crayon-blue text-lg text-white [text-shadow:1px_1px_0_#2b2a33]"
      >
        I&apos;m 18 or older and I agree
      </button>
    </section>
  );
}
