import type { ReactNode } from "react";
import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";

export const OPERATOR = "True Craft Ventures LLC";
export const CONTACT = "hello@parkroulette.quest";
export const UPDATED = "November 13, 2026";

/** A plain, readable legal page in the crayon frame. */
export function LegalPage({
  accent,
  lead,
  intro,
  children,
}: {
  accent: string;
  lead: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-5">
      <PageTitle
        lead={lead}
        accent={accent}
        color="blue"
        underline="yellow"
        underlineWidth="w-40"
        size="text-4xl"
        subtitle={<p className="text-sm">Last updated {UPDATED}</p>}
      />
      <div className="doodle-box flex flex-col gap-3 bg-[color-mix(in_srgb,var(--color-crayon-yellow)_14%,#fffdf7)] p-4 leading-relaxed">
        {intro}
      </div>
      <div className="legal flex flex-col gap-5 leading-relaxed">
        {children}
      </div>
      <p className="text-center text-sm text-ink-soft">
        <Link href="/terms" className="underline">
          Terms
        </Link>{" "}
        ·{" "}
        <Link href="/privacy" className="underline">
          Privacy
        </Link>{" "}
        ·{" "}
        <a href={`mailto:${CONTACT}`} className="underline">
          {CONTACT}
        </a>
      </p>
    </article>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-hand text-2xl leading-tight">{title}</h2>
      {children}
    </section>
  );
}

export function Mail() {
  return (
    <a href={`mailto:${CONTACT}`} className="font-semibold underline">
      {CONTACT}
    </a>
  );
}
