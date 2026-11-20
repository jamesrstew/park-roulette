"use client";

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { EmailSignup } from "@/components/ParkNews";
import { ParkTextsCard } from "@/components/ParkTexts";
import { TextsLink } from "@/components/news/TextsLink";
import {
  ASKS_KEY,
  type Ask,
  type AskCtx,
  type AskState,
  type Channel,
  type Moment,
  parseState,
  pickAsk,
  recordDeclined,
  recordHidden,
  recordOn,
  recordShown,
  recordTapped,
} from "@/lib/asks";
import { declinePicks } from "@/lib/client-actions";
import { EVENTS } from "@/lib/events";
import { trackEvent } from "@/lib/events-client";
import { pacific } from "@/lib/news/time";
import { useOverlayOpen } from "@/lib/overlay";
import { NEWS_NAME, PARK_NEWS, successLine } from "@/lib/park-news";
import { storage } from "@/lib/storage";
import { TEXTS_COPY } from "@/lib/texts";

/** What the server knows, for the ask moments (app/page.tsx). */
export type AskServer = Omit<
  AskCtx,
  "surface" | "overlayOpen" | "result" | "lastStamp"
> & {
  lastStamp: AskCtx["lastStamp"];
  /** The grown-up's number, and whether it passed a code in 30 days. */
  phone: string | null;
  phoneFresh: boolean;
  /** Texts are sending, for the sheet's done line. */
  textsSendingOn: boolean;
  textsFrom: string | null;
};

function load(): AskState {
  const s = parseState(storage.get(ASKS_KEY));
  if (s.firstSeen) return s;
  const first = { ...s, firstSeen: new Date().toISOString() };
  storage.set(ASKS_KEY, JSON.stringify(first));
  return first;
}

const channelOf = (cs: readonly Channel[]) => (cs.length > 1 ? "both" : cs[0]);

/**
 * The one ask slot (above the wheel, or under a settled result): picks
 * the ask (lib/asks.ts), counts it when half of it is on screen, and
 * keeps it once tapped, whatever the page learns after (a yes refreshes
 * the server's view, but the row stays to say "You're in!").
 */
export function AskSlot({
  server,
  surface,
  result,
  onShowing,
}: {
  server: AskServer;
  surface: AskCtx["surface"];
  result?: AskCtx["result"];
  /** Whether an ask is on screen (the Directions event's `ask`). */
  onShowing?: (showing: boolean) => void;
}) {
  const [state, setState] = useState<AskState | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [latched, setLatched] = useState<Ask | null>(null);
  const [gone, setGone] = useState(false);
  const overlay = useOverlayOpen();
  useEffect(() => {
    // Hydrate from this device's storage, then keep the clock current.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of localStorage
    setState(load());
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // Writes start from what's stored now (another tab, or the other slot,
  // may have written since), and other tabs' writes come back in.
  const update = useCallback((fn: (s: AskState) => AskState) => {
    const next = fn(parseState(storage.get(ASKS_KEY)));
    storage.set(ASKS_KEY, JSON.stringify(next));
    setState(next);
  }, []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ASKS_KEY) setState(parseState(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const picked =
    state && now
      ? pickAsk(
          {
            surface,
            signedIn: server.signedIn,
            isKid: server.isKid,
            borrowed: server.borrowed,
            account: server.account,
            lastStamp: server.lastStamp,
            textsAvailable: server.textsAvailable,
            overlayOpen: overlay,
            result,
          },
          state,
          now,
        )
      : null;
  const ask = gone ? null : (latched ?? picked);
  const showing = !!ask;
  useEffect(() => {
    onShowing?.(showing);
  }, [showing, onShowing]);
  // Gone (a new spin, a new result): nothing is showing any more.
  useEffect(() => () => onShowing?.(false), [onShowing]);
  if (!ask) return null;

  const tap = () => {
    update((s) => recordTapped(s, ask.moment, new Date()));
    setLatched(ask);
  };
  const opened = (c: Channel) => {
    tap();
    trackEvent(EVENTS.askOpened, { moment: ask.moment, channel: c });
  };
  const decline = () => {
    tap();
    update((s) => recordDeclined(s, ask.channels));
    trackEvent(EVENTS.askDeclined, {
      moment: ask.moment,
      channel: channelOf(ask.channels),
    });
    if (server.signedIn) void declinePicks([...ask.channels]);
    setGone(true);
  };
  const hide = () => {
    update((s) => recordHidden(s, ask.moment, new Date()));
    setGone(true);
  };
  const shown = () => {
    const today = pacific(new Date()).date;
    const first = !state?.exposures.some(
      (e) => e.m === ask.moment && e.d === today,
    );
    update((s) => recordShown(s, ask, new Date()));
    if (first)
      trackEvent(EVENTS.askShown, {
        moment: ask.moment,
        channel: channelOf(ask.channels),
      });
  };
  const signedUp = (c: Channel) => update((s) => recordOn(s, c));

  return (
    <AskBody
      key={ask.moment}
      ask={ask}
      server={server}
      onShown={shown}
      onOpened={opened}
      onDecline={decline}
      onHide={ask.moment === "next_pick" ? hide : undefined}
      onSignedUp={signedUp}
    />
  );
}

function AskBody({
  ask,
  server,
  onShown,
  onOpened,
  onDecline,
  onHide,
  onSignedUp,
}: {
  ask: Ask;
  server: AskServer;
  onShown: () => void;
  onOpened: (c: Channel) => void;
  onDecline: () => void;
  onHide?: () => void;
  onSignedUp: (c: Channel) => void;
}) {
  const [open, setOpen] = useState<Channel | null>(null);
  const [sheet, setSheet] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const shownRef = useRef(onShown);
  useEffect(() => {
    shownRef.current = onShown;
  });
  // An exposure: at least half the row on screen (once; the state keeps
  // it to one a day).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          shownRef.current();
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const textChip = (moment: Moment, label: string) =>
    server.phone && server.phoneFresh ? (
      <button
        type="button"
        className="chip min-h-11"
        onClick={() => (onOpened("text"), setSheet(true))}
      >
        <Icon name="phone" size={22} /> {label}
      </button>
    ) : (
      <Link
        href={`/texts?from=${moment}`}
        className="chip min-h-11"
        onClick={() => onOpened("text")}
      >
        <Icon name="phone" size={22} /> {label}
      </Link>
    );

  let icon: IconName;
  let lead: ReactNode;
  let line: ReactNode;
  let chips: ReactNode;
  let panel: ReactNode = null;
  if (ask.moment === "next_pick") {
    icon = "stamp";
    lead = `You stamped ${ask.park}!`;
    line = "Want a new playground to try every week?";
    chips = (
      <>
        {ask.channels.includes("email") ? (
          <button
            type="button"
            className="chip min-h-11"
            aria-expanded={open === "email"}
            onClick={() => (onOpened("email"), setOpen("email"))}
          >
            <Icon name="mail" size={22} /> By email
          </button>
        ) : null}
        {ask.channels.includes("text")
          ? textChip("next_pick", "By text")
          : null}
      </>
    );
    if (open === "email")
      panel = (
        <div className="flex flex-col gap-2">
          {done ? null : (
            <p className="leading-snug">
              {NEWS_NAME}: a playground to try, Thursday mornings.
            </p>
          )}
          <EmailSignup
            source="next_pick"
            fine="Unsubscribe anytime."
            inline
            autoFocus
            doneText={(first) =>
              first
                ? `You're in! Your first email comes ${first}.`
                : PARK_NEWS.success
            }
            onDone={() => (setDone(true), onSignedUp("email"))}
          />
          {!done && ask.channels.includes("text") ? (
            <TextsLink from="next_pick" />
          ) : null}
        </div>
      );
  } else if (ask.moment === "rainy_spin") {
    icon = "rain";
    lead = `${ask.wet.kind} on ${ask.wet.day}?`;
    line = "Thursday's email has a playground and a warm indoor backup.";
    chips = (
      <button
        type="button"
        className="chip min-h-11"
        aria-expanded={open === "email"}
        onClick={() => (onOpened("email"), setOpen("email"))}
      >
        <Icon name="mail" size={22} /> Email me Thursdays
      </button>
    );
    if (open === "email")
      panel = (
        <EmailSignup
          source="rainy_spin"
          fine={server.signedIn ? "Unsubscribe anytime." : PARK_NEWS.fine}
          inline
          autoFocus
          doneText={successLine}
          onDone={() => (setDone(true), onSignedUp("email"))}
        />
      );
  } else {
    icon = "phone";
    lead = "Planning the weekend?";
    line = "Get one playground by text, Friday afternoons.";
    chips = textChip("weekend_spin", "Get the Weekend Pick");
  }

  return (
    <section
      ref={ref}
      aria-label="Weekly park picks"
      className="relative flex flex-col gap-2 rounded-3xl border-2 border-dashed border-ink/30 px-4 py-3"
    >
      {onHide && !done ? (
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide for now"
          className="absolute top-1 right-1 grid size-11 place-items-center text-2xl text-ink-soft"
        >
          ×
        </button>
      ) : null}
      <div className="flex items-start gap-3 pr-6">
        <Icon name={icon} size={34} className="mt-0.5 shrink-0" />
        <p className="leading-snug">
          <b className="font-hand text-2xl font-normal">{lead}</b>
          <br />
          {line}
        </p>
      </div>
      {panel ?? (
        <div className="flex flex-wrap items-center gap-2 pl-[46px]">
          {chips}
        </div>
      )}
      {done ? null : (
        <button
          type="button"
          onClick={onDecline}
          className="min-h-11 self-start pl-[46px] text-ink-soft underline underline-offset-2"
        >
          No thanks
        </button>
      )}
      {sheet && server.phone ? (
        <TextsSheet
          moment={ask.moment}
          phone={server.phone}
          sendingOn={server.textsSendingOn}
          textsFrom={server.textsFrom}
          onClose={() => setSheet(false)}
          onYes={() => (setDone(true), onSignedUp("text"))}
        />
      ) : null}
    </section>
  );
}

/**
 * The text consent sheet (from next_pick and weekend_spin): the Weekend
 * Pick heading and subtitle (TEXTS_COPY), then the same consent block and
 * button as /texts (ParkTextsCard, words from the frozen constant), with
 * the moment as the consent's source. Not now records nothing.
 */
function TextsSheet({
  moment,
  phone,
  sendingOn,
  textsFrom,
  onClose,
  onYes,
}: {
  moment: Moment;
  phone: string;
  sendingOn: boolean;
  textsFrom: string | null;
  onClose: () => void;
  onYes: () => void;
}) {
  const id = useId();
  const [yes, setYes] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  // Focus moves in (to the heading), stays in (Tab wraps), and goes back
  // to whatever opened the sheet when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("h2")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closeRef.current();
      if (e.key !== "Tab" || !box.current) return;
      const f = [
        ...box.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !box.current.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !box.current.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        className="doodle-box relative mx-3 mb-[max(env(safe-area-inset-bottom),0.75rem)] flex max-h-[calc(100dvh-2rem)] w-full max-w-md animate-pop-in flex-col gap-3 overflow-y-auto px-5 pt-5 pb-4 shadow-[4px_6px_0_#2b2a33]"
      >
        <div className="flex items-start gap-3">
          <Icon name="phone" size={40} className="shrink-0" />
          <div>
            <h2
              id={`${id}-h`}
              tabIndex={-1}
              className="font-hand text-4xl leading-tight outline-none"
            >
              {TEXTS_COPY.title.replace(/ Pick$/, "")}{" "}
              <span className="text-crayon-green">Pick</span>
            </h2>
            <p className="leading-snug">{TEXTS_COPY.subtitle}</p>
          </div>
        </div>
        <ParkTextsCard
          number={phone}
          source={moment}
          sendingOn={sendingOn}
          textsFrom={textsFrom}
          bare
          onDone={(s) => {
            if (s !== "on" && s !== "already") return;
            setYes(true);
            onYes();
          }}
        />
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 text-lg text-ink-soft underline underline-offset-2"
        >
          {yes ? "Done" : "Not now"}
        </button>
      </div>
    </div>
  );
}
