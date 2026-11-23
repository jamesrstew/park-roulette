"use client";

import { useSearchParams } from "next/navigation";
import { EmailSignup } from "@/components/ParkNews";
import { igSourceOrNull } from "@/lib/social/sources";

/**
 * The footer's email field. On a page one of our posts linked to (a park,
 * /events: ?from=ig, ig_dm or fb), a signup counts for that post's
 * channel; anywhere else it's the footer's.
 */
export function FooterEmail() {
  const social = igSourceOrNull(useSearchParams().get("from"));
  return <EmailSignup source={social ?? "footer"} inline />;
}
