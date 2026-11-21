"use client";

import { toastNow } from "./HelloToast";
import { InstallSheet } from "./InstallSheet";
import { PhoneCode } from "./PhoneCode";
import { type PicksOutcome, SignupPicks } from "./SignupPicks";
import { loadPicks } from "@/lib/client-actions";
import type { PicksFacts } from "@/lib/texts-actions";
import { dropWelcome } from "@/lib/welcome-url";
import { shouldOfferInstall } from "@/lib/install";
import confetti from "canvas-confetti";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { CRAYONS, crayon } from "@/lib/crayons";
import { sfx } from "@/lib/sound";
import { storage } from "@/lib/storage";
import { PHONE_NUDGE_KEY } from "./PhoneNudge";

/**
 * Shown once on /?welcome=1 right after joining. Page 1 greets the new
 * explorer with confetti and a 3-line how-to; then (if they have no number
 * yet) "Add your number", which is how they'll sign in anywhere later;
 * then "picks", the weekly email (pre-checked) and the Weekend Pick (an
 * unchecked box), skipped for anyone who already gets both. Then "Make it
 * an app!". Never for kids or "That's me!" claims (they don't land here).
 */
export function WelcomeSheet({
  name,
  avatar,
  color,
  crewName,
  crewLink,
  hasPhone,
}: {
  name: string;
  avatar: string;
  color: string;
  crewName: string;
  /** This crew's join link: the way back in for explorers with no phone. */
  crewLink: string;
  hasPhone: boolean;
}) {
  const [page, setPage] = useState<"hello" | "phone" | "picks">("hello");
  /** The picks page's facts: undefined while loading, null if they failed. */
  const [facts, setFacts] = useState<PicksFacts | null | undefined>();
  const [phoneAdded, setPhoneAdded] = useState(false);
  const [phoneSkipped, setPhoneSkipped] = useState(false);
  const params = useSearchParams();
  // Latch on first render: we strip ?welcome=1 from the URL right away.
  const [wanted] = useState(() => params.get("welcome") === "1");
  const [closed, setClosed] = useState(false);
  const open = wanted && !closed;
  // After the welcome, offer "Make it an app!" (phones, not yet installed).
  const offerInstall = useSyncExternalStore(
    () => () => {},
    shouldOfferInstall,
    () => false,
  );
  const [installOpen, setInstallOpen] = useState(false);
  const finish = (o?: PicksOutcome) => {
    // Leaving the phone page without a number (backdrop, Escape, Skip) is a
    // skip: don't ask again in the install sheet a second later.
    if (page === "phone" && !phoneAdded) setPhoneSkipped(true);
    setClosed(true);
    // A refresh() from the phone or picks page can put ?welcome=1 back
    // (the router's copy of the address): drop it again, so a reload
    // never greets twice.
    dropWelcome();
    if (o?.toast) toastNow(o.toast);
    // After a texts yes, let "Watch for a hello text" land first.
    if (offerInstall)
      setTimeout(() => setInstallOpen(true), o?.textsYes ? 2500 : 0);
  };
  /** The next page after hello or the phone: picks when there's one. */
  const afterPhone = (f: PicksFacts | null | undefined = facts) => {
    // Tapped before the facts came back: wait for them.
    if (f === undefined) {
      void loadPicks().then((x) => {
        setFacts(x);
        afterPhoneRef.current(x);
      });
      return;
    }
    if (f?.show) {
      confetti.reset();
      setPage("picks");
    } else finish();
  };
  const finishRef = useRef(finish);
  const pageRef = useRef(page);
  const afterPhoneRef = useRef(afterPhone);
  useEffect(() => {
    finishRef.current = finish;
    pageRef.current = page;
    afterPhoneRef.current = afterPhone;
  });

  useEffect(() => {
    if (!open) return;
    // This flow already asks for a number: the "Sign in on any phone"
    // nudge is never needed on this phone.
    storage.set(PHONE_NUDGE_KEY, String(Date.now()));
    // Drop ?welcome=1 so a refresh or share doesn't greet again.
    dropWelcome();
    const t = setTimeout(() => {
      sfx.tada();
      confetti({
        particleCount: 110,
        spread: 80,
        startVelocity: 42,
        origin: { y: 0.75 },
        colors: Object.values(CRAYONS),
        disableForReducedMotion: true,
        zIndex: 1300,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [open]);

  // The picks page's facts, read as the sheet opens (kids and borrowed
  // links get show: false).
  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadPicks().then((f) => live && setFacts(f));
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Escape closes, like Not now (it records nothing on the account).
    // The picks page handles its own (it reports "closed").
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && pageRef.current !== "picks" && finishRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open)
    return (
      <InstallSheet
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        crewLink={crewLink}
        hasPhone={hasPhone || phoneAdded}
        phoneSkipped={phoneSkipped}
      />
    );
  const hex = crayon(color);

  return (
    <div
      className={`fixed inset-0 z-[1200] flex justify-center ${page === "hello" ? "items-end" : "items-start"}`}
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        // The picks page has its own Not now: a stray tap outside it does
        // nothing (it would lose a typed address).
        onClick={page === "picks" ? undefined : () => finish()}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-h"
        key={page}
        className={`doodle-box relative mx-3 w-full max-w-md animate-pop-in px-5 pb-5 shadow-[4px_6px_0_#2b2a33] ${
          page !== "hello"
            ? "mt-[max(env(safe-area-inset-top),1rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto pt-5"
            : "mb-[max(env(safe-area-inset-bottom),0.75rem)] pt-14"
        }`}
      >
        {page === "picks" && facts ? (
          <SignupPicks
            facts={facts}
            headingId="welcome-h"
            onFinish={(o) => finish(o)}
          />
        ) : page === "phone" ? (
          <>
            <h2 id="welcome-h" className="font-hand text-4xl leading-tight">
              Add your number
            </h2>
            <p className="mt-1 mb-3 leading-snug">
              Add your number and you can sign in on any phone with a quick
              text. Kids can skip this.
            </p>
            <PhoneCode
              mode="add"
              autoFocus
              onDone={() => {
                setPhoneAdded(true);
                // The number just passed a code: the picks page can offer
                // the Weekend Pick to it.
                const t0 = Date.now();
                void loadPicks().then((f) => {
                  setFacts(f);
                  setTimeout(
                    () => afterPhoneRef.current(f),
                    Math.max(0, 900 - (Date.now() - t0)),
                  );
                });
              }}
              onSkip={() => afterPhone()}
              skipLabel="Skip for now"
            />
          </>
        ) : (
          <>
            <span
              className="absolute -top-12 left-1/2 grid size-24 -translate-x-1/2 animate-float place-items-center rounded-[var(--radius-blob)] border-[3px] border-ink text-6xl shadow-[3px_4px_0_#2b2a33]"
              style={{
                backgroundColor: `color-mix(in srgb, ${hex} 40%, #fffdf7)`,
              }}
              aria-hidden
            >
              {avatar}
            </span>
            <h2 id="welcome-h" className="text-center font-hand text-4xl">
              Welcome, {name}!
            </h2>
            <p className="mt-1 text-center font-hand text-xl text-ink-soft">
              You&apos;re in{" "}
              <span
                className="highlight text-ink"
                style={{ ["--hl" as string]: hex }}
              >
                {crewName}
              </span>
              {". Here's the game:"}
            </p>
            <ol className="mt-4 flex flex-col gap-2.5 text-lg leading-snug">
              {(
                [
                  ["spin", "Spin", "the wheel to pick a playground."],
                  ["directions", "Go", "play! Slides first, snacks after."],
                  [
                    "stamp",
                    "Tap “We went!”",
                    "to stamp your passport, then rate it.",
                  ],
                ] as const
              ).map(([icon, bold, rest]) => (
                <li key={bold} className="flex items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper"
                    aria-hidden
                  >
                    <Icon name={icon} size={26} />
                  </span>
                  <span>
                    <b className="font-hand text-2xl font-normal">{bold}</b>{" "}
                    {rest}
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => {
                if (hasPhone) return afterPhone();
                confetti.reset(); // don't rain on the number field
                setPage("phone");
              }}
              autoFocus
              className="crayon-btn wax mt-5 w-full bg-crayon-yellow py-3.5 text-3xl"
            >
              {/* "Next" only when another page follows. With a number, that
                  waits for the picks facts (a beat): the words are held back
                  until they're known, so the label never flips. */}
              <span
                className={!hasPhone || facts !== undefined ? "" : "invisible"}
              >
                {!hasPhone || facts?.show ? "Next" : "Let's spin!"}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
