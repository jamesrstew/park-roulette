"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { storage } from "@/lib/storage";

const VIEWS_KEY = "pr:park-news-views";
/** Ask on this many different days, at most. */
const MAX_VIEWS = 3;
const noSubscribe = () => () => {};

function parseViews(raw: string | null): { n: number; day: string } {
  try {
    const v = JSON.parse(raw ?? "");
    return { n: Number(v.n) || 0, day: String(v.day ?? "") };
  } catch {
    return { n: 0, day: "" };
  }
}
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import {
  dismissParkNews,
  joinParkNews,
  stopParkNews,
} from "@/lib/client-actions";
import {
  cleanEmail,
  PARK_NEWS,
  type ParkNewsSource,
  suggestEmail,
} from "@/lib/park-news";
import { sfx } from "@/lib/sound";

/**
 * The email field, typo chip and button, shared by the inline ask and the
 * settings card. Typing your email and tapping the button is the yes.
 */
function EmailForm({
  source,
  initial = "",
  button = PARK_NEWS.button,
  onDone,
  onCancel,
  cancelLabel,
}: {
  source: ParkNewsSource;
  initial?: string;
  button?: string;
  onDone: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const id = useId();
  const [email, setEmail] = useState(initial);
  const [hint, setHint] = useState<string | null>(null);
  /** Offer the typo fix once; a second press sends it as typed. */
  const [hinted, setHinted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!cleanEmail(email)) return setError("That email looks off. Try again?");
    const fix = suggestEmail(email);
    if (fix && !hinted) {
      setHint(fix);
      setHinted(true);
      return;
    }
    start(async () => {
      const r = await joinParkNews(email, source);
      if (!r.ok) return (sfx.oops(), setError(r.error));
      sfx.pop();
      onDone();
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        Your email
      </label>
      <input
        id={id}
        className="field"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="send"
        maxLength={254}
        placeholder="you@example.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setHint(null);
          setHinted(false);
          setError(null);
        }}
        onBlur={() => setHint(suggestEmail(email))}
      />
      <div aria-live="polite">
        {hint ? (
          <button
            type="button"
            onClick={() => (setEmail(hint), setHint(null))}
            className="chip min-h-11 self-start text-sm"
          >
            <span>
              Did you mean <b className="font-semibold">{hint}</b>?
            </span>
          </button>
        ) : null}
      </div>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      <button
        type="submit"
        disabled={pending}
        className="crayon-btn wax min-h-12 bg-crayon-blue text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
      >
        {pending ? "One sec…" : button}
      </button>
      <p className="text-center text-sm leading-snug text-ink-soft">
        {PARK_NEWS.fine}{" "}
        <Link href="/privacy#park-news" className="underline">
          Privacy
        </Link>
      </p>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 text-sm text-ink-soft underline underline-offset-2"
        >
          {cancelLabel}
        </button>
      ) : null}
    </form>
  );
}

/**
 * The one-time, inline park news ask (never a popup): under the stamp on a
 * spin, and at the top of the Passport. Gone for good after a yes or a
 * "No thanks"; Family & settings always has it.
 */
export function ParkNewsAsk({
  source,
  show,
  explorerId,
}: {
  source: ParkNewsSource;
  /** Still unanswered (from the server). Once answered here, we stay put. */
  show: boolean;
  /** Views are counted per person (phones get shared). */
  explorerId: number;
}) {
  const [state, setState] = useState<"ask" | "done" | "gone">("ask");
  const [, start] = useTransition();
  const key = `${VIEWS_KEY}:${explorerId}`;
  const seen = useSyncExternalStore(
    noSubscribe,
    () => storage.get(key),
    () => null,
  );
  const views = parseViews(seen);
  // Seen on MAX_VIEWS different days without an answer: stop asking, the
  // same as "No thanks" (settings still has it). Quietly: no page refresh.
  useEffect(() => {
    if (!show) return;
    const v = parseViews(storage.get(key));
    const today = new Date().toDateString();
    if (v.day === today) return;
    const n = v.n + 1;
    storage.set(key, JSON.stringify({ n, day: today }));
    // The last allowed day: answer "No thanks" for them now (quietly), but
    // keep showing it today so it never vanishes mid-typing.
    if (n >= MAX_VIEWS) void dismissParkNews(true);
  }, [show, key]);
  // Hidden only when the cap was reached on an earlier day.
  const capped =
    views.n >= MAX_VIEWS && views.day !== new Date().toDateString();
  if (state === "ask" && (!show || capped)) return null;
  if (state === "gone") return null;
  if (state === "done")
    return (
      <p
        role="status"
        className="doodle-box-alt flex animate-pop-in items-center gap-2 px-4 py-3 font-hand text-xl"
      >
        <Icon name="check" size={28} /> {PARK_NEWS.success}
      </p>
    );
  return (
    <section
      aria-labelledby="park-news-h"
      className="doodle-box-alt flex flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-blue)_8%,#fffdf7)] px-4 py-3"
    >
      <h2
        id="park-news-h"
        className="flex items-center gap-2 font-hand text-2xl leading-tight"
      >
        <Icon name="mail" size={30} /> {PARK_NEWS.headline}
      </h2>
      <p className="-mt-1 leading-snug">{PARK_NEWS.body}</p>
      <EmailForm source={source} onDone={() => setState("done")} />
      <button
        type="button"
        onClick={() => {
          setState("gone");
          start(async () => {
            await dismissParkNews();
          });
        }}
        className="min-h-11 text-sm text-ink-soft underline underline-offset-2"
      >
        {PARK_NEWS.decline}
      </button>
    </section>
  );
}

/** Family & settings: on (address, Change, Stop) or off (Get park news). */
export function ParkNewsSettings({
  on,
  email,
  trusted,
}: {
  on: boolean;
  /** Only for a trusted session (never sent to a borrowed-link session). */
  email: string | null;
  trusted: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="news-settings-h"
      className="doodle-box-alt flex flex-col gap-2 px-4 py-3"
    >
      <h2
        id="news-settings-h"
        className="flex items-center gap-2 font-hand text-2xl leading-tight"
      >
        <Icon name="mail" size={30} /> Park news
      </h2>
      {!trusted && on ? (
        <>
          <p className="leading-snug">Park news is on, about once a month.</p>
          <StopButton onStopped={() => setSaved("Emails off.")} />
        </>
      ) : !trusted ? (
        <p className="leading-snug">
          Sign in with your own number to get park news.
        </p>
      ) : mode === "edit" ? (
        <EmailForm
          source="settings"
          initial={email ?? ""}
          button={email ? "Save" : PARK_NEWS.button}
          onDone={() => (setMode("view"), setSaved("Saved!"))}
          onCancel={() => setMode("view")}
          cancelLabel="Never mind"
        />
      ) : email ? (
        <>
          <div className="flex min-h-11 items-center gap-3">
            <p className="min-w-0 flex-1 truncate">{email}</p>
            <button
              type="button"
              onClick={() => (setMode("edit"), setSaved(null))}
              className="chip min-h-11 shrink-0"
            >
              Change
            </button>
          </div>
          <p className="text-sm text-ink-soft">
            Park news, about once a month.
          </p>
          <StopButton onStopped={() => setSaved("Emails off.")} />
        </>
      ) : (
        <>
          <p className="leading-snug">{PARK_NEWS.body}</p>
          <button
            type="button"
            onClick={() => (setMode("edit"), setSaved(null))}
            className="chip min-h-11 self-start"
          >
            Get park news
          </button>
        </>
      )}
      {saved ? (
        <p
          role="status"
          className="flex animate-pop-in items-center gap-2 font-hand text-xl"
        >
          <Icon name="check" size={24} /> {saved}
        </p>
      ) : null}
    </section>
  );
}

/** "Stop emails": one tap, no confirm step, works in any grown-up session. */
function StopButton({ onStopped }: { onStopped: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await stopParkNews();
            if (!r.ok) return setError(r.error);
            onStopped();
          })
        }
        className="min-h-11 self-start text-sm text-ink-soft underline underline-offset-2"
      >
        Stop emails
      </button>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </>
  );
}
