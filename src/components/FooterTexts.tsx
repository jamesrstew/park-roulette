"use client";

import { useEffect, useRef } from "react";
import { ParkTextsCard } from "@/components/ParkTexts";
import { EVENTS } from "@/lib/events";
import { trackEvent } from "@/lib/events-client";
import { pacific } from "@/lib/news/time";
import { storage } from "@/lib/storage";
import { TEXTS_COPY, TEXTS_FROM } from "@/lib/texts";

/** When this browser last counted "Footer text shown" (a Pacific date). */
const SHOWN_KEY = "pr:footer-text";

/**
 * The site footer's Weekend Pick card, for a signed-in grown-up whose
 * number passed a code in the last 30 days: the number in the unchecked
 * box, the full disclosure, then Text me Fridays (two taps, no extra
 * screen; the filed CQXRMSG flow, decision 11). Its own consent wording,
 * sms-2026-11-22-footer, accepted only from site_footer.
 */
export function FooterTexts({
  number,
  state,
  confirmationsOn,
}: {
  number: string;
  /** Confirmation texts go out now (else the done line says when). */
  confirmationsOn: boolean;
  /** rather: the email box is above it; too: they get the email. */
  state: "rather" | "too";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        const today = pacific(new Date()).date;
        if (storage.get(SHOWN_KEY) === today) return;
        storage.set(SHOWN_KEY, today);
        trackEvent(EVENTS.footerTextShown, { state });
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [state]);
  return (
    <div ref={ref}>
      <ParkTextsCard
        number={number}
        source="site_footer"
        sendingOn={confirmationsOn}
        textsFrom={TEXTS_FROM}
        headline={
          state === "too" ? TEXTS_COPY.footerToo : TEXTS_COPY.footerRather
        }
        doneLine={confirmationsOn ? TEXTS_COPY.hello : undefined}
      />
    </div>
  );
}
