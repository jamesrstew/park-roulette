"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { addPark } from "@/lib/actions";
import { CRAYONS, townCrayon } from "@/lib/crayons";
import type { ParkPin } from "@/lib/data-map";
import { ATTR_GROUPS, ATTRIBUTES } from "@/lib/features";
import { milesBetween, type LatLng } from "@/lib/geo";

const PinPicker = dynamic(() => import("./PinPicker"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-paper-dark font-hand text-xl text-ink-soft">
      Unfolding the map…
    </div>
  ),
});

const BEND: LatLng = { lat: 44.0582, lng: -121.3153 };
const OTHER = "__other__";
/** Closer than this to an existing park? Probably the same one. */
const DUPLICATE_MILES = 0.1;
/** Guess the town from the nearest park within this distance. */
const TOWN_GUESS_MILES = 4;

const PICKABLE = ATTR_GROUPS.filter((g) => g.key !== "heads_up").map((g) => ({
  ...g,
  keys: Object.entries(ATTRIBUTES)
    .filter(([, a]) => a.kind === "good" && a.group === g.key)
    .map(([k]) => k),
}));

function inOregon(p: LatLng) {
  return p.lat >= 42 && p.lat <= 46.5 && p.lng >= -124.7 && p.lng <= -116.4;
}

export function AddParkForm({
  towns,
  others,
  start,
}: {
  towns: string[];
  others: ParkPin[];
  start: LatLng | null;
}) {
  const [name, setName] = useState("");
  const [town, setTown] = useState("");
  const [otherTown, setOtherTown] = useState("");
  const [townTouched, setTownTouched] = useState(false);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [flyKey, setFlyKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nearest = useMemo(() => {
    if (!pin || others.length === 0) return null;
    let best: { park: ParkPin; mi: number } | null = null;
    for (const o of others) {
      const mi = milesBetween(pin, o);
      if (!best || mi < best.mi) best = { park: o, mi };
    }
    return best;
  }, [pin, others]);
  const duplicate =
    nearest && nearest.mi < DUPLICATE_MILES ? nearest.park : null;

  function pick(ll: LatLng) {
    setPin(ll);
    setError(null);
    // Guess the town from the closest park, until they pick one themselves.
    if (!townTouched) {
      let best: { city: string; mi: number } | null = null;
      for (const o of others) {
        const mi = milesBetween(ll, o);
        if (!best || mi < best.mi) best = { city: o.city, mi };
      }
      if (best && best.mi < TOWN_GUESS_MILES) setTown(best.city);
    }
  }

  function useMyLocation() {
    if (!("geolocation" in navigator))
      return setError("This phone can't share its location. Tap the map!");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pick({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFlyKey((k) => k + 1);
      },
      () => {
        setLocating(false);
        setError("Couldn't find you. Tap the map instead!");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }

  function toggle(k: string) {
    setFeatures((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));
  }

  const city = town === OTHER ? otherTown.trim() : town;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("What's the park called?");
    if (city.length < 2) return setError("Which town is it in?");
    if (!pin) return setError("Tap the map to drop a pin on it!");
    if (!inOregon(pin))
      return setError("That pin is outside Oregon! Drag it back home.");
    setError(null);
    startTransition(async () => {
      const r = await addPark({
        name: name.trim(),
        city,
        lat: pin.lat,
        lng: pin.lng,
        features,
        notes: notes.trim() || undefined,
      });
      // On success addPark redirects to the new park page.
      if (r && !r.ok) setError(r.error);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <label className="flex flex-col gap-1">
        <span className="font-hand text-2xl">What&apos;s it called?</span>
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sunny Pines Park"
          maxLength={80}
          autoComplete="off"
          enterKeyHint="next"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-hand text-2xl">Where is it?</legend>
        <div className="relative">
          <div className="tape -top-3 left-6 z-[1] -rotate-6" />
          <div className="tape -top-3 right-6 z-[1] rotate-6" />
          <div className="doodle-box h-64 overflow-hidden">
            <PinPicker
              start={start ?? BEND}
              startZoom={start ? 15 : 12}
              pin={pin}
              onPick={pick}
              others={others}
              flyKey={flyKey}
            />
          </div>
          {!pin && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 z-[1] flex justify-center">
              <span className="doodle-box-alt animate-pop-in bg-[#fffdf7] px-3 py-1 font-hand text-lg shadow-[2px_3px_0_#2b2a33]">
                👆 Tap where the playground is
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            className="crayon-btn wax bg-crayon-blue text-lg text-white"
            onClick={useMyLocation}
            disabled={locating}
          >
            📍 {locating ? "Finding you…" : "Use my location"}
          </button>
          <span className="text-sm text-ink-soft">
            {pin ? "Drag the pin to fine-tune." : "Or tap the map."}
          </span>
        </div>
        {duplicate && (
          <p className="doodle-box-alt animate-pop-in bg-[#fff1e3] px-3 py-2 text-sm">
            🤔 <b>{duplicate.name}</b> is right there. Same one?{" "}
            <Link
              href={`/parks/${duplicate.slug}`}
              className="font-hand text-base whitespace-nowrap text-crayon-blue underline"
            >
              Open it instead
            </Link>
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-hand text-2xl">Which town?</legend>
        <div className="flex flex-wrap gap-2">
          {towns.map((t) => (
            <button
              key={t}
              type="button"
              className="chip min-h-11"
              aria-pressed={town === t}
              style={
                town === t
                  ? { background: CRAYONS[townCrayon(t)], color: "#fff" }
                  : undefined
              }
              onClick={() => (setTown(t), setTownTouched(true))}
            >
              {t}
            </button>
          ))}
          <button
            type="button"
            className="chip min-h-11"
            aria-pressed={town === OTHER}
            onClick={() => (setTown(OTHER), setTownTouched(true))}
          >
            ✏️ Somewhere else
          </button>
        </div>
        {town === OTHER && (
          <input
            className="field animate-pop-in"
            value={otherTown}
            onChange={(e) => setOtherTown(e.target.value)}
            placeholder="Tumalo"
            maxLength={40}
            aria-label="Town name"
            autoFocus
          />
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-hand text-2xl">What&apos;s there?</legend>
        <p className="-mt-1 text-sm text-ink-soft">
          Tap the stickers you know about. Skip any you&apos;re not sure of.
        </p>
        {PICKABLE.map((g) => (
          <div key={g.key} className="flex flex-col gap-1.5">
            <span className="font-hand text-lg text-ink-soft">{g.label}</span>
            <div className="flex flex-wrap gap-2">
              {g.keys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="chip min-h-11"
                  aria-pressed={features.includes(k)}
                  onClick={() => toggle(k)}
                >
                  <span aria-hidden>{ATTRIBUTES[k].emoji}</span>{" "}
                  {ATTRIBUTES[k].label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="font-hand text-2xl">Anything else?</span>
        <textarea
          className="field min-h-24"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Behind the library. Park on Elm St."
          maxLength={500}
          rows={3}
        />
      </label>

      <div className="flex flex-col gap-2">
        {error && (
          <p
            role="alert"
            className="animate-wiggle text-center font-hand text-xl text-crayon-red"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          className="crayon-btn wax bg-crayon-green py-3 text-2xl text-white"
          disabled={pending}
        >
          {pending ? "Drawing it in…" : "🖍️ Put it on the map!"}
        </button>
        <Link
          href="/map"
          className="mx-auto flex min-h-11 items-center font-hand text-lg text-ink-soft underline"
        >
          Never mind
        </Link>
      </div>
    </form>
  );
}
