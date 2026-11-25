import type { Metadata } from "next";
import Link from "next/link";
import { Shortlist } from "@/components/events/Shortlist";
import { PageTitle } from "@/components/PageTitle";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Saved events",
  description: "Your family's shortlist of kids' events.",
  ...NOINDEX,
};

/**
 * The shortlist. The page itself is the same for everyone (static); the
 * list is built in the browser from the phone's store, so nothing saved
 * is ever in a URL or a shared cache.
 */
export default function SavedEventsPage() {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/" className="underline">
          Park Roulette
        </Link>{" "}
        ›{" "}
        <Link href="/events" className="underline">
          Kids&apos; events
        </Link>
      </nav>
      <PageTitle
        accent="Saved"
        trail=" events"
        color="pink"
        underline="yellow"
        underlineWidth="w-32"
        subtitle={<p className="text-lg">Your plans, soonest first.</p>}
      />
      <Shortlist />
    </div>
  );
}
