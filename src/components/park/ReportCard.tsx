"use client";

import { useState, useTransition } from "react";
import { updateFeatures } from "@/lib/actions";
import { ATTR_GROUPS, ATTRIBUTES, attributeScores } from "@/lib/features";
import { AttrSticker, AttrToggle } from "./AttrChip";
import { JoinNudge } from "./JoinNudge";
import { sfx } from "@/lib/sound";

const TILTS = [-1.5, 1, -0.5, 1.8, -1, 0.6];

export function ReportCard({
  parkId,
  features,
  confidence,
  reports,
  signedIn,
}: {
  parkId: number;
  features: string[];
  confidence: string;
  /** How many reviews tagged each attribute. */
  reports: Record<string, number>;
  signedIn: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [nudge, setNudge] = useState(false);
  const unchecked = confidence !== "confirmed";

  const scores = attributeScores(features, reports);
  const keys = Object.keys(scores)
    .filter((k) => ATTRIBUTES[k] && scores[k] > 0)
    .sort((a, b) => scores[b] - scores[a]);
  const headsUp = keys.filter((k) => ATTRIBUTES[k].kind === "heads_up");
  const good = keys.filter((k) => ATTRIBUTES[k].kind === "good");
  const sticker = (k: string, i: number) => (
    <AttrSticker
      key={k}
      k={k}
      count={reports[k] ?? 0}
      fromMap={unchecked && !reports[k]}
      tilt={TILTS[i % TILTS.length]}
    />
  );

  return (
    <section aria-labelledby="report-card" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <h2 id="report-card" className="font-hand text-3xl">
          📝 Report card
        </h2>
        {!editing && (
          <button
            type="button"
            className="chip min-h-11 text-base"
            onClick={() => (signedIn ? setEditing(true) : setNudge((n) => !n))}
          >
            ✏️ Fix what&apos;s here
          </button>
        )}
      </div>

      {nudge && !signedIn && (
        <JoinNudge
          emoji="✏️"
          line="Join to fix the list!"
          onClose={() => setNudge(false)}
        />
      )}

      {editing ? (
        <FeatureEditor
          parkId={parkId}
          initial={features}
          onDone={() => setEditing(false)}
        />
      ) : keys.length === 0 ? (
        <div className="doodle-box-alt flex items-center gap-3 p-4">
          <span className="text-4xl" aria-hidden>
            🤷
          </span>
          <p className="font-hand text-xl leading-tight text-ink-soft">
            Nothing on the report card yet. Been here? Tell us what&apos;s here!
          </p>
        </div>
      ) : (
        <>
          {headsUp.length > 0 && (
            <div className="doodle-box border-crayon-red bg-[color-mix(in_srgb,var(--color-crayon-orange)_12%,#fffdf7)] p-3 pt-2">
              <p className="font-hand text-xl text-crayon-red">
                ⚠️ Heads up, grown-ups
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {headsUp.map(sticker)}
              </ul>
            </div>
          )}
          {good.length > 0 && (
            <div>
              <p className="font-hand text-xl text-crayon-green">
                ⭐ Good stuff
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {good.map(sticker)}
              </ul>
            </div>
          )}
          <p className="text-sm leading-snug text-ink-soft">
            {unchecked ? (
              <>
                <span className="mr-1 inline-block w-6 border-b-2 border-dashed border-ink/50 align-middle" />
                Dashed ones came from the map and might be fibbing.
              </>
            ) : (
              "✅ Checked by explorers."
            )}{" "}
            ×2 means two critics said so.
          </p>
        </>
      )}
    </section>
  );
}

function FeatureEditor({
  parkId,
  initial,
  onDone,
}: {
  parkId: number;
  initial: string[];
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (k: string) =>
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  return (
    <div className="doodle-box flex animate-pop-in flex-col gap-3 p-4">
      <p className="text-[0.95rem] leading-snug">
        This list came from maps, so it may be wrong. Tap what&apos;s{" "}
        <span className="highlight">really there</span>, the way you saw it.
      </p>
      {ATTR_GROUPS.map((g) => (
        <fieldset key={g.key}>
          <legend
            className={`font-hand text-lg ${g.key === "heads_up" ? "text-crayon-red" : ""}`}
          >
            {g.key === "heads_up" ? "⚠️ " : ""}
            {g.label}
          </legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(ATTRIBUTES)
              .filter(([, a]) => a.group === g.key)
              .map(([k]) => (
                <AttrToggle
                  key={k}
                  k={k}
                  on={picked.includes(k)}
                  onClick={() => toggle(k)}
                />
              ))}
          </div>
        </fieldset>
      ))}
      {error && <p className="font-hand text-lg text-crayon-red">{error}</p>}
      <div className="sticky bottom-24 flex gap-3 pt-1">
        <button
          type="button"
          className="crayon-btn min-h-12 bg-paper px-4 text-lg"
          onClick={onDone}
        >
          Never mind
        </button>
        <button
          type="button"
          className="crayon-btn wax min-h-12 flex-1 bg-crayon-yellow"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await updateFeatures({ parkId, features: picked });
              if (!res.ok) return (sfx.oops(), setError(res.error));
              sfx.scribble();
              onDone();
            })
          }
        >
          {pending ? "Saving…" : "Save the list"}
        </button>
      </div>
    </div>
  );
}
